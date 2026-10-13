import { JUDICIAL_RELATIONS, type GraphFilters, type GraphLink, type GraphNode, type RelationType } from '../types/graph';

const resolveId = (v: string | GraphNode) => (typeof v === 'string' ? v : v.id);

/**
 * Aplica os filtros dinâmicos ao grafo, retornando os subconjuntos visíveis.
 * O nó raiz nunca é ocultado.
 */
export function applyFilters(
  nodes: GraphNode[],
  links: GraphLink[],
  filters: GraphFilters,
  rootId: string | null,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const nodeVisible = (n: GraphNode): boolean => {
    if (n.id === rootId) return true;
    if (n.kind === 'person') {
      if (!filters.showPeople) return false;
      if (filters.onlyAdmins && !n.person?.administrador) return false;
      return true;
    }
    if (!filters.showCompanies) return false;
    const c = n.company;
    if (filters.onlyActive && c?.situacao !== 'ATIVA') return false;
    if (filters.onlyBaixadas && c?.situacao !== 'BAIXADA') return false;
    if (!filters.showBranches && c?.matriz === false) return false;
    if (!filters.showHeadquarters && c?.matriz === true) return false;
    if (filters.uf && c?.uf !== filters.uf) return false;
    if (filters.cnae && c?.cnaePrincipal?.codigo !== filters.cnae) return false;
    if (filters.openedAfter && (!c?.dataAbertura || c.dataAbertura < filters.openedAfter)) return false;
    return true;
  };

  const visibleIds = new Set(nodes.filter(nodeVisible).map((n) => n.id));

  // Relações de contexto desligadas saem da aresta; se não sobrar nenhuma, a aresta some.
  const hidden = new Set<RelationType>([
    ...(filters.showJudicial === false ? JUDICIAL_RELATIONS : []),
    ...(filters.showFamily === false ? (['PARENTE'] as const) : []),
  ]);
  const linkSurvivesContext = (l: GraphLink): boolean => {
    if (hidden.size === 0) return true;
    const rels = l.meta.relations?.length ? l.meta.relations : [l.type];
    return rels.some((r) => !hidden.has(r));
  };

  const visibleLinks = links.filter((l) => {
    const s = resolveId(l.source);
    const t = resolveId(l.target);
    if (!visibleIds.has(s) || !visibleIds.has(t)) return false;
    if (!linkSurvivesContext(l)) return false;
    if (filters.minParticipation > 0 && (l.meta.percentual ?? 0) < filters.minParticipation) return false;
    if (filters.onlyPartners && l.type !== 'SOCIO' && l.type !== 'PARTICIPACAO') return false;
    if (filters.onlyAdmins && l.type !== 'ADMINISTRADOR') {
      // quando o filtro de administradores está ativo, mantém apenas vínculos de administração
      return false;
    }
    return true;
  });

  // remove nós que ficaram órfãos após o filtro de vínculos (exceto a raiz)
  const connected = new Set<string>();
  if (rootId) connected.add(rootId);
  for (const l of visibleLinks) {
    connected.add(resolveId(l.source));
    connected.add(resolveId(l.target));
  }
  const finalNodes = nodes.filter((n) => connected.has(n.id));

  return { nodes: finalNodes, links: visibleLinks };
}

export interface GraphStats {
  totalCompanies: number;
  totalPeople: number;
  totalLinks: number;
  maxDepth: number;
  totalCapital: number;
  ufs: string[];
  municipios: string[];
  cnaes: string[];
  activeCompanies: number;
  baixadas: number;
}

export function computeStats(nodes: GraphNode[], links: GraphLink[]): GraphStats {
  const companies = nodes.filter((n) => n.kind === 'company');
  const ufs = new Set<string>();
  const municipios = new Set<string>();
  const cnaes = new Set<string>();
  let capital = 0;
  let active = 0;
  let baixadas = 0;
  for (const c of companies) {
    const d = c.company;
    if (!d) continue;
    if (d.uf) ufs.add(d.uf);
    if (d.municipio) municipios.add(d.municipio);
    if (d.cnaePrincipal) cnaes.add(`${d.cnaePrincipal.codigo} — ${d.cnaePrincipal.descricao}`);
    capital += d.capitalSocial ?? 0;
    if (d.situacao === 'ATIVA') active++;
    if (d.situacao === 'BAIXADA') baixadas++;
  }
  return {
    totalCompanies: companies.length,
    totalPeople: nodes.length - companies.length,
    totalLinks: links.length,
    maxDepth: nodes.reduce((m, n) => Math.max(m, n.depth), 0),
    totalCapital: capital,
    ufs: [...ufs].sort(),
    municipios: [...municipios].sort(),
    cnaes: [...cnaes].sort(),
    activeCompanies: active,
    baixadas,
  };
}

/** Contagem de conexões por nó (usada para dimensionar os nós) */
export function degreeMap(links: GraphLink[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of links) {
    const s = resolveId(l.source);
    const t = resolveId(l.target);
    m.set(s, (m.get(s) ?? 0) + 1);
    m.set(t, (m.get(t) ?? 0) + 1);
  }
  return m;
}
