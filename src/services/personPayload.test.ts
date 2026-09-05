import { describe, expect, it } from 'vitest';
import { normalizePersonSections } from './personPayload';

// Fixtures sintéticas conhecidas — não são dados de pessoa real.
const CPF = '11144477735';

const PESSOA = {
  identificacao: {
    cpf: CPF,
    nome: 'FULANO DE TAL',
    sexo: 'M',
    nome_mae: 'BELTRANA DE TAL',
    nome_pai: null,
    estrangeiro: 'False',
    nacionalidade: null,
    data_nascimento: '1973-03-16 00:00:00',
  },
  cadastro: {
    uf: 'AL',
    obito: { ano: null, data: null },
    municipio: 'MACEIO',
    estado_civil: null,
    data_inscricao: '2008-12-21 00:00:00',
    data_atualizacao: null,
    residente_exterior: null,
    situacao_cadastral: '2',
    data_situacao_cadastral: '2019-08-22 00:00:00',
  },
  contatos: {
    fotos: ['https://storage.exemplo.invalid/foto-espelhada.jpg'],
    emails: ['fulano@exemplo.invalid'],
    enderecos: [
      { uf: 'AL', cep: '57000000', bairro: 'CENTRO', cidade: 'MACEIO', numero: '100', logradouro: 'AV EXEMPLO' },
    ],
    telefones: ['(11) 4002-8922'],
  },
  juridico: { processos: { itens: [{ numero_processo: '0000000-00.0000.0.00.0000' }], total: 1 } },
  ocupacao: { cbo: '252105', atual: null, profissao: null, historico_caged: null },
  veiculos: null,
  vinculos: { parentes: [{ cpf: '00000000000', nome: 'BELTRANA DE TAL', vinculo: 'MAE' }], vizinhos: null },
  seguranca: { vazamentos: { total: 0, registros: null, encontrado: false } },
  documentos: {
    rg: { uf: null, numero: '1234567', orgao_emissor: 'SSP' },
    cnh: {
      uf: 'AL',
      numero: '00000000001',
      renach: '0000000001',
      emissao: '2025-01-14',
      validade: '2030-01-14',
      categoria: 'B',
      validade_vencida: false,
      bloqueios: null,
    },
    titulo_eleitor: '000000000001',
  },
  financeiro: { renda: 6450.97, score: { csb8: '29', csba: 89 } },
};

describe('normalizePersonSections', () => {
  const sr = normalizePersonSections(PESSOA);
  const cadastral = sr.cadastral as Record<string, unknown>;

  it('1. reúne identificação, cadastro, renda e documentos no bloco "cadastral" lido pelo schema', () => {
    expect(cadastral.nome).toBe('FULANO DE TAL');
    expect(cadastral.cpf).toBe(CPF);
    expect(cadastral.cpfMask).toBe('111.444.777-35');
    expect(cadastral.sexo).toBe('M');
    expect(cadastral.mae).toEqual({ nome: 'BELTRANA DE TAL' });
    expect(cadastral.renda).toBe(6450.97);
    expect(cadastral.rg).toEqual({ numero: '1234567', orgao: 'SSP' });
    expect(cadastral.tituloEleitor).toEqual({ numero: '000000000001' });
  });

  it('2. normaliza data com espaço para a grafia que formatDate aceita (sem mudar o instante)', () => {
    expect(cadastral.dataNasc).toBe('1973-03-16');
    expect(cadastral.dataInscricao).toBe('2008-12-21');
    expect(new Date(String(cadastral.dataNasc) + 'T12:00:00').getFullYear()).toBe(1973);
  });

  it('3. sem ano nem data de óbito, marca explicitamente que não consta falecimento', () => {
    expect(cadastral.flagObito2).toBe(false);
    expect(cadastral).not.toHaveProperty('dataObito');
  });

  it('4. campo nulo NUNCA vira chave — nada de "—" inventado no painel', () => {
    expect(cadastral).not.toHaveProperty('pai');
    expect(cadastral).not.toHaveProperty('nacionalidade');
    expect(cadastral).not.toHaveProperty('estadoCivil');
    expect(cadastral).not.toHaveProperty('estrangeiro'); // "False" textual não vira flag
    expect(sr).not.toHaveProperty('placas'); // veiculos: null
  });

  it('5. listas de escalares viram registros com a chave que a seção rotula', () => {
    expect(sr.telefones).toEqual([{ telefone: '(11) 4002-8922' }]);
    expect(sr.emails).toEqual([{ email: 'fulano@exemplo.invalid' }]);
  });

  it('6. endereço: logradouro vira "endereco" e o restante do item é preservado', () => {
    expect(sr.enderecos).toEqual([
      { endereco: 'AV EXEMPLO', uf: 'AL', cep: '57000000', bairro: 'CENTRO', cidade: 'MACEIO', numero: '100' },
    ]);
  });

  it('7. fotos passam intactas (o painel já recebe a referência que ele sabe abrir)', () => {
    expect(sr.fotos).toEqual(['https://storage.exemplo.invalid/foto-espelhada.jpg']);
  });

  it('8. parentes, processos e vazamentos caem nas seções correspondentes', () => {
    expect(sr.parentes).toEqual([{ cpf: '00000000000', nome: 'BELTRANA DE TAL', vinculo: 'MAE' }]);
    expect(sr.processos).toEqual(PESSOA.juridico.processos);
    expect(sr.vazamentos).toEqual(PESSOA.seguranca.vazamentos);
    expect(sr).not.toHaveProperty('relacionadosPorEndereco'); // vizinhos: null
  });

  it('9. CNH: campos renomeados para o schema, o resto mantém o nome original', () => {
    expect(sr.cnh).toEqual({
      registro: '00000000001',
      renach: '0000000001',
      uf_cnh: 'AL',
      emissao: '2025-01-14',
      validade: '2030-01-14',
      categoria: 'B',
      validade_vencida: false,
    });
  });

  it('10. ocupação vira profissão (CBO) e o score fica na sua própria seção', () => {
    expect(sr.profissoes).toEqual([{ cbo: '252105' }]);
    expect(sr.score).toEqual({ csb8: '29', csba: 89 });
    expect(sr).not.toHaveProperty('ocupacao'); // nada sobrou além do CBO
    expect(sr).not.toHaveProperty('financeiro');
  });

  it('11. NUNCA inventa a seção de sociedades quando a resposta não a traz', () => {
    expect(sr).not.toHaveProperty('sociedades');
  });

  it('12. bloco desconhecido de "pessoa" é preservado com o nome que tinha', () => {
    const out = normalizePersonSections({ ...PESSOA, imoveis: [{ matricula: '123' }] });
    expect(out.imoveis).toEqual([{ matricula: '123' }]);
  });

  it('13. chave desconhecida dentro de um bloco conhecido também é preservada', () => {
    const out = normalizePersonSections({
      ...PESSOA,
      contatos: { ...PESSOA.contatos, redes_sociais: ['@fulano'] },
      documentos: { ...PESSOA.documentos, passaporte: 'AA000000' },
    });
    expect(out.contatos).toEqual({ redes_sociais: ['@fulano'] });
    expect(out.documentos).toEqual({ passaporte: 'AA000000' });
  });

  it('14. bloco ausente não quebra a conversão', () => {
    expect(() => normalizePersonSections({})).not.toThrow();
    expect(normalizePersonSections({}).cadastral).toEqual({ flagObito2: false });
  });
});
