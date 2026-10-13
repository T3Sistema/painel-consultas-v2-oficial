import type { GraphLink, GraphNode } from '../types/graph';

export interface XY {
  x: number;
  y: number;
}

const nid = (v: string | GraphNode) => (typeof v === 'string' ? v : v.id);

const LEVEL_RADIUS = 320; // distância entre camadas no layout radial
const CHILD_RADIUS = 260; // distância dos filhos ao expandir um nó
const MIN_GAP = 165; // distância mínima entre nós (evita sobreposição de cartões)

function adjacency(links: GraphLink[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const l of links) {
    const s = nid(l.source);
    const t = nid(l.target);
    if (!adj.has(s)) adj.set(s, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(s)!.push(t);
    adj.get(t)!.push(s);
  }
  return adj;
}

function tooClose(p: XY, taken: XY[], gap = MIN_GAP): boolean {
  return taken.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < gap);
}

/** Empurra o ponto em espiral até não colidir com posições ocupadas */
function nudge(p: XY, taken: XY[]): XY {
  let { x, y } = p;
  let angle = Math.atan2(y, x);
  let r = 0;
  for (let i = 0; i < 60 && tooClose({ x, y }, taken); i++) {
    angle += 0.7;
    r += 14;
    x = p.x + Math.cos(angle) * r;
    y = p.y + Math.sin(angle) * r;
  }
  return { x, y };
}

/**
 * Layout radial completo (BFS a partir da raiz): camada k em anel de raio
 * crescente, filhos agrupados dentro do setor angular do pai.
 */
export function radialLayout(nodes: GraphNode[], links: GraphLink[], rootId: string | null): Map<string, XY> {
  const pos = new Map<string, XY>();
  if (nodes.length === 0) return pos;
  const adj = adjacency(links);
  const root = rootId && nodes.some((n) => n.id === rootId) ? rootId : nodes[0].id;

  pos.set(root, { x: 0, y: 0 });
  const sector = new Map<string, [number, number]>([[root, [0, Math.PI * 2]]]);
  const visited = new Set<string>([root]);
  let frontier = [root];
  let level = 1;
  const present = new Set(nodes.map((n) => n.id));
  const taken: XY[] = [{ x: 0, y: 0 }];

  let prevRadius = 0;
  while (frontier.length > 0 && level < 40) {
    // 1º junta a camada inteira (para dimensionar o anel), depois posiciona
    const entries: { child: string; angle: number; step: number }[] = [];
    for (const parent of frontier) {
      const children = (adj.get(parent) ?? []).filter((c) => present.has(c) && !visited.has(c));
      if (children.length === 0) continue;
      const [a0, a1] = sector.get(parent) ?? [0, Math.PI * 2];
      const step = (a1 - a0) / children.length;
      children.forEach((child, i) => {
        visited.add(child);
        entries.push({ child, angle: a0 + step * (i + 0.5), step });
      });
    }
    // anel cresce com a quantidade de nós — evita cartões empilhados num círculo pequeno
    const radius = Math.max(LEVEL_RADIUS * level, prevRadius + LEVEL_RADIUS, (entries.length * MIN_GAP) / (Math.PI * 2));
    prevRadius = radius;
    const next: string[] = [];
    for (const { child, angle, step } of entries) {
      const raw = { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
      const p = nudge(raw, taken);
      pos.set(child, p);
      taken.push(p);
      sector.set(child, [angle - step / 2, angle + step / 2]);
      next.push(child);
    }
    frontier = next;
    level++;
  }

  // nós desconectados da raiz (após filtros): coloca numa coluna à esquerda
  let orphanY = 0;
  for (const n of nodes) {
    if (!pos.has(n.id)) {
      const p = nudge({ x: -LEVEL_RADIUS * 1.5, y: orphanY }, taken);
      pos.set(n.id, p);
      taken.push(p);
      orphanY += MIN_GAP;
    }
  }
  return pos;
}

/**
 * Posiciona apenas os nós novos ao redor do nó âncora (expansão incremental),
 * distribuindo-os em arco no sentido oposto ao restante da rede.
 */
export function placeAround(
  anchor: XY,
  awayFrom: XY | null,
  count: number,
  taken: XY[],
): XY[] {
  const base = awayFrom ? Math.atan2(anchor.y - awayFrom.y, anchor.x - awayFrom.x) : Math.random() * Math.PI * 2;
  const arc = Math.min(Math.PI * 1.6, Math.max(Math.PI * 0.6, count * 0.55));
  const out: XY[] = [];
  for (let i = 0; i < count; i++) {
    const angle = count === 1 ? base : base - arc / 2 + (arc * i) / (count - 1);
    const raw = {
      x: anchor.x + Math.cos(angle) * CHILD_RADIUS,
      y: anchor.y + Math.sin(angle) * CHILD_RADIUS,
    };
    const p = nudge(raw, taken);
    out.push(p);
    taken.push(p);
  }
  return out;
}
