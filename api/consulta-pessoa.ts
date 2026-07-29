import { isValidCPF, onlyDigits } from '../src/lib/format';
import { requireSession } from './_lib/auth';
import { mirrorImagesInPayload } from './_lib/imageMirror';
import { diagnosticId, normalizeUnreachableError, normalizeUpstreamError } from './_lib/upstreamError';

export const config = { runtime: 'edge' };

/**
 * Protegida por sessão (ver api/_lib/auth.ts) — exige cookie de sessão
 * válido antes de consumir créditos pagos da APIFull.
 *
 * Não há rate-limit nem controle de concorrência no servidor (exige
 * KV/Redis, que este projeto não tem) — a mitigação adicional é client-side
 * (cache por CPF, lotes com concorrência limitada, confirmação antes de
 * cascatas grandes). Ver README.
 */

const MAX_BODY_BYTES = 2048; // {"cpf":"...","link":"cpf-ultra"} nunca chega perto disso
const UPSTREAM_TIMEOUT_MS = 15000;

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  });
}

/** Testável isoladamente (ver api/consulta-pessoa.test.ts). Nunca lança — sempre retorna um resultado. */
export function normalizeAndValidateCpf(rawBody: string): { ok: true; cpf: string } | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, message: 'Corpo da requisição deve ser JSON válido.' };
  }
  if (typeof parsed !== 'object' || parsed === null || !('cpf' in parsed)) {
    return { ok: false, message: 'Campo "cpf" é obrigatório.' };
  }
  const rawCpf = (parsed as { cpf: unknown }).cpf;
  if (typeof rawCpf !== 'string') {
    return { ok: false, message: 'Campo "cpf" deve ser uma string.' };
  }
  const cpf = onlyDigits(rawCpf);
  if (!isValidCPF(cpf)) {
    return { ok: false, message: 'CPF inválido: informe um CPF com 11 dígitos e dígitos verificadores válidos.' };
  }
  return { ok: true, cpf };
}

/**
 * Proxy same-origin para a APIFull (cpf-ultra): o frontend nunca chama a
 * APIFull diretamente. `link` é sempre fixado aqui — o cliente não escolhe.
 */
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

  const validated = normalizeAndValidateCpf(rawBody);
  if (!validated.ok) {
    return jsonResponse({ code: 'invalid_cpf', message: validated.message }, 400);
  }

  const authorization = process.env.APIFULL_AUTHORIZATION;
  if (!authorization) {
    return jsonResponse(
      { code: 'configuration_incomplete', message: 'Configuração interna incompleta.', id: diagnosticId() },
      500,
    );
  }

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch('https://api.apifull.com.br/api/cpf-ultra', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify({ cpf: validated.cpf, link: 'cpf-ultra' }),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return normalizeUnreachableError('apifull-proxy', startedAt, aborted ? 'timeout' : 'unreachable');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!upstream.ok) {
    return normalizeUpstreamError('apifull-proxy', upstream, startedAt);
  }

  const body = await upstream.text();

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    // Corpo 2xx que não é JSON não pode ser inspecionado em busca de imagens,
    // então também não pode ser repassado — poderia carregar URL de origem.
    return jsonResponse(
      { code: 'unexpected_response', message: 'Não foi possível processar a resposta da consulta.', id: diagnosticId() },
      502,
    );
  }

  // Toda imagem da resposta passa a viver no nosso Storage; nenhuma URL de
  // origem chega ao navegador (ver api/_lib/imageMirror.ts).
  const imageStats = await mirrorImagesInPayload(payload);

  console.log('[apifull-proxy]', {
    status: upstream.status,
    durationMs: Date.now() - startedAt,
    requestId: upstream.headers.get('x-request-id') ?? undefined,
    imagens: imageStats,
  });

  return jsonResponse(payload, upstream.status);
}
