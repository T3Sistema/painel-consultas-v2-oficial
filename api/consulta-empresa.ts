import { requireSession } from './_lib/auth';
import { mirrorImagesInPayload } from './_lib/imageMirror';
import { diagnosticId, normalizeUnreachableError, normalizeUpstreamError } from './_lib/upstreamError';

export const config = { runtime: 'edge' };

/** Testável isoladamente (ver api/consulta-empresa.test.ts) */
export function buildCadastroPjUrl(cnpj: string): URL {
  const url = new URL('https://app.dabradata.com/api/v1/consulta/cadastro-pj-plus');
  url.searchParams.set('cnpj', cnpj); // minúsculo — case-sensitive na origem
  return url;
}

/**
 * Chave da consulta de CNPJ. `DABRADATA_API_KEY` é a atual; `FONTEDATA_API_KEY`
 * continua aceita como reserva, para um ambiente já configurado não parar de
 * funcionar enquanto a variável nova não é cadastrada.
 */
export function readCadastroPjKey(): string | undefined {
  return process.env.DABRADATA_API_KEY || process.env.FONTEDATA_API_KEY || undefined;
}

/**
 * Proxy same-origin para a consulta cadastro-pj-plus, protegido por
 * sessão (ver api/_lib/auth.ts): evita CORS ao chamar a partir do navegador e
 * mantém a chave fora do bundle client-side. No sucesso (2xx), repassa o
 * corpo do upstream sem reinterpretar (é o dado que a UI precisa). Numa
 * falha, NUNCA repassa o corpo/detalhe cru do upstream — normaliza via
 * `normalizeUpstreamError` (ver api/_lib/upstreamError.ts), que loga o
 * detalhe só no servidor e devolve um envelope neutro ao cliente.
 */
export default async function handler(req: Request): Promise<Response> {
  const auth = await requireSession(req);
  if (!auth.ok) return auth.response;

  const cnpj = new URL(req.url).searchParams.get('CNPJ');
  if (!cnpj || !/^\d{14}$/.test(cnpj)) {
    return new Response(
      JSON.stringify({ code: 'invalid_cnpj', message: 'Parâmetro CNPJ deve ter exatamente 14 dígitos.' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }

  const apiKey = readCadastroPjKey();
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        code: 'configuration_incomplete',
        message: 'Configuração interna incompleta.',
        id: diagnosticId(),
      }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const url = buildCadastroPjUrl(cnpj);
  const startedAt = Date.now();
  let upstream: Response;
  try {
    upstream = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
    });
  } catch {
    return normalizeUnreachableError('cnpj-proxy', startedAt, 'unreachable');
  }

  if (!upstream.ok) {
    return normalizeUpstreamError('cnpj-proxy', upstream, startedAt);
  }

  const body = await upstream.text();

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    // Corpo 2xx que não é JSON não pode ser inspecionado em busca de imagens,
    // então também não pode ser repassado — poderia carregar URL de origem.
    return new Response(
      JSON.stringify({
        code: 'unexpected_response',
        message: 'Não foi possível processar a resposta da consulta.',
        id: diagnosticId(),
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }

  // Toda imagem da resposta passa a viver no nosso Storage; nenhuma URL de
  // origem chega ao navegador (ver api/_lib/imageMirror.ts).
  const imageStats = await mirrorImagesInPayload(payload);

  // Log de diagnóstico (Vercel → Deployments → Functions → Logs) — nunca CNPJ, corpo ou chave.
  console.log('[cnpj-proxy]', {
    status: upstream.status,
    durationMs: Date.now() - startedAt,
    requestId: upstream.headers.get('x-request-id') ?? undefined,
    imagens: imageStats,
  });

  return new Response(JSON.stringify(payload), {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  });
}
