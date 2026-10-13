// ─── Modelo de grafo societário ────────────────────────────────────────────────

export type NodeKind = 'company' | 'person';

export type CompanyStatus = 'ATIVA' | 'BAIXADA' | 'SUSPENSA' | 'INAPTA' | 'NULA' | 'DESCONHECIDA';

export type RelationType =
  | 'SOCIO'
  | 'ADMINISTRADOR'
  | 'REPRESENTANTE_LEGAL'
  | 'CONTROLADORA'
  | 'CONTROLADA'
  | 'FILIAL'
  | 'MATRIZ'
  | 'PARTICIPACAO'
  // ─── Rede de contexto do perfil de pessoa (nunca societária) ───
  /** Partes em polos opostos (ou envolvidas) num processo judicial. */
  | 'PROCESSO'
  /** Partes no mesmo polo de um processo (ex.: co-executados). */
  | 'COPARTE'
  /** Vínculo familiar declarado no perfil. */
  | 'PARENTE';

/** Relações que vêm do perfil da pessoa (processos/família), não do quadro societário. */
export const CONTEXT_RELATIONS: readonly RelationType[] = ['PROCESSO', 'COPARTE', 'PARENTE'];
export const JUDICIAL_RELATIONS: readonly RelationType[] = ['PROCESSO', 'COPARTE'];

export interface CompanyData {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia?: string;
  situacao: CompanyStatus;
  cnaePrincipal?: { codigo: string; descricao: string };
  cnaesSecundarios?: { codigo: string; descricao: string }[];
  naturezaJuridica?: string;
  capitalSocial?: number;
  dataAbertura?: string; // ISO
  endereco?: string;
  municipio?: string;
  uf?: string;
  telefone?: string;
  email?: string;
  matriz?: boolean;
}

export interface PersonData {
  /** CPF (possivelmente mascarado, ex.: ***123456**) ou identificador estável */
  cpf: string;
  nome: string;
  /** Se a pessoa exerce função de administrador em alguma empresa */
  administrador?: boolean;
  /** URL http(s) da melhor foto disponível (cadastral.foto > fotos[] > extraFotos[]) — nunca o perfil completo. */
  photoUrl?: string;
}

export interface GraphNode {
  /** id estável: cnpj normalizado ou cpf/nome normalizado */
  id: string;
  kind: NodeKind;
  label: string;
  /** distância (em camadas) da raiz da pesquisa */
  depth: number;
  /** já teve as conexões carregadas? */
  expanded: boolean;
  company?: CompanyData;
  person?: PersonData;
  /**
   * Nó descoberto só pela rede de contexto de uma pessoa (parte de processo
   * ou parente) — fica de fora das cascatas automáticas de camada/"Expandir
   * Tudo" (cada uma seria uma consulta paga sem o usuário pedir). Duplo clique
   * ainda expande, explicitamente. Some quando o nó entra na rede societária.
   */
  context?: 'processo' | 'familia';
  // campos gerenciados pelo force-graph
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
}

/**
 * Uma "evidência" é o registro completo de uma fonte para uma relação:
 * preserva a associação entre relação, qualificação, origem e data —
 * fonte única de verdade para os campos derivados de `RelationshipMeta`
 * (ver `src/store/graphStore.ts`: `buildMeta`/`pickPrimaryEvidence`).
 */
export interface RelationshipEvidence {
  relation: RelationType;
  qualificacao?: string;
  origem?: string;
  dataEntrada?: string;
}

export interface RelationshipMeta {
  /** percentual de participação (0–100), quando conhecido */
  percentual?: number;
  /** data de entrada "principal" — derivada da evidência primária (prioridade fixa, não por ordem de chegada) */
  dataEntrada?: string;
  situacao?: string;
  /** origem "principal" — derivada da evidência primária */
  origem?: string;
  /** função/qualificação "principal" — derivada da evidência primária */
  funcao?: string;
  /**
   * Todas as qualificações mapeadas (ex.: sócio confirmado por uma fonte e
   * administrador por outra) — uma única aresta visual acumula todas, sem
   * duplicar. Derivado de `evidencias`, ordenado de forma estável,
   * independente da ordem de chegada das respostas das APIs.
   */
  relations?: RelationType[];
  /** Texto bruto de qualificação de cada fonte que contribuiu para a relação, sem duplicar. */
  qualificacoes?: string[];
  /** Todas as origens que confirmaram esta relação (ex.: "Consulta por CPF", "Consulta por CNPJ"), sem duplicar. */
  origens?: string[];
  /** Todas as datas de entrada distintas conhecidas, sem duplicar. */
  datasEntrada?: string[];
  /** Registro completo por fonte — relação+qualificação+origem+data associadas, deduplicadas pela combinação completa. */
  evidencias?: RelationshipEvidence[];
}

export interface GraphLink {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  type: RelationType;
  meta: RelationshipMeta;
}

// ─── Resultado de consultas aos provedores ────────────────────────────────────

export interface PartnerInfo {
  person?: PersonData;
  /** sócio pessoa jurídica */
  company?: Pick<CompanyData, 'cnpj' | 'razaoSocial'>;
  relation: RelationType;
  meta: RelationshipMeta;
}

export interface CompanyLookupResult {
  company: CompanyData;
  partners: PartnerInfo[];
  /** filiais/matriz conhecidas */
  branches?: { cnpj: string; razaoSocial: string; matriz: boolean }[];
}

export interface PersonLookupResult {
  person: PersonData;
  companies: {
    company: Pick<CompanyData, 'cnpj' | 'razaoSocial' | 'situacao' | 'uf' | 'municipio'>;
    relation: RelationType;
    meta: RelationshipMeta;
  }[];
}

// ─── Filtros ──────────────────────────────────────────────────────────────────

export interface GraphFilters {
  showPeople: boolean;
  showCompanies: boolean;
  onlyActive: boolean;
  onlyBaixadas: boolean;
  onlyAdmins: boolean;
  onlyPartners: boolean;
  showBranches: boolean;
  showHeadquarters: boolean;
  minParticipation: number; // 0 = sem filtro
  uf: string; // '' = todos
  cnae: string; // '' = todos
  openedAfter: string; // ISO date ou ''
  /** Vínculos por processo judicial (contrapartes e co-partes). Ausente em consultas antigas = ligado. */
  showJudicial?: boolean;
  /** Vínculos familiares. Ausente em consultas antigas = ligado. */
  showFamily?: boolean;
}

export const defaultFilters: GraphFilters = {
  showPeople: true,
  showCompanies: true,
  onlyActive: false,
  onlyBaixadas: false,
  onlyAdmins: false,
  onlyPartners: false,
  showBranches: true,
  showHeadquarters: true,
  minParticipation: 0,
  uf: '',
  cnae: '',
  openedAfter: '',
  showJudicial: true,
  showFamily: true,
};

// ─── Eventos para a linha do tempo ────────────────────────────────────────────

export interface TimelineEvent {
  date: string; // ISO
  kind: 'abertura' | 'entrada_socio' | 'saida_socio' | 'alteracao';
  description: string;
  nodeId: string;
}
