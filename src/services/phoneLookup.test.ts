import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPeopleByPhone } from './phoneLookup';

describe('findPeopleByPhone', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('chama só a rota interna, com os dígitos normalizados', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'sucesso', pessoas: [] }), { status: 200 }));
    await findPeopleByPhone('+55 (11) 98765-4321');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/consulta-telefone');
    expect(JSON.parse(init.body)).toEqual({ telefone: '11987654321' });
  });

  it('valida localmente antes de qualquer requisição', async () => {
    await expect(findPeopleByPhone('1234')).rejects.toThrow(/Telefone inválido/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('devolve só itens com CPF válido', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 'sucesso',
          pessoas: [{ cpf: '11144477735', nome: 'MARIA', nascimento: '1980-01-02', extra: 'x' }, { cpf: '123' }, 'lixo'],
        }),
        { status: 200 },
      ),
    );
    expect(await findPeopleByPhone('11987654321')).toEqual([{ cpf: '11144477735', nome: 'MARIA', nascimento: '1980-01-02' }]);
  });

  it('404 = nenhum vínculo; outros erros usam a mensagem neutra do envelope', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await findPeopleByPhone('11987654321')).toEqual([]);

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'rate_limited', message: 'Limite de requisições atingido.', id: 'ab12' }), { status: 429 }),
    );
    await expect(findPeopleByPhone('11987654321')).rejects.toThrow('Limite de requisições atingido.');

    fetchMock.mockResolvedValueOnce(new Response('<html>Bad Gateway</html>', { status: 502 }));
    await expect(findPeopleByPhone('11987654321')).rejects.toThrow('Não foi possível concluir a operação. Tente novamente em instantes.');
  });
});

describe('findPeopleByPhone — resposta que demorou (status 200 com envelope de erro)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lê o envelope neutro mesmo com status 200 e espaços antes do JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('     {"code":"timeout","message":"A operação demorou mais que o esperado.","id":"ab"}', { status: 200 })),
    );
    await expect(findPeopleByPhone('11987654321')).rejects.toThrow('A operação demorou mais que o esperado.');
  });

  it('resultado com espaços antes do JSON é lido normalmente', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('   {"status":"sucesso","pessoas":[{"cpf":"11144477735","nome":"M"}]}', { status: 200 })),
    );
    expect(await findPeopleByPhone('11987654321')).toEqual([{ cpf: '11144477735', nome: 'M', nascimento: undefined }]);
  });
});
