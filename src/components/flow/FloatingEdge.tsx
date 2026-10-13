import { useEffect, useState } from 'react';
import { EdgeLabelRenderer, useInternalNode, type EdgeProps, type Edge } from '@xyflow/react';
import { phaseOf } from '../../lib/motion';

export interface FlowEdgeData extends Record<string, unknown> {
  color: string;
  label: string;
  dashed?: boolean;
  width?: number;
  /** Vínculo de contexto (processo/família) — traço próprio, sem seta. */
  context?: boolean;
  /** Nº de processos que sustentam a aresta (engrossa o traço). */
  weight?: number;
  /** Partícula lenta de "fluxo" mesmo sem foco (só em redes pequenas). */
  ambient?: boolean;
  /** Aresta nascendo: atraso (ms) até ser desenhada. Ausente = já existia / movimento reduzido. */
  enterDelay?: number;
  /** Desenha do destino para a origem (quando é a origem que acabou de nascer). */
  drawReverse?: boolean;
  /** Incide no nó sob o mouse. */
  active?: boolean;
  /** Fora da vizinhança do nó sob o mouse. */
  dimmed?: boolean;
}

export type FloatingFlowEdge = Edge<FlowEdgeData, 'floating'>;

const LABEL_WIDTH = 150; // largura do cartão rf-entity (círculo centralizado)
/** quanto tempo a aresta leva para ser "desenhada" */
const DRAW_MS = 620;

/**
 * Aresta "flutuante": liga a borda do círculo de origem à borda do círculo de
 * destino, independentemente de onde os nós estejam (bordas circulares).
 *
 * Coreografia: ao nascer, um traço luminoso percorre a linha (desenho) e a
 * aresta definitiva aparece por baixo; o rótulo surge em seguida. Com foco
 * (mouse sobre um nó), as arestas da vizinhança brilham e partículas correm
 * por elas; as demais recuam.
 */
export function FloatingEdge({ id, source, target, data, markerEnd }: EdgeProps<FloatingFlowEdge>) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const delay = data?.enterDelay;
  // o traço de desenho existe só durante a entrada — depois sai do DOM
  const [drawing, setDrawing] = useState(() => delay !== undefined);
  useEffect(() => {
    if (!drawing) return;
    const t = setTimeout(() => setDrawing(false), (delay ?? 0) + DRAW_MS + 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!sourceNode || !targetNode || !data) return null;

  const sr = (sourceNode.data.radius as number) ?? 32;
  const tr = (targetNode.data.radius as number) ?? 32;

  // centro dos círculos: o círculo fica no topo/centro do cartão de 150px
  const sx = sourceNode.internals.positionAbsolute.x + LABEL_WIDTH / 2;
  const sy = sourceNode.internals.positionAbsolute.y + sr + 3;
  const tx = targetNode.internals.positionAbsolute.x + LABEL_WIDTH / 2;
  const ty = targetNode.internals.positionAbsolute.y + tr + 3;

  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  const x1 = sx + ux * (sr + 5);
  const y1 = sy + uy * (sr + 5);
  const tailGap = data.context ? tr + 5 : tr + 9; // sem seta, a linha encosta no círculo
  const x2 = tx - ux * tailGap;
  const y2 = ty - uy * tailGap;
  // nós sobrepostos (ex.: ainda no meio do voo) — nada a desenhar
  const collapsed = dist < sr + tr + 6;

  const path = `M ${x1},${y1} L ${x2},${y2}`;
  const drawPath = data.drawReverse ? `M ${x2},${y2} L ${x1},${y1}` : path;
  const labelX = (x1 + x2) / 2;
  const labelY = (y1 + y2) / 2;

  const width = (data.width ?? 1.8) + Math.min(2.2, (data.weight ?? 0) * 0.35);
  const phase = phaseOf(id);
  const particles = !drawing && !data.dimmed && !collapsed ? (data.active ? 3 : data.ambient ? 1 : 0) : 0;
  const particleDur = data.active ? 1.5 : 4.2 + phase * 2;

  const groupClass = [
    'rf-edge',
    data.context ? 'is-context' : '',
    data.active ? 'is-active' : '',
    data.dimmed ? 'is-dimmed' : '',
    drawing ? 'is-drawing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const vars = {
    '--edge-color': data.color,
    '--edge-delay': `${delay ?? 0}ms`,
    '--edge-draw': `${DRAW_MS}ms`,
  } as React.CSSProperties;

  return (
    <>
      <g className={groupClass} style={vars}>
        {data.active && <path className="rf-edge-glow" d={path} style={{ stroke: data.color }} />}
        <path
          id={id}
          className="react-flow__edge-path rf-edge-base"
          d={path}
          markerEnd={markerEnd}
          style={{
            stroke: data.color,
            strokeWidth: data.active ? width + 0.8 : width,
            strokeDasharray: data.dashed ? '5 5' : undefined,
          }}
        />
        <path className="react-flow__edge-interaction" d={path} fill="none" strokeOpacity={0} strokeWidth={20} />
        {drawing && !collapsed && <path className="rf-edge-draw" d={drawPath} pathLength={1} style={{ stroke: data.color }} />}
        {Array.from({ length: particles }, (_, i) => (
          <circle key={i} className="rf-particle" r={data.active ? 3 : 2.2} style={{ fill: data.color, color: data.color }}>
            <animateMotion
              dur={`${particleDur}s`}
              repeatCount="indefinite"
              path={path}
              begin={`${-((phase + i / particles) * particleDur).toFixed(2)}s`}
              keyPoints="0;1"
              keyTimes="0;1"
              calcMode="linear"
            />
          </circle>
        ))}
      </g>
      <EdgeLabelRenderer>
        <div
          className={[
            'rf-edge-label nodrag nopan',
            drawing ? 'is-born' : '',
            data.context ? 'is-context' : '',
            data.active ? 'is-active' : '',
            data.dimmed ? 'is-dimmed' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            color: data.color,
            ...vars,
          }}
        >
          {data.label}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
