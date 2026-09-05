import { create } from 'zustand';
import type {
  CompanyLookupResult,
  GraphFilters,
  GraphLink,
  GraphNode,
  RelationshipEvidence,
  RelationshipMeta,
  RelationType,
  TimelineEvent,
} from '../types/graph';
import { defaultFilters } from '../types/graph';
import { formatCPF, isValidCPF, onlyDigits } from '../lib/format';
import type { DataProvider } from '../services/provider';
import {
  FORCE_DEFAULTS,
  clearForceSettings,
  loadForceSettings,
  saveForceSettings,
  type ForceSettings,
} from '../lib/forceSim';
import { FonteDataProvider, mapRelation, mapStatus, parseBrDate } from '../services/fontedata';
import {
  extractPersonName,
  extractSociedades,
  hasSociedadesSection,
  type ApiFullSociedade,
  type ApiFullProfile,
} from '../services/apifull';
import { usePersonProfileStore } from './personProfileStore';
import { extractPersonPhotoUrl } from '../lib/personPhoto';
import { stripHardFields } from '../lib/mask';

export type ProviderMode = 'cadastral';

/**
 * Snapshot necessário para reabrir uma consulta salva sem chamar
 * FonteData/APIFull de novo: grafo completo (nós/arestas), estado de
 * camada/filtros, e os perfis já sanitizados (sem campos "hard") para
 * pré-popular o cache do `personProfileStore`. `photoUrl` nunca entra aqui —
 * é recalculado a partir do bucket (`saved_query_images`) ao reabrir.
 */
export interface GraphSnapshot {
  rootId: string;
  nodes: GraphNode[];
  links: GraphLink[];
  currentLayer: number;
  maxDepth: number;
  filters: GraphFilters;
  profiles: Record<string, ApiFullProfile>;
}

export const companyId = (cnpj: string) => `c:${onlyDigits(cnpj).padStart(14, '0')}`;
export const personId = (cpfOrName: string) => `p:${cpfOrName.trim()}`;

const linkId = (source: string, target: string, type: RelationType) => `${source}→${target}:${type}`;

/** Limite de segurança para o "Expandir Tudo" não explodir a renderização */
const EXPAND_ALL_NODE_CAP = 600;
/** Quantos CNPJs de sociedades[] são enriquecidos na FonteData por vez, por pessoa */
const SOCIEDADES_BATCH_SIZE = 4;
/** Teto de consultas NOVAS à APIFull (sem contar cache) numa execução de "Expandir Tudo" — proteção de custo */
const MAX_APIFULL_CALLS_PER_EXPAND_ALL = 25;

interface GraphState {
  providerMode: ProviderMode;
  providers: Record<ProviderMode, DataProvider>;
  nodes: GraphNode[];
  links: GraphLink[];
  nodeIndex: Map<string, GraphNode>;
  timeline: TimelineEvent[];
  rootId: string | null;
  maxDepth: number; // Infinity = ilimitado
  /** camada atual do controle [−] Camada N [+]: exibe nós com depth <= currentLayer */
  currentLayer: number;
  /** consulta de camada em andamento (bloqueia cliques repetidos no controle) */
  layerLoading: boolean;
  selectedNodeId: string | null;
  breadcrumb: string[];
  expandingIds: Set<string>;
  loading: boolean;
  error: string | null;
  notice: string | null;
  filters: GraphFilters;
  searchQuery: string;
  highlightedNodeId: string | null;
  focusRequest: { nodeId: string; ts: number } | null;
  organizeRequest: number;
  panelMode: 'entity' | 'stats';
  /** incrementado a cada reset/recolhimento — cancela expansões em andamento */
  graphEpoch: number;
  /** forças do layout (painel "Configurar mapa"), escala 0–100 */
  forceSettings: ForceSettings;
  /** true quando o usuário personalizou as forças (ativa o refinamento automático) */
  forceCustomized: boolean;
  /** incrementado pelo botão "Animar" */
  animateRequest: number;
  theme: 'light' | 'dark';

  /**
   * Fase da busca inicial — o mapa (`rootId`) só é liberado quando o lote de
   * perfis termina sem falhas (`done`) ou quando o usuário escolhe
   * explicitamente continuar mesmo com falhas (`awaiting-decision` →
   * `continueWithAvailableData`).
   */
  searchPhase: 'idle' | 'company' | 'company-found' | 'profiles' | 'preparing' | 'awaiting-decision' | 'done' | 'error';
  searchProfilesTotal: number;
  searchProfilesDone: number;
  searchProfilesFailed: number;
  searchFailedCpfs: string[];
  /** rootId calculado assim que a empresa é montada — só vira `rootId` de fato quando o mapa é liberado. */
  searchPendingRootId: string | null;
  /** true quando há dados no grafo (mapa aberto ou expandido) desde o último "Salvar consulta". */
  unsavedChanges: boolean;

  setProviderMode: (m: ProviderMode) => void;
  setMaxDepth: (d: number) => void;
  setTheme: (t: 'light' | 'dark') => void;
  setFilters: (f: Partial<GraphFilters>) => void;
  resetFilters: () => void;
  setSearchQuery: (q: string) => void;
  focusNode: (id: string) => void;
  selectNode: (id: string | null) => void;
  requestOrganize: () => void;
  setForceSettings: (s: Partial<ForceSettings>) => void;
  resetForceSettings: () => void;
  requestAnimate: () => void;
  setPanelMode: (m: 'entity' | 'stats') => void;
  notify: (msg: string) => void;
  clearNotice: () => void;
  startSearch: (cnpj: string) => Promise<void>;
  /** Busca por CPF ("Consulta Avançada") — abre o mapa com a pessoa na raiz e suas empresas. */
  startPersonSearch: (cpf: string) => Promise<void>;
  /** Reprocessa só os CPFs que falharam no lote da busca inicial (ou de uma tentativa anterior). */
  retryFailedSearchProfiles: () => Promise<void>;
  /** Libera o mapa mesmo com falhas pendentes — ação explícita do usuário. */
  continueWithAvailableData: () => void;
  expandNode: (id: string, opts?: { force?: boolean; batchId?: string }) => Promise<void>;
  expandAll: () => Promise<void>;
  collapseAll: () => void;
  nextLayer: () => Promise<void>;
  prevLayer: () => void;
  reset: () => void;
  /** Atualiza a foto de um nó pessoa já presente no grafo (id determinado pelo CPF) — nunca cria nó novo. */
  updatePersonPhoto: (cpf: string, photoUrl: string | undefined) => void;
  /** Monta o snapshot para "Salvar consulta" — null se não há uma pesquisa aberta (sem rootId). */
  buildSnapshot: () => GraphSnapshot | null;
  /** Chamado após salvar com sucesso — limpa o aviso de alterações não salvas. */
  markSaved: () => void;
  /** Restaura grafo + perfis de uma consulta salva — nunca chama FonteData/APIFull. */
  hydrateFromSnapshot: (snapshot: GraphSnapshot, photoUrlsByPersonId: Record<string, string>) => void;
}

function pushEvent(timeline: TimelineEvent[], ev: TimelineEvent) {
  if (!ev.date) return;
  if (timeline.some((t) => t.date === ev.date && t.description === ev.description)) return;
  timeline.push(ev);
}

/** Ordem estável de exibição — independe da ordem de chegada das respostas das APIs. */
const RELATION_ORDER: RelationType[] = [
  'SOCIO',
  'ADMINISTRADOR',
  'REPRESENTANTE_LEGAL',
  'CONTROLADORA',
  'CONTROLADA',
  'FILIAL',
  'MATRIZ',
  'PARTICIPACAO',
];

function sortRelations(list: RelationType[]): RelationType[] {
  return [...new Set(list)].sort((a, b) => RELATION_ORDER.indexOf(a) - RELATION_ORDER.indexOf(b));
}

function sortStrings(list: string[]): string[] {
  return [...new Set(list)].sort((a, b) => a.localeCompare(b));
}

/**
 * Prioridade fixa (não a ordem de chegada) pra escolher a evidência
 * "primária" — usada só pra derivar os campos singulares de compatibilidade
 * (funcao/origem/dataEntrada). Papéis administrativos/de representação
 * antes de sócio simples; desempate alfabético (origem, depois
 * qualificação, depois data) garante resultado 100% determinístico.
 */
const PRIMARY_RELATION_PRIORITY: RelationType[] = [
  'ADMINISTRADOR',
  'REPRESENTANTE_LEGAL',
  'CONTROLADORA',
  'SOCIO',
  'PARTICIPACAO',
  'CONTROLADA',
  'MATRIZ',
  'FILIAL',
];

/**
 * Internamente cada evidência também carrega `percentual`/`situacao` — não
 * fazem parte do shape público de `RelationshipEvidence` (dedup usa só os
 * 4 campos pedidos), mas viajam junto pra que os campos singulares de
 * `RelationshipMeta` também sejam derivados da evidência primária com a
 * mesma prioridade fixa (não "quem chegou primeiro"), garantindo que TODO
 * o resultado independe da ordem de resposta das APIs.
 */
type EvidenceWithExtras = RelationshipEvidence & { percentual?: number; situacao?: string };

/** Chave de dedup pela combinação COMPLETA (relação + qualificação + origem + data). */
function evidenceKey(e: RelationshipEvidence): string {
  return [e.relation, e.qualificacao ?? '', e.origem ?? '', e.dataEntrada ?? ''].join(' ');
}

/** Deduplicação pela combinação completa + ordenação determinística (nunca depende da ordem de chegada). */
function dedupeAndSortEvidencias(list: EvidenceWithExtras[]): EvidenceWithExtras[] {
  const byKey = new Map<string, EvidenceWithExtras>();
  for (const e of list) byKey.set(evidenceKey(e), e);
  return [...byKey.values()].sort((a, b) => evidenceKey(a).localeCompare(evidenceKey(b)));
}

function pickPrimaryEvidence(evidencias: EvidenceWithExtras[]): EvidenceWithExtras | undefined {
  if (evidencias.length === 0) return undefined;
  return [...evidencias].sort((a, b) => {
    const pr = PRIMARY_RELATION_PRIORITY.indexOf(a.relation) - PRIMARY_RELATION_PRIORITY.indexOf(b.relation);
    if (pr !== 0) return pr;
    const oc = (a.origem ?? '').localeCompare(b.origem ?? '');
    if (oc !== 0) return oc;
    const qc = (a.qualificacao ?? '').localeCompare(b.qualificacao ?? '');
    if (qc !== 0) return qc;
    return (a.dataEntrada ?? '').localeCompare(b.dataEntrada ?? '');
  })[0];
}

/**
 * Reconstrói todo o `RelationshipMeta` a partir de `evidencias` (fonte
 * única de verdade) — os campos plurais e os singulares "principais"
 * (incluindo percentual/situacao) são sempre DERIVADOS, nunca acumulados
 * em paralelo, então não há como os mecanismos divergirem nem depender de
 * qual fonte respondeu primeiro.
 */
function buildMeta(evidenciasIn: EvidenceWithExtras[]): RelationshipMeta {
  const evidencias = dedupeAndSortEvidencias(evidenciasIn);
  const primary = pickPrimaryEvidence(evidencias);
  return {
    percentual: primary?.percentual,
    situacao: primary?.situacao,
    funcao: primary?.qualificacao,
    origem: primary?.origem,
    dataEntrada: primary?.dataEntrada,
    relations: sortRelations(evidencias.map((e) => e.relation)),
    qualificacoes: sortStrings(evidencias.map((e) => e.qualificacao).filter((x): x is string => !!x)),
    origens: sortStrings(evidencias.map((e) => e.origem).filter((x): x is string => !!x)),
    datasEntrada: sortStrings(evidencias.map((e) => e.dataEntrada).filter((x): x is string => !!x)),
    evidencias,
  };
}

/** Extrai os CPFs válidos dos sócios pessoa física de um resultado de empresa — usado pro prefetch automático da APIFull. */
function extractPartnerCpfs(partners: CompanyLookupResult['partners']): string[] {
  return partners
    .map((p) => p.person?.cpf)
    .filter((cpf): cpf is string => !!cpf)
    .map(onlyDigits)
    .filter(isValidCPF);
}

/**
 * Adiciona uma relação ou mescla com uma já existente entre o mesmo par
 * (source, target) — independente do `type`. Evita aresta duplicada quando
 * a mesma relação pessoa↔empresa é informada por duas fontes diferentes
 * (ex.: APIFull cria a relação primeiro, FonteData chega depois com a
 * mesma pessoa), acumulando a evidência de cada fonte em vez de perder uma
 * delas (ver `buildMeta`).
 */
export function addOrMergeLink(links: GraphLink[], source: string, target: string, type: RelationType, meta: RelationshipMeta) {
  const newEvidence: EvidenceWithExtras = {
    relation: type,
    qualificacao: meta.funcao,
    origem: meta.origem,
    dataEntrada: meta.dataEntrada,
    percentual: meta.percentual,
    situacao: meta.situacao,
  };
  const existingIdx = links.findIndex((l) => {
    const s = typeof l.source === 'string' ? l.source : l.source.id;
    const t = typeof l.target === 'string' ? l.target : l.target.id;
    return s === source && t === target;
  });
  if (existingIdx >= 0) {
    const existing = links[existingIdx];
    const evidencias = [...((existing.meta.evidencias as EvidenceWithExtras[] | undefined) ?? []), newEvidence];
    links[existingIdx] = { ...existing, meta: buildMeta(evidencias) };
    return;
  }
  links.push({ id: linkId(source, target, type), source, target, type, meta: buildMeta([newEvidence]) });
}

/**
 * Mescla o resultado de uma consulta de CNPJ no grafo (mutação controlada +
 * novos arrays). `opts.partnerDepth` permite colocar a empresa e seus sócios
 * na MESMA camada — usado quando a empresa foi descoberta via
 * `sociedades[]` de uma pessoa (empresa e sócios entram juntos na camada
 * seguinte à da pessoa, não em camadas separadas). Sem `opts`, mantém o
 * comportamento padrão (sócios uma camada abaixo da empresa) usado na busca
 * inicial e na expansão normal de uma empresa.
 */
function mergeCompanyResult(
  state: GraphState,
  result: CompanyLookupResult,
  depth: number,
  opts?: { partnerDepth?: number },
) {
  const { nodeIndex } = state;
  const links = [...state.links];
  const timeline = [...state.timeline];
  const partnerDepth = opts?.partnerDepth ?? depth + 1;

  const cId = companyId(result.company.cnpj);
  let cNode = nodeIndex.get(cId);
  if (!cNode) {
    cNode = { id: cId, kind: 'company', label: result.company.razaoSocial, depth, expanded: false };
    nodeIndex.set(cId, cNode);
  } else {
    cNode.depth = Math.min(cNode.depth, depth);
  }
  cNode.company = result.company;
  cNode.label = result.company.razaoSocial;
  cNode.expanded = true;
  pushEvent(timeline, {
    date: result.company.dataAbertura ?? '',
    kind: 'abertura',
    description: `Abertura de ${result.company.razaoSocial}`,
    nodeId: cId,
  });

  for (const p of result.partners) {
    if (p.person) {
      const pId = personId(p.person.cpf || p.person.nome);
      let pNode = nodeIndex.get(pId);
      if (!pNode) {
        pNode = {
          id: pId,
          kind: 'person',
          label: p.person.nome,
          depth: partnerDepth,
          expanded: false,
          person: p.person,
        };
        nodeIndex.set(pId, pNode);
      } else {
        pNode.depth = Math.min(pNode.depth, partnerDepth);
        if (p.person.administrador) pNode.person = { ...pNode.person!, administrador: true };
      }
      addOrMergeLink(links, pId, cId, p.relation, p.meta);
      pushEvent(timeline, {
        date: p.meta.dataEntrada ?? '',
        kind: p.meta.situacao === 'RETIRADO' ? 'saida_socio' : 'entrada_socio',
        description:
          p.meta.situacao === 'RETIRADO'
            ? `Saída de ${p.person.nome} de ${result.company.razaoSocial}`
            : `Entrada de ${p.person.nome} em ${result.company.razaoSocial}`,
        nodeId: pId,
      });
    } else if (p.company) {
      const pjId = companyId(p.company.cnpj);
      let pjNode = nodeIndex.get(pjId);
      if (!pjNode) {
        pjNode = {
          id: pjId,
          kind: 'company',
          label: p.company.razaoSocial,
          depth: partnerDepth,
          expanded: false,
          company: { cnpj: onlyDigits(p.company.cnpj), razaoSocial: p.company.razaoSocial, situacao: 'DESCONHECIDA' },
        };
        nodeIndex.set(pjId, pjNode);
      } else {
        pjNode.depth = Math.min(pjNode.depth, partnerDepth);
      }
      addOrMergeLink(links, pjId, cId, p.relation, p.meta);
    }
  }

  for (const b of result.branches ?? []) {
    const bId = companyId(b.cnpj);
    if (!nodeIndex.has(bId)) {
      nodeIndex.set(bId, {
        id: bId,
        kind: 'company',
        label: `${b.razaoSocial} (Filial)`,
        depth: partnerDepth,
        expanded: false,
        company: { cnpj: onlyDigits(b.cnpj), razaoSocial: b.razaoSocial, situacao: 'DESCONHECIDA', matriz: false },
      });
    }
    addOrMergeLink(links, bId, cId, 'FILIAL', { origem: 'Cadastro', situacao: 'ATIVA' });
  }

  return { nodes: [...nodeIndex.values()], links, timeline };
}

/**
 * Cria/atualiza imediatamente a relação Pessoa→Empresa informada pela
 * própria APIFull (`sociedades[]`), com um nó de empresa "placeholder" se
 * ainda não existir. Roda ANTES da chamada à FonteData — se a FonteData não
 * devolver essa pessoa entre os sócios (bases desatualizadas entre si), a
 * relação informada pela APIFull continua no grafo.
 */
function mergeApiFullSociedadeRelation(state: GraphState, personNode: GraphNode, s: ApiFullSociedade, depth: number) {
  const { nodeIndex } = state;
  const links = [...state.links];

  const cId = companyId(s.cnpj);
  let cNode = nodeIndex.get(cId);
  if (!cNode) {
    cNode = {
      id: cId,
      kind: 'company',
      label: s.razaoSocial || s.cnpj,
      depth,
      expanded: false,
      company: {
        cnpj: s.cnpj,
        razaoSocial: s.razaoSocial || '(razão social pendente)',
        situacao: mapStatus(s.situacaoCadastral),
      },
    };
    nodeIndex.set(cId, cNode);
  } else {
    cNode.depth = Math.min(cNode.depth, depth);
  }

  const relation = mapRelation(s.qualificacaoSocioDescricao ?? '');
  addOrMergeLink(links, personNode.id, cId, relation, {
    dataEntrada: parseBrDate(s.dtEntrada),
    situacao: s.situacaoCadastral || 'ATIVO',
    origem: 'Consulta por CPF',
    funcao: s.qualificacaoSocioDescricao,
  });

  return { nodes: [...nodeIndex.values()], links };
}

/**
 * Processa em lotes pequenos (Promise.allSettled) os CNPJs de `sociedades[]`
 * ainda não expandidos no grafo, enriquecendo cada um via FonteData
 * (empresa completa + todos os seus sócios, na mesma camada `targetDepth`).
 * Uma falha individual não cancela as demais. Retorna quantas tiveram
 * sucesso/falharam nesta chamada — chamar de novo (mesmo nó) reprocessa só
 * as que ainda não estão expandidas (as bem-sucedidas já ficam marcadas
 * `expanded` no grafo e não são reconsultadas).
 */
async function processPendingSociedades(
  get: () => GraphState,
  set: (partial: Partial<GraphState> | ((s: GraphState) => Partial<GraphState>)) => void,
  cpf: string,
  cnpjs: string[],
  targetDepth: number,
  epoch: number,
  batchId?: string,
): Promise<{ succeededCount: number; failedCount: number }> {
  let succeededCount = 0;
  let failedCount = 0;
  for (let i = 0; i < cnpjs.length; i += SOCIEDADES_BATCH_SIZE) {
    if (get().graphEpoch !== epoch) break;
    const batch = cnpjs.slice(i, i + SOCIEDADES_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((cnpj) => get().providers.cadastral.getCompany(cnpj)));
    if (get().graphEpoch !== epoch) break;
    results.forEach((res, idx) => {
      const cnpj = batch[idx];
      if (res.status === 'fulfilled') {
        succeededCount += 1;
        set(mergeCompanyResult(get(), res.value, targetDepth, { partnerDepth: targetDepth }));
        usePersonProfileStore.getState().markSociedadeOutcome(cpf, cnpj, 'succeeded');
        // Sócios da empresa recém-descoberta já começam a ser preparados na APIFull.
        // Quando chamado a partir de `nextLayer` (batchId presente), entram no MESMO
        // lote da camada atual — `nextLayer` só libera `layerLoading` depois que eles
        // terminarem também. Fora desse contexto (ex.: clique manual, "Expandir Tudo"),
        // continuam em segundo plano (fire-and-forget), sem bloquear nada.
        const newPartnerCpfs = extractPartnerCpfs(res.value.partners);
        if (batchId) {
          usePersonProfileStore.getState().addToBatch(batchId, newPartnerCpfs, { priority: false });
        } else {
          usePersonProfileStore.getState().prefetchProfiles(newPartnerCpfs);
        }
      } else {
        failedCount += 1;
        usePersonProfileStore.getState().markSociedadeOutcome(cpf, cnpj, 'failed');
      }
    });
  }
  return { succeededCount, failedCount };
}

/** Rótulo legível de um nó de pessoa para mensagens ao usuário. */
function nomeDoNo(node: GraphNode): string {
  return node.person?.nome ?? formatCPF(onlyDigits(node.person?.cpf ?? ''));
}

/**
 * Expande um nó pessoa: perfil completo via APIFull (cache/dedup real em
 * `personProfileStore`, compartilhado com o clique no painel) → relação
 * imediata por `sociedades[]` → enriquecimento em lote via FonteData. Só
 * marca `node.expanded = true` quando não sobra CNPJ pendente nem falho —
 * numa falha parcial o nó permanece clicável para tentar de novo (reaproveita
 * o perfil em cache e só reprocessa os CNPJs que ainda faltam).
 */
async function expandPersonViaProfile(
  get: () => GraphState,
  set: (partial: Partial<GraphState> | ((s: GraphState) => Partial<GraphState>)) => void,
  node: GraphNode,
  batchId?: string,
): Promise<void> {
  const cpf = onlyDigits(node.person?.cpf ?? '');
  const targetDepth = node.depth + 1;
  const epoch = get().graphEpoch;

  let profile;
  try {
    profile = await usePersonProfileStore.getState().loadProfile(cpf);
  } catch (e) {
    if (get().graphEpoch !== epoch) return;
    set({
      notice: `Falha ao carregar perfil de ${node.person?.nome ?? cpf}: ${e instanceof Error ? e.message : 'erro desconhecido'}`,
    });
    return; // node.expanded fica false — permite tentar de novo
  }
  if (get().graphEpoch !== epoch) return;

  const sociedades = extractSociedades(profile);
  if (sociedades.length === 0) {
    node.expanded = true;
    // Sem a seção de sociedades a camada não tem como crescer — avisa, em vez
    // de deixar o nó "expandido" e o mapa parado sem explicação nenhuma.
    set({
      nodes: [...get().nodeIndex.values()],
      ...(hasSociedadesSection(profile)
        ? {}
        : { notice: `${nomeDoNo(node)}: esta consulta não traz participação societária. O perfil completo continua disponível no painel.` }),
    });
    return;
  }

  // 1. Relação Empresa→Pessoa imediata por sociedade, com base só na APIFull
  // (não depende da FonteData responder — ver mergeApiFullSociedadeRelation).
  for (const s of sociedades) {
    set(mergeApiFullSociedadeRelation(get(), node, s, targetDepth));
  }
  if (get().graphEpoch !== epoch) return;

  // 2. Enriquecimento via FonteData só dos CNPJs ainda não expandidos no grafo.
  const pendingCnpjs = [...new Set(sociedades.map((s) => s.cnpj))].filter(
    (cnpj) => !get().nodeIndex.get(companyId(cnpj))?.expanded,
  );
  usePersonProfileStore.getState().setSociedadesStatus(cpf, { pending: pendingCnpjs, succeeded: [], failed: [] });

  const { failedCount } = await processPendingSociedades(get, set, cpf, pendingCnpjs, targetDepth, epoch, batchId);
  if (get().graphEpoch !== epoch) return;

  if (failedCount === 0) {
    node.expanded = true;
    set({ nodes: [...get().nodeIndex.values()] });
  } else {
    set({
      notice: `Expansão parcial: ${failedCount} de ${pendingCnpjs.length} empresa(s) falharam ao consultar ${node.person?.nome ?? cpf}. Clique de novo para tentar essas empresas.`,
    });
  }
}

const initialForce = loadForceSettings();

export const useGraphStore = create<GraphState>((set, get) => ({
  providerMode: 'cadastral',
  providers: { cadastral: new FonteDataProvider() },
  nodes: [],
  links: [],
  nodeIndex: new Map(),
  timeline: [],
  rootId: null,
  maxDepth: 5,
  currentLayer: 1,
  layerLoading: false,
  selectedNodeId: null,
  breadcrumb: [],
  expandingIds: new Set(),
  loading: false,
  error: null,
  notice: null,
  filters: { ...defaultFilters },
  searchQuery: '',
  highlightedNodeId: null,
  focusRequest: null,
  organizeRequest: 0,
  panelMode: 'entity',
  graphEpoch: 0,
  forceSettings: initialForce.settings,
  forceCustomized: initialForce.customized,
  animateRequest: 0,
  theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  searchPhase: 'idle',
  searchProfilesTotal: 0,
  searchProfilesDone: 0,
  searchProfilesFailed: 0,
  searchFailedCpfs: [],
  searchPendingRootId: null,
  unsavedChanges: false,

  setProviderMode: (m) => set({ providerMode: m }),
  setMaxDepth: (d) => set({ maxDepth: d }),
  setTheme: (t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
    localStorage.setItem('painel-theme', t);
    set({ theme: t });
  },
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  resetFilters: () => set({ filters: { ...defaultFilters } }),
  setSearchQuery: (q) => set({ searchQuery: q }),
  focusNode: (id) => set({ highlightedNodeId: id, focusRequest: { nodeId: id, ts: Date.now() } }),
  selectNode: (id) => {
    if (!id) {
      set({ selectedNodeId: null });
      return;
    }
    set((s) => {
      const crumb = s.breadcrumb.filter((b) => b !== id);
      crumb.push(id);
      return { selectedNodeId: id, breadcrumb: crumb.slice(-8), panelMode: 'entity' };
    });
  },
  requestOrganize: () => set((s) => ({ organizeRequest: s.organizeRequest + 1 })),
  setForceSettings: (partial) =>
    set((s) => {
      const next = { ...s.forceSettings, ...partial };
      saveForceSettings(next);
      return { forceSettings: next, forceCustomized: true };
    }),
  resetForceSettings: () => {
    clearForceSettings();
    set({ forceSettings: { ...FORCE_DEFAULTS }, forceCustomized: false });
    // volta ao layout radial puro, sem zoom brusco (organize já faz fitView suave)
    get().requestOrganize();
  },
  requestAnimate: () => set((s) => ({ animateRequest: s.animateRequest + 1 })),
  setPanelMode: (m) => set({ panelMode: m }),
  notify: (msg) => set({ notice: msg }),
  clearNotice: () => set({ notice: null }),

  startSearch: async (cnpj: string) => {
    const state = get();
    const provider = state.providers[state.providerMode];
    // Nova pesquisa principal cancela a fila pendente (ainda não iniciada) da pesquisa
    // anterior — uma requisição já em andamento não é interrompida, só termina em cache.
    usePersonProfileStore.getState().cancelPendingQueue();
    const epoch = state.graphEpoch + 1;
    set({
      loading: true,
      error: null,
      nodes: [],
      links: [],
      nodeIndex: new Map(),
      timeline: [],
      breadcrumb: [],
      selectedNodeId: null,
      rootId: null,
      graphEpoch: epoch,
      searchPhase: 'company',
      searchProfilesTotal: 0,
      searchProfilesDone: 0,
      searchProfilesFailed: 0,
      searchFailedCpfs: [],
      searchPendingRootId: null,
    });
    try {
      const result = await provider.getCompany(cnpj);
      // Resposta de uma pesquisa antiga (já substituída por outra mais recente) nunca
      // pode montar/abrir o mapa da pesquisa atual.
      if (get().graphEpoch !== epoch) return;

      const merged = mergeCompanyResult(get(), result, 0);
      const rootId = companyId(result.company.cnpj);
      // Empresa e sócios já existem em nodeIndex/nodes (dados internos), mas o mapa
      // continua oculto — `rootId` só é setado depois que o lote de perfis terminar.
      set({ ...merged, searchPhase: 'company-found', searchPendingRootId: rootId });

      const cpfs = extractPartnerCpfs(result.partners);
      set({ searchProfilesTotal: cpfs.length, searchPhase: 'profiles' });
      const { failed } = await usePersonProfileStore.getState().runBatch(cpfs, {
        priority: true,
        onEach: (_cpf, ok) => {
          if (get().graphEpoch !== epoch) return;
          set((s) => ({
            searchProfilesDone: s.searchProfilesDone + 1,
            searchProfilesFailed: ok ? s.searchProfilesFailed : s.searchProfilesFailed + 1,
          }));
        },
      });
      if (get().graphEpoch !== epoch) return;
      set({ searchPhase: 'preparing' });

      if (failed.length === 0) {
        set({
          rootId,
          loading: false,
          breadcrumb: [rootId],
          currentLayer: 1,
          layerLoading: false,
          searchPhase: 'done',
          unsavedChanges: true,
        });
      } else {
        // Falha em 1+ CPF não abre o mapa sozinha: fica na tela de decisão até o
        // usuário escolher "Tentar novamente" ou "Continuar com os dados disponíveis".
        set({ searchFailedCpfs: failed, searchPhase: 'awaiting-decision', loading: false });
      }
    } catch (e) {
      if (get().graphEpoch !== epoch) return;
      set({ loading: false, error: e instanceof Error ? e.message : 'Erro na consulta', searchPhase: 'error' });
    }
  },

  startPersonSearch: async (cpf: string) => {
    const digits = onlyDigits(cpf);
    usePersonProfileStore.getState().cancelPendingQueue();
    const epoch = get().graphEpoch + 1;
    set({
      loading: true,
      error: null,
      nodes: [],
      links: [],
      nodeIndex: new Map(),
      timeline: [],
      breadcrumb: [],
      selectedNodeId: null,
      rootId: null,
      graphEpoch: epoch,
      searchPhase: 'company',
      searchProfilesTotal: 0,
      searchProfilesDone: 0,
      searchProfilesFailed: 0,
      searchFailedCpfs: [],
      searchPendingRootId: null,
    });
    try {
      const profile = await usePersonProfileStore.getState().loadProfile(digits);
      if (get().graphEpoch !== epoch) return;

      const sociedades = extractSociedades(profile);
      const nome =
        sociedades.find((s) => onlyDigits(s.documentoSocio) === digits)?.nomeSocio ??
        sociedades[0]?.nomeSocio ??
        extractPersonName(profile) ??
        formatCPF(digits);

      const rootId = personId(digits);
      const rootNode: GraphNode = {
        id: rootId,
        kind: 'person',
        label: nome,
        depth: 0,
        expanded: sociedades.length === 0,
        person: { cpf: digits, nome },
      };
      const nodeIndex = new Map(get().nodeIndex);
      nodeIndex.set(rootId, rootNode);
      set({ nodes: [...nodeIndex.values()], nodeIndex });

      if (sociedades.length === 0) {
        set({
          rootId,
          loading: false,
          breadcrumb: [rootId],
          currentLayer: 1,
          layerLoading: false,
          searchPhase: 'done',
          unsavedChanges: true,
          ...(hasSociedadesSection(profile)
            ? {}
            : { notice: `${nome}: esta consulta não traz participação societária, então o mapa fica só com a pessoa. O perfil completo está no painel.` }),
        });
        return;
      }

      set({ searchPhase: 'profiles', searchProfilesTotal: sociedades.length });
      for (const s of sociedades) {
        set(mergeApiFullSociedadeRelation(get(), rootNode, s, 1));
      }
      if (get().graphEpoch !== epoch) return;

      const pendingCnpjs = [...new Set(sociedades.map((s) => s.cnpj))];
      usePersonProfileStore.getState().setSociedadesStatus(digits, { pending: pendingCnpjs, succeeded: [], failed: [] });

      set({ searchPhase: 'preparing' });
      const { failedCount } = await processPendingSociedades(get, set, digits, pendingCnpjs, 1, epoch);
      if (get().graphEpoch !== epoch) return;

      rootNode.expanded = failedCount === 0;
      if (failedCount > 0) {
        get().notify(
          `Busca com falha parcial: ${failedCount} de ${pendingCnpjs.length} empresa(s) falharam ao consultar ${nome}. Clique na pessoa para tentar de novo.`,
        );
      }
      set({
        nodes: [...get().nodeIndex.values()],
        rootId,
        loading: false,
        breadcrumb: [rootId],
        currentLayer: 1,
        layerLoading: false,
        searchPhase: 'done',
        unsavedChanges: true,
      });
    } catch (e) {
      if (get().graphEpoch !== epoch) return;
      set({ loading: false, error: e instanceof Error ? e.message : 'Erro na consulta', searchPhase: 'error' });
    }
  },

  retryFailedSearchProfiles: async () => {
    const state = get();
    const epoch = state.graphEpoch;
    const toRetry = state.searchFailedCpfs;
    if (toRetry.length === 0) return;
    set({
      loading: true,
      searchPhase: 'profiles',
      searchProfilesTotal: toRetry.length,
      searchProfilesDone: 0,
      searchProfilesFailed: 0,
    });
    const { failed } = await usePersonProfileStore.getState().runBatch(toRetry, {
      priority: true,
      onEach: (_cpf, ok) => {
        if (get().graphEpoch !== epoch) return;
        set((s) => ({
          searchProfilesDone: s.searchProfilesDone + 1,
          searchProfilesFailed: ok ? s.searchProfilesFailed : s.searchProfilesFailed + 1,
        }));
      },
    });
    if (get().graphEpoch !== epoch) return;
    set({ searchPhase: 'preparing' });

    const rootId = get().searchPendingRootId;
    if (failed.length === 0 && rootId) {
      set({
        rootId,
        loading: false,
        breadcrumb: [rootId],
        currentLayer: 1,
        layerLoading: false,
        searchPhase: 'done',
        searchFailedCpfs: [],
        unsavedChanges: true,
      });
    } else {
      set({ searchFailedCpfs: failed, searchPhase: 'awaiting-decision', loading: false });
    }
  },

  continueWithAvailableData: () => {
    const rootId = get().searchPendingRootId;
    if (!rootId) return;
    set({
      rootId,
      loading: false,
      breadcrumb: [rootId],
      currentLayer: 1,
      layerLoading: false,
      searchPhase: 'done',
      unsavedChanges: true,
    });
  },

  expandNode: async (id: string, opts?: { force?: boolean; batchId?: string }) => {
    const state = get();
    const node = state.nodeIndex.get(id);
    if (!node || node.expanded || state.expandingIds.has(id)) return;
    if (!opts?.force && node.depth >= state.maxDepth) {
      set({ notice: `Limite de ${state.maxDepth} níveis atingido. Aumente o limite para continuar expandindo.` });
      return;
    }
    const provider = state.providers[state.providerMode];
    const epoch = state.graphEpoch;
    set((s) => ({ expandingIds: new Set(s.expandingIds).add(id) }));
    try {
      if (node.kind === 'company') {
        const result = await provider.getCompany(node.company!.cnpj);
        if (get().graphEpoch !== epoch) return; // grafo foi recolhido/resetado no meio-tempo
        const merged = mergeCompanyResult(get(), result, node.depth);
        set(merged);
      } else {
        await expandPersonViaProfile(get, set, node, opts?.batchId);
        if (get().graphEpoch !== epoch) return;
      }
      // expansão manual (duplo clique / painel): garante que os filhos fiquem visíveis
      if (!opts?.force && node.depth + 1 > get().currentLayer) {
        set({ currentLayer: node.depth + 1 });
      }
      set({ unsavedChanges: true });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Erro ao expandir nó' });
    } finally {
      set((s) => {
        const next = new Set(s.expandingIds);
        next.delete(id);
        return { expandingIds: next };
      });
    }
  },

  expandAll: async () => {
    const { maxDepth, graphEpoch, nodeIndex } = get();
    const pendingPeopleCount = [...nodeIndex.values()].filter(
      (n) => n.kind === 'person' && !n.expanded && n.depth < maxDepth,
    ).length;
    if (pendingPeopleCount > 0) {
      // "Expandir Tudo" pode disparar uma cascata de consultas — confirmação
      // explícita antes de consultar várias pessoas sem o usuário pedir uma por vez.
      const confirmed = window.confirm(
        `"Expandir Tudo" vai consultar dados para ${pendingPeopleCount} pessoa(s) (e possivelmente novas empresas) e pode continuar em cascata por várias camadas. Deseja continuar?`,
      );
      if (!confirmed) return;
    }

    let apiFullCallsThisRun = 0;
    set({ loading: true, notice: null });
    // BFS: expande em ondas até o limite de profundidade ou o teto de nós
    for (let round = 0; round < 50; round++) {
      if (get().graphEpoch !== graphEpoch) break; // cancelado por recolher/reset
      const { nodeIndex: idx, expandingIds } = get();
      if (idx.size >= EXPAND_ALL_NODE_CAP) {
        set({ notice: `Expansão interrompida ao atingir ${EXPAND_ALL_NODE_CAP} nós (limite de segurança).` });
        break;
      }
      if (apiFullCallsThisRun >= MAX_APIFULL_CALLS_PER_EXPAND_ALL) {
        set({
          notice: `Expansão interrompida após ${MAX_APIFULL_CALLS_PER_EXPAND_ALL} consultas novas nesta execução (limite desta execução). Use "+" para continuar manualmente.`,
        });
        break;
      }
      const pending = [...idx.values()]
        .filter((n) => !n.expanded && n.depth < maxDepth && !expandingIds.has(n.id))
        .sort((a, b) => a.depth - b.depth)
        .slice(0, 8);
      if (pending.length === 0) break;
      const profilesByCpf = usePersonProfileStore.getState().profilesByCpf;
      apiFullCallsThisRun += pending.filter(
        (n) => n.kind === 'person' && !profilesByCpf.has(onlyDigits(n.person?.cpf ?? '')),
      ).length;
      await Promise.all(pending.map((n) => get().expandNode(n.id)));
      set({ unsavedChanges: true });
    }
    set({ loading: false });
  },

  nextLayer: async () => {
    const s0 = get();
    if (s0.layerLoading || !s0.rootId) return;
    const target = s0.currentLayer + 1;
    const all = [...s0.nodeIndex.values()];
    const alreadyLoadedNext = all.some((n) => n.depth === target);
    // fronteira: nós ainda não expandidos dentro das camadas visíveis
    const frontier = all.filter((n) => !n.expanded && n.depth <= s0.currentLayer);
    if (!alreadyLoadedNext && frontier.length === 0) {
      set({ notice: 'Última camada alcançada — não há novas conexões nos dados.' });
      return;
    }
    set({ layerLoading: true, notice: null });
    const epoch = s0.graphEpoch;
    // Lote da CAMADA ATUAL: só os CPFs descobertos por esta chamada de nextLayer
    // (sócios da fronteira + sócios de empresas descobertas em cascata via
    // sociedades[]) entram aqui — nunca a fila inteira do personProfileStore, que
    // pode conter consultas de outras operações concorrentes sem relação com esta
    // camada (ver processPendingSociedades/expandPersonViaProfile, que recebem
    // este `batchId` e usam `addToBatch` em vez de `prefetchProfiles` solto).
    const { batchId, promise: layerBatch } = usePersonProfileStore.getState().startBatch([]);
    try {
      for (let i = 0; i < frontier.length; i += 6) {
        if (get().graphEpoch !== epoch) {
          // Sela mesmo ao cancelar — evita um lote aberto para sempre (vazamento).
          usePersonProfileStore.getState().sealBatch(batchId);
          return;
        }
        if (get().nodeIndex.size >= EXPAND_ALL_NODE_CAP) {
          set({ notice: `Expansão limitada a ${EXPAND_ALL_NODE_CAP} nós (limite de segurança).` });
          break;
        }
        await Promise.all(frontier.slice(i, i + 6).map((n) => get().expandNode(n.id, { force: true, batchId })));
      }
      usePersonProfileStore.getState().sealBatch(batchId);
      if (get().graphEpoch !== epoch) return;
      await layerBatch; // aguarda só os perfis descobertos nesta camada, não a fila inteira
      if (get().graphEpoch !== epoch) return;
      if (frontier.length > 0) set({ unsavedChanges: true });

      const hasNext = [...get().nodeIndex.values()].some((n) => n.depth === target);
      if (hasNext) {
        set({ currentLayer: target });
        get().requestOrganize();
      } else {
        set({ notice: 'Última camada alcançada — não há novas conexões nos dados.' });
      }
    } finally {
      set({ layerLoading: false });
    }
  },

  prevLayer: () => {
    const s = get();
    if (s.currentLayer <= 1 || s.layerLoading) return;
    set({ currentLayer: s.currentLayer - 1 });
    get().requestOrganize();
  },

  collapseAll: () => {
    const { rootId, nodeIndex, links } = get();
    if (!rootId) return;
    const keep = new Set<string>([rootId]);
    for (const l of links) {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      if (s === rootId) keep.add(t);
      if (t === rootId) keep.add(s);
    }
    const newIndex = new Map<string, GraphNode>();
    for (const id of keep) {
      const n = nodeIndex.get(id);
      if (n) {
        if (id !== rootId) n.expanded = false;
        newIndex.set(id, n);
      }
    }
    const newLinks = links.filter((l) => {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      return (s === rootId || t === rootId) && keep.has(s) && keep.has(t);
    });
    set((s) => ({
      nodeIndex: newIndex,
      nodes: [...newIndex.values()],
      links: newLinks,
      breadcrumb: [rootId],
      selectedNodeId: null,
      graphEpoch: s.graphEpoch + 1,
      loading: false,
      currentLayer: 1,
      layerLoading: false,
    }));
  },

  reset: () =>
    set((s) => ({
      nodes: [],
      links: [],
      nodeIndex: new Map(),
      timeline: [],
      rootId: null,
      selectedNodeId: null,
      breadcrumb: [],
      error: null,
      notice: null,
      searchQuery: '',
      highlightedNodeId: null,
      graphEpoch: s.graphEpoch + 1,
      loading: false,
      searchPhase: 'idle',
      searchProfilesTotal: 0,
      searchProfilesDone: 0,
      searchProfilesFailed: 0,
      searchFailedCpfs: [],
      searchPendingRootId: null,
      unsavedChanges: false,
    })),

  markSaved: () => set({ unsavedChanges: false }),

  updatePersonPhoto: (cpf, photoUrl) => {
    if (!photoUrl) return;
    const id = personId(cpf);
    set((s) => {
      const node = s.nodeIndex.get(id);
      if (!node?.person || node.person.photoUrl === photoUrl) return {};
      node.person = { ...node.person, photoUrl };
      return { nodes: [...s.nodeIndex.values()] };
    });
  },

  buildSnapshot: () => {
    const s = get();
    if (!s.rootId) return null;
    const profilesByCpf = usePersonProfileStore.getState().profilesByCpf;
    const profiles: Record<string, ApiFullProfile> = {};
    const nodes: GraphNode[] = [];
    for (const n of s.nodeIndex.values()) {
      if (n.kind === 'person' && n.person) {
        const cpf = onlyDigits(n.person.cpf);
        const profile = profilesByCpf.get(cpf);
        if (profile) profiles[cpf] = stripHardFields(profile);
        // photoUrl nunca é persistido cru — é recalculado a partir do bucket ao reabrir.
        const { photoUrl: _photoUrl, ...personWithoutPhoto } = n.person;
        nodes.push({ ...n, person: personWithoutPhoto });
      } else {
        nodes.push(n);
      }
    }
    return {
      rootId: s.rootId,
      nodes,
      links: s.links,
      currentLayer: s.currentLayer,
      maxDepth: s.maxDepth,
      filters: s.filters,
      profiles,
    };
  },

  hydrateFromSnapshot: (snapshot, photoUrlsByPersonId) => {
    // Ordem importante: hidrata os perfis ANTES de montar o nodeIndex final —
    // o subscribe de foto (abaixo) pode disparar durante hydrateProfiles, mas
    // o nodeIndex definitivo (com a URL assinada do bucket) é setado depois,
    // então sempre vence por último, independente do que o subscribe fizer.
    usePersonProfileStore.getState().hydrateProfiles(snapshot.profiles);

    const nodeIndex = new Map<string, GraphNode>();
    for (const n of snapshot.nodes) {
      const photoUrl = photoUrlsByPersonId[n.id];
      nodeIndex.set(n.id, photoUrl && n.person ? { ...n, person: { ...n.person, photoUrl } } : n);
    }

    set((s) => ({
      nodeIndex,
      nodes: [...nodeIndex.values()],
      links: snapshot.links,
      rootId: snapshot.rootId,
      currentLayer: snapshot.currentLayer,
      maxDepth: snapshot.maxDepth,
      filters: snapshot.filters,
      graphEpoch: s.graphEpoch + 1,
      loading: false,
      error: null,
      notice: null,
      searchPhase: 'done',
      breadcrumb: [snapshot.rootId],
      selectedNodeId: null,
      // Acabou de vir de uma consulta salva — nada foi alterado ainda.
      unsavedChanges: false,
    }));
  },
}));

/**
 * Reage a perfis resolvidos no personProfileStore para atualizar a foto do nó
 * correspondente — cobre tanto o caso síncrono (perfil resolvido durante uma
 * expansão) quanto o tardio (usuário abre o painel de uma pessoa depois que o
 * mapa já está montado). Sentido único (personProfileStore → graphStore);
 * o inverso já existe (graphStore importa/usa personProfileStore) e inverter
 * criaria um ciclo de módulos.
 */
usePersonProfileStore.subscribe((state, prevState) => {
  if (state.profilesByCpf === prevState.profilesByCpf) return;
  for (const [cpf, profile] of state.profilesByCpf) {
    if (prevState.profilesByCpf.get(cpf) === profile) continue;
    useGraphStore.getState().updatePersonPhoto(cpf, extractPersonPhotoUrl(profile));
  }
});
