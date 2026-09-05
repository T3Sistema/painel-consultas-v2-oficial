/**
 * Adaptador do envelope de resposta da consulta de pessoa.
 *
 * A rota interna pode devolver a resposta em duas formas:
 *
 * - **consolidada** — `dados.SERVICE_RESPONSE`, um mapa plano cujas chaves de
 *   nível superior já são as consumidas por `src/lib/profileSchema.ts`
 *   (`cadastral`, `telefones`, `sociedades`, …);
 * - **por seções** — `dados.pessoa`, com o conteúdo agrupado em blocos
 *   (`identificacao`, `cadastro`, `contatos`, `documentos`, `financeiro`,
 *   `vinculos`, `juridico`, `seguranca`, `ocupacao`, `veiculos`).
 *
 * Este módulo converte a segunda forma na primeira, para que TODO o resto do
 * app (schema de páginas, categorias, foto, imagens salvas, grafo) continue
 * lendo um único formato. Regras:
 *
 * 1. **Nada de metadado técnico.** Só o conteúdo de `dados.pessoa` é lido —
 *    as chaves irmãs de `pessoa` (identificadores de rota, carimbos de
 *    origem, lista de bases acionadas) nunca são copiadas, porque revelariam
 *    a arquitetura interna no painel/exports.
 * 2. **Nada de dado inventado.** Campo ausente ou nulo é omitido, nunca
 *    preenchido com placeholder. Nenhum valor pesquisado é reescrito: só há
 *    renomeação de chave e normalização de data para o formato que
 *    `formatDate` entende.
 * 3. **Nada perdido.** Toda chave desconhecida — de `pessoa` ou de qualquer
 *    bloco dela — é repassada, caindo nas seções genéricas do schema.
 */
import { formatCPF } from '../lib/format';

type Dict = Record<string, unknown>;

/** Blocos de `pessoa` com mapeamento explícito abaixo — o resto é repassado como veio. */
const MAPPED_GROUPS = [
  'identificacao',
  'cadastro',
  'contatos',
  'documentos',
  'financeiro',
  'vinculos',
  'juridico',
  'seguranca',
  'ocupacao',
  'veiculos',
];

export function isPlainObject(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function asDict(v: unknown): Dict {
  return isPlainObject(v) ? v : {};
}

/** `false` para o que não vale uma linha no painel — nulo, string vazia, lista/objeto vazio. */
function hasValue(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  if (isPlainObject(v)) return Object.keys(v).length > 0;
  return true;
}

/** Grava só quando há valor de verdade (ver regra 2 no topo). */
function put(target: Dict, key: string, value: unknown): void {
  if (hasValue(value)) target[key] = value;
}

/** Chaves do bloco ainda não consumidas por nenhum mapeamento — garante a regra 3. */
function leftovers(source: Dict, consumed: string[]): Dict {
  const out: Dict = {};
  for (const [key, value] of Object.entries(source)) {
    if (consumed.includes(key) || !hasValue(value)) continue;
    out[key] = value;
  }
  return out;
}

const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?$/;

/**
 * `"1973-03-16 00:00:00"` → `"1973-03-16"`; com hora significativa, vira ISO
 * com `T`. Mesmo instante, só numa grafia que `formatDate` (e o `Date` de
 * todos os navegadores) aceita — a forma com espaço é inválida em alguns.
 */
function normalizeDate(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const m = DATE_TIME_RE.exec(value.trim());
  if (!m) return value;
  return m[2] === '00:00:00' ? m[1] : `${m[1]}T${m[2]}`;
}

/** `"True"`/`"False"` textuais viram booleano; qualquer outra coisa passa direto. */
function parseBooleanish(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const s = value.trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return value;
}

/** Lista de escalares (`["a@b.com"]`) vira lista de registros (`[{ email: … }]`). */
function toRecords(value: unknown, key: string): unknown[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.map((item) => (isPlainObject(item) ? item : { [key]: item }));
}

function mapCadastral(pessoa: Dict): Dict {
  const identificacao = asDict(pessoa.identificacao);
  const cadastro = asDict(pessoa.cadastro);
  const documentos = asDict(pessoa.documentos);
  const financeiro = asDict(pessoa.financeiro);

  const cadastral: Dict = {};

  put(cadastral, 'nome', identificacao.nome);
  const cpf = typeof identificacao.cpf === 'string' ? identificacao.cpf : undefined;
  put(cadastral, 'cpf', cpf);
  put(cadastral, 'cpfMask', cpf ? formatCPF(cpf) : undefined);
  put(cadastral, 'dataNasc', normalizeDate(identificacao.data_nascimento));
  put(cadastral, 'sexo', identificacao.sexo);
  put(cadastral, 'nacionalidade', identificacao.nacionalidade);
  if (hasValue(identificacao.nome_mae)) cadastral.mae = { nome: identificacao.nome_mae };
  if (hasValue(identificacao.nome_pai)) cadastral.pai = { nome: identificacao.nome_pai };
  // Só sinaliza quando é verdade: "não é estrangeiro" é o caso comum e vira ruído.
  if (parseBooleanish(identificacao.estrangeiro) === true) cadastral.estrangeiro = true;

  put(cadastral, 'estadoCivil', cadastro.estado_civil);
  put(cadastral, 'municipio', cadastro.municipio);
  put(cadastral, 'uf', cadastro.uf);
  put(cadastral, 'situacaoCadastral', cadastro.situacao_cadastral);
  put(cadastral, 'dataSituacaoCadastral', normalizeDate(cadastro.data_situacao_cadastral));
  put(cadastral, 'dataInscricao', normalizeDate(cadastro.data_inscricao));
  put(cadastral, 'dataAtualizacao', normalizeDate(cadastro.data_atualizacao));
  put(cadastral, 'residenteExterior', parseBooleanish(cadastro.residente_exterior));

  // Óbito: o bloco só afirma falecimento quando traz ano ou data.
  const obito = asDict(cadastro.obito);
  cadastral.flagObito2 = hasValue(obito.ano) || hasValue(obito.data);
  put(cadastral, 'dataObito', normalizeDate(obito.data));

  put(cadastral, 'renda', financeiro.renda);

  const rg = asDict(documentos.rg);
  if (hasValue(rg.numero)) {
    // fmtRg espera { numero, orgao, uf }.
    const mapped: Dict = { numero: rg.numero };
    put(mapped, 'orgao', rg.orgao_emissor);
    put(mapped, 'uf', rg.uf);
    cadastral.rg = mapped;
  }
  if (hasValue(documentos.titulo_eleitor)) {
    cadastral.tituloEleitor = { numero: documentos.titulo_eleitor };
  }

  Object.assign(
    cadastral,
    leftovers(identificacao, ['nome', 'cpf', 'data_nascimento', 'sexo', 'nacionalidade', 'nome_mae', 'nome_pai', 'estrangeiro']),
    leftovers(cadastro, [
      'estado_civil',
      'municipio',
      'uf',
      'situacao_cadastral',
      'data_situacao_cadastral',
      'data_inscricao',
      'data_atualizacao',
      'residente_exterior',
      'obito',
    ]),
  );

  return cadastral;
}

function mapCnh(documentos: Dict): Dict {
  const src = asDict(documentos.cnh);
  const cnh: Dict = {};
  put(cnh, 'registro', src.numero);
  put(cnh, 'renach', src.renach);
  put(cnh, 'uf_cnh', src.uf);
  put(cnh, 'endereco', src.endereco);
  // Categoria, validade, multas, exame etc. seguem com o nome original — a
  // seção de CNH tem `absorbRest`, então aparecem sem precisar de mapeamento.
  Object.assign(cnh, leftovers(src, ['numero', 'renach', 'uf']));
  return cnh;
}

/**
 * Converte o bloco `pessoa` no mapa plano consumido pelo schema de páginas.
 * Não recebe (nem enxerga) nada fora de `pessoa` — ver regra 1 no topo.
 */
export function normalizePersonSections(pessoa: Dict): Dict {
  const sr: Dict = {};

  const contatos = asDict(pessoa.contatos);
  const documentos = asDict(pessoa.documentos);
  const financeiro = asDict(pessoa.financeiro);
  const vinculos = asDict(pessoa.vinculos);
  const juridico = asDict(pessoa.juridico);
  const seguranca = asDict(pessoa.seguranca);
  const ocupacao = asDict(pessoa.ocupacao);

  put(sr, 'cadastral', mapCadastral(pessoa));

  // ── Documentos ──────────────────────────────────────────────────────────
  put(sr, 'cnh', mapCnh(documentos));
  put(sr, 'documentos', leftovers(documentos, ['rg', 'cnh', 'titulo_eleitor']));

  // ── Contatos e endereços ────────────────────────────────────────────────
  put(sr, 'telefones', toRecords(contatos.telefones, 'telefone'));
  put(sr, 'emails', toRecords(contatos.emails, 'email'));
  if (Array.isArray(contatos.enderecos)) {
    // `logradouro` é o campo que a seção de endereços rotula como "Logradouro".
    const enderecos = contatos.enderecos.map((raw) => {
      if (!isPlainObject(raw)) return raw;
      const item: Dict = {};
      put(item, 'endereco', raw.logradouro);
      Object.assign(item, leftovers(raw, ['logradouro']));
      return item;
    });
    put(sr, 'enderecos', enderecos);
  }
  // As fotos já chegam como referência utilizável pelo painel — passam intactas.
  put(sr, 'fotos', contatos.fotos);
  put(sr, 'contatos', leftovers(contatos, ['telefones', 'emails', 'enderecos', 'fotos']));

  // ── Vínculos ────────────────────────────────────────────────────────────
  put(sr, 'parentes', vinculos.parentes);
  put(sr, 'relacionadosPorEndereco', vinculos.vizinhos);
  put(sr, 'vinculos', leftovers(vinculos, ['parentes', 'vizinhos']));

  // ── Jurídico e segurança ────────────────────────────────────────────────
  put(sr, 'processos', juridico.processos);
  put(sr, 'juridico', leftovers(juridico, ['processos']));
  put(sr, 'vazamentos', seguranca.vazamentos);
  put(sr, 'seguranca', leftovers(seguranca, ['vazamentos']));

  // ── Ocupação e patrimônio ───────────────────────────────────────────────
  if (hasValue(ocupacao.cbo) || hasValue(ocupacao.profissao)) {
    const profissao: Dict = {};
    put(profissao, 'cbo', ocupacao.cbo);
    put(profissao, 'descricao', ocupacao.profissao);
    sr.profissoes = [profissao];
  }
  put(sr, 'ocupacao', leftovers(ocupacao, ['cbo', 'profissao']));
  put(sr, 'placas', pessoa.veiculos);

  // ── Financeiro ──────────────────────────────────────────────────────────
  put(sr, 'score', financeiro.score);
  put(sr, 'financeiro', leftovers(financeiro, ['renda', 'score']));

  // ── Regra 3: qualquer bloco novo de `pessoa` segue com o nome que tinha ──
  Object.assign(sr, leftovers(pessoa, MAPPED_GROUPS));

  return sr;
}
