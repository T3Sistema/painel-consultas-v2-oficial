/**
 * Consultas externas lentas × limite da plataforma.
 *
 * No runtime edge da Vercel a função precisa COMEÇAR a responder em ~25s,
 * mas pode continuar transmitindo por bem mais tempo. Algumas consultas
 * externas passam disso. Então:
 *
 * - se o trabalho termina em `directWithinMs`, a resposta sai como sempre
 *   (status HTTP original, nada muda para o cliente);
 * - senão, a resposta começa já com status 200 e vai mandando espaços em
 *   branco a cada `heartbeatMs` (JSON.parse ignora espaço inicial) até o
 *   trabalho terminar; aí o corpo final é escrito. Nesse caminho o status
 *   original se perde, então o corpo carrega a informação: erros já são
 *   sempre o envelope neutro `{ code, message, id }` (ver upstreamError.ts),
 *   e o cliente o reconhece também numa resposta 200.
 *
 * Server-only — nunca importado por `src/`.
 */
export async function respondWhenReady(
  work: Promise<Response>,
  opts: { directWithinMs?: number; heartbeatMs?: number } = {},
): Promise<Response> {
  const directWithinMs = opts.directWithinMs ?? 8000;
  const heartbeatMs = opts.heartbeatMs ?? 5000;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const early = await Promise.race([
    work.then((res) => ({ res })),
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), directWithinMs);
    }),
  ]);
  clearTimeout(timer);
  if (early) return early.res;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(' '));
      const beat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(' '));
        } catch {
          clearInterval(beat); // cliente desconectou
        }
      }, heartbeatMs);
      work
        .then((res) => res.text())
        .catch(() => JSON.stringify({ code: 'processing_failed', message: 'Não foi possível concluir a operação.' }))
        .then((text) => {
          clearInterval(beat);
          try {
            controller.enqueue(encoder.encode(text));
            controller.close();
          } catch {
            // cliente já desconectou
          }
        });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
  });
}
