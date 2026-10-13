/**
 * Coreografia do mapa: easing, plano de entrada dos nós e utilidades de
 * câmera. Tudo puro (sem DOM/React) — o canvas só aplica o plano.
 */
import type { XY } from './flowLayout';

/** Usuário pediu menos movimento no sistema → nada de voo, desenho ou partícula. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Saída com leve "estouro" além do alvo — o nó parece ser arremessado e assentar. */
export function easeOutBack(t: number): number {
  const c1 = 1.15;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

export const lerp = (a: XY, b: XY, k: number): XY => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });

export const ROOT_DELAY_MS = 90;

export interface EntranceStep {
  id: string;
  /** de onde o nó "nasce" (posição do nó que o revelou) */
  from: XY;
  /** atraso em ms a partir de agora */
  delay: number;
}

/**
 * Primeira carga: a raiz surge, depois cada camada explode em onda a partir
 * do nó-pai, varrendo o anel no sentido horário (ordem pelo ângulo em torno
 * da raiz). O tempo total é limitado, então redes grandes não ficam
 * "carregando" por segundos.
 */
export function initialEntrance(
  nodes: { id: string; depth: number }[],
  targets: Map<string, XY>,
  parentOf: (id: string) => string | undefined,
  rootId: string | null,
): EntranceStep[] {
  const origin = (rootId && targets.get(rootId)) || { x: 0, y: 0 };
  const byDepth = new Map<number, { id: string; angle: number }[]>();
  for (const n of nodes) {
    const p = targets.get(n.id) ?? origin;
    const depth = n.id === rootId ? 0 : Math.max(1, n.depth);
    const angle = Math.atan2(p.y - origin.y, p.x - origin.x);
    // começa "ao meio-dia" e gira no sentido horário
    const clock = (angle + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    if (!byDepth.has(depth)) byDepth.set(depth, []);
    byDepth.get(depth)!.push({ id: n.id, angle: clock });
  }

  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const steps: EntranceStep[] = [];
  // a raiz espera um instante: dá tempo de a câmera se posicionar antes do primeiro quadro
  let waveStart = ROOT_DELAY_MS;
  for (const d of depths) {
    const ring = byDepth.get(d)!.sort((a, b) => a.angle - b.angle);
    const spread = Math.min(900, ring.length * 70); // duração da varredura do anel
    ring.forEach((item, i) => {
      const parent = d === 0 ? undefined : parentOf(item.id);
      steps.push({
        id: item.id,
        from: (parent && targets.get(parent)) || origin,
        delay: Math.round(waveStart + (d === 0 || ring.length <= 1 ? 0 : (spread * i) / (ring.length - 1))),
      });
    });
    waveStart += d === 0 ? 320 : spread + 260;
  }
  return steps;
}

/** Caixa que envolve as posições (cartão de 150×120 a partir do canto superior esquerdo). */
export function boundsOf(points: XY[], cardW = 150, cardH = 120): { x: number; y: number; width: number; height: number } | null {
  if (points.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x + cardW);
    y1 = Math.max(y1, p.y + cardH);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Fase estável (0–1) derivada de um id — espalha as partículas para não pulsarem juntas. */
export function phaseOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
