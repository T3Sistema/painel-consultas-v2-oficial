import { memo, useEffect, useState } from 'react';
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { CompanyIcon, PersonIcon } from './icons';

export interface EntityNodeData extends Record<string, unknown> {
  kind: string; // classes: company | person | closed | branch | inactive | matrix | admin
  isPerson: boolean;
  color: string;
  ring?: string;
  radius: number;
  label: string;
  subLabel?: string;
  idLabel?: string;
  role?: string;
  /** URL http(s) da foto da pessoa (já validada) — nunca usado em nó de empresa. */
  photoUrl?: string;
  main?: boolean;
  /** Nó vindo da rede de contexto (parte de processo / parente) — ganha um selo. */
  context?: 'processo' | 'familia';
  expanded: boolean;
  expanding: boolean;
  highlighted: boolean;
  /** Recém-nascido no mapa: atraso (ms) da animação de entrada. Ausente = sem animação. */
  enterDelay?: number;
  /** Fora da vizinhança do nó sob o mouse. */
  dimmed?: boolean;
  /** Vizinho direto do nó sob o mouse. */
  focused?: boolean;
}

export type EntityFlowNode = Node<EntityNodeData, 'entity'>;

function ScaleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0L5 7Zm14 0-3 6a3 3 0 0 0 6 0l-3-6Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" fill="currentColor" />
    </svg>
  );
}

/** Nó circular do mapa societário (estrutura rf-entity) */
export const EntityNode = memo(({ data, selected }: NodeProps<EntityFlowNode>) => {
  const size = data.radius * 2;
  const style = {
    '--rf-radius': `${data.radius}px`,
    '--rf-size': `${size}px`,
    '--rf-color': data.ring ?? data.color,
    '--rf-fill': data.color,
    '--enter-delay': `${data.enterDelay ?? 0}ms`,
  } as React.CSSProperties;

  const [photoFailed, setPhotoFailed] = useState(false);
  // se a URL da foto mudar (ex.: perfil recarregado), dá uma nova chance antes de cair no ícone
  useEffect(() => setPhotoFailed(false), [data.photoUrl]);
  const showPhoto = data.isPerson && Boolean(data.photoUrl) && !photoFailed;
  const isSelected = selected || data.highlighted;

  const classes = [
    'rf-entity',
    data.kind,
    isSelected ? 'is-selected' : '',
    data.main ? 'is-root' : '',
    data.enterDelay !== undefined ? 'is-born' : '',
    data.dimmed ? 'is-dimmed' : '',
    data.focused ? 'is-focused' : '',
    data.expanding ? 'is-expanding' : '',
    data.context ? `ctx-${data.context}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classes} style={style}>
      <Handle type="target" id="t" position={Position.Top} className="rf-port" isConnectable={false} />
      <Handle type="source" id="s" position={Position.Top} className="rf-port" isConnectable={false} />
      <div className="rf-pop">
        <div className="rf-disc">
          {data.main && (
            <>
              <span className="rf-halo" aria-hidden="true" />
              <span className="rf-halo late" aria-hidden="true" />
              <span className="rf-orbit" aria-hidden="true" />
            </>
          )}
          {isSelected && <span className="rf-selring" aria-hidden="true" />}
          {data.expanding && <span className="rf-scan" aria-hidden="true" />}
          {data.enterDelay !== undefined && <span className="rf-shock" aria-hidden="true" />}
          <div className="rf-circle">
            {showPhoto ? (
              <img
                src={data.photoUrl}
                alt=""
                className="rf-avatar"
                loading="lazy"
                onError={() => setPhotoFailed(true)}
              />
            ) : data.isPerson ? (
              <PersonIcon />
            ) : (
              <CompanyIcon />
            )}
            {!data.expanded && !data.expanding && <span className="rf-expand">+</span>}
            {data.expanding && <span className="rf-loading" />}
          </div>
          {data.context && (
            <span
              className={`rf-ctx ${data.context}`}
              title={data.context === 'familia' ? 'Vínculo familiar' : 'Parte em processo judicial'}
            >
              {data.context === 'familia' ? <HeartIcon /> : <ScaleIcon />}
            </span>
          )}
        </div>
        <div className={`rf-label ${data.main ? 'main' : ''}`}>
          <strong>{data.label}</strong>
          {data.subLabel && <span>{data.subLabel}</span>}
          {data.idLabel && <small>{data.idLabel}</small>}
          {data.role && <em>{data.role}</em>}
        </div>
      </div>
    </div>
  );
});
EntityNode.displayName = 'EntityNode';
