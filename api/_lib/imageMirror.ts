import { getSupabaseClient } from './supabase';
import {
  ALLOWED_MIME,
  MAX_IMAGE_BYTES,
  createSignedImageUrl,
  decodeBase64,
  extensionForMime,
  fetchExternalImage,
  sha256Hex,
  sniffMimeType,
  uploadImageToBucket,
} from './uploads';

/**
 * Espelhamento de imagens: toda imagem que chega numa resposta de consulta é
 * baixada/decodificada no servidor, gravada no bucket `imagens_url` e
 * substituída no payload por uma URL assinada do nosso próprio Storage —
 * antes de a resposta chegar ao navegador.
 *
 * Duas razões, ambas obrigatórias:
 *
 * 1. Persistência — a imagem passa a viver no nosso banco, não numa CDN de
 *    terceiro que pode expirar, rotacionar ou tirar o arquivo do ar.
 * 2. Neutralidade (ver CLAUDE.md) — uma `<img src="https://cdn-do-fornecedor/...">`
 *    entrega o domínio do fornecedor ao navegador em texto claro. Depois do
 *    espelhamento nenhum host externo sobra no payload.
 *
 * Por isso, quando o espelhamento de uma URL falha, o campo vira `null` em vez
 * de manter a URL original: perder a miniatura é aceitável, vazar o domínio do
 * fornecedor não é. Base64 que falha continua como veio — é dado embutido, sem
 * host nenhum para vazar, e o painel já sabe renderizá-lo.
 */

/** URL assinada longa (7 dias): a consulta fica aberta por horas e o snapshot salvo referencia a mesma URL. */
export const MIRROR_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

const MAX_DEPTH = 8;
const MAX_IMAGES_PER_PAYLOAD = 60;
const DOWNLOAD_CONCURRENCY = 4;
const MIRROR_PREFIX = 'espelho';

const IMAGE_KEY_HINT_RE = /(foto|imagem|selfie|fotografia|avatar|picture|photo|documento|anexo|thumb|image)/;
const GENERIC_URL_KEY_RE = /^(url|link|href|src)$/;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp)(\?|#|$)/i;
const BASE64_KEY_HINT_RE = /(foto|imagem|selfie|fotografia|avatar|picture|photo|documento|anexo|base64)/;
const BASE64_CHARSET_RE = /^[A-Za-z0-9+/\s]+={0,2}$/;
const DATA_URL_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

export interface MirrorStats {
  /** Quantas imagens foram detectadas no payload. */
  found: number;
  /** Quantas terminaram apontando para o nosso Storage. */
  mirrored: number;
  /** Quantas não puderam ser espelhadas (campo removido, no caso de URL). */
  failed: number;
}

interface MirrorTarget {
  kind: 'url' | 'base64';
  value: string;
  assign: (replacement: unknown) => void;
}

/** URL http(s) que o painel renderizaria como imagem — mesma heurística de `src/lib/profileRender.ts`. */
export function looksLikeImageUrl(key: string, value: string, containerKey?: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  if (IMAGE_EXT_RE.test(value)) return true;
  const normalizedKey = key.toLowerCase();
  if (IMAGE_KEY_HINT_RE.test(normalizedKey)) return true;
  if (containerKey && GENERIC_URL_KEY_RE.test(normalizedKey) && IMAGE_KEY_HINT_RE.test(containerKey.toLowerCase())) {
    return true;
  }
  return false;
}

/** Candidato a imagem em Base64 — confirmado depois por magic bytes, nunca só pelo nome da chave. */
export function looksLikeBase64Image(key: string, value: string): boolean {
  if (DATA_URL_IMAGE_RE.test(value)) return true;
  if (value.length < 200) return false;
  if (!BASE64_KEY_HINT_RE.test(key.toLowerCase())) return false;
  return BASE64_CHARSET_RE.test(value.trim());
}

/** Já é uma URL do nosso Storage — não reespelha (evita cópia de cópia num payload já processado). */
function isAlreadyMirrored(value: string): boolean {
  const base = process.env.SUPABASE_URL;
  if (!base) return false;
  try {
    return new URL(value).host === new URL(base).host;
  } catch {
    return false;
  }
}

function stripDataUrlPrefix(value: string): string {
  return value.replace(DATA_URL_IMAGE_RE, '');
}

function walk(
  node: unknown,
  key: string,
  containerKey: string | undefined,
  depth: number,
  targets: MirrorTarget[],
  assign: (replacement: unknown) => void,
): void {
  if (depth > MAX_DEPTH || targets.length >= MAX_IMAGES_PER_PAYLOAD) return;

  if (typeof node === 'string') {
    if (looksLikeImageUrl(key, node, containerKey)) {
      if (!isAlreadyMirrored(node)) targets.push({ kind: 'url', value: node, assign });
    } else if (looksLikeBase64Image(key, node)) {
      targets.push({ kind: 'base64', value: node, assign });
    }
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item, index) => {
      // Itens de array herdam a chave do array como contexto (ex.: `fotos: [{ url }]`).
      walk(item, key, key, depth + 1, targets, (replacement) => {
        node[index] = replacement;
      });
    });
    return;
  }

  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    for (const [childKey, childValue] of Object.entries(obj)) {
      walk(childValue, childKey, key || containerKey, depth + 1, targets, (replacement) => {
        obj[childKey] = replacement;
      });
    }
  }
}

export function collectMirrorTargets(payload: unknown): MirrorTarget[] {
  const targets: MirrorTarget[] = [];
  walk(payload, '', undefined, 0, targets, () => {});
  return targets.slice(0, MAX_IMAGES_PER_PAYLOAD);
}

/** Consulta o índice de imagens já espelhadas. Nunca lança — sem índice, apenas reespelha. */
async function lookupMirroredPath(sourceHash: string): Promise<string | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('mirrored_images')
      .select('storage_path')
      .eq('source_hash', sourceHash)
      .maybeSingle();
    if (error || !data) return null;
    return (data.storage_path as string) ?? null;
  } catch {
    return null;
  }
}

/** Registra a imagem espelhada. Nunca lança — o objeto já está no bucket, o índice é só cache. */
async function recordMirroredImage(
  sourceHash: string,
  storagePath: string,
  mimeType: string,
  byteSize: number,
): Promise<void> {
  try {
    const supabase = getSupabaseClient();
    await supabase
      .from('mirrored_images')
      .upsert(
        { source_hash: sourceHash, storage_path: storagePath, mime_type: mimeType, byte_size: byteSize },
        { onConflict: 'source_hash' },
      );
  } catch {
    // Índice é otimização de cache; falha aqui não invalida o upload.
  }
}

/** Valida (magic bytes), sobe para o bucket, indexa e devolve a URL assinada. */
async function storeAndSign(sourceHash: string, bytes: Uint8Array): Promise<string | null> {
  const mimeType = sniffMimeType(bytes);
  if (!ALLOWED_MIME.has(mimeType)) return null;

  const path = `${MIRROR_PREFIX}/${sourceHash}.${extensionForMime(mimeType)}`;
  const uploaded = await uploadImageToBucket(path, bytes, mimeType);
  if (!uploaded.ok) return null;

  await recordMirroredImage(sourceHash, path, mimeType, bytes.byteLength);
  return createSignedImageUrl(path, MIRROR_SIGNED_URL_TTL_SECONDS);
}

async function mirrorUrl(sourceUrl: string): Promise<string | null> {
  // Chaveado pela URL de origem (não pelo conteúdo) para poder pular o
  // download inteiro quando a mesma imagem já foi espelhada antes.
  const sourceHash = await sha256Hex(new TextEncoder().encode(`url:${sourceUrl}`));

  const cachedPath = await lookupMirroredPath(sourceHash);
  if (cachedPath) {
    const signed = await createSignedImageUrl(cachedPath, MIRROR_SIGNED_URL_TTL_SECONDS);
    if (signed) return signed;
  }

  const fetched = await fetchExternalImage(sourceUrl, { maxBytes: MAX_IMAGE_BYTES });
  if (!fetched.ok) return null;
  return storeAndSign(sourceHash, fetched.bytes);
}

async function mirrorBase64(rawBase64: string): Promise<string | null> {
  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(stripDataUrlPrefix(rawBase64));
  } catch {
    return null;
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;

  const sourceHash = await sha256Hex(bytes);
  const cachedPath = await lookupMirroredPath(sourceHash);
  if (cachedPath) {
    const signed = await createSignedImageUrl(cachedPath, MIRROR_SIGNED_URL_TTL_SECONDS);
    if (signed) return signed;
  }

  return storeAndSign(sourceHash, bytes);
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      // eslint-disable-next-line no-await-in-loop -- é justamente o worker serial do pool
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/**
 * Percorre o payload já parseado, espelha toda imagem encontrada e substitui
 * o valor no lugar (mutação in-place — o chamador é dono do objeto, que veio
 * de um `JSON.parse` local). Nunca lança.
 */
export async function mirrorImagesInPayload(payload: unknown): Promise<MirrorStats> {
  const targets = collectMirrorTargets(payload);
  // Sem imagem nenhuma: não toca no Storage (nem exige Supabase configurado).
  if (targets.length === 0) return { found: 0, mirrored: 0, failed: 0 };

  // Mesma imagem repetida no payload é baixada uma vez só.
  const resolved = new Map<string, string | null>();
  const unique = [...new Map(targets.map((t) => [`${t.kind}:${t.value}`, t])).values()];

  await runPool(unique, DOWNLOAD_CONCURRENCY, async (target) => {
    const mirrored = target.kind === 'url' ? await mirrorUrl(target.value) : await mirrorBase64(target.value);
    resolved.set(`${target.kind}:${target.value}`, mirrored);
  });

  let mirrored = 0;
  let failed = 0;
  for (const target of targets) {
    const replacement = resolved.get(`${target.kind}:${target.value}`) ?? null;
    if (replacement) {
      target.assign(replacement);
      mirrored += 1;
      continue;
    }
    failed += 1;
    // URL externa que não pôde ser espelhada nunca segue para o navegador.
    // Base64 é dado embutido (sem host a vazar) — fica como veio.
    if (target.kind === 'url') target.assign(null);
  }

  return { found: targets.length, mirrored, failed };
}
