import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({ requireSessionMock: vi.fn() }));
vi.mock('./_lib/auth', () => ({ requireSession: requireSessionMock }));

import handler, { buildCadastroPjUrl, readCadastroPjKey } from './consulta-empresa';

describe('buildCadastroPjUrl', () => {
  it('monta a URL exata esperada pela origem', () => {
    const url = buildCadastroPjUrl('33260563000178');

    expect(url.origin).toBe('https://app.dabradata.com');
    expect(url.pathname).toBe('/api/v1/consulta/cadastro-pj-plus');
    expect(url.searchParams.get('cnpj')).toBe('33260563000178');
    expect(url.searchParams.has('CNPJ')).toBe(false);
    expect(url.toString()).toBe(
      'https://app.dabradata.com/api/v1/consulta/cadastro-pj-plus?cnpj=33260563000178',
    );
  });
});

describe('readCadastroPjKey', () => {
  afterEach(() => {
    delete process.env.DABRADATA_API_KEY;
    delete process.env.FONTEDATA_API_KEY;
  });

  it('prefere a variável nova e aceita a anterior como reserva', () => {
    process.env.FONTEDATA_API_KEY = 'antiga';
    expect(readCadastroPjKey()).toBe('antiga');
    process.env.DABRADATA_API_KEY = 'nova';
    expect(readCadastroPjKey()).toBe('nova');
  });

  it('sem nenhuma das duas, devolve undefined', () => {
    expect(readCadastroPjKey()).toBeUndefined();
  });
});

function req(cnpj: string): Request {
  return new Request(`http://localhost/api/consulta-empresa?CNPJ=${cnpj}`);
}

describe('handler (api/consulta-empresa)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.FONTEDATA_API_KEY = 'test-api-key';
    requireSessionMock.mockReset();
    requireSessionMock.mockResolvedValue({ ok: true, userId: 'user-1' });
    fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ empresa: { razaoSocial: 'ACME' }, socios: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    logSpy.mockRestore();
    delete process.env.FONTEDATA_API_KEY;
    delete process.env.DABRADATA_API_KEY;
  });

  it('1. sem sessão válida retorna a resposta de requireSession sem chamar a FonteData', async () => {
    requireSessionMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const res = await handler(req('33260563000178'));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('2. CNPJ inválido retorna 400 sem chamar a API', async () => {
    const res = await handler(req('123'));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('3. chama a FonteData com X-API-Key e repassa o corpo', async () => {
    const res = await handler(req('33260563000178'));
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers['X-API-Key']).toBe('test-api-key');
    const body = await res.json();
    expect(body).toEqual({ empresa: { razaoSocial: 'ACME' }, socios: [] });
  });

  it('4. nunca loga o CNPJ nem o corpo da resposta da FonteData', async () => {
    await handler(req('33260563000178'));
    for (const call of logSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain('33260563000178');
      expect(serialized).not.toContain('ACME');
      expect(serialized).not.toContain('razaoSocial');
    }
  });

  it('5. retorna 500 sem chamar a API se FONTEDATA_API_KEY não estiver configurada', async () => {
    delete process.env.FONTEDATA_API_KEY;
    const res = await handler(req('33260563000178'));
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.code).toBe('configuration_incomplete');
    expect(body.message).not.toMatch(/api|chave|fontedata/i);
  });

  it('6. nunca repassa o corpo cru de um erro do upstream (nome, domínio, saldo, chave) — devolve envelope neutro', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Saldo insuficiente na conta FonteData (https://fontedata.com). Chave sk_live_ABC123 inválida.',
        }),
        { status: 402, headers: { 'content-type': 'application/json' } },
      ),
    );
    const res = await handler(req('33260563000178'));
    expect(res.status).toBe(402);
    const text = await res.text();
    expect(text).not.toMatch(/fontedata|saldo|sk_live|chave/i);
    const body = JSON.parse(text);
    expect(body).toHaveProperty('code');
    expect(body).toHaveProperty('message');
    expect(body).toHaveProperty('id');
    expect(typeof body.id).toBe('string');
  });

  it('7. detalhe do erro do upstream nunca aparece nos logs do servidor (só status/id/duração — a tag interna "[fontedata-proxy]" pode aparecer, é só um rótulo do próprio log, nunca visível ao navegador)', async () => {
    fetchMock.mockResolvedValue(
      new Response('Fornecedor FonteData: chave da API expirada, saldo zerado.', { status: 401 }),
    );
    await handler(req('33260563000178'));
    for (const call of logSpy.mock.calls) {
      // remove a própria tag do log (rótulo interno fixo) antes de checar o restante do payload
      const serialized = JSON.stringify(call).replace(/\[cnpj-proxy\]/g, '');
      expect(serialized).not.toMatch(/fornecedor|saldo|chave da api|expirada/i);
    }
  });
});
