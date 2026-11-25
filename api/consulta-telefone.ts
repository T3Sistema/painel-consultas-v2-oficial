import { isValidCPF, isValidPhone, normalizePhone, onlyDigits } from '../src/lib/format';
import { requireSession } from './_lib/auth';
import { respondWhenReady } from './_lib/slowResponse';
import { diagnosticId, normalizeUnreachableError, normalizeUpstreamError } from './_lib/upstreamError';

export const config = { runtime: 'edge' };

/**
 * Busca reversa por telefone: devolve as pessoas (CPF + nome) vinculadas a
 * um número. O dossiê completo de cada pessoa continua vindo de
 * `/api/consulta-pessoa` — esta rota só resolve "telefone → quem".
 *
 * Protegida por sessão (ver api/_lib/auth.ts), como as demais rotas de
 * consulta paga. Server-only: o frontend só conhece `/api/consulta-telefone`.
 */

const MAX_BODY_BYTES = 2048;
/** Consultas por telefone podem passar de 20s; ver `respondWhenReady` para o limite da plataforma. */
const UPSTREAM_TIMEOUT_MS = 60000;
/** Uma busca reversa nunca deveria devolver muito mais que isso; o excedente é descartado. */
export const MAX_MATCHES = 30;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  });
}

/** Testável isoladamente. Nunca lança — sempre retorna um resultado. */
export function normalizeAndValidatePhone(rawBody: string): { ok: true; telefone: string } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, message: 'Corpo da requisição deve ser JSON válido.' };
  }
  if (typeof parsed !== 'object' || parsed === null || !('telefone' in parsed)) {
    return { ok: false, message: 'Campo "telefone" é obrigatório.' };
  }
  const raw = (parsed as { telefone: unknown }).telefone;
  if (typeof raw !== 'string') {
    return { ok: false, message: 'Campo "telefone" deve ser uma string.' };
  }
  if (!isValidPhone(raw)) {
    return { ok: false, message: 'Telefone inválido: informe DDD + número (10 ou 11 dígitos).' };
  }
  return { ok: true, telefone: normalizePhone(raw) };
}

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface PhoneMatch {
  cpf: string;
  nome?: string;
  nascimento?: string;
}

const NAME_KEYS = ['nome', 'nome_completo', 'nomecompleto', 'nome_pessoa', 'name'];
const BIRTH_KEY = /nasc|birth/i;

function pickString(obj: Dict, pred: (key: string) => boolean): string | undefined {
  for (const [k, v] of Object.entries(obj)) {
    if (!pred(k.toLowerCase())) continue;
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  }
  return undefined;
}

const isCpfKey = (k: string) => k === 'cpf' || k.startsWith('cpf_') || k.endsWith('_cpf') || k === 'documento';

/** Primeiro campo de CPF válido do objeto (string pontuada ou número sem zeros à esquerda). */
function pickCpf(obj: Dict): string | undefined {
  for (const [k, v] of Object.entries(obj)) {
    if (!isCpfKey(k.toLowerCase())) continue;
    let digits = '';
    if (typeof v === 'string') digits = onlyDigits(v);
    else if (typeof v === 'number' && Number.isInteger(v) && v > 0) digits = String(v).padStart(11, '0');
    if (isValidCPF(digits)) return digits;
  }
  return undefined;
}

/**
 * Extrai os CPFs (com nome/nascimento, quando presentes) do resultado.
 *
 * O formato de `dados` não é contratual (varia conforme a base consultada),
 * então a leitura é estrutural: qualquer objeto, em qualquer nível, com um
 * campo de CPF válido vira um resultado; o nome vem do mesmo objeto ou do
 * objeto pai imediato. CPF mascarado/inválido é descartado. Só esses três
 * campos atravessam — nenhum outro dado ou metadado de origem chega ao
 * navegador (ver CLAUDE.md, "Neutralidade do frontend").
 */
export function extractPhoneMatches(dados: unknown): PhoneMatch[] {
  const byCpf = new Map<string, PhoneMatch>();
  let visited = 0;

  const visit = (node: unknown, parent: Dict | null, depth: number) => {
    if (depth > 8 || visited > 5000 || byCpf.size >= MAX_MATCHES) return;
    visited++;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, parent, depth + 1);
      return;
    }
    if (!isDict(node)) return;

    const cpf = pickCpf(node);
    if (cpf) {
      const nome = pickString(node, (k) => NAME_KEYS.includes(k)) ?? (parent ? pickString(parent, (k) => NAME_KEYS.includes(k)) : undefined);
      const nascimento = pickString(node, (k) => BIRTH_KEY.test(k));
      const prev = byCpf.get(cpf);
      byCpf.set(cpf, { cpf, nome: prev?.nome ?? nome, nascimento: prev?.nascimento ?? nascimento });
    }
    for (const v of Object.values(node)) {
      if (typeof v === 'object' && v !== null) visit(v, node, depth + 1);
    }
  };

  visit(dados, null, 0);
  return [...byCpf.values()].map((m) => {
    const out: PhoneMatch = { cpf: m.cpf };
    if (m.nome) out.nome = m.nome;
    if (m.nascimento) out.nascimento = m.nascimento;
    return out;
  });
}

/** Formas de topo do resultado (só nomes de chave, nunca valores) — para diagnóstico no log do servidor. */
function shapeOf(v: unknown): string[] | string {
  if (Array.isArray(v)) return `array(${v.length})`;
  if (isDict(v)) return Object.keys(v).slice(0, 20);
  return typeof v;
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ code: 'method_not_allowed', message: 'Use POST.' }, 405);
  }

  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;

  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse({ code: 'payload_too_large', message: 'Corpo da requisição excede o tamanho permitido.' }, 413);
  }
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return jsonResponse({ code: 'payload_too_large', message: 'Corpo da requisição excede o tamanho permitido.' }, 413);
  }

  const validated = normalizeAndValidatePhone(rawBody);
  if (!validated.ok) {
    return jsonResponse({ code: 'invalid_phone', message: validated.message }, 400);
  }

  const authorization = process.env.APIFULL_AUTHORIZATION;
  if (!authorization) {
    return jsonResponse(
      { code: 'configuration_incomplete', message: 'Configuração interna incompleta.', id: diagnosticId() },
      500,
    );
  }

  return respondWhenReady(consultar(validated.telefone, authorization));
}

/** Chamada externa + recorte do resultado. Sempre devolve uma Response (nunca lança). */
async function consultar(telefone: string, authorization: string): Promise<Response> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch('https://api.apifull.com.br/api/pessoa-telefone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: authorization },
      body: JSON.stringify({ telefone, link: 'pessoa-telefone' }),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return normalizeUnreachableError('apifull-telefone', startedAt, aborted ? 'timeout' : 'unreachable');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!upstream.ok) {
    return normalizeUpstreamError('apifull-telefone', upstream, startedAt);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await upstream.text());
  } catch {
    return jsonResponse(
      { code: 'unexpected_response', message: 'Não foi possível processar a resposta da consulta.', id: diagnosticId() },
      502,
    );
  }

  // Rotas legadas podem devolver falha com HTTP 200: só `status: "sucesso"` conta.
  const dados = isDict(parsed) && parsed.status === 'sucesso' ? parsed.dados : undefined;
  const success = dados !== undefined;
  const pessoas = success ? extractPhoneMatches(dados) : [];

  console.log('[apifull-telefone]', {
    status: upstream.status,
    durationMs: Date.now() - startedAt,
    requestId: upstream.headers.get('x-request-id') ?? undefined,
    sucesso: success,
    resultados: pessoas.length,
    // Só nomes de chave: ajuda a ajustar a leitura se o formato mudar, sem logar dado pessoal.
    formato: success && pessoas.length === 0 ? shapeOf(dados) : undefined,
  });

  return jsonResponse({ status: pessoas.length > 0 ? 'sucesso' : 'sem_resultado', pessoas }, 200);
}
