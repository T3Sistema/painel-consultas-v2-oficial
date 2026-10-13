/**
 * Resposta SINTÉTICA da consulta de pessoa no formato por seções
 * (`dados.pessoa`). Nomes fictícios; CPFs/CNPJs gerados só para passar no
 * dígito verificador — nenhum corresponde a pessoa ou empresa real.
 * Cobre o formato completo: processos com partes/representantes, parente
 * sem CPF válido, score, CNH e contatos.
 */
export const SELF_CPF = '12345678909';
export const MAE_CPF = '23456789173';
export const COPARTE_CPF = '34567891228';
export const ADV_CPF = '45678912364';
export const IMOB_CNPJ = '11222333000181';
export const BANCO_CNPJ = '22333444000181';
export const SHOPPING_CNPJ = '33444555000181';
export const CONDOMINIO_CNPJ = '44555666000181';

const self = (polo: string, tipo: string, extra: Record<string, unknown> = {}) => ({
  nome: 'MARINA SOUZA TESTE',
  polo,
  documento: SELF_CPF,
  tipo_parte: tipo,
  tipo_pessoa: 'FISICA',
  ...extra,
});

const advUm = { cpf: ADV_CPF, oab: 'BA 1111', nome: 'ADVOGADO UM EXEMPLO' };
const advDois = { oab: 'BA 2222', nome: 'ADVOGADA DOIS EXEMPLO' };

export const PESSOA_SECOES = {
  identificacao: {
    cpf: SELF_CPF,
    nome: 'MARINA SOUZA TESTE',
    sexo: 'F',
    nome_mae: 'HELENA SOUZA TESTE',
    nome_pai: null,
    estrangeiro: 'False',
    nacionalidade: null,
    data_nascimento: '1980-05-20 00:00:00',
  },
  cadastro: {
    uf: 'BA',
    obito: { ano: null, data: null },
    municipio: 'SALVADOR',
    situacao_cadastral: '2',
    data_situacao_cadastral: '2019-11-26 00:00:00',
  },
  contatos: {
    fotos: ['https://proj.supabase.co/storage/v1/object/sign/espelho/foto.jpg?token=t'],
    emails: ['marina@exemplo.com', 'contato@exemplo.com'],
    enderecos: [
      { uf: 'BA', cep: '40000000', bairro: 'CENTRO', cidade: 'SALVADOR', numero: '10', logradouro: 'RUA EXEMPLO' },
    ],
    telefones: ['(71) 3000-0000', '(71) 99999-0000'],
  },
  juridico: {
    processos: {
      total: 6,
      itens: [
        {
          ativo: true,
          classe: 'Despejo por Falta de Pagamento',
          partes: [
            { nome: 'IMOBILIARIA EXEMPLO LTDA', polo: 'ATIVO', documento: IMOB_CNPJ, tipo_parte: 'AUTOR', tipo_pessoa: 'JURIDICA' },
            self('PASSIVO', 'RÉU', { representantes: [advUm, advDois] }),
          ],
          assunto: 'Locação de Imóvel',
          tribunal: 'TJBA',
          valor_acao: 50000,
          orgao_julgador: '8VARA CÍVEL - SALVADOR',
          numero_processo: '0000001-11.2023.8.05.0001',
          data_ajuizamento: '2023-11-09T16:28:07.529',
          ultimo_movimento: { data: '2026-10-02T13:52:19.202', descricao: 'Baixa Definitiva' },
        },
        {
          ativo: true,
          classe: 'Execução de Título Extrajudicial',
          partes: [
            self('PASSIVO', 'EXECUTADO'),
            { nome: 'CARLOS TESTE NETO', polo: 'PASSIVO', documento: COPARTE_CPF, tipo_parte: 'EXECUTADO', tipo_pessoa: 'FISICA' },
            { nome: 'BANCO FICTICIO S.A.', polo: 'ATIVO', documento: BANCO_CNPJ, tipo_parte: 'EXEQUENTE', tipo_pessoa: 'JURIDICA' },
          ],
          assunto: 'Contratos Bancários',
          tribunal: 'TJBA',
          valor_acao: 150000.5,
          orgao_julgador: '10VARA CÍVEL - SALVADOR',
          numero_processo: '0000002-22.2024.8.05.0001',
          data_ajuizamento: '2024-01-25T13:29:27.918',
          ultimo_movimento: { data: '2026-09-18T18:08:34.932', descricao: 'Juntada de Petição' },
        },
        {
          ativo: true,
          classe: 'Execução de Título Extrajudicial',
          partes: [
            { nome: 'SHOPPING MODELO S/A', polo: 'ATIVO', documento: SHOPPING_CNPJ, tipo_parte: 'EXEQUENTE', tipo_pessoa: 'JURIDICA' },
            { nome: 'CARLOS TESTE NETO', polo: 'PASSIVO', documento: COPARTE_CPF, tipo_parte: 'EXECUTADO', tipo_pessoa: 'FISICA' },
            self('PASSIVO', 'EXECUTADO', { nome: 'MARINA SOUSA TESTE' }),
          ],
          assunto: 'Cobrança de Aluguéis',
          tribunal: 'TJBA',
          valor_acao: 1000000,
          orgao_julgador: '7VARA CÍVEL - SALVADOR',
          numero_processo: '0000003-33.2024.8.05.0001',
          data_ajuizamento: '2024-07-17T15:56:47.657',
          ultimo_movimento: { data: '2026-09-14T17:33:29.850', descricao: 'Juntada de Petição' },
        },
        {
          ativo: true,
          classe: 'Embargos à Execução',
          partes: [
            self('ATIVO', 'EMBARGANTE', { representantes: [advUm] }),
            { nome: 'IMOBILIARIA EXEMPLO LTDA', polo: 'PASSIVO', documento: IMOB_CNPJ, tipo_parte: 'EMBARGADO', tipo_pessoa: 'JURIDICA' },
          ],
          assunto: 'Benfeitorias',
          tribunal: 'TJBA',
          valor_acao: 20000,
          orgao_julgador: '7VARA CÍVEL - SALVADOR',
          numero_processo: '0000004-44.2025.8.05.0001',
          data_ajuizamento: '2025-09-19T18:23:54.476',
          ultimo_movimento: { data: '2026-09-21T11:38:50.828', descricao: 'Conclusos para despacho' },
        },
        {
          ativo: true,
          classe: 'Despejo',
          partes: [
            { nome: 'HELENA SOUZA TESTE', polo: 'PASSIVO', documento: MAE_CPF, tipo_parte: 'RÉU', tipo_pessoa: 'FISICA' },
            self('PASSIVO', 'RÉU'),
            { nome: 'CONDOMINIO RESIDENCIAL ALFA', polo: 'ATIVO', documento: CONDOMINIO_CNPJ, tipo_parte: 'AUTOR', tipo_pessoa: 'JURIDICA' },
            { nome: 'JOANA TERCEIRA INTERESSADA', polo: 'OUTROS_PARTICIPANTES', tipo_parte: 'TERCEIRO INTERESSADO', tipo_pessoa: 'FISICA' },
          ],
          assunto: 'Locação de Imóvel',
          tribunal: 'TJSE',
          valor_acao: 0,
          orgao_julgador: '2ª VARA CÍVEL DE ARACAJU',
          numero_processo: '0000005-55.2016.8.25.0001',
          data_ajuizamento: '2016-10-17T10:13:45',
          ultimo_movimento: { data: '2018-03-01T09:41:31', descricao: 'Arquivamento definitivo' },
        },
        {
          ativo: true,
          classe: 'Procedimento Comum Cível',
          partes: [
            self('ATIVO', 'AUTOR', { representantes: [{ nome: 'ADVOGADO SEM DOCUMENTO' }] }),
            { nome: 'CARLOS TESTE NETO', polo: 'ATIVO', documento: COPARTE_CPF, tipo_parte: 'AUTOR', tipo_pessoa: 'FISICA' },
            { nome: 'BANCO FICTICIO S.A.', polo: 'PASSIVO', documento: BANCO_CNPJ, tipo_parte: 'RÉU', tipo_pessoa: 'JURIDICA' },
          ],
          assunto: 'Contratos Bancários',
          tribunal: 'TRF1',
          valor_acao: 160000,
          orgao_julgador: '16ª SALVADOR',
          numero_processo: '0000006-66.2025.4.01.3300',
          data_ajuizamento: '2025-08-08T16:30:39.446',
          ultimo_movimento: { data: '2025-09-24T00:51:04.061', descricao: 'Decorrido prazo' },
        },
      ],
    },
  },
  ocupacao: { cbo: '141410', atual: null, profissao: null },
  veiculos: null,
  vinculos: {
    parentes: [{ cpf: '00000000000', nome: 'HELENA SOUZA TESTE', vinculo: 'MAE' }],
    vizinhos: null,
  },
  seguranca: { vazamentos: { total: 0, registros: null, encontrado: false } },
  documentos: {
    rg: { uf: 'BA', numero: '1234567', orgao_emissor: 'SSP' },
    cnh: {
      uf: 'BA',
      numero: '00000000000',
      renach: '1234567890',
      emissao: '2024-03-08',
      validade: '2034-03-07',
      categoria: 'B',
      validade_vencida: false,
      exame_toxicologico: { valido: true, mensagem: 'Não há registro de informação de exame toxicológico' },
    },
    titulo_eleitor: '000000000000',
  },
  financeiro: {
    renda: 6478.34,
    score: { csb8: '814', csba: 758, csb8_faixa: 'BAIXISSIMO RISCO', csba_faixa: 'BAIXISSIMO RISCO' },
  },
};

/** Envelope completo como a rota interna devolve (já recortado no servidor). */
export const RESPOSTA_SECOES = { status: 'sucesso', dados: { pessoa: PESSOA_SECOES } };
