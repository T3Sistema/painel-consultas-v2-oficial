import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGraphStore } from '../store/graphStore';
import { deleteSavedQuery, getSavedQuery, listSavedQueries, type SavedQuerySummary } from '../services/savedQueries';
import { formatCNPJ, formatCPF, formatDate, normalizeText, onlyDigits } from '../lib/format';
import { SpotlightCard } from './home/HomeParts';
import { CountUp } from './painel/MotionBits';

function BookmarkIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 21V5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v16" />
      <path d="M14 10h5a1 1 0 0 1 1 1v10" />
      <path d="M9 8h.01M9 12h.01M9 16h.01" />
      <path d="M4 21h16" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
    </svg>
  );
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function Spinner() {
  return <span className="vault-spinner" aria-hidden="true" />;
}

function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" />
    </svg>
  );
}

/** Documento da raiz: CPF (consulta por pessoa) ou CNPJ. */
function docOf(raw: string): { kind: 'cpf' | 'cnpj'; label: string } {
  const d = onlyDigits(raw);
  return d.length === 11 ? { kind: 'cpf', label: formatCPF(d) } : { kind: 'cnpj', label: formatCNPJ(raw) };
}

const DAY = 86400000;

/**
 * Agrupa por recência (dias de calendário, no fuso de quem está vendo) — só
 * para organizar a lista; a ordem original é mantida dentro do grupo.
 */
export function groupOf(iso: string, now = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return 'Mais antigas';
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days <= 0) return 'Hoje';
  if (days < 7) return 'Últimos 7 dias';
  if (days < 30) return 'Últimos 30 dias';
  return 'Mais antigas';
}
const GROUP_ORDER = ['Hoje', 'Últimos 7 dias', 'Últimos 30 dias', 'Mais antigas'];

/**
 * Tela "Consultas salvas" ("cofre"): listar (com busca), abrir (hidrata o
 * grafo sem consultar nada de novo) e excluir. Cartões agrupados por
 * recência, com entrada em cascata e saída desintegrando ao excluir.
 */
export function SavedQueriesList({ onBack }: { onBack: () => void }) {
  const hydrateFromSnapshot = useGraphStore((s) => s.hydrateFromSnapshot);

  const [items, setItems] = useState<SavedQuerySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listSavedQueries();
        if (!cancelled) setItems(list);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Falha ao carregar consultas salvas.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = normalizeText(query.trim());
    if (!q) return items;
    const qDigits = onlyDigits(query);
    return items.filter((item) => {
      const title = item.titulo?.trim() || item.cnpj_raiz;
      if (normalizeText(title).includes(q)) return true;
      if (qDigits && onlyDigits(item.cnpj_raiz).includes(qDigits)) return true;
      return false;
    });
  }, [items, query]);

  const groups = useMemo(() => {
    const map = new Map<string, SavedQuerySummary[]>();
    for (const it of filtered) {
      const g = groupOf(it.created_at);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(it);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => [g, map.get(g)!] as const);
  }, [filtered]);

  const people = items.filter((i) => onlyDigits(i.cnpj_raiz).length === 11).length;
  const latest = items.reduce<string | undefined>((m, i) => (!m || i.created_at > m ? i.created_at : m), undefined);

  const handleOpen = async (id: string) => {
    setOpeningId(id);
    setError(null);
    try {
      const detail = await getSavedQuery(id);
      hydrateFromSnapshot(detail.snapshot, detail.photoUrlsByPersonId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao abrir a consulta.');
    } finally {
      setOpeningId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Excluir esta consulta salva? Esta ação não pode ser desfeita.')) return;
    setDeletingId(id);
    try {
      await deleteSavedQuery(id);
      setItems((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao excluir a consulta.');
    } finally {
      setDeletingId(null);
    }
  };

  let cardIndex = 0;
  const ease = [0.2, 0.9, 0.3, 1] as const;

  return (
    <div className="vault">
      <motion.button
        type="button"
        onClick={onBack}
        className="vault-back"
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M15 6l-6 6 6 6" />
        </svg>
        Voltar para consultas
      </motion.button>

      <motion.header
        className="vault-head"
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease }}
      >
        <div className="vault-title-wrap">
          <span className="vault-emblem" aria-hidden="true">
            <span className="vault-emblem-ring" />
            <BookmarkIcon size={22} />
          </span>
          <div>
            <h1 className="vault-title">Consultas salvas</h1>
            <p className="vault-sub">
              {items.length === 0
                ? 'Suas consultas guardadas para acesso rápido aparecem aqui.'
                : `${items.length} consulta${items.length === 1 ? '' : 's'} guardada${items.length === 1 ? '' : 's'} para acesso rápido.`}
            </p>
          </div>
        </div>

        {items.length > 0 && (
          <label className="vault-search">
            <span className="vault-search-beam" aria-hidden="true" />
            <span className="vault-search-inner">
              <SearchIcon />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nome ou CNPJ"
                aria-label="Buscar consultas salvas"
              />
              {query && (
                <span className="vault-search-count">
                  {filtered.length}/{items.length}
                </span>
              )}
            </span>
          </label>
        )}
      </motion.header>

      {!loading && items.length > 0 && (
        <motion.div
          className="vault-stats"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15, ease }}
        >
          <div className="vault-stat">
            <b>
              <CountUp value={items.length} />
            </b>
            <small>consultas no cofre</small>
          </div>
          <div className="vault-stat">
            <b>
              <CountUp value={items.length - people} />
            </b>
            <small>por CNPJ</small>
          </div>
          <div className="vault-stat">
            <b>
              <CountUp value={people} />
            </b>
            <small>por CPF</small>
          </div>
          {latest && (
            <div className="vault-stat">
              <b className="mono">{formatDate(latest)}</b>
              <small>última salva</small>
            </div>
          )}
        </motion.div>
      )}

      <AnimatePresence>
        {error && (
          <motion.p className="home-alert error" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {error}
          </motion.p>
        )}
      </AnimatePresence>

      {loading && (
        <ul className="vault-grid">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="vault-skeleton" aria-hidden="true" />
          ))}
        </ul>
      )}

      {!loading && filtered.length === 0 && (
        <motion.div className="vault-empty" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5, ease }}>
          <span className="vault-empty-icon">
            <span className="vault-emblem-ring" />
            <BookmarkIcon size={24} />
          </span>
          <div>
            <p className="vault-empty-title">{query ? 'Nenhuma consulta encontrada' : 'Nenhuma consulta salva ainda'}</p>
            <p className="vault-empty-sub">
              {query
                ? 'Tente buscar por outro nome ou CNPJ.'
                : 'Suas consultas salvas vão aparecer aqui para você acessar rapidamente depois.'}
            </p>
          </div>
          {!query && (
            <button type="button" onClick={onBack} className="vault-cta">
              <SearchIcon />
              Fazer uma nova consulta
            </button>
          )}
        </motion.div>
      )}

      {!loading &&
        groups.map(([group, list]) => (
          <section key={group} className="vault-group">
            <h2 className="vault-group-title">
              <i />
              {group}
              <span>{list.length}</span>
            </h2>
            <ul className="vault-grid">
              <AnimatePresence initial={true}>
                {list.map((item) => {
                  const doc = docOf(item.cnpj_raiz);
                  const i = cardIndex++;
                  const opening = openingId === item.id;
                  return (
                    <motion.li
                      key={item.id}
                      layout
                      initial={{ opacity: 0, y: 22, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9, filter: 'blur(8px)' }}
                      transition={{ duration: 0.45, delay: Math.min(i * 0.05, 0.5), ease }}
                    >
                      <SpotlightCard className={`vault-card ${opening ? 'is-opening' : ''}`}>
                        <span className={`vault-card-icon ${doc.kind}`}>{doc.kind === 'cpf' ? <PersonIcon /> : <BuildingIcon />}</span>
                        <div className="vault-card-body">
                          <p className="vault-card-title">{item.titulo?.trim() || doc.label}</p>
                          <p className="vault-card-meta">
                            <span className="mono">{doc.label}</span>
                            <span aria-hidden>•</span>
                            <span>Salvo em {formatDate(item.created_at)}</span>
                          </p>
                        </div>
                        <div className="vault-card-actions">
                          <button
                            type="button"
                            disabled={opening}
                            onClick={() => void handleOpen(item.id)}
                            className="vault-open"
                          >
                            {opening ? <Spinner /> : <OpenIcon />}
                            {opening ? 'Abrindo…' : 'Abrir'}
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === item.id}
                            onClick={() => void handleDelete(item.id)}
                            className="vault-delete"
                          >
                            <TrashIcon />
                            Excluir
                          </button>
                        </div>
                        {opening && <span className="vault-card-progress" aria-hidden="true" />}
                      </SpotlightCard>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          </section>
        ))}
    </div>
  );
}
