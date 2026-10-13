import { CONTEXT_RELATIONS, JUDICIAL_RELATIONS, type GraphLink, type GraphNode, type RelationType } from '../types/graph';

// ─── Identidade visual dos nós (paleta "noite" — neon sobre fundo escuro, no tom do logo) ───
export const NODE_COLORS = {
  company: '#22d3ee', // ciano — empresa ativa
  companyRing: '#a5f3fc', // gelo — anel da raiz
  person: '#34d399', // esmeralda — pessoa
  inactive: '#64748b', // ardósia — empresa inativa (suspensa/inapta/nula)
  baixada: '#fb7185', // rosa-vermelho — empresa baixada
  admin: '#fbbf24', // âmbar — administrador
  matriz: '#a78bfa', // violeta — empresa matriz (destaque)
  filial: '#fb923c', // laranja — empresa filial
} as const;

// ─── Cores por tipo de relacionamento ─────────────────────────────────────────
export const LINK_COLORS: Record<RelationType, string> = {
  SOCIO: '#22d3ee', // ciano
  ADMINISTRADOR: '#34d399', // esmeralda
  REPRESENTANTE_LEGAL: '#2dd4bf', // turquesa
  CONTROLADORA: '#fb7185', // rosa-vermelho
  CONTROLADA: '#f43f5e',
  FILIAL: '#fb923c', // laranja
  MATRIZ: '#a78bfa',
  PARTICIPACAO: '#c084fc', // lilás
  PROCESSO: '#f87171', // vermelho — litígio
  COPARTE: '#94a3b8', // ardósia — mesmo polo
  PARENTE: '#f472b6', // magenta — família
};

export const RELATION_LABELS: Record<RelationType, string> = {
  SOCIO: 'Sócio',
  ADMINISTRADOR: 'Administrador',
  REPRESENTANTE_LEGAL: 'Representante Legal',
  CONTROLADORA: 'Controladora',
  CONTROLADA: 'Controlada',
  FILIAL: 'Filial',
  MATRIZ: 'Matriz de',
  PARTICIPACAO: 'Participação',
  PROCESSO: 'Processo judicial',
  COPARTE: 'Co-parte em processo',
  PARENTE: 'Parente',
};

const relationsOf = (l: GraphLink): RelationType[] => (l.meta.relations?.length ? l.meta.relations : [l.type]);

/** Quantos processos distintos sustentam a aresta (cada evidência judicial carrega o nº na origem). */
export function linkProcessCount(l: GraphLink): number {
  const ev = l.meta.evidencias ?? [];
  return new Set(ev.filter((e) => JUDICIAL_RELATIONS.includes(e.relation)).map((e) => e.origem ?? '')).size;
}

/**
 * Relação que define a cor da aresta: societária vence (é o que o mapa
 * investiga); depois família; depois litígio; co-parte por último.
 */
export function linkPrimaryType(l: GraphLink): RelationType {
  const rels = relationsOf(l);
  const societaria = rels.find((r) => !CONTEXT_RELATIONS.includes(r));
  if (societaria) return societaria;
  for (const r of ['PARENTE', 'PROCESSO', 'COPARTE'] as const) if (rels.includes(r)) return r;
  return l.type;
}

export const linkColor = (l: GraphLink): string => LINK_COLORS[linkPrimaryType(l)];

/** `true` quando a aresta é só de contexto (processo/família) — sem relação societária. */
export const isContextLink = (l: GraphLink): boolean => relationsOf(l).every((r) => CONTEXT_RELATIONS.includes(r));

/** Rótulo curto da aresta no mapa ("Sócio", "Mãe · 1 processo", "3 processos"…). */
export function linkLabel(l: GraphLink): string {
  const primary = linkPrimaryType(l);
  if (!CONTEXT_RELATIONS.includes(primary)) return RELATION_LABELS[primary];
  const parts: string[] = [];
  if (relationsOf(l).includes('PARENTE')) {
    const fam = (l.meta.evidencias ?? []).find((e) => e.relation === 'PARENTE');
    parts.push(fam?.qualificacao ?? RELATION_LABELS.PARENTE);
  }
  const n = linkProcessCount(l);
  if (n > 0) {
    const onlyCoparte = !relationsOf(l).includes('PROCESSO');
    parts.push(`${onlyCoparte && parts.length === 0 ? 'Co-parte · ' : ''}${n} processo${n > 1 ? 's' : ''}`);
  }
  return parts.join(' · ') || RELATION_LABELS[primary];
}

export function nodeColor(node: GraphNode): string {
  if (node.kind === 'person') {
    return node.person?.administrador ? NODE_COLORS.admin : NODE_COLORS.person;
  }
  const c = node.company;
  if (!c) return NODE_COLORS.company;
  if (c.situacao === 'BAIXADA') return NODE_COLORS.baixada;
  if (c.situacao === 'SUSPENSA' || c.situacao === 'INAPTA' || c.situacao === 'NULA') return NODE_COLORS.inactive;
  if (c.matriz === false) return NODE_COLORS.filial;
  return NODE_COLORS.company;
}

/** Classes CSS do nó do mapa (rf-entity) */
export function nodeKindClass(node: GraphNode): string {
  if (node.kind === 'person') {
    return node.person?.administrador ? 'person admin' : 'person';
  }
  const c = node.company;
  const parts = ['company'];
  if (c?.situacao === 'BAIXADA') parts.push('closed');
  if (c?.situacao === 'SUSPENSA' || c?.situacao === 'INAPTA' || c?.situacao === 'NULA') parts.push('inactive');
  if (c?.matriz === false) parts.push('branch');
  if (c?.matriz === true) parts.push('matrix');
  return parts.join(' ');
}

export const NODE_LEGEND = [
  { color: NODE_COLORS.company, label: 'Empresa ativa' },
  { color: NODE_COLORS.person, label: 'Pessoa (CPF)' },
  { color: NODE_COLORS.admin, label: 'Administrador' },
  { color: NODE_COLORS.inactive, label: 'Empresa inativa' },
  { color: NODE_COLORS.baixada, label: 'Empresa baixada' },
  { color: NODE_COLORS.filial, label: 'Filial' },
  { color: NODE_COLORS.matriz, label: 'Matriz (destaque)' },
];
