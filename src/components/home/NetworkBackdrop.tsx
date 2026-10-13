import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '../../lib/motion';

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hub: boolean;
  phase: number;
}

interface Packet {
  a: number;
  b: number;
  t: number;
  speed: number;
}

const LINK_DIST = 150;
const MOUSE_DIST = 210;

/**
 * Fundo vivo da tela inicial: uma rede de nós à deriva que se conectam por
 * proximidade (a mesma metáfora do mapa), com "pacotes" de luz correndo
 * pelas ligações e o cursor agindo como um nó magnético. Pausa com a aba
 * oculta; com movimento reduzido, desenha um único quadro estático.
 */
export function NetworkBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const reduced = prefersReducedMotion();
    let w = 0;
    let h = 0;
    let dots: Dot[] = [];
    const packets: Packet[] = [];
    const mouse = { x: -9999, y: -9999, active: false };
    let raf = 0;
    let last = performance.now();

    const seed = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.max(28, Math.min(120, Math.round((w * h) / 15000)));
      dots = Array.from({ length: count }, () => {
        const hub = Math.random() < 0.09;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.22,
          vy: (Math.random() - 0.5) * 0.22,
          r: hub ? 2.6 + Math.random() * 1.4 : 1 + Math.random() * 1.2,
          hub,
          phase: Math.random() * Math.PI * 2,
        };
      });
      packets.length = 0;
    };

    const draw = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      ctx.clearRect(0, 0, w, h);

      for (const d of dots) {
        if (!reduced) {
          // o cursor atrai de leve os nós próximos
          if (mouse.active) {
            const dx = mouse.x - d.x;
            const dy = mouse.y - d.y;
            const dist = Math.hypot(dx, dy);
            if (dist < MOUSE_DIST && dist > 1) {
              d.vx += (dx / dist) * 0.0025 * dt;
              d.vy += (dy / dist) * 0.0025 * dt;
            }
          }
          d.vx *= 0.995;
          d.vy *= 0.995;
          const speed = Math.hypot(d.vx, d.vy);
          if (speed < 0.06) {
            d.vx += (Math.random() - 0.5) * 0.02;
            d.vy += (Math.random() - 0.5) * 0.02;
          }
          d.x += d.vx * dt * 0.06;
          d.y += d.vy * dt * 0.06;
          if (d.x < -20) d.x = w + 20;
          if (d.x > w + 20) d.x = -20;
          if (d.y < -20) d.y = h + 20;
          if (d.y > h + 20) d.y = -20;
        }
      }

      // ligações por proximidade
      const linked: [number, number][] = [];
      ctx.lineWidth = 1;
      for (let i = 0; i < dots.length; i++) {
        const a = dots[i];
        for (let j = i + 1; j < dots.length; j++) {
          const b = dots[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          if (Math.abs(dx) > LINK_DIST || Math.abs(dy) > LINK_DIST) continue;
          const dist = Math.hypot(dx, dy);
          if (dist > LINK_DIST) continue;
          const alpha = (1 - dist / LINK_DIST) * (a.hub || b.hub ? 0.42 : 0.24);
          ctx.strokeStyle = `rgba(56, 220, 255, ${alpha})`;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          linked.push([i, j]);
        }
        // o cursor vira um nó: liga-se a quem está perto
        if (mouse.active) {
          const dist = Math.hypot(a.x - mouse.x, a.y - mouse.y);
          if (dist < MOUSE_DIST) {
            ctx.strokeStyle = `rgba(125, 249, 255, ${(1 - dist / MOUSE_DIST) * 0.55})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(mouse.x, mouse.y);
            ctx.stroke();
          }
        }
      }

      // nós (hubs pulsam)
      for (const d of dots) {
        const pulse = d.hub && !reduced ? 1 + Math.sin(now / 700 + d.phase) * 0.35 : 1;
        if (d.hub) {
          const g = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r * 6 * pulse);
          g.addColorStop(0, 'rgba(56, 220, 255, 0.35)');
          g.addColorStop(1, 'rgba(56, 220, 255, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.r * 6 * pulse, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = d.hub ? 'rgba(165, 250, 255, 0.95)' : 'rgba(120, 220, 245, 0.7)';
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!reduced) {
        // pacotes de dados correndo pelas ligações
        if (linked.length > 0 && packets.length < 14 && Math.random() < 0.06) {
          const [a, b] = linked[Math.floor(Math.random() * linked.length)];
          packets.push(Math.random() < 0.5 ? { a, b, t: 0, speed: 0.0009 + Math.random() * 0.0012 } : { a: b, b: a, t: 0, speed: 0.0009 + Math.random() * 0.0012 });
        }
        for (let k = packets.length - 1; k >= 0; k--) {
          const p = packets[k];
          p.t += p.speed * dt;
          const A = dots[p.a];
          const B = dots[p.b];
          if (!A || !B || p.t >= 1 || Math.hypot(A.x - B.x, A.y - B.y) > LINK_DIST * 1.1) {
            packets.splice(k, 1);
            continue;
          }
          const x = A.x + (B.x - A.x) * p.t;
          const y = A.y + (B.y - A.y) * p.t;
          const g = ctx.createRadialGradient(x, y, 0, x, y, 9);
          g.addColorStop(0, 'rgba(220, 255, 255, 0.95)');
          g.addColorStop(0.35, 'rgba(56, 220, 255, 0.55)');
          g.addColorStop(1, 'rgba(56, 220, 255, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, y, 9, 0, Math.PI * 2);
          ctx.fill();
        }
        raf = requestAnimationFrame(draw);
      }
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = e.clientX - rect.left;
      mouse.y = e.clientY - rect.top;
      mouse.active = true;
    };
    const onLeave = () => {
      mouse.active = false;
    };
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden && !reduced) {
        last = performance.now();
        raf = requestAnimationFrame(draw);
      }
    };
    const onResize = () => {
      seed();
      if (reduced) draw(performance.now());
    };

    seed();
    raf = requestAnimationFrame(draw);
    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return <canvas ref={ref} className="home-network" aria-hidden="true" />;
}
