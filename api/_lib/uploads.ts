import { getSupabaseClient } from './supabase';
import { isSafeExternalHost } from './ssrf';

export const BUCKET = 'imagens_url';
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Extensão do objeto no bucket. Importa porque a URL assinada preserva o
 * caminho do objeto: com `.jpg` no fim, o detector de imagem do painel
 * (`isLikelyImageUrl`, em src/lib/profileRender.ts) continua reconhecendo a
 * URL espelhada como imagem mesmo quando o nome do campo não é sugestivo.
 */
export function extensionForMime(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] ?? 'bin';
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

/** Sniffing de magic bytes — nunca confia no Content-Type/nome de campo informado pelo cliente. */
export function sniffMimeType(bytes: Uint8Array): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export type FetchImageResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/**
 * Baixa uma imagem de terceiro (URL http/https recebida da APIFull) com
 * timeout, teto de tamanho e defesa de SSRF — nunca segue redirect
 * automaticamente (`redirect: 'manual'`).
 */
export async function fetchExternalImage(
  rawUrl: string,
  opts: { maxBytes?: number; timeoutMs?: number } = {},
): Promise<FetchImageResult> {
  const maxBytes = opts.maxBytes ?? MAX_IMAGE_BYTES;
  const timeoutMs = opts.timeoutMs ?? 10_000;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'URL inválida.' };
  }
  if (!isSafeExternalHost(url)) {
    return { ok: false, error: 'Host não permitido.' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), { redirect: 'manual', signal: controller.signal });
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, error: 'Redirecionamento não permitido.' };
    }
    if (!res.ok) {
      return { ok: false, error: `Falha ao baixar imagem (HTTP ${res.status}).` };
    }
    const contentLength = Number(res.headers.get('content-length') ?? '0');
    if (contentLength > maxBytes) {
      return { ok: false, error: 'Imagem excede o tamanho permitido.' };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) {
      return { ok: false, error: 'Imagem excede o tamanho permitido.' };
    }
    return { ok: true, bytes: buf };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: aborted ? 'Tempo limite excedido ao baixar a imagem.' : 'Não foi possível baixar a imagem.' };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function uploadImageToBucket(
  path: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mimeType, upsert: false });
    if (error) {
      // Já existe (mesmo hash) — dedupe, não é falha.
      if (/duplicate|already exists/i.test(error.message)) return { ok: true };
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch {
    // Storage indisponível/não configurado: falha de upload como outra qualquer,
    // nunca uma exceção que derruba a consulta inteira.
    return { ok: false, error: 'storage_unavailable' };
  }
}

export async function createSignedImageUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
    if (error || !data) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

export async function removeBucketImages(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const supabase = getSupabaseClient();
  await supabase.storage.from(BUCKET).remove(paths);
}
