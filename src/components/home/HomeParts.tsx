import { useEffect, useRef, useState, type ReactNode } from 'react';
import { prefersReducedMotion } from '../../lib/motion';
import { NetworkBackdrop } from './NetworkBackdrop';

export const LOGO_URL = 'https://aisfizoyfpcisykarrnt.supabase.co/storage/v1/object/public/imagens/LOGO%20TRIAD3%20.png';

/**
 * Cenário da tela inicial: céu escuro com auroras, rede viva, chão em
 * perspectiva e vinheta. O conteúdo vem por cima.
 */
export function HomeShell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <div className="home">
      <div className="home-sky" aria-hidden="true">
        <span className="home-aurora a1" />
        <span className="home-aurora a2" />
        <span className="home-aurora a3" />
      </div>
      <NetworkBackdrop />
      <div className="home-floor" aria-hidden="true" />
      <div className="home-vignette" aria-hidden="true" />
      {header && <div className="home-header">{header}</div>}
      <div className="home-scroll">{children}</div>
    </div>
  );
}

/**
 * Logo como "núcleo": anel de luz girando, duas órbitas com satélites,
 * ondas de radar e uma leve inclinação 3D que acompanha o mouse.
 */
export function LogoCore({ size = 220, scanning = false }: { size?: number; scanning?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / window.innerWidth;
        const dy = (e.clientY - (r.top + r.height / 2)) / window.innerHeight;
        el.style.setProperty('--tilt-x', `${(-dy * 18).toFixed(2)}deg`);
        el.style.setProperty('--tilt-y', `${(dx * 18).toFixed(2)}deg`);
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  return (
    <div ref={ref} className={`core ${scanning ? 'is-scanning' : ''}`} style={{ '--core': `${size}px` } as React.CSSProperties}>
      <span className="core-ping" aria-hidden="true" />
      <span className="core-ping late" aria-hidden="true" />
      <span className="core-orbit o1" aria-hidden="true">
        <i />
      </span>
      <span className="core-orbit o2" aria-hidden="true">
        <i />
        <i className="b" />
      </span>
      <span className="core-ring" aria-hidden="true" />
      {scanning && <span className="core-sweep" aria-hidden="true" />}
      <div className="core-disc">
        {failed ? (
          <span className="core-fallback">T3</span>
        ) : (
          <img src={LOGO_URL} alt="TRIAD3" className="core-logo" onError={() => setFailed(true)} />
        )}
        <span className="core-glare" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Frases que se digitam e se apagam em sequência (cursor piscando). */
export function Typewriter({ phrases, className }: { phrases: string[]; className?: string }) {
  const reduced = prefersReducedMotion();
  const [text, setText] = useState(reduced ? phrases[0] : '');
  const state = useRef({ i: 0, pos: 0, deleting: false });

  useEffect(() => {
    if (reduced || phrases.length === 0) return;
    let t: ReturnType<typeof setTimeout>;
    const step = () => {
      const s = state.current;
      const full = phrases[s.i % phrases.length];
      if (!s.deleting) {
        s.pos += 1;
        setText(full.slice(0, s.pos));
        if (s.pos >= full.length) {
          s.deleting = true;
          t = setTimeout(step, 2400);
          return;
        }
        t = setTimeout(step, 34 + Math.random() * 40);
      } else {
        s.pos -= 2;
        setText(full.slice(0, Math.max(0, s.pos)));
        if (s.pos <= 0) {
          s.deleting = false;
          s.pos = 0;
          s.i += 1;
          t = setTimeout(step, 380);
          return;
        }
        t = setTimeout(step, 16);
      }
    };
    t = setTimeout(step, 900);
    return () => clearTimeout(t);
  }, [phrases, reduced]);

  return (
    <p className={className} aria-live="off">
      <span>{text}</span>
      <i className="tw-caret" aria-hidden="true" />
    </p>
  );
}

/** Cartão com holofote que segue o mouse e leve inclinação. */
export function SpotlightCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={`spot ${className}`}
      onPointerMove={(e) => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        el.style.setProperty('--mx', `${x}px`);
        el.style.setProperty('--my', `${y}px`);
        if (!prefersReducedMotion()) {
          el.style.setProperty('--rx', `${((y / r.height - 0.5) * -8).toFixed(2)}deg`);
          el.style.setProperty('--ry', `${((x / r.width - 0.5) * 8).toFixed(2)}deg`);
        }
      }}
      onPointerLeave={() => {
        ref.current?.style.setProperty('--rx', '0deg');
        ref.current?.style.setProperty('--ry', '0deg');
      }}
    >
      {children}
    </div>
  );
}
