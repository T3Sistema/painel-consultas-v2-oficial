import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  extractPersonName,
  extractSociedades,
  getApiFullProfile,
  hasSociedadesSection,
  PersonNotFoundError,
  type ApiFullProfile,
} from './apifull';

// Fixtures sintéticas conhecidas — não são documentos de pessoas/empresas reais.
const VALID_CPF = '11144477735';
const VALID_CNPJ = '11222333000181';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const successBody = (serviceResponse: Record<string, unknown>) => ({
  status: 'sucesso',
  dados: { SERVICE_RESPONSE: serviceResponse },
});

describe('getApiFullProfile', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejeita CPF inválido sem chamar fetch', async () => {
    await expect(getApiFullProfile('123')).rejects.toThrow('CPF inválido');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lança PersonNotFoundError em 404', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: 'não encontrado' }, 404));
    await expect(getApiFullProfile(VALID_CPF)).rejects.toBeInstanceOf(PersonNotFoundError);
  });

  it('propaga a mensagem já neutralizada devolvida pela rota interna em status de falha (ex.: 429)', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ code: 'rate_limited', message: 'Limite de requisições atingido. Tente novamente em instantes.', id: 'ab12cd34' }, 429),
    );
    await expect(getApiFullProfile(VALID_CPF)).rejects.toThrow('Limite de requisições atingido');
  });

  it('nunca expõe nome de fornecedor, saldo, chave ou endpoint mesmo se o corpo de erro vier fora do formato esperado', async () => {
    fetchMock.mockResolvedValue(
      new Response('upstream error: FonteData saldo insuficiente, chave sk_live_ABC em api.apifull.com.br', {
        status: 500,
      }),
    );
    await expect(getApiFullProfile(VALID_CPF)).rejects.toThrow(
      'Não foi possível concluir a operação. Tente novamente em instantes.',
    );
  });

  it('rejeita HTTP 200 sem status "sucesso" (erro de negócio, não fica em cache de perfil válido)', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'erro', dados: { SERVICE_RESPONSE: {} } }));
    await expect(getApiFullProfile(VALID_CPF)).rejects.toThrow('sem sucesso');
  });

  it('rejeita HTTP 200 sem "dados"', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'sucesso' }));
    await expect(getApiFullProfile(VALID_CPF)).rejects.toThrow();
  });

  it('rejeita HTTP 200 com SERVICE_RESPONSE que não é objeto', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'sucesso', dados: { SERVICE_RESPONSE: [] } }));
    await expect(getApiFullProfile(VALID_CPF)).rejects.toThrow();
  });

  it('preserva SERVICE_RESPONSE integralmente, incluindo chaves desconhecidas', async () => {
    const serviceResponse = {
      cadastral: { nome: 'FULANO DE TAL' },
      umaCategoriaFuturaAindaNaoMapeada: { qualquerCoisa: 42 },
    };
    fetchMock.mockResolvedValue(jsonResponse(successBody(serviceResponse)));
    const profile = await getApiFullProfile(VALID_CPF);
    expect(profile.SERVICE_RESPONSE).toEqual(serviceResponse);
  });
});

describe('extractSociedades', () => {
  it('mapeia campos snake_case da APIFull corretamente', () => {
    const profile: ApiFullProfile = {
      SERVICE_RESPONSE: {
        sociedades: [
          {
            cnpj: VALID_CNPJ,
            razao_social: 'EMPRESA TESTE LTDA',
            situacao_cadastral: 'ATIVA',
            qualificacao_socio_descricao: 'Sócio Administrador',
            dt_entrada: '10/05/2024',
            nome_socio: 'FULANO DE TAL',
            documento_socio: VALID_CPF,
          },
        ],
      },
    };
    const result = extractSociedades(profile);
    expect(result).toEqual([
      {
        cnpj: VALID_CNPJ,
        razaoSocial: 'EMPRESA TESTE LTDA',
        situacaoCadastral: 'ATIVA',
        qualificacaoSocioDescricao: 'Sócio Administrador',
        dtEntrada: '10/05/2024',
        nomeSocio: 'FULANO DE TAL',
        documentoSocio: VALID_CPF,
      },
    ]);
  });

  it('descarta itens com CNPJ inválido (formato ou checksum)', () => {
    const profile: ApiFullProfile = {
      SERVICE_RESPONSE: { sociedades: [{ cnpj: '123', documento_socio: VALID_CPF }] },
    };
    expect(extractSociedades(profile)).toEqual([]);
  });

  it('descarta itens com documento_socio que não é CPF válido', () => {
    const profile: ApiFullProfile = {
      SERVICE_RESPONSE: { sociedades: [{ cnpj: VALID_CNPJ, documento_socio: '000' }] },
    };
    expect(extractSociedades(profile)).toEqual([]);
  });

  it('retorna array vazio quando sociedades não existe ou não é array', () => {
    expect(extractSociedades({ SERVICE_RESPONSE: {} })).toEqual([]);
    expect(extractSociedades({ SERVICE_RESPONSE: { sociedades: 'não é array' } })).toEqual([]);
  });
});


/**
 * Envelope alternativo: o conteúdo chega agrupado em `dados.pessoa` em vez de
 * `dados.SERVICE_RESPONSE`. Fixture sintética — não é uma pessoa real. As
 * chaves irmãs de `pessoa` são metadados técnicos da consulta e existem aqui
 * de propósito: o teste 3 prova que NENHUMA delas atravessa para o cliente.
 */
const sectionedBody = () => ({
  status: 'sucesso',
  'API Full': 'https://doc.exemplo.invalid',
  dados: {
    cpf: VALID_CPF,
    pessoa: {
      identificacao: { cpf: VALID_CPF, nome: 'FULANO DE TAL', sexo: 'M', data_nascimento: '1973-03-16 00:00:00' },
      cadastro: { uf: 'AL', municipio: 'MACEIO', obito: { ano: null, data: null }, situacao_cadastral: '2' },
      contatos: { telefones: ['(11) 4002-8922'], emails: [], enderecos: [], fotos: [] },
      documentos: { rg: { numero: '1234567', orgao_emissor: 'SSP', uf: null }, cnh: null, titulo_eleitor: null },
      financeiro: { renda: 6450.97, score: { csba: 89 } },
      vinculos: { parentes: [], vizinhos: null },
      juridico: { processos: { itens: [], total: 0 } },
      seguranca: { vazamentos: { total: 0, encontrado: false } },
      ocupacao: { cbo: '252105' },
      veiculos: null,
    },
    query_date: '2026-09-05T12:34:11+00:00',
    api_central: { timestamp: '2026-09-05 09:34:37', api_utilizada: 'cpf_pwn', query_fornecida: VALID_CPF },
    fontes_consultadas: { reg_cpf: true, cpf_basica: true, dataleak: false },
  },
  aux: [],
});

describe('getApiFullProfile — envelope com o conteúdo agrupado em seções', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('1. aceita o envelope e entrega o perfil no formato consolidado (sem o erro de formato inesperado)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(sectionedBody()));
    const profile = await getApiFullProfile(VALID_CPF);
    const cadastral = profile.SERVICE_RESPONSE.cadastral as Record<string, unknown>;
    expect(cadastral.nome).toBe('FULANO DE TAL');
    expect(cadastral.renda).toBe(6450.97);
    expect(profile.SERVICE_RESPONSE.telefones).toEqual([{ telefone: '(11) 4002-8922' }]);
  });

  it('2. o mesmo corpo, antes desta adaptação, era exatamente o que caía no erro de formato', async () => {
    const semPessoa = sectionedBody();
    delete (semPessoa.dados as Record<string, unknown>).pessoa;
    fetchMock.mockResolvedValue(jsonResponse(semPessoa));
    await expect(getApiFullProfile(VALID_CPF)).rejects.toThrow('Consulta sem sucesso ou em formato inesperado.');
  });

  it('3. NEUTRALIDADE: nenhum metadado técnico do corpo atravessa para o cliente', async () => {
    fetchMock.mockResolvedValue(jsonResponse(sectionedBody()));
    const profile = await getApiFullProfile(VALID_CPF);
    const serialized = JSON.stringify(profile);

    for (const key of ['API Full', 'api_central', 'api_utilizada', 'query_fornecida', 'fontes_consultadas', 'query_date', 'cpf_pwn', 'doc.exemplo.invalid']) {
      expect(serialized).not.toContain(key);
    }
    expect(Object.keys(profile)).toEqual(['SERVICE_RESPONSE']);
  });

  it('4. sinaliza que a resposta não traz a seção de sociedades (em vez de "zero sociedades")', async () => {
    fetchMock.mockResolvedValue(jsonResponse(sectionedBody()));
    const profile = await getApiFullProfile(VALID_CPF);
    expect(extractSociedades(profile)).toEqual([]);
    expect(hasSociedadesSection(profile)).toBe(false);
  });

  it('5. o formato consolidado com sociedades: [] continua significando "zero sociedades"', () => {
    expect(hasSociedadesSection({ SERVICE_RESPONSE: { sociedades: [] } })).toBe(true);
    expect(hasSociedadesSection({ SERVICE_RESPONSE: {} })).toBe(false);
  });

  it('6. expõe o nome da pessoa, que passa a rotular o nó raiz do mapa', async () => {
    fetchMock.mockResolvedValue(jsonResponse(sectionedBody()));
    expect(extractPersonName(await getApiFullProfile(VALID_CPF))).toBe('FULANO DE TAL');
    expect(extractPersonName({ SERVICE_RESPONSE: {} })).toBeUndefined();
    expect(extractPersonName({ SERVICE_RESPONSE: { cadastral: { nome: '  ' } } })).toBeUndefined();
  });
});
