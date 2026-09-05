/**
 * Dicionário de campos do perfil de pessoa (APIFull). Substitui o agrupamento
 * genérico por palavra-chave: aqui cada chave de nível superior de
 * `SERVICE_RESPONSE` é mapeada explicitamente para uma das 9 páginas, numa
 * seção nomeada, com rótulos em pt-BR e o renderizador adequado.
 *
 * Nada é descartado: qualquer chave de nível superior que NÃO apareça em
 * nenhuma seção abaixo cai automaticamente na página "Saúde" via
 * `unmappedGenericSections` — inclusive uma chave nova/desconhecida que a API
 * venha a adicionar no futuro.
 */
import {
  fmtCtps,
  fmtDate,
  fmtIdade,
  fmtLocalidade,
  fmtMoney,
  fmtNadaConsta,
  fmtObito,
  fmtRg,
  fmtSexo,
} from './profileFormat';
import type { MaskClass } from './mask';

export type SectionKind = 'fields' | 'list' | 'people' | 'leaks' | 'timeline' | 'flags' | 'generic';

export interface FieldSpec {
  label: string;
  /** Caminho pontilhado dentro do objeto de origem (item, no caso de listas). '' = o próprio objeto. */
  path: string;
  /** Formatação de exibição (default: texto puro / "—" quando vazio). */
  format?: (value: unknown) => string;
  /** Chave usada para decidir mascaramento (default: último segmento de `path`). */
  maskKey?: string;
  /** Força a classe de mascaramento, ignorando `classifyKey` (ex.: senha vazada — revelável, ao contrário de credencial do próprio sistema). */
  maskOverride?: MaskClass;
  /** Chaves cruas consumidas por este campo (além do topo de `path`) — evita duplicá-las no "restante". */
  consumes?: string[];
}

export interface SectionSpec {
  title: string;
  /** Chave de nível superior de SERVICE_RESPONSE lida por esta seção. */
  source: string;
  kind: SectionKind;
  /** Campos rotulados — para 'fields' (objeto único) e 'list' (por item). */
  fields?: FieldSpec[];
  /** Renderiza mesmo quando a origem está vazia (mostra `emptyText`). */
  alwaysShow?: boolean;
  emptyText?: string;
  /**
   * Numa seção 'fields', anexa ao fim TODAS as chaves da origem ainda não
   * cobertas por nenhum campo (desta ou de seções irmãs que leem a mesma
   * origem) — garante que nenhum dado seja omitido.
   */
  absorbRest?: boolean;
}

export interface PageSpec {
  name: string;
  sections: SectionSpec[];
}

const CADASTRAL_FIELDS: FieldSpec[] = [
  { label: 'Nome completo', path: 'nome' },
  { label: 'Nome social', path: 'nomeSocial' },
  { label: 'CPF', path: 'cpfMask', maskKey: 'cpf', consumes: ['cpf'] },
  { label: 'Data de nascimento', path: 'dataNasc', format: fmtDate },
  { label: 'Idade', path: 'idade', format: fmtIdade },
  { label: 'Sexo', path: 'sexo', format: fmtSexo },
  { label: 'Naturalidade', path: 'naturalidade' },
  { label: 'Signo ocidental', path: 'signo' },
  { label: 'Signo chinês', path: 'signoChines' },
  { label: 'Classe social', path: 'classeSocial' },
  { label: 'Subclasse social', path: 'subClasseSocial' },
  { label: 'Nível escolar', path: 'escolaridade' },
  { label: 'Renda estimada', path: 'renda', format: fmtMoney },
  { label: 'Nome do pai', path: 'pai.nome', maskKey: '_' },
  { label: 'Nome da mãe', path: 'mae.nome', maskKey: '_' },
  { label: 'NIS', path: 'nis', maskKey: 'nis' },
  { label: 'CNS (SUS)', path: 'cns', maskKey: 'cns' },
  { label: 'RG', path: 'rg', format: fmtRg, maskKey: 'rg' },
  { label: 'PIS', path: 'pis', maskKey: 'pis' },
  { label: 'Carteira de Trabalho (CTPS)', path: 'ctps', format: fmtCtps },
  { label: 'Capital social estimado', path: 'capitalSocialTotal', format: fmtMoney },
  { label: 'Indicativo criminal', path: 'indicativoCriminal', format: fmtNadaConsta },
  { label: 'Óbito (RFB)', path: 'flagObito2', format: fmtObito },
];

const TITULO_ELEITOR_FIELDS: FieldSpec[] = [
  { label: 'Número de inscrição', path: 'tituloEleitor.numero', maskKey: 'titulo' },
  { label: 'Zona eleitoral', path: 'tituloEleitor.zona' },
  { label: 'Seção eleitoral', path: 'tituloEleitor.secao' },
];

const CNH_FIELDS: FieldSpec[] = [
  { label: 'Nome completo', path: 'nome' },
  { label: 'Nº registro CNH', path: 'registro', maskKey: 'registro' },
  { label: 'Renach', path: 'renach' },
  { label: 'Nº documento', path: 'numero_documento', maskKey: 'documento' },
  { label: 'Órgão emissor', path: 'orgao_emissor' },
  { label: 'UF de emissão', path: 'uf_cnh' },
  { label: 'Primeira habilitação', path: 'data_primeira_cnh', format: fmtDate },
  { label: 'Data de nascimento', path: 'data_nascimento', format: fmtDate },
  { label: 'Local de nascimento', path: 'local_nascimento' },
  { label: 'Endereço (DETRAN)', path: 'endereco', maskKey: 'endereco' },
  { label: 'Município', path: 'municipio_endereco' },
  { label: 'UF do endereço', path: 'uf_endereco' },
  { label: 'CEP', path: 'cep' },
];

const cidadeUf = (cidadeKey: string, ufKey: string) => (item: unknown): string => {
  const o = (item ?? {}) as Record<string, unknown>;
  return fmtLocalidade(o[cidadeKey], o[ufKey]);
};

export const PROFILE_PAGES: PageSpec[] = [
  {
    name: 'Cadastral & Civil',
    sections: [
      { title: 'Dados de Registro Civil & RFB', source: 'cadastral', kind: 'fields', fields: CADASTRAL_FIELDS, alwaysShow: true, absorbRest: true, emptyText: 'Sem dados cadastrais para este CPF.' },
      { title: 'Título de Eleitor', source: 'cadastral', kind: 'fields', fields: TITULO_ELEITOR_FIELDS, alwaysShow: true },
      { title: 'Carteira de Identidade Nacional (CIN)', source: 'cin', kind: 'generic', alwaysShow: true, emptyText: 'Sem dados de CIN disponíveis para este CPF.' },
      { title: 'Dados de Habilitação (CNH)', source: 'cnh', kind: 'fields', fields: CNH_FIELDS, alwaysShow: true, absorbRest: true, emptyText: 'Sem dados de habilitação vinculados.' },
      { title: 'Registros de RG', source: 'rgs', kind: 'list', fields: [
        { label: 'RG', path: 'rg', maskKey: 'rg' },
        { label: 'Órgão', path: 'orgaorg' },
        { label: 'UF', path: 'ufrg' },
        { label: 'Emissão', path: 'emissaorg', format: fmtDate },
      ] },
      { title: 'Histórico de grafias / Nomes adicionais', source: 'outrosNomes', kind: 'list', alwaysShow: true, emptyText: 'Sem nomenclaturas secundárias registradas.', fields: [{ label: 'Nome', path: 'nome' }] },
      { title: 'Escolaridade', source: 'escolaridade', kind: 'list', fields: [{ label: 'Nível', path: 'nivel' }] },
      { title: 'Formação (SISU)', source: 'sisu', kind: 'generic' },
      { title: 'Formação (ProUni)', source: 'prouni', kind: 'generic' },
      { title: 'Vida universitária', source: 'universitarios', kind: 'generic' },
      { title: 'Histórico escolar', source: 'historicoEscolar', kind: 'generic' },
      { title: 'Filiação (genitores)', source: 'genitores', kind: 'people' },
      { title: 'Relação de Parentesco & Árvore Genealógica', source: 'parentes', kind: 'people', alwaysShow: true, emptyText: 'Sem vínculos familiares registrados.' },
      { title: 'Certidões Cíveis (Registro Civil)', source: 'certidoes', kind: 'generic', alwaysShow: true, emptyText: 'Sem anotações de certidões cíveis digitais vinculadas.' },
      { title: 'Certidão de óbito', source: 'certidaoObito', kind: 'generic' },
      { title: 'Fotos encontradas', source: 'fotos', kind: 'generic' },
      { title: 'Fotos adicionais', source: 'extraFotos', kind: 'generic' },
      { title: 'Documentos digitalizados', source: 'docsBase64', kind: 'generic' },
      { title: 'Outros documentos', source: 'documentos', kind: 'generic' },
    ],
  },
  {
    name: 'Contatos & Endereços',
    sections: [
      { title: 'Telefones', source: 'telefones', kind: 'list', alwaysShow: true, emptyText: 'Nenhum telefone encontrado.', fields: [
        { label: 'Telefone', path: 'telefone', maskKey: 'telefone' },
        { label: 'WhatsApp', path: 'flagWhatsApp', format: (v) => (v ? 'Sim' : 'Não'), maskKey: '_' },
        { label: 'Tipo', path: 'tipo' },
        { label: 'Classificação', path: 'classificacao' },
        { label: 'Última informação', path: 'data', format: fmtDate },
      ] },
      { title: 'E-mails', source: 'emails', kind: 'list', alwaysShow: true, emptyText: 'Nenhum e-mail encontrado.', fields: [
        { label: 'E-mail', path: 'email', maskKey: 'email' },
        { label: 'Senha vazada', path: 'password', maskOverride: 'soft' },
        { label: 'Avaliação', path: 'avaliacao' },
      ] },
      { title: 'Endereços', source: 'enderecos', kind: 'list', alwaysShow: true, emptyText: 'Nenhum endereço encontrado.', fields: [
        { label: 'Logradouro', path: 'endereco', maskKey: 'endereco' },
        { label: 'Número', path: 'numero' },
        { label: 'Complemento', path: 'complemento' },
        { label: 'Bairro', path: 'bairro' },
        { label: 'Cidade / UF', path: '', format: cidadeUf('cidade', 'uf'), maskKey: '_', consumes: ['cidade', 'uf'] },
        { label: 'CEP', path: 'cep' },
        { label: 'Fonte', path: 'fonte' },
        { label: 'Atualizado em', path: 'dataInformacao', format: fmtDate },
      ] },
      { title: 'Relacionados por endereço', source: 'relacionadosPorEndereco', kind: 'people' },
    ],
  },
  {
    name: 'Financeiro & Consumo',
    sections: [
      { title: 'Contas bancárias', source: 'contasBancos', kind: 'list', fields: [
        { label: 'Banco', path: 'banco' },
        { label: 'Agência', path: 'agencia', maskKey: 'agencia' },
        { label: 'Conta', path: 'conta', maskKey: 'conta' },
        { label: 'Código', path: 'codBanco' },
      ] },
      { title: 'Chaves PIX', source: 'chavesPix', kind: 'generic' },
      { title: 'Restituições de IRPF', source: 'irpf', kind: 'list', fields: [
        { label: 'Ano', path: 'ano' },
        { label: 'Situação', path: 'situacao' },
        { label: 'Lote', path: 'lote' },
        { label: 'Banco', path: 'banco' },
        { label: 'Agência', path: 'agencia', maskKey: 'agencia' },
        { label: 'Data do lote', path: 'dt_lote', format: fmtDate },
      ] },
      { title: 'Cheques sem fundo (CCF)', source: 'ccf', kind: 'generic' },
      { title: 'Dívida ativa', source: 'dividaAtiva', kind: 'generic' },
      { title: 'Empréstimos', source: 'emprestimos', kind: 'generic' },
      { title: 'Assinaturas', source: 'assinaturas', kind: 'generic' },
      { title: 'Compras online', source: 'comprasOnline', kind: 'generic' },
      { title: 'Planos de internet / telecom', source: 'planos', kind: 'list', fields: [
        { label: 'Plano', path: 'plano' },
        { label: 'Empresa', path: 'empresa' },
        { label: 'Status', path: 'statusProduto' },
        { label: 'Cidade', path: 'cidade' },
        { label: 'Logradouro', path: 'endereco', maskKey: 'endereco' },
        { label: 'Contratado em', path: 'dataProduto', format: fmtDate },
      ] },
      { title: 'Planos móveis', source: 'planosMoveis', kind: 'generic' },
      { title: 'Contas de energia', source: 'energias', kind: 'generic' },
      { title: 'Score de crédito', source: 'score', kind: 'generic' },
      { title: 'Outros dados financeiros', source: 'financeiro', kind: 'generic' },
      { title: 'Perfil de consumo (propensões)', source: 'propensoes', kind: 'flags' },
    ],
  },
  {
    name: 'Carreira & Negócios',
    sections: [
      { title: 'Sociedades (empresas)', source: 'sociedades', kind: 'list', alwaysShow: true, emptyText: 'Nenhuma sociedade encontrada.', fields: [
        { label: 'Razão social', path: 'razao_social' },
        { label: 'CNPJ', path: 'cnpj' },
        { label: 'Qualificação', path: 'qualificacao_socio_descricao' },
        { label: 'Situação', path: 'situacao_cadastral' },
        { label: 'Entrada', path: 'dt_entrada', format: fmtDate },
      ] },
      { title: 'Vínculos empregatícios', source: 'empregos', kind: 'list', fields: [
        { label: 'Empregador', path: 'razao_social' },
        { label: 'Cargo (CBO)', path: 'descricao_cbo' },
        { label: 'Salário', path: 'salario', format: fmtMoney },
        { label: 'Admissão', path: 'data_admissao', format: fmtDate },
        { label: 'Demissão', path: 'data_demissao', format: fmtDate },
        { label: 'CNPJ', path: 'cnpj_empregador' },
      ] },
      { title: 'Histórico RAIS', source: 'rais', kind: 'list', fields: [
        { label: 'Empregador', path: 'razao_social' },
        { label: 'CNPJ', path: 'cnpj' },
        { label: 'Ano base', path: 'ano_base' },
        { label: 'Admissão', path: 'admissao', format: fmtDate },
        { label: 'Demissão', path: 'demissao_tratada', format: fmtDate },
      ] },
      { title: 'Profissões (CBO)', source: 'profissoes', kind: 'list', fields: [
        { label: 'CBO', path: 'cbo' },
        { label: 'Descrição', path: 'descricao' },
      ] },
      { title: 'Contatos comerciais', source: 'contatosComerciais', kind: 'list', fields: [
        { label: 'Razão social', path: 'razaoSocial' },
        { label: 'CNPJ', path: 'cnpj' },
        { label: 'E-mail', path: 'email', maskKey: 'email' },
        { label: 'Telefones', path: 'telefones', maskKey: 'telefone' },
        { label: 'Endereço', path: '', format: (i) => fmtLocalidadeFromContato(i), maskKey: '_', consumes: ['endereco'] },
      ] },
      { title: 'Empresas relacionadas', source: 'empresasRelacionadas', kind: 'generic' },
      { title: 'MEI', source: 'meiDetalhado', kind: 'generic' },
      { title: 'Conselhos de classe', source: 'dadosConselho', kind: 'generic' },
      { title: 'Inscrições na OAB', source: 'inscricoesOab', kind: 'generic' },
      { title: 'LinkedIn', source: 'linkedin', kind: 'generic' },
      { title: 'Exposição política (PPE)', source: 'ppe', kind: 'generic' },
      { title: 'Filiações e histórico político', source: 'politica', kind: 'generic' },
      { title: 'Ocupação', source: 'ocupacao', kind: 'generic' },
    ],
  },
  {
    name: 'Cyber Sec & Vazamentos',
    sections: [
      { title: 'Credenciais vazadas', source: 'credenciaisVazadas', kind: 'leaks', alwaysShow: true, emptyText: 'Nenhuma credencial vazada encontrada.' },
      { title: 'Outros vazamentos', source: 'vazamentos', kind: 'generic', alwaysShow: true, emptyText: 'Nenhum vazamento adicional encontrado.' },
    ],
  },
  {
    name: 'Presença & Viagens',
    sections: [
      { title: 'Viagens', source: 'viagens', kind: 'generic', alwaysShow: true, emptyText: 'Nenhuma viagem registrada.' },
      { title: 'Presença online (Google Maps)', source: 'movimentacoesOnline', kind: 'generic' },
      { title: 'Situação de estrangeiro / imigração', source: 'estrangeiro', kind: 'generic' },
    ],
  },
  {
    name: 'Bens & Patrimônio',
    sections: [
      { title: 'Veículos (placas)', source: 'placas', kind: 'generic', alwaysShow: true, emptyText: 'Nenhum veículo/placa encontrado.' },
      { title: 'Imóveis (SP)', source: 'imoveisSp', kind: 'generic' },
      { title: 'Aeronaves', source: 'aeronaves', kind: 'generic' },
      { title: 'Drones', source: 'drones', kind: 'generic' },
    ],
  },
  {
    name: 'Saúde',
    sections: [
      { title: 'Vacinas', source: 'vacinas', kind: 'list', fields: [
        { label: 'Vacina', path: 'vacina_nome' },
        { label: 'Dose', path: 'vacina_dose' },
        { label: 'Fabricante', path: 'vacina_fabricante' },
        { label: 'Aplicação', path: 'vacina_dt_aplicacao', format: fmtDate },
        { label: 'Estabelecimento', path: 'estab_nome_fantasia' },
        { label: 'Município / UF', path: '', format: cidadeUf('estab_municipio', 'estab_uf'), maskKey: '_', consumes: ['estab_municipio', 'estab_uf'] },
      ] },
      { title: 'Planos de saúde', source: 'planosSaude', kind: 'generic' },
      { title: 'INSS / SIAPE', source: 'inssSiape', kind: 'generic' },
      { title: 'Benefícios', source: 'beneficios', kind: 'generic' },
      { title: 'Benefícios e auxílios', source: 'beneficiosAuxilios', kind: 'generic' },
      { title: 'Auxílio emergencial', source: 'pagamentosAuxilioEmergencial', kind: 'generic' },
      { title: 'Processos judiciais', source: 'processos', kind: 'generic', alwaysShow: true, emptyText: 'Nenhum processo judicial encontrado.' },
      { title: 'Peças / mandados (BNMP)', source: 'pecasBnmp', kind: 'generic' },
      { title: 'Vínculos por processos', source: 'vinculosPorProcessos', kind: 'generic' },
      { title: 'Outros registros jurídicos', source: 'juridico', kind: 'generic' },
    ],
  },
  {
    name: 'Timeline',
    sections: [
      { title: 'Linha do tempo', source: 'linhaDoTempo', kind: 'timeline', alwaysShow: true, emptyText: 'Sem eventos na linha do tempo.' },
    ],
  },
];

/**
 * Página que recebe as chaves de nível superior não mapeadas por nenhuma
 * seção (ver `unmappedGenericSections`) — não é necessariamente a última
 * página da lista, então referenciamos pelo nome para não jogar dados soltos
 * na aba "Timeline", que é puramente cronológica.
 */
export const UNMAPPED_PAGE_NAME = 'Saúde';

function fmtLocalidadeFromContato(item: unknown): string {
  const e = (item as { endereco?: Record<string, unknown> } | null)?.endereco;
  if (!e) return '—';
  const partes = [e.logradouro, e.numero, e.bairro, fmtLocalidade(e.cidade, e.uf), e.cep]
    .map((x) => (x == null || String(x).trim() === '' ? '' : String(x).trim()))
    .filter(Boolean);
  return partes.join(' · ') || '—';
}

export const PROFILE_PAGE_NAMES: string[] = PROFILE_PAGES.map((p) => p.name);

const fieldCoveredKeys = (f: FieldSpec): string[] => {
  const keys = f.consumes ? [...f.consumes] : [];
  const top = f.path.split('.')[0];
  if (top) keys.push(top);
  return keys;
};

/**
 * Chaves cruas da `source` já cobertas por algum campo curado (somando TODAS
 * as seções que leem a mesma origem — ex.: cadastral é lido pela seção de
 * Registro Civil e pela de Título de Eleitor). Usado por `absorbRest` para
 * anexar só o que sobrou, sem duplicar.
 */
export function coveredKeysForSource(source: string): Set<string> {
  const set = new Set<string>();
  for (const page of PROFILE_PAGES) {
    for (const sec of page.sections) {
      if (sec.source !== source || !sec.fields) continue;
      for (const f of sec.fields) for (const k of fieldCoveredKeys(f)) set.add(k);
    }
  }
  return set;
}

/** Chaves cruas cobertas pelos campos de UMA seção (para listas, que não compartilham origem). */
export function coveredKeysForFields(fields: FieldSpec[] | undefined): Set<string> {
  const set = new Set<string>();
  for (const f of fields ?? []) for (const k of fieldCoveredKeys(f)) set.add(k);
  return set;
}

/** Todas as chaves de nível superior referenciadas por alguma seção. */
export function collectUsedSources(): Set<string> {
  const used = new Set<string>();
  for (const page of PROFILE_PAGES) for (const s of page.sections) used.add(s.source);
  return used;
}

/**
 * Seções sintéticas (genéricas) para qualquer chave de nível superior de
 * `serviceResponse` que não esteja em nenhuma seção — anexadas ao fim da
 * página "Saúde" (ver `UNMAPPED_PAGE_NAME`) para garantir que nada é perdido.
 */
export function unmappedGenericSections(serviceResponse: Record<string, unknown>): SectionSpec[] {
  const used = collectUsedSources();
  return Object.keys(serviceResponse)
    .filter((k) => !used.has(k))
    .map((k) => ({ title: humanizeSourceKey(k), source: k, kind: 'generic' as const }));
}

function humanizeSourceKey(key: string): string {
  const cleaned = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .trim();
  return cleaned ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : key;
}
