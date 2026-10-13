import { describe, expect, it } from 'vitest';
import { normalizePersonSections } from '../services/personPayload';
import {
  BANCO_CNPJ,
  COPARTE_CPF,
  IMOB_CNPJ,
  MAE_CPF,
  PESSOA_SECOES,
  SELF_CPF,
} from '../test/personSectionsFixture';
import {
  buildCounterparties,
  extractFamily,
  extractProcessos,
  judicialStats,
  poloKind,
  processosDeclaredTotal,
  vinculoLabel,
} from './judicial';

const sr = normalizePersonSections(PESSOA_SECOES as unknown as Record<string, unknown>);

describe('extractProcessos', () => {
  it('lê a lista sob `itens`, com partes e representantes', () => {
    const ps = extractProcessos(sr);
    expect(ps).toHaveLength(6);
    expect(ps[0]).toMatchObject({
      numero: '0000001-11.2023.8.05.0001',
      classe: 'Despejo por Falta de Pagamento',
      tribunal: 'TJBA',
      valor: 50000,
      ultimoMovimento: { descricao: 'Baixa Definitiva' },
    });
    expect(ps[0].partes[1].representantes).toEqual([
      { cpf: '45678912364', oab: 'BA 1111', nome: 'ADVOGADO UM EXEMPLO' },
      { oab: 'BA 2222', nome: 'ADVOGADA DOIS EXEMPLO' },
    ]);
    expect(processosDeclaredTotal(sr)).toBe(6);
  });

  it('aceita a lista direta e ignora itens sem número', () => {
    expect(extractProcessos({ processos: [{ numero_processo: '1' }, { classe: 'x' }, 'lixo'] })).toHaveLength(1);
    expect(extractProcessos({})).toEqual([]);
  });

  it('classifica o polo', () => {
    expect(poloKind('ATIVO')).toBe('ativo');
    expect(poloKind('PASSIVO')).toBe('passivo');
    expect(poloKind('OUTROS_PARTICIPANTES')).toBe('outros');
  });
});

describe('judicialStats', () => {
  const stats = judicialStats(extractProcessos(sr), SELF_CPF, 'MARINA SOUZA TESTE');

  it('soma valores, conta polos e reconhece a pessoa mesmo com grafia diferente (pelo CPF)', () => {
    expect(stats.total).toBe(6);
    expect(stats.valorTotal).toBeCloseTo(1380000.5);
    expect(stats.porPolo).toEqual({ ativo: 2, passivo: 4, outros: 0, desconhecido: 0 });
    expect(stats.valorComoPassivo).toBeCloseTo(1200000.5);
  });

  it('histograma por ano cobre o intervalo inteiro, inclusive anos sem processo', () => {
    expect(stats.porAno[0]).toEqual({ ano: 2016, count: 1 });
    expect(stats.porAno[stats.porAno.length - 1]).toEqual({ ano: 2025, count: 2 });
    expect(stats.porAno).toHaveLength(10);
  });

  it('ranqueia advogados da pessoa e o movimento mais recente', () => {
    expect(stats.advogados[0]).toMatchObject({ label: 'ADVOGADO UM EXEMPLO', count: 2 });
    expect(stats.advogados.map((a) => a.label)).toContain('ADVOGADO SEM DOCUMENTO');
    expect(stats.maisRecente).toMatchObject({ numero: '0000001-11.2023.8.05.0001' });
    expect(stats.tribunais[0]).toMatchObject({ label: 'TJBA', count: 4 });
  });
});

describe('buildCounterparties', () => {
  const cps = buildCounterparties(extractProcessos(sr), SELF_CPF, 'MARINA SOUZA TESTE');
  const byKey = new Map(cps.map((c) => [c.key, c]));

  it('nunca inclui a própria pessoa (nem por grafia alternativa) nem advogados', () => {
    expect(byKey.has(SELF_CPF)).toBe(false);
    expect(cps.some((c) => /MARINA/.test(c.nome))).toBe(false);
    expect(cps.some((c) => /ADVOGAD/.test(c.nome))).toBe(false);
  });

  it('agrega por documento e classifica adverso × co-parte', () => {
    const imob = byKey.get(IMOB_CNPJ)!;
    expect(imob.processos).toHaveLength(2);
    expect(imob.processos.every((p) => p.relation === 'adverso')).toBe(true);
    expect(imob.pessoaJuridica).toBe(true);

    const carlos = byKey.get(COPARTE_CPF)!;
    expect(carlos.processos.map((p) => p.relation)).toEqual(['coparte', 'coparte', 'coparte']);

    const banco = byKey.get(BANCO_CNPJ)!;
    expect(banco.processos.map((p) => p.relation)).toEqual(['adverso', 'adverso']);
  });

  it('parte sem documento vira chave por nome e relação "envolvido" quando está em outros participantes', () => {
    const joana = cps.find((c) => c.nome === 'JOANA TERCEIRA INTERESSADA')!;
    expect(joana.key).toBe('nome:joana terceira interessada');
    expect(joana.documento).toBeUndefined();
    expect(joana.processos[0].relation).toBe('envolvido');
  });

  it('ordena por quantidade de processos', () => {
    expect(cps[0].key).toBe(COPARTE_CPF);
  });
});

describe('extractFamily', () => {
  it('parente com CPF inválido herda o documento encontrado nos processos pelo nome', () => {
    const cps = buildCounterparties(extractProcessos(sr), SELF_CPF);
    expect(extractFamily(sr, cps)).toEqual([
      { key: MAE_CPF, nome: 'HELENA SOUZA TESTE', vinculo: 'MAE', documento: MAE_CPF },
    ]);
  });

  it('sem correspondência, fica identificado pelo nome — nunca pelo CPF zerado', () => {
    expect(extractFamily(sr)).toEqual([{ key: 'nome:helena souza teste', nome: 'HELENA SOUZA TESTE', vinculo: 'MAE', documento: undefined }]);
  });

  it('rótulos de vínculo', () => {
    expect(vinculoLabel('MAE')).toBe('Mãe');
    expect(vinculoLabel('IRMÃO')).toBe('Irmão');
    expect(vinculoLabel('PADRINHO')).toBe('Padrinho');
    expect(vinculoLabel(undefined)).toBe('Parente');
  });
});
