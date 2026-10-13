import { describe, expect, it } from 'vitest';
import { ROOT_DELAY_MS, boundsOf, easeInOutCubic, easeOutBack, initialEntrance, phaseOf } from './motion';

describe('easing', () => {
  it('começa em 0 e termina em 1; easeOutBack passa do alvo antes de assentar', () => {
    for (const f of [easeOutBack, easeInOutCubic]) {
      expect(f(0)).toBeCloseTo(0);
      expect(f(1)).toBeCloseTo(1);
    }
    expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map(easeOutBack))).toBeGreaterThan(1);
  });
});

describe('initialEntrance', () => {
  const targets = new Map([
    ['root', { x: 0, y: 0 }],
    ['norte', { x: 0, y: -300 }],
    ['leste', { x: 300, y: 0 }],
    ['sul', { x: 0, y: 300 }],
    ['neto', { x: 600, y: 0 }],
  ]);
  const nodes = [
    { id: 'root', depth: 0 },
    { id: 'sul', depth: 1 },
    { id: 'leste', depth: 1 },
    { id: 'norte', depth: 1 },
    { id: 'neto', depth: 2 },
  ];
  const parentOf = (id: string) => (id === 'neto' ? 'leste' : 'root');
  const steps = initialEntrance(nodes, targets, parentOf, 'root');
  const byId = new Map(steps.map((s) => [s.id, s]));

  it('a raiz nasce primeiro, onde já está', () => {
    expect(byId.get('root')).toEqual({ id: 'root', from: { x: 0, y: 0 }, delay: ROOT_DELAY_MS });
  });

  it('o anel varre no sentido horário a partir do meio-dia', () => {
    const order = ['norte', 'leste', 'sul'].map((id) => byId.get(id)!.delay);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThan(ROOT_DELAY_MS);
  });

  it('cada nó nasce do próprio pai, e a camada seguinte só depois da anterior', () => {
    expect(byId.get('neto')!.from).toEqual({ x: 300, y: 0 });
    expect(byId.get('leste')!.from).toEqual({ x: 0, y: 0 });
    expect(byId.get('neto')!.delay).toBeGreaterThan(byId.get('sul')!.delay);
  });

  it('o tempo total fica limitado mesmo com anéis grandes', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ id: `n${i}`, depth: 1 }));
    const t = new Map(many.map((n, i) => [n.id, { x: Math.cos(i) * 500, y: Math.sin(i) * 500 }]));
    const s = initialEntrance(many, t, () => undefined, null);
    expect(Math.max(...s.map((x) => x.delay))).toBeLessThanOrEqual(ROOT_DELAY_MS + 900);
  });
});

describe('boundsOf / phaseOf', () => {
  it('envolve os cartões inteiros', () => {
    expect(boundsOf([{ x: 0, y: 0 }, { x: 100, y: -50 }])).toEqual({ x: 0, y: -50, width: 250, height: 170 });
    expect(boundsOf([])).toBeNull();
  });
  it('fase estável e dentro de [0, 1)', () => {
    expect(phaseOf('a→b')).toBe(phaseOf('a→b'));
    for (const id of ['x', 'y', 'p:1→c:2:SOCIO']) {
      expect(phaseOf(id)).toBeGreaterThanOrEqual(0);
      expect(phaseOf(id)).toBeLessThan(1);
    }
  });
});
