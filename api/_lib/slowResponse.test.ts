import { describe, expect, it } from 'vitest';
import { respondWhenReady } from './slowResponse';

const later = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('respondWhenReady', () => {
  it('trabalho rápido → resposta original, com o status original', async () => {
    const res = await respondWhenReady(later(5, json({ code: 'not_found', message: 'x' }, 404)), { directWithinMs: 200 });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ code: 'not_found', message: 'x' });
  });

  it('trabalho lento → começa a responder já (200 + espaços) e termina com o corpo, ainda JSON válido', async () => {
    const started = Date.now();
    const res = await respondWhenReady(later(120, json({ code: 'timeout', message: 'demorou', id: 'a1' }, 504)), {
      directWithinMs: 10,
      heartbeatMs: 20,
    });
    expect(Date.now() - started).toBeLessThan(100); // não esperou o trabalho
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text.startsWith('  ')).toBe(true); // houve batidas antes do corpo
    expect(JSON.parse(text)).toEqual({ code: 'timeout', message: 'demorou', id: 'a1' });
  });

  it('trabalho lento que falha → envelope neutro, nunca o erro cru', async () => {
    const res = await respondWhenReady(later(30, null).then(() => Promise.reject(new Error('detalhe interno'))), {
      directWithinMs: 5,
      heartbeatMs: 10,
    });
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ code: 'processing_failed', message: 'Não foi possível concluir a operação.' });
    expect(text).not.toMatch(/detalhe interno/);
  });
});
