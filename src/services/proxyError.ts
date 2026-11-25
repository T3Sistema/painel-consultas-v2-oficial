/**
 * Leitura segura do corpo de erro das rotas internas de consulta
 * (`/api/consulta-pessoa`, `/api/consulta-empresa`). Nunca expõe texto cru de uma
 * resposta ao usuário: só aceita o campo `message` de um envelope JSON já
 * normalizado pelo servidor (ver `api/_lib/upstreamError.ts`) — nunca nome de
 * fornecedor, saldo, chave, endpoint ou qualquer outro detalhe técnico,
 * porque o servidor já removeu tudo isso antes de responder. Qualquer outra
 * forma de corpo (JSON inesperado, HTML, texto solto) cai no fallback
 * genérico — nunca é repassada como está.
 */
const GENERIC_MESSAGE = 'Não foi possível concluir a operação. Tente novamente em instantes.';

/**
 * Envelope de erro neutro dentro de um corpo JSON já lido — também aparece
 * em respostas 200 quando a consulta demorou e o servidor precisou começar a
 * responder antes de terminar (o status HTTP real se perde nesse caso).
 */
export function neutralErrorFromBody(body: unknown): { code: string; message: string } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { code, message } = body as { code?: unknown; message?: unknown };
  if (typeof code !== 'string' || typeof message !== 'string' || !message.trim()) return null;
  return { code, message };
}

export async function readNeutralErrorMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.clone().json();
    if (body && typeof body === 'object' && 'message' in body) {
      const message = (body as { message: unknown }).message;
      if (typeof message === 'string' && message.trim()) return message;
    }
  } catch {
    // corpo não é JSON válido — nunca expõe texto cru ao usuário
  }
  return GENERIC_MESSAGE;
}
