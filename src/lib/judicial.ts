/**
 * Leitura dos processos judiciais e dos vínculos familiares do perfil de
 * pessoa — base da aba "Jurídico" e da rede judicial/familiar desenhada no
 * mapa.
 *
 * Só INTERPRETA o que veio na consulta: nada é inventado (campo ausente fica
 * ausente) e o registro original de cada processo/parte é preservado em
 * `raw`, para que a interface possa mostrar qualquer campo que não tenha
 * leitura dedicada aqui.
 */
import { isValidCNPJ, isValidCPF, normalizeText, onlyDigits } from './format';

type Dict = Record<string, unknown>;

const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const numOrUndef = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};

export type PoloKind = 'ativo' | 'passivo' | 'outros';

export interface Representante {
  nome: string;
  cpf?: string;
  oab?: string;
}

export interface ProcessoParte {
  nome: string;
  polo: PoloKind;
  /** Texto original do polo (ex.: "OUTROS_PARTICIPANTES"). */
  poloTexto?: string;
  /** Só dígitos, quando houver documento. */
  documento?: string;
  tipoParte?: string;
  pessoaJuridica: boolean;
  representantes: Representante[];
  raw: Dict;
}

export interface Processo {
  numero: string;
  classe?: string;
  assunto?: string;
  tribunal?: string;
  orgaoJulgador?: string;
  valor?: number;
  dataAjuizamento?: string;
  ultimoMovimento?: { data?: string; descricao?: string };
  ativo?: boolean;
  partes: ProcessoParte[];
  raw: Dict;
}

/** Chaves de um processo com leitura dedicada — o resto vai para "outros campos" na interface. */
export const PROCESSO_KNOWN_KEYS = [
  'numero_processo',
  'classe',
  'assunto',
  'tribunal',
  'orgao_julgador',
  'valor_acao',
  'data_ajuizamento',
  'ultimo_movimento',
  'ativo',
  'partes',
];

export function poloKind(polo: unknown): PoloKind {
  const p = normalizeText(String(polo ?? ''));
  if (p.startsWith('ativo')) return 'ativo';
  if (p.startsWith('passivo')) return 'passivo';
  return 'outros';
}

export const POLO_LABEL: Record<PoloKind, string> = {
  ativo: 'Polo ativo',
  passivo: 'Polo passivo',
  outros: 'Outros participantes',
};

function readRepresentantes(v: unknown): Representante[] {
  if (!Array.isArray(v)) return [];
  const out: Representante[] = [];
  for (const r of v) {
    if (!isDict(r)) continue;
    const nome = str(r.nome);
    if (!nome) continue;
    const rep: Representante = { nome };
    const cpf = str(r.cpf);
    if (cpf) rep.cpf = onlyDigits(cpf);
    const oab = str(r.oab);
    if (oab) rep.oab = oab;
    out.push(rep);
  }
  return out;
}

function readParte(v: unknown): ProcessoParte | null {
  if (!isDict(v)) return null;
  const nome = str(v.nome);
  if (!nome) return null;
  const doc = str(v.documento) ? onlyDigits(String(v.documento)) : undefined;
  const tipoPessoa = normalizeText(String(v.tipo_pessoa ?? ''));
  return {
    nome,
    polo: poloKind(v.polo),
    poloTexto: str(v.polo),
    documento: doc || undefined,
    tipoParte: str(v.tipo_parte),
    pessoaJuridica: tipoPessoa.startsWith('jur') || (!!doc && doc.length === 14),
    representantes: readRepresentantes(v.representantes),
    raw: v,
  };
}

/** Lista de processos do perfil, aceitando `{ itens: [...] }` ou a lista direta. */
export function extractProcessos(sr: Dict): Processo[] {
  const src = sr.processos;
  const itens = Array.isArray(src) ? src : isDict(src) && Array.isArray(src.itens) ? src.itens : [];
  const out: Processo[] = [];
  for (const it of itens) {
    if (!isDict(it)) continue;
    const numero = str(it.numero_processo) ?? str(it.numero);
    if (!numero) continue;
    const um = isDict(it.ultimo_movimento) ? it.ultimo_movimento : undefined;
    out.push({
      numero,
      classe: str(it.classe),
      assunto: str(it.assunto),
      tribunal: str(it.tribunal),
      orgaoJulgador: str(it.orgao_julgador),
      valor: numOrUndef(it.valor_acao),
      dataAjuizamento: str(it.data_ajuizamento),
      ultimoMovimento: um ? { data: str(um.data), descricao: str(um.descricao) } : undefined,
      ativo: typeof it.ativo === 'boolean' ? it.ativo : undefined,
      partes: (Array.isArray(it.partes) ? it.partes : []).map(readParte).filter((p): p is ProcessoParte => !!p),
      raw: it,
    });
  }
  return out;
}

/** Total declarado pela consulta (pode ser maior que a lista devolvida). */
export function processosDeclaredTotal(sr: Dict): number | undefined {
  return isDict(sr.processos) ? numOrUndef(sr.processos.total) : undefined;
}

/**
 * Parte que representa a própria pessoa consultada: casa pelo CPF; sem CPF na
 * parte, cai para o nome (grafias já vistas como dela no mesmo conjunto).
 */
export function findSelf(p: Processo, cpf: string, selfNames: Set<string>): ProcessoParte | undefined {
  const digits = onlyDigits(cpf);
  return (
    p.partes.find((x) => digits !== '' && x.documento === digits) ??
    p.partes.find((x) => !x.documento && selfNames.has(normalizeText(x.nome)))
  );
}

/** Todas as grafias com que a pessoa aparece (via CPF) — usadas para reconhecê-la onde falta o documento. */
export function collectSelfNames(processos: Processo[], cpf: string, extra?: string): Set<string> {
  const digits = onlyDigits(cpf);
  const names = new Set<string>();
  if (extra) names.add(normalizeText(extra));
  for (const p of processos) for (const x of p.partes) if (digits && x.documento === digits) names.add(normalizeText(x.nome));
  return names;
}

/** Ano (AAAA) de uma data ISO-ish, ou undefined. */
export function yearOf(date?: string): number | undefined {
  const m = date ? /^(\d{4})/.exec(date) : null;
  return m ? Number(m[1]) : undefined;
}

// ─── Estatísticas (aba "Jurídico") ────────────────────────────────────────────

export interface CountItem {
  key: string;
  label: string;
  count: number;
  valor: number;
  extra?: string;
}

export interface JudicialStats {
  total: number;
  ativos: number;
  valorTotal: number;
  /** valor em causa nos processos em que a pessoa está no polo passivo */
  valorComoPassivo: number;
  porPolo: Record<PoloKind | 'desconhecido', number>;
  porAno: { ano: number; count: number }[];
  tribunais: CountItem[];
  classes: CountItem[];
  advogados: CountItem[];
  maisRecente?: { data: string; descricao?: string; numero: string };
  primeiroAno?: number;
}

function bump(map: Map<string, CountItem>, key: string, label: string, valor: number, extra?: string) {
  const cur = map.get(key);
  if (cur) {
    cur.count += 1;
    cur.valor += valor;
  } else {
    map.set(key, { key, label, count: 1, valor, extra });
  }
}

const byCount = (a: CountItem, b: CountItem) => b.count - a.count || b.valor - a.valor || a.label.localeCompare(b.label);

export function judicialStats(processos: Processo[], cpf: string, selfName?: string): JudicialStats {
  const selfNames = collectSelfNames(processos, cpf, selfName);
  const porPolo: JudicialStats['porPolo'] = { ativo: 0, passivo: 0, outros: 0, desconhecido: 0 };
  const anos = new Map<number, number>();
  const tribunais = new Map<string, CountItem>();
  const classes = new Map<string, CountItem>();
  const advogados = new Map<string, CountItem>();
  let valorTotal = 0;
  let valorComoPassivo = 0;
  let ativos = 0;
  let maisRecente: JudicialStats['maisRecente'];

  for (const p of processos) {
    const valor = p.valor ?? 0;
    valorTotal += valor;
    if (p.ativo !== false) ativos += 1;
    const self = findSelf(p, cpf, selfNames);
    porPolo[self ? self.polo : 'desconhecido'] += 1;
    if (self?.polo === 'passivo') valorComoPassivo += valor;
    for (const r of self?.representantes ?? []) {
      bump(advogados, r.cpf || normalizeText(r.nome), r.nome, valor, r.oab);
    }
    const ano = yearOf(p.dataAjuizamento);
    if (ano) anos.set(ano, (anos.get(ano) ?? 0) + 1);
    if (p.tribunal) bump(tribunais, p.tribunal, p.tribunal, valor);
    if (p.classe) bump(classes, normalizeText(p.classe), p.classe, valor);
    const um = p.ultimoMovimento?.data;
    if (um && (!maisRecente || um > maisRecente.data)) {
      maisRecente = { data: um, descricao: p.ultimoMovimento?.descricao, numero: p.numero };
    }
  }

  const anosOrdenados = [...anos.keys()].sort((a, b) => a - b);
  const porAno: { ano: number; count: number }[] = [];
  if (anosOrdenados.length > 0) {
    for (let a = anosOrdenados[0]; a <= anosOrdenados[anosOrdenados.length - 1]; a++) {
      porAno.push({ ano: a, count: anos.get(a) ?? 0 });
    }
  }

  return {
    total: processos.length,
    ativos,
    valorTotal,
    valorComoPassivo,
    porPolo,
    porAno,
    tribunais: [...tribunais.values()].sort(byCount),
    classes: [...classes.values()].sort(byCount),
    advogados: [...advogados.values()].sort(byCount),
    maisRecente,
    primeiroAno: anosOrdenados[0],
  };
}

// ─── Rede (contrapartes e família) ────────────────────────────────────────────

/** Como a outra parte se relaciona com a pessoa num processo. */
export type JudicialRelation = 'adverso' | 'coparte' | 'envolvido';

export interface CounterpartyProcess {
  numero: string;
  classe?: string;
  relation: JudicialRelation;
  poloSelf?: PoloKind;
  poloOutro: PoloKind;
  tipoParte?: string;
  dataAjuizamento?: string;
  valor?: number;
}

export interface Counterparty {
  /** CPF/CNPJ válido (só dígitos) ou `nome:<normalizado>` quando não há documento. */
  key: string;
  nome: string;
  documento?: string;
  pessoaJuridica: boolean;
  processos: CounterpartyProcess[];
  valorTotal: number;
}

export interface FamilyMember {
  key: string;
  nome: string;
  vinculo?: string;
  documento?: string;
}

/** Documento utilizável como identidade (CPF/CNPJ com dígitos verificadores válidos). */
export function validDocument(doc?: string): string | undefined {
  const d = onlyDigits(doc ?? '');
  if (d.length === 11 && isValidCPF(d)) return d;
  if (d.length === 14 && isValidCNPJ(d)) return d;
  return undefined;
}

const nameKey = (nome: string) => `nome:${normalizeText(nome).replace(/\s+/g, ' ').trim()}`;

function relationBetween(self: PoloKind | undefined, other: PoloKind): JudicialRelation {
  if (!self || self === 'outros' || other === 'outros') return 'envolvido';
  return self === other ? 'coparte' : 'adverso';
}

/**
 * Demais partes dos processos da pessoa, agregadas por documento (ou nome,
 * quando não há documento). A própria pessoa nunca entra; advogados também
 * não — eles aparecem só no detalhe de cada processo.
 */
export function buildCounterparties(processos: Processo[], cpf: string, selfName?: string): Counterparty[] {
  const selfDigits = onlyDigits(cpf);
  const selfNames = collectSelfNames(processos, cpf, selfName);
  const byKey = new Map<string, Counterparty>();
  const docByName = new Map<string, string>();

  // 1ª passada: grafias que têm documento — permite unir a mesma parte sem documento em outro processo.
  for (const p of processos) {
    for (const x of p.partes) {
      const doc = validDocument(x.documento);
      if (doc && doc !== selfDigits) docByName.set(nameKey(x.nome), doc);
    }
  }

  for (const p of processos) {
    const self = findSelf(p, cpf, selfNames);
    for (const x of p.partes) {
      if (x === self) continue;
      if (x.documento && x.documento === selfDigits) continue;
      if (!x.documento && selfNames.has(normalizeText(x.nome))) continue;
      const doc = validDocument(x.documento) ?? docByName.get(nameKey(x.nome));
      const key = doc ?? nameKey(x.nome);
      let cp = byKey.get(key);
      if (!cp) {
        cp = {
          key,
          nome: x.nome,
          documento: doc,
          pessoaJuridica: doc ? doc.length === 14 : x.pessoaJuridica,
          processos: [],
          valorTotal: 0,
        };
        byKey.set(key, cp);
      }
      // mesma parte duas vezes no mesmo processo conta uma vez
      if (cp.processos.some((q) => q.numero === p.numero)) continue;
      cp.processos.push({
        numero: p.numero,
        classe: p.classe,
        relation: relationBetween(self?.polo, x.polo),
        poloSelf: self?.polo,
        poloOutro: x.polo,
        tipoParte: x.tipoParte,
        dataAjuizamento: p.dataAjuizamento,
        valor: p.valor,
      });
      cp.valorTotal += p.valor ?? 0;
    }
  }

  return [...byKey.values()].sort(
    (a, b) => b.processos.length - a.processos.length || b.valorTotal - a.valorTotal || a.nome.localeCompare(b.nome),
  );
}

/**
 * Parentes declarados no perfil. Sem CPF válido (há bases que devolvem
 * "00000000000"), tenta o documento da mesma pessoa nos processos, pelo nome.
 */
export function extractFamily(sr: Dict, counterparties: Counterparty[] = []): FamilyMember[] {
  const raw = sr.parentes;
  if (!Array.isArray(raw)) return [];
  const docByName = new Map(counterparties.filter((c) => c.documento).map((c) => [nameKey(c.nome), c.documento!]));
  const out: FamilyMember[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isDict(item)) continue;
    const nome = str(item.nome) ?? str(item.nome_parente) ?? str(item.nomeParente);
    if (!nome) continue;
    const doc = validDocument(str(item.cpf) ?? str(item.documento)) ?? docByName.get(nameKey(nome));
    const key = doc ?? nameKey(nome);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, nome, vinculo: str(item.vinculo) ?? str(item.parentesco) ?? str(item.grau), documento: doc });
  }
  return out;
}

/** "MAE" → "Mãe", "IRMAO" → "Irmão"… (texto original quando não reconhecido). */
export function vinculoLabel(v?: string): string {
  if (!v) return 'Parente';
  const n = normalizeText(v).replace(/[^a-z]/g, '');
  const map: Record<string, string> = {
    mae: 'Mãe',
    pai: 'Pai',
    irmao: 'Irmão',
    irma: 'Irmã',
    filho: 'Filho',
    filha: 'Filha',
    conjuge: 'Cônjuge',
    esposa: 'Esposa',
    esposo: 'Esposo',
    avo: 'Avô/Avó',
    tio: 'Tio',
    tia: 'Tia',
    primo: 'Primo',
    prima: 'Prima',
    sobrinho: 'Sobrinho',
    sobrinha: 'Sobrinha',
    neto: 'Neto',
    neta: 'Neta',
  };
  if (map[n]) return map[n];
  const t = v.trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}
