import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion } from '../../lib/motion';

/** Número que "sobe" até o alvo (easing de saída). Movimento reduzido → valor final direto. */
export function useCountUp(target: number, duration = 1100, delay = 0): number {
  const [value, setValue] = useState(() => (prefersReducedMotion() ? target : 0));
  const fromRef = useRef(0);
  useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(target)) {
      setValue(target);
      return;
    }
    const from = fromRef.current;
    let raf = 0;
    const start = performance.now() + delay;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      const k = 1 - (1 - t) ** 4;
      const v = from + (target - from) * k;
      setValue(v);
      fromRef.current = v;
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, delay]);
  return value;
}

export function CountUp({
  value,
  format = (v) => Math.round(v).toLocaleString('pt-BR'),
  duration,
  delay,
}: {
  value: number;
  format?: (v: number) => string;
  duration?: number;
  delay?: number;
}) {
  const v = useCountUp(value, duration, delay);
  return <>{format(v)}</>;
}

/** Tom de risco de um score 0–1000 (quanto maior, menor o risco). */
export function scoreTone(v: number): 'red' | 'amber' | 'green' {
  if (v < 400) return 'red';
  if (v < 650) return 'amber';
  return 'green';
}

const TONE_COLOR = { red: '#ef4444', amber: '#f59e0b', green: '#10b981' } as const;

/**
 * Medidor semicircular 0–1000: o arco se preenche e o ponteiro varre até o
 * valor. Só desenha o que a consulta trouxe — sem valor, sem medidor.
 */
export function ScoreGauge({
  value,
  label,
  band,
  size = 168,
  dark = true,
}: {
  value: number;
  label?: string;
  band?: string;
  size?: number;
  dark?: boolean;
}) {
  const clamped = Math.max(0, Math.min(1000, value));
  const animated = useCountUp(clamped, 1400, 120);
  const tone = scoreTone(clamped);
  const r = 70;
  const cx = 90;
  const cy = 86;
  const arc = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  const frac = animated / 1000;
  const angle = Math.PI * (1 - frac);
  // marcador luminoso na ponta do arco (sem ponteiro cruzando o número)
  const mx = cx + Math.cos(angle) * r;
  const my = cy - Math.sin(angle) * r;
  const gradId = `gauge-${label ?? 'score'}-${size}`.replace(/\W+/g, '');

  return (
    <div className={`gauge ${dark ? 'dark' : ''} tone-${tone}`} style={{ width: size }}>
      <svg viewBox="0 0 180 100" width={size} height={(size * 100) / 180} aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="45%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
        <path d={arc} className="gauge-track" pathLength={1} />
        <path d={arc} className="gauge-fill" pathLength={1} stroke={`url(#${gradId})`} style={{ strokeDashoffset: 1 - frac }} />
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const a = Math.PI * (1 - t);
          return (
            <line
              key={t}
              className="gauge-tick"
              x1={cx + Math.cos(a) * (r + 9)}
              y1={cy - Math.sin(a) * (r + 9)}
              x2={cx + Math.cos(a) * (r + 13)}
              y2={cy - Math.sin(a) * (r + 13)}
            />
          );
        })}
        <circle cx={mx} cy={my} r={11} className="gauge-glow" style={{ fill: TONE_COLOR[tone] }} />
        <circle cx={mx} cy={my} r={7.5} className="gauge-knob" style={{ stroke: TONE_COLOR[tone] }} />
      </svg>
      <div className="gauge-readout">
        <b>{Math.round(animated)}</b>
        {label && <small>{label}</small>}
      </div>
      {band && <span className="gauge-band">{band}</span>}
    </div>
  );
}

/** Lê os scores de um bloco `{ chave: número, chave_faixa: texto }` — só o que veio preenchido. */
export function readScores(score: unknown): { key: string; value: number; band?: string }[] {
  if (!score || typeof score !== 'object' || Array.isArray(score)) return [];
  const o = score as Record<string, unknown>;
  const out: { key: string; value: number; band?: string }[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (/faixa|band|classe/i.test(k)) continue;
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
    if (!Number.isFinite(n)) continue;
    const band = o[`${k}_faixa`] ?? o[`${k}Faixa`];
    out.push({ key: k, value: n, band: typeof band === 'string' && band.trim() ? band.trim() : undefined });
  }
  return out;
}

/** Chaves do bloco de score que `readScores` já consome (para mostrar só o resto). */
export function scoreConsumedKeys(score: unknown): Set<string> {
  const set = new Set<string>();
  for (const s of readScores(score)) {
    set.add(s.key);
    set.add(`${s.key}_faixa`);
    set.add(`${s.key}Faixa`);
  }
  return set;
}

/** "BAIXISSIMO RISCO" → "Baixíssimo risco" (sem inventar: só caixa e acento conhecido). */
export function bandLabel(band?: string): string | undefined {
  if (!band) return undefined;
  const t = band.trim().toLowerCase().replace('baixissimo', 'baixíssimo').replace('altissimo', 'altíssimo').replace('medio', 'médio');
  return t.charAt(0).toUpperCase() + t.slice(1);
}
