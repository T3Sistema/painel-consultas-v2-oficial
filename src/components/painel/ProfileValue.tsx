import { useEffect, useRef, useState, type ReactNode } from 'react';
import { applyMask, type MaskClass } from '../../lib/mask';
import {
  MAX_RENDER_DEPTH,
  classifyLeaf,
  decodeBase64ToBlob,
  formatApproxSize,
  formatScalarValue,
  humanizeKey,
  truncateItems,
} from '../../lib/profileRender';
import { normalizeText } from '../../lib/format';
import { prefersReducedMotion } from '../../lib/motion';

/**
 * Primitivas de renderização de valor do perfil da APIFull, compartilhadas
 * entre o painel em accordion (`PersonProfilePanel`) e a visão em cartões de
 * tela cheia (`EntityDetail`). Concentrar aqui garante que as regras de
 * segurança (mascaramento, Base64 nunca cru, imagem só via miniatura) sejam
 * as mesmas nas duas visões — ver também `classifyLeaf` em profileRender.
 */

export function countRecords(value: unknown): number | undefined {
  if (Array.isArray(value)) return value.length;
  if (value !== null && typeof value === 'object') return Object.keys(value).length;
  return undefined;
}

export function categoryRecordCount(entries: [string, unknown][]): number {
  return entries.reduce((sum, [, v]) => sum + (countRecords(v) ?? 1), 0);
}

/** Realce discreto do trecho encontrado — só o primeiro match, sem HTML perigoso (texto React puro). */
export function highlightMatch(text: string, query: string): ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/** Busca recursiva por nome de campo/valor textual — mesmo limite de profundidade da renderização. */
export function valueMatchesQuery(value: unknown, query: string, depth = 0): boolean {
  if (depth > MAX_RENDER_DEPTH) return false;
  if (value == null) return false;
  if (typeof value === 'string') return normalizeText(value).includes(query);
  if (typeof value === 'number' || typeof value === 'boolean') return normalizeText(String(value)).includes(query);
  if (Array.isArray(value)) return value.some((v) => valueMatchesQuery(v, query, depth + 1));
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => normalizeText(k).includes(query) || valueMatchesQuery(v, query, depth + 1),
    );
  }
  return false;
}

export function entryMatchesQuery(key: string, value: unknown, query: string): boolean {
  return normalizeText(key).includes(query) || valueMatchesQuery(value, query);
}

/**
 * Base64/documento grande: nunca renderizado como texto cru. Só decodifica e
 * cria um Blob URL quando o usuário clica em "Visualizar" — o URL é revogado
 * ao trocar de documento ou desmontar, nunca persiste em storage. Se o
 * conteúdo for imagem, abre no lightbox; caso contrário (PDF etc.), abre em
 * nova aba.
 */
export function DocumentValue({ base64, onOpenImage }: { base64: string; onOpenImage: (url: string) => void }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <span className="profile-doc">
      <span>Documento disponível ({formatApproxSize(base64.length)})</span>
      <button
        type="button"
        className="btn plain"
        onClick={() => {
          const blob = decodeBase64ToBlob(base64);
          const url = URL.createObjectURL(blob);
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
          if (blob.type.startsWith('image/')) {
            onOpenImage(url);
          } else {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        }}
      >
        Visualizar
      </button>
    </span>
  );
}

/** URL http(s) de imagem: miniatura clicável (lazy, fallback de erro), nunca texto cru. */
export function ImageUrlValue({ url, alt, onOpen }: { url: string; alt: string; onOpen: (url: string) => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className="profile-row-value">Imagem indisponível</span>;
  }
  return (
    <button type="button" className="profile-image-thumb" onClick={() => onOpen(url)} aria-label={`Ampliar imagem: ${alt}`}>
      <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
    </button>
  );
}

/** Ícone de olho (aberto/fechado) do botão de revelar — só indicação visual, ver `MaskedValue`. */
function EyeIcon({ open }: { open: boolean }) {
  if (!open) {
    return (
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path
        d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.6 19.6 0 0 1 5.06-5.94M9.9 5.1A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a19.5 19.5 0 0 1-2.27 3.34"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1 1l22 22" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Campos "soft" mascaram por padrão com botão de revelar (ícone de olho) —
 * conveniência de UI, não controle de acesso (ver README). Campos "hard"
 * nunca mostram o botão — `applyMask` já garante isso independente do
 * estado local.
 */
const SCRAMBLE_CHARS = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ#$%&@*';
const SCRAMBLE_FRAMES = 14;

export function MaskedValue({ value, cls }: { value: string; cls: MaskClass }) {
  const [revealed, setRevealed] = useState(false);
  // durante a revelação, os caracteres "descriptografam" da esquerda para a direita
  const [scramble, setScramble] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const toggle = () => {
    const next = !revealed;
    setRevealed(next);
    clearTimeout(timer.current);
    setScramble(null);
    if (!next || cls !== 'soft' || prefersReducedMotion()) return;
    const target = applyMask(value, cls, true);
    let frame = 0;
    const tick = () => {
      frame += 1;
      if (frame >= SCRAMBLE_FRAMES) {
        setScramble(null);
        return;
      }
      const solved = Math.floor((target.length * frame) / SCRAMBLE_FRAMES);
      setScramble(
        Array.from(target, (c, i) =>
          i < solved || /[\s.\-/@()]/.test(c) ? c : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)],
        ).join(''),
      );
      timer.current = setTimeout(tick, 32);
    };
    tick();
  };

  return (
    <span className={`profile-masked ${scramble ? 'is-decrypting' : ''}`}>
      <span className="pm-text">
        {/* o valor real entra na hora (leitores de tela, busca, cópia); o embaralhado é só visual */}
        <span className="pm-real">{applyMask(value, cls, revealed)}</span>
        {scramble && (
          <span className="pm-scramble" aria-hidden="true">
            {scramble}
          </span>
        )}
      </span>
      {cls === 'soft' && (
        <button
          type="button"
          className="profile-reveal"
          onClick={toggle}
          aria-label={revealed ? 'Ocultar valor' : 'Revelar valor'}
          title={revealed ? 'Ocultar' : 'Revelar'}
        >
          <EyeIcon open={revealed} />
        </button>
      )}
    </span>
  );
}

/**
 * Renderiza apenas a FOLHA de um valor (imagem/documento/mascarado/escalar),
 * já com realce de busca. Retorna `null` quando o valor é um container
 * (array/objeto) — nesse caso o chamador percorre a estrutura. Fonte única
 * das decisões de exibição segura, via `classifyLeaf`.
 */
export function ProfileLeafValue({
  keyName,
  label,
  value,
  query,
  onOpenImage,
  containerKey,
}: {
  keyName: string;
  label: string;
  value: unknown;
  query: string;
  onOpenImage: (url: string) => void;
  containerKey?: string;
}): ReactNode | null {
  const leaf = classifyLeaf(keyName, value, containerKey);
  if (!leaf) return null;
  switch (leaf.kind) {
    case 'image':
      return <ImageUrlValue url={leaf.url} alt={label} onOpen={onOpenImage} />;
    case 'document':
      return <DocumentValue base64={leaf.base64} onOpenImage={onOpenImage} />;
    case 'masked':
      return <MaskedValue value={leaf.value} cls={leaf.cls} />;
    case 'text':
      return <span className="profile-row-value">{highlightMatch(leaf.value, query)}</span>;
  }
}

/**
 * Árvore genérica em accordion (usada pelo `PersonProfilePanel`). Mantida com
 * a mesma estrutura de DOM/classes de antes — só as folhas passam a vir de
 * `ProfileLeafValue`, single-source com a visão em cartões.
 */
export function RenderValue({
  label,
  keyName,
  value,
  depth,
  query,
  onOpenImage,
}: {
  label: string;
  keyName: string;
  value: unknown;
  depth: number;
  query: string;
  onOpenImage: (url: string) => void;
}) {
  if (depth > MAX_RENDER_DEPTH) {
    return (
      <div className="profile-row">
        <span>{highlightMatch(label, query)}</span>
        <span className="profile-row-value">…</span>
      </div>
    );
  }

  const leaf = ProfileLeafValue({ keyName, label, value, query, onOpenImage });
  if (leaf !== null) {
    return (
      <div className="profile-row">
        <span>{highlightMatch(label, query)}</span>
        {leaf}
      </div>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="profile-row">
          <span>{highlightMatch(label, query)}</span>
          <span className="profile-row-value">Nenhum registro encontrado</span>
        </div>
      );
    }
    const { visible, hiddenCount } = truncateItems(value);
    return (
      <div className="profile-array">
        {visible.map((item, i) => (
          <div className="profile-array-item" key={i}>
            <RenderValue
              label={`#${i + 1}`}
              keyName={keyName}
              value={item}
              depth={depth + 1}
              query={query}
              onOpenImage={onOpenImage}
            />
          </div>
        ))}
        {hiddenCount > 0 && <p className="profile-more">+{hiddenCount} mais</p>}
      </div>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return (
      <div className="profile-row">
        <span>{highlightMatch(label, query)}</span>
        <span className="profile-row-value">Nenhum registro encontrado</span>
      </div>
    );
  }
  return (
    <div className="profile-object">
      {entries.map(([k, v]) => (
        <RenderValue key={k} label={k} keyName={k} value={v} depth={depth + 1} query={query} onOpenImage={onOpenImage} />
      ))}
    </div>
  );
}

// ─── Visão em cartões (tela cheia) ─────────────────────────────────────────

/** Um valor escalar dentro de um cartão — folha segura, ou fallback textual. */
function CardScalar({
  keyName,
  label,
  value,
  query,
  onOpenImage,
  containerKey,
}: {
  keyName: string;
  label: string;
  value: unknown;
  query: string;
  onOpenImage: (url: string) => void;
  containerKey?: string;
}) {
  const leaf = ProfileLeafValue({ keyName, label, value, query, onOpenImage, containerKey });
  return leaf ?? <span className="profile-row-value">{highlightMatch(formatScalarValue(keyName, value), query)}</span>;
}

const isLeafEntry = ([k, v]: [string, unknown]) => classifyLeaf(k, v) !== null;

/**
 * Renderiza uma lista de entradas [chave, valor] como conteúdo de uma página
 * em cartões: escalares viram cartões rotulados numa grade; objetos e arrays
 * viram sub-seções tituladas (recursivas). Toda folha passa pelas mesmas
 * primitivas seguras acima.
 */
export function ProfileCardEntries({
  entries,
  query,
  onOpenImage,
  depth = 0,
  containerKey,
}: {
  entries: [string, unknown][];
  query: string;
  onOpenImage: (url: string) => void;
  depth?: number;
  /** Chave do array/objeto que envolve estas entradas (ex.: "fotos") — repassada só até as folhas escalares, para reconhecer `{ url: "..." }` dentro de uma coleção de fotos. */
  containerKey?: string;
}) {
  if (depth > MAX_RENDER_DEPTH) {
    return <p className="ef-empty">…</p>;
  }
  const scalars = entries.filter(isLeafEntry);
  const groups = entries.filter((e) => !isLeafEntry(e));

  return (
    <>
      {scalars.length > 0 && (
        <div className="ef-grid">
          {scalars.map(([k, v]) => (
            <div className="ef-card" key={k}>
              <span className="ef-card-label">{highlightMatch(humanizeKey(k), query)}</span>
              <div className="ef-card-value">
                <CardScalar keyName={k} label={humanizeKey(k)} value={v} query={query} onOpenImage={onOpenImage} containerKey={containerKey} />
              </div>
            </div>
          ))}
        </div>
      )}
      {groups.map(([k, v]) => (
        <ProfileCardGroup key={k} name={humanizeKey(k)} keyName={k} value={v} query={query} onOpenImage={onOpenImage} depth={depth} />
      ))}
    </>
  );
}

/**
 * Corpo de um valor (array/objeto/escalar) renderizado em cartões, SEM título —
 * reaproveitado pela sub-seção titulada (`ProfileCardGroup`) e pelas seções
 * genéricas do schema (`ProfileSections`). Arrays de escalares viram chips;
 * arrays de objetos viram "records"; objetos viram uma grade de campos.
 */
export function ProfileValueBlock({
  keyName,
  value,
  query,
  onOpenImage,
  depth = 0,
}: {
  keyName: string;
  value: unknown;
  query: string;
  onOpenImage: (url: string) => void;
  depth?: number;
}) {
  if (depth > MAX_RENDER_DEPTH) return <p className="ef-empty">…</p>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="ef-empty">Nenhum registro encontrado</p>;
    const { visible, hiddenCount } = truncateItems(value);
    const allScalars = visible.every((item) => classifyLeaf(keyName, item) !== null);
    return (
      <>
        {allScalars ? (
          <div className="ef-chips">
            {visible.map((item, i) => (
              <span className="ef-chip" key={i}>
                <CardScalar keyName={keyName} label={keyName} value={item} query={query} onOpenImage={onOpenImage} />
              </span>
            ))}
          </div>
        ) : (
          <div className="ef-records">
            {visible.map((item, i) => (
              <div className="ef-record" key={i}>
                {classifyLeaf(keyName, item) !== null ? (
                  <div className="ef-card-value">
                    <CardScalar keyName={keyName} label={keyName} value={item} query={query} onOpenImage={onOpenImage} />
                  </div>
                ) : (
                  <ProfileCardEntries
                    entries={Object.entries(item as Record<string, unknown>)}
                    query={query}
                    onOpenImage={onOpenImage}
                    depth={depth + 1}
                    containerKey={keyName}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {hiddenCount > 0 && <p className="profile-more">+{hiddenCount} mais</p>}
      </>
    );
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <p className="ef-empty">Nenhum registro encontrado</p>;
    return <ProfileCardEntries entries={entries} query={query} onOpenImage={onOpenImage} depth={depth + 1} containerKey={keyName} />;
  }

  return (
    <div className="ef-card-value">
      <CardScalar keyName={keyName} label={keyName} value={value} query={query} onOpenImage={onOpenImage} />
    </div>
  );
}

/** Uma sub-seção titulada (objeto ou array) dentro de uma página. */
function ProfileCardGroup({
  name,
  keyName,
  value,
  query,
  onOpenImage,
  depth,
}: {
  name: string;
  keyName: string;
  value: unknown;
  query: string;
  onOpenImage: (url: string) => void;
  depth: number;
}) {
  const count = countRecords(value);
  return (
    <section className="ef-group">
      <h4 className="ef-group-title">
        {highlightMatch(name, query)}
        {count != null && <span className="ef-count">{count}</span>}
      </h4>
      <ProfileValueBlock keyName={keyName} value={value} query={query} onOpenImage={onOpenImage} depth={depth} />
    </section>
  );
}
