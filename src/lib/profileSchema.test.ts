import { describe, expect, it } from 'vitest';
import { PROFILE_PAGE_NAMES, PROFILE_PAGES, collectUsedSources, unmappedGenericSections } from './profileSchema';
import { fmtCtps, fmtDate, fmtMoney, fmtObito, fmtRg, fmtSexo, getPath, isEmptyValue } from './profileFormat';

describe('profileSchema', () => {
  it('define exatamente as 10 páginas na ordem pedida', () => {
    expect(PROFILE_PAGE_NAMES).toEqual([
      'Cadastral & Civil',
      'Contatos & Endereços',
      'Financeiro & Consumo',
      'Carreira & Negócios',
      'Jurídico',
      'Cyber Sec & Vazamentos',
      'Presença & Viagens',
      'Bens & Patrimônio',
      'Saúde',
      'Timeline',
    ]);
  });

  it('cobre as principais chaves reais da APIFull na página certa', () => {
    const sourcesByPage = Object.fromEntries(
      PROFILE_PAGES.map((p) => [p.name, p.sections.map((s) => s.source)]),
    );
    expect(sourcesByPage['Cadastral & Civil']).toEqual(expect.arrayContaining(['cadastral', 'cnh', 'parentes', 'certidoes', 'cin']));
    expect(sourcesByPage['Contatos & Endereços']).toEqual(expect.arrayContaining(['telefones', 'emails', 'enderecos']));
    expect(sourcesByPage['Financeiro & Consumo']).toEqual(expect.arrayContaining(['contasBancos', 'irpf', 'propensoes']));
    expect(sourcesByPage['Carreira & Negócios']).toEqual(expect.arrayContaining(['sociedades', 'empregos', 'rais', 'politica']));
    expect(sourcesByPage['Cyber Sec & Vazamentos']).toEqual(expect.arrayContaining(['credenciaisVazadas', 'vazamentos']));
    expect(sourcesByPage['Bens & Patrimônio']).toEqual(expect.arrayContaining(['placas', 'aeronaves']));
    expect(sourcesByPage['Saúde']).toEqual(expect.arrayContaining(['vacinas']));
    expect(sourcesByPage['Jurídico']).toEqual(expect.arrayContaining(['processos', 'pecasBnmp', 'juridico']));
    expect(sourcesByPage['Timeline']).toEqual(['linhaDoTempo']);
  });

  it('chave desconhecida cai em seção genérica (nada é descartado)', () => {
    const used = collectUsedSources();
    expect(used.has('cadastral')).toBe(true);
    const extra = unmappedGenericSections({ campoNovoInesperado: [1, 2], cadastral: {} });
    expect(extra).toHaveLength(1);
    expect(extra[0]).toMatchObject({ source: 'campoNovoInesperado', kind: 'generic' });
  });
});

describe('profileFormat', () => {
  it('getPath resolve caminhos aninhados', () => {
    expect(getPath({ mae: { nome: 'X' } }, 'mae.nome')).toBe('X');
    expect(getPath({ a: { b: 1 } }, 'a.z')).toBeUndefined();
  });

  it('isEmptyValue trata tokens de vazio conhecidos', () => {
    expect(isEmptyValue('n/a')).toBe(true);
    expect(isEmptyValue('Data Inválida')).toBe(true);
    expect(isEmptyValue('--')).toBe(true);
    expect(isEmptyValue('Maceió')).toBe(false);
  });

  it('formatadores cobrem os casos reais da APIFull', () => {
    expect(fmtSexo('M')).toBe('Masculino');
    expect(fmtSexo('F')).toBe('Feminino');
    expect(fmtDate('16/03/1973')).toBe('16/03/1973'); // BR já formatada passa direto
    expect(fmtDate('1998-07-25T03:00:00.000Z')).toBe('25/07/1998'); // ISO convertida
    expect(fmtMoney(20000)).toContain('20.000');
    expect(fmtMoney('R$ 7.184,00')).toBe('R$ 7.184,00');
    expect(fmtObito(false)).toBe('Não consta falecimento');
    expect(fmtRg({ numero: '1095584', orgao: 'SSP', uf: '' })).toBe('1095584 — SSP');
    expect(fmtCtps({ serie: 11, numero: 48947 })).toBe('Série 11 · Nº 48947');
  });
});
