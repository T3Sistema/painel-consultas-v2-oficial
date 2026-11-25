import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requireSessionMock } = vi.hoisted(() => ({ requireSessionMock: vi.fn() }));
vi.mock('./_lib/auth', () => ({ requireSession: requireSessionMock }));

import handler, { MAX_MATCHES, extractPhoneMatches, normalizeAndValidatePhone } from './consulta-telefone';

// Fixtures sintéticas de CPF (algoritmicamente válidos, não são pessoas reais).
const CPF_A = '11144477735';
const CPF_B = '52998224725';

function postRequest(body: unknown): Request {
  return new Request('http://localhost/api/consulta-telefone', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function upstreamJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('normalizeAndValidatePhone', () => {
  it('normaliza celular com máscara e prefixo +55', () => {
    expect(normalizeAndValidatePhone(JSON.stringify({ telefone: '+55 (11) 98765-4321' }))).toEqual({
      ok: true,
      telefone: '11987654321',
    });
  });

  it('aceita fixo com 10 dígitos', () => {
    expect(normalizeAndValidatePhone(JSON.stringify({ telefone: '(31) 3456-7890' }))).toEqual({ ok: true, telefone: '3134567890' });
  });

  it('rejeita número sem DDD, celular sem o 9 e valores repetidos', () => {
    expect(normalizeAndValidatePhone(JSON.stringify({ telefone: '98765-4321' })).ok).toBe(false);
    expect(normalizeAndValidatePhone(JSON.stringify({ telefone: '11887654321' })).ok).toBe(false);
    expect(normalizeAndValidatePhone(JSON.stringify({ telefone: '11111111111' })).ok).toBe(false);
  });

  it('rejeita corpo sem telefone, telefone não-string e JSON malformado', () => {
    expect(normalizeAndValidatePhone(JSON.stringify({ cpf: CPF_A })).ok).toBe(false);
    expect(normalizeAndValidatePhone(JSON.stringify({ telefone: 11987654321 })).ok).toBe(false);
    expect(normalizeAndValidatePhone('{nope').ok).toBe(false);
  });
});

describe('extractPhoneMatches', () => {
  it('lê CPF + nome + nascimento de uma lista, em qualquer nível', () => {
    const dados = {
      resultado: {
        pessoas: [
          { cpf: '111.444.777-35', nome: 'MARIA EXEMPLO', data_nascimento: '1980-01-02', nome_mae: 'OUTRA PESSOA' },
          { CPF: CPF_B, NOME: 'JOAO EXEMPLO' },
        ],
      },
    };
    expect(extractPhoneMatches(dados)).toEqual([
      { cpf: CPF_A, nome: 'MARIA EXEMPLO', nascimento: '1980-01-02' },
      { cpf: CPF_B, nome: 'JOAO EXEMPLO' },
    ]);
  });

  it('busca o nome no objeto pai quando o CPF está num sub-objeto', () => {
    expect(extractPhoneMatches({ nome: 'MARIA EXEMPLO', documentos: { cpf: CPF_A } })).toEqual([
      { cpf: CPF_A, nome: 'MARIA EXEMPLO' },
    ]);
  });

  it('aceita CPF numérico, repondo zeros à esquerda', () => {
    expect(extractPhoneMatches([{ cpf: Number(CPF_A) }])).toEqual([{ cpf: CPF_A }]);
    // 01234567890 é um CPF válido que, como número, perde o zero inicial.
    expect(extractPhoneMatches([{ cpf: 1234567890 }])).toEqual([{ cpf: '01234567890' }]);
  });

  it('descarta CPF mascarado ou inválido e deduplica', () => {
    const dados = [
      { cpf: '***.444.777-**', nome: 'X' },
      { cpf: '111.444.777-36', nome: 'Y' },
      { cpf: CPF_A, nome: 'MARIA' },
      { cpf: CPF_A },
    ];
    expect(extractPhoneMatches(dados)).toEqual([{ cpf: CPF_A, nome: 'MARIA' }]);
  });

  it('nunca devolve campos além de cpf/nome/nascimento', () => {
    const [m] = extractPhoneMatches({ cpf: CPF_A, nome: 'M', endereco: 'Rua X', telefones: ['11987654321'], origem: 'interna' });
    expect(Object.keys(m).sort()).toEqual(['cpf', 'nome']);
  });

  it('limita a quantidade de resultados', () => {
    const many = Array.from({ length: MAX_MATCHES + 10 }, (_, i) => {
      // gera CPFs válidos distintos a partir de 9 dígitos base
      const base = String(100000000 + i * 7919).slice(0, 9);
      const dv = (digits: string) => {
        let sum = 0;
        for (let k = 0; k < digits.length; k++) sum += Number(digits[k]) * (digits.length + 1 - k);
        const mod = (sum * 10) % 11;
        return mod === 10 ? 0 : mod;
      };
      const d1 = dv(base);
      const d2 = dv(base + d1);
      return { cpf: `${base}${d1}${d2}` };
    });
    expect(extractPhoneMatches(many).length).toBe(MAX_MATCHES);
  });
});

describe('handler (api/consulta-telefone)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    process.env.APIFULL_AUTHORIZATION = 'test-authorization-value';
    requireSessionMock.mockReset().mockResolvedValue({ ok: true, userId: 'user-1' });
    fetchMock = vi.fn().mockResolvedValue(
      upstreamJson({
        status: 'sucesso',
        'API Full': 'carimbo de origem',
        dados: [{ cpf: CPF_A, nome: 'MARIA EXEMPLO', endereco: 'Rua X' }],
        aux: { relatorio: 'https://exemplo.invalid/relatorio.pdf' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.APIFULL_AUTHORIZATION;
  });

  it('rejeita método diferente de POST sem chamar a origem', async () => {
    const res = await handler(new Request('http://localhost/api/consulta-telefone', { method: 'GET' }));
    expect(res.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem sessão válida não chama a consulta paga', async () => {
    requireSessionMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    const res = await handler(postRequest({ telefone: '11987654321' }));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('telefone inválido → 400 neutro, sem chamar a origem', async () => {
    const res = await handler(postRequest({ telefone: '123' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'invalid_phone' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sem credencial configurada → 500 neutro', async () => {
    delete process.env.APIFULL_AUTHORIZATION;
    const res = await handler(postRequest({ telefone: '11987654321' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'configuration_incomplete', message: 'Configuração interna incompleta.' });
  });

  it('envia só os dígitos e o link fixo; devolve apenas cpf/nome, sem metadados de origem', async () => {
    const res = await handler(postRequest({ telefone: '(11) 98765-4321' }));
    expect(res.status).toBe(200);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.apifull.com.br/api/pessoa-telefone');
    expect(JSON.parse(init.body)).toEqual({ telefone: '11987654321', link: 'pessoa-telefone' });
    expect(init.headers.Authorization).toBe('test-authorization-value');

    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'sucesso', pessoas: [{ cpf: CPF_A, nome: 'MARIA EXEMPLO' }] });
    expect(text).not.toMatch(/API Full|relatorio|Rua X|exemplo\.invalid/);
  });

  it('falha com HTTP 200 (status != sucesso) → sem_resultado, sem repassar a mensagem de origem', async () => {
    fetchMock.mockResolvedValue(upstreamJson({ status: 'erro', message: 'Saldo insuficiente na conta' }));
    const res = await handler(postRequest({ telefone: '11987654321' }));
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: 'sem_resultado', pessoas: [] });
    expect(text).not.toMatch(/Saldo/);
  });

  it('erro HTTP da origem passa pelo normalizador central', async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"token inválido"}', { status: 401 }));
    const res = await handler(postRequest({ telefone: '11987654321' }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ code: 'service_unavailable', message: 'Serviço temporariamente indisponível.' });
    expect(JSON.stringify(body)).not.toMatch(/token/);
  });

  it('corpo 2xx que não é JSON → 502 neutro', async () => {
    fetchMock.mockResolvedValue(new Response('<html>oops</html>', { status: 200 }));
    const res = await handler(postRequest({ telefone: '11987654321' }));
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'unexpected_response' });
  });

  it('origem inalcançável → resposta neutra', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const res = await handler(postRequest({ telefone: '11987654321' }));
    expect(res.ok).toBe(false);
    const body = await res.json();
    expect(body).toHaveProperty('message');
    expect(JSON.stringify(body)).not.toMatch(/fetch failed/);
  });
});
