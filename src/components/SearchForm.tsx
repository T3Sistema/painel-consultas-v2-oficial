import { ChangeEvent, FormEvent, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGraphStore } from '../store/graphStore';
import { caretPositionForDigitCount, isValidCNPJ, isValidCPF, maskCNPJ, maskCPF, onlyDigits, formatDate } from '../lib/format';
import { applyMask } from '../lib/mask';
import { listSavedQueries, getSavedQuery, type SavedQuerySummary } from '../services/savedQueries';
import { LogoCore, SpotlightCard, Typewriter } from './home/HomeParts';
import { CountUp } from './painel/MotionBits';

const LOCKED_TABS = ['SMS', 'Placa', 'Email', 'Nome'];

const RECENT_LIMIT = 5;

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <path d="M3 3l18 18" />}
    </svg>
  );
}

/** "Consultas recentes": nomes mascarados por padrão, alterna com o botão "Ocultas"/"Reveladas". */
function RecentQueries({ onOpenAll }: { onOpenAll?: () => void }) {
  const hydrateFromSnapshot = useGraphStore((s) => s.hydrateFromSnapshot);
  const [items, setItems] = useState<SavedQuerySummary[] | null>(null);
  const [hidden, setHidden] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSavedQueries()
      .then((list) => {
        if (!cancelled) setItems(list.slice(0, RECENT_LIMIT));
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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

  return (
    <motion.section
      className="home-recent"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 1.05, ease: [0.2, 0.9, 0.3, 1] }}
    >
      <div className="home-recent-head">
        <span className="home-kicker">
          <i />
          Consultas recentes
        </span>
        <button type="button" onClick={() => setHidden((h) => !h)} className="home-ghost-btn">
          <EyeIcon crossed={hidden} />
          {hidden ? 'Ocultas' : 'Reveladas'}
        </button>
      </div>

      {error && <p className="home-recent-error">{error}</p>}

      <ul className="home-recent-list">
        {items === null &&
          [0, 1, 2].map((i) => (
            <li key={i} className="home-skeleton" aria-hidden="true">
              <span />
            </li>
          ))}
        {items === null && <li className="sr-only">Carregando…</li>}
        {items?.length === 0 && <li className="home-recent-empty">Nenhuma consulta recente.</li>}
        {items?.map((item, i) => {
          const label = item.titulo?.trim() || item.cnpj_raiz;
          return (
            <motion.li
              key={item.id}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.35, delay: 0.05 * i }}
            >
              <button
                type="button"
                onClick={() => void handleOpen(item.id)}
                disabled={openingId === item.id}
                className="home-recent-item"
              >
                <span className="home-recent-dot" aria-hidden="true" />
                <span className="home-recent-label">{applyMask(label, 'soft', !hidden)}</span>
                <span className="home-recent-date">{openingId === item.id ? 'Abrindo…' : formatDate(item.created_at)}</span>
                <svg className="home-recent-arrow" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </motion.li>
          );
        })}
      </ul>

      {onOpenAll && (
        <button type="button" onClick={onOpenAll} className="home-all-btn">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 4h16v16H4z" />
            <path d="M8 4v16M4 9h4" />
          </svg>
          Ver todas as consultas salvas
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.5" className="home-all-arrow">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      )}
    </motion.section>
  );
}

const PHRASES = [
  'Mapeie empresas, sócios e conexões em segundos.',
  'Siga as pessoas. Siga as empresas. Veja o que liga uma à outra.',
  'Processos, parentes e participações num único mapa.',
  'Do CNPJ ao dossiê completo, camada por camada.',
];

const FEATURES = [
  {
    title: 'Mapa societário',
    text: 'Empresas, sócios e participações revelados em camadas.',
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <circle cx="4.5" cy="6" r="2" />
        <circle cx="19.5" cy="6" r="2" />
        <circle cx="12" cy="20.5" r="2" />
        <path d="M6.2 7.2 9.6 10.4M17.8 7.2l-3.4 3.2M12 15v3.5" />
      </>
    ),
  },
  {
    title: 'Rede judicial e familiar',
    text: 'Processos, contrapartes e parentes ligados direto no mapa.',
    icon: <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0L5 7Zm14 0-3 6a3 3 0 0 0 6 0l-3-6Z" />,
  },
  {
    title: 'Dossiê completo',
    text: 'Cadastro, contatos, score e histórico num só lugar.',
    icon: (
      <>
        <rect x="4" y="3" width="16" height="18" rx="2.5" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </>
    ),
  },
];

/** Anel que se preenche conforme os dígitos são digitados (verde quando o documento é válido). */
function DigitsRing({ count, total, state }: { count: number; total: number; state: 'idle' | 'ok' | 'bad' }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className={`digits-ring ${state}`} aria-hidden="true">
      <svg viewBox="0 0 36 36" width="36" height="36">
        <circle cx="18" cy="18" r={r} className="digits-track" />
        <circle
          cx="18"
          cy="18"
          r={r}
          className="digits-fill"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - count / total)}
        />
      </svg>
      {state === 'ok' ? (
        <svg className="digits-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.8">
          <path d="m5 12 5 5 9-10" />
        </svg>
      ) : (
        <svg className="digits-icon" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-4-4" />
        </svg>
      )}
    </span>
  );
}

export function SearchForm({ onOpenSavedQueries }: { onOpenSavedQueries?: () => void }) {
  const startSearch = useGraphStore((s) => s.startSearch);
  const startPersonSearch = useGraphStore((s) => s.startPersonSearch);
  const retryFailedSearchProfiles = useGraphStore((s) => s.retryFailedSearchProfiles);
  const continueWithAvailableData = useGraphStore((s) => s.continueWithAvailableData);
  const error = useGraphStore((s) => s.error);
  const searchPhase = useGraphStore((s) => s.searchPhase);
  const searchProfilesTotal = useGraphStore((s) => s.searchProfilesTotal);
  const searchFailedCpfs = useGraphStore((s) => s.searchFailedCpfs);
  const maxDepth = useGraphStore((s) => s.maxDepth);
  const setMaxDepth = useGraphStore((s) => s.setMaxDepth);
  const [mode, setMode] = useState<'cnpj' | 'cpf'>('cnpj');
  const [cnpj, setCnpj] = useState('');
  const [cpf, setCpf] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // "/" ou Ctrl/⌘+K levam direto ao campo de busca
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      if ((e.key === '/' && !typing) || (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const switchMode = (m: 'cnpj' | 'cpf') => {
    setMode(m);
    setValidationError(null);
  };

  // Reformata a cada tecla (maskCNPJ/maskCPF) mas devolve o cursor pro lugar
  // certo — sem isso, apagar/editar um dígito no meio do texto reposiciona
  // o cursor pro fim a cada tecla (o React troca o `value` todo e o
  // navegador não sabe onde ele "deveria" continuar).
  const handleMaskedChange = (mask: (v: string) => string, setValue: (v: string) => void) => (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const selStart = input.selectionStart ?? input.value.length;
    const digitsBeforeCursor = onlyDigits(input.value.slice(0, selStart)).length;
    const masked = mask(input.value);
    setValue(masked);
    requestAnimationFrame(() => {
      const pos = caretPositionForDigitCount(masked, digitsBeforeCursor);
      input.setSelectionRange(pos, pos);
    });
  };

  const fail = (msg: string) => {
    setValidationError(msg);
    setShake((n) => n + 1);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === 'cnpj') {
      const digits = onlyDigits(cnpj);
      if (digits.length !== 14) {
        fail('Informe um CNPJ com 14 dígitos.');
        return;
      }
      if (!isValidCNPJ(digits)) {
        fail('CNPJ inválido (dígitos verificadores não conferem).');
        return;
      }
      setValidationError(null);
      void startSearch(digits);
    } else {
      const digits = onlyDigits(cpf);
      if (digits.length !== 11) {
        fail('Informe um CPF com 11 dígitos.');
        return;
      }
      if (!isValidCPF(digits)) {
        fail('CPF inválido (dígitos verificadores não conferem).');
        return;
      }
      setValidationError(null);
      void startPersonSearch(digits);
    }
  };

  const value = mode === 'cnpj' ? cnpj : cpf;
  const digits = onlyDigits(value).length;
  const total = mode === 'cnpj' ? 14 : 11;
  const complete = digits === total;
  const valid = complete && (mode === 'cnpj' ? isValidCNPJ(onlyDigits(value)) : isValidCPF(onlyDigits(value)));
  const ringState: 'idle' | 'ok' | 'bad' = !complete ? 'idle' : valid ? 'ok' : 'bad';
  const tabs: { id: 'cnpj' | 'cpf'; label: string }[] = [
    { id: 'cnpj', label: 'CNPJ' },
    { id: 'cpf', label: 'Consulta Avançada' },
  ];
  const ease = [0.2, 0.9, 0.3, 1] as const;

  return (
    <div className="home-main">
      <motion.div
        className="home-hero"
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.9, ease }}
      >
        <LogoCore />

        <motion.div
          className="home-badge"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.35 }}
        >
          <i />
          Inteligência societária · judicial · cadastral
        </motion.div>

        <h1 className="home-title" data-text="PAINEL DE CONSULTAS">
          PAINEL DE CONSULTAS
        </h1>

        <Typewriter phrases={PHRASES} className="home-sub" />
      </motion.div>

      <motion.div
        className="home-tabs"
        role="group"
        aria-label="Tipo de consulta"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.45, ease }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => switchMode(t.id)}
            className={`home-tab ${mode === t.id ? 'active' : ''}`}
          >
            {mode === t.id && <motion.span layoutId="home-tab-pill" className="home-tab-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
            <span className="home-tab-text">{t.label}</span>
          </button>
        ))}
        <span className="home-tabs-sep" aria-hidden="true" />
        {LOCKED_TABS.map((tab) => (
          <span key={tab} className="home-tab locked" title="Em breve">
            <span>{tab}</span>
            <LockIcon />
          </span>
        ))}
      </motion.div>

      <motion.form
        onSubmit={submit}
        className="home-form"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.55, ease }}
      >
        <motion.div
          key={shake}
          className={`home-search ${focused ? 'is-focused' : ''} ${ringState}`}
          animate={shake ? { x: [0, -12, 11, -8, 6, -3, 0] } : undefined}
          transition={{ duration: 0.45 }}
        >
          <span className="home-search-beam" aria-hidden="true" />
          <div className="home-search-inner">
            <DigitsRing count={digits} total={total} state={ringState} />
            {mode === 'cnpj' ? (
                <motion.input
                  key="cnpj"
                  ref={inputRef}
                  id="cnpj"
                  value={cnpj}
                  onChange={handleMaskedChange(maskCNPJ, setCnpj)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="00.000.000/0000-00"
                  inputMode="numeric"
                  autoComplete="off"
                  className="home-input"
                  autoFocus
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                />
              ) : (
                <motion.input
                  key="cpf"
                  ref={inputRef}
                  id="cpf"
                  value={cpf}
                  onChange={handleMaskedChange(maskCPF, setCpf)}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  placeholder="000.000.000-00"
                  inputMode="numeric"
                  autoComplete="off"
                  className="home-input"
                  autoFocus
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                />
              )}
            <span className={`home-count ${ringState}`} aria-hidden="true">
              {digits}/{total}
            </span>
            <button type="submit" className="home-go">
              <span className="home-go-shine" aria-hidden="true" />
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
              </svg>
              Buscar
            </button>
          </div>
        </motion.div>

        <div className="home-meta">
          <span className="home-stat">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 17l6-6 4 4 8-8M21 3h-6M21 3v6" />
            </svg>
            <b>
              <CountUp value={67} format={(v) => `+${Math.round(v)}M`} duration={1600} delay={700} />
            </b>
            empresas homologadas
          </span>
          <span className="home-meta-sep" />
          <span className="home-stat">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <ellipse cx="12" cy="5" rx="8" ry="3" />
              <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
            </svg>
            <b>
              <CountUp value={1} format={(v) => `+${Math.max(0, Math.round(v))}M`} duration={1200} delay={900} />
            </b>
            requisições diárias
          </span>
          <span className="home-meta-sep" />
          <label htmlFor="maxDepth" className="home-depth">
            Limite de níveis
            <select
              id="maxDepth"
              value={maxDepth === Infinity ? 'inf' : maxDepth}
              onChange={(e) => setMaxDepth(e.target.value === 'inf' ? Infinity : Number(e.target.value))}
            >
              <option value={3}>3 níveis</option>
              <option value={5}>5 níveis</option>
              <option value={10}>10 níveis</option>
              <option value="inf">Ilimitado</option>
            </select>
          </label>
          <span className="home-kbd" aria-hidden="true">
            <kbd>/</kbd> para buscar
          </span>
        </div>

        <AnimatePresence>
          {(validationError || error) && (
            <motion.p
              className="home-alert error"
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              {validationError ?? error}
            </motion.p>
          )}
        </AnimatePresence>

        {searchPhase === 'awaiting-decision' && (
          <div className="home-alert warn">
            <p>
              {searchFailedCpfs.length} de {searchProfilesTotal} perfil(is) não puderam ser carregados agora. O mapa
              ainda não foi aberto.
            </p>
            <div className="home-alert-actions">
              <button type="button" onClick={() => void retryFailedSearchProfiles()} className="home-alert-primary">
                Tentar novamente
              </button>
              <button type="button" onClick={continueWithAvailableData} className="home-alert-secondary">
                Continuar com os dados disponíveis
              </button>
            </div>
          </div>
        )}
      </motion.form>

      <div className="home-features">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, y: 26 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.75 + i * 0.1, ease }}
          >
            <SpotlightCard className="home-feature">
              <span className="home-feature-icon">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {f.icon}
                </svg>
              </span>
              <b>{f.title}</b>
              <small>{f.text}</small>
            </SpotlightCard>
          </motion.div>
        ))}
      </div>

      <RecentQueries onOpenAll={onOpenSavedQueries} />
    </div>
  );
}
