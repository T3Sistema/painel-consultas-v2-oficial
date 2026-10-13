import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGraphStore, companyId, personId } from '../../store/graphStore';
import {
  PROCESSO_KNOWN_KEYS,
  POLO_LABEL,
  buildCounterparties,
  collectSelfNames,
  extractProcessos,
  findSelf,
  judicialStats,
  processosDeclaredTotal,
  type Counterparty,
  type PoloKind,
  type Processo,
  type ProcessoParte,
} from '../../lib/judicial';
import { formatCNPJ, formatCompactCurrency, formatCurrency, formatDate, normalizeText } from '../../lib/format';
import type { SectionSpec } from '../../lib/profileSchema';
import { MaskedValue, ProfileCardEntries } from './ProfileValue';
import { ProfileSectionView, sectionHasContent } from './ProfileSections';
import { CountUp } from './MotionBits';

/**
 * Aba "Jurídico": cockpit (volume, valor em causa, posição da pessoa nos
 * processos), linha de ajuizamentos por ano, quem aparece contra/junto da
 * pessoa, advogados que a representaram e a lista completa de processos —
 * com filtro por polo, busca e ordenação. Todo campo de processo sem
 * leitura dedicada continua aparecendo no cartão ("outros campos").
 */

type Dict = Record<string, unknown>;
type PoloFilter = 'todos' | PoloKind;
type Sort = 'movimento' | 'valor' | 'ajuizamento';

const DAY = 86400000;

function relativeTime(iso?: string): string | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return undefined;
  const days = Math.floor((Date.now() - t) / DAY);
  if (days < 0) return undefined;
  if (days === 0) return 'hoje';
  if (days === 1) return 'ontem';
  if (days < 30) return `há ${days} dias`;
  const months = Math.floor(days / 30);
  if (months < 12) return `há ${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(days / 365);
  return `há ${years} ${years === 1 ? 'ano' : 'anos'}`;
}

const isRecent = (iso?: string) => !!iso && Date.now() - new Date(iso).getTime() < 30 * DAY;

/** CPF de terceiro fica mascarado (com "Revelar"); CNPJ é dado público e aparece formatado. */
function DocValue({ doc }: { doc?: string }) {
  if (!doc) return null;
  if (doc.length === 14) return <span className="jur-doc">{formatCNPJ(doc)}</span>;
  return (
    <span className="jur-doc">
      <MaskedValue value={doc} cls="soft" />
    </span>
  );
}

const Svg = ({ children, size = 18 }: { children: ReactNode; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const I = {
  scale: <path d="M12 3v18M7 21h10M5 7h14M5 7l-3 6a3 3 0 0 0 6 0L5 7Zm14 0-3 6a3 3 0 0 0 6 0l-3-6Z" />,
  money: (<><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.5 9.5c0-1 1-1.6 2.5-1.6s2.4.7 2.4 1.7c0 2.4-4.8 1.2-4.8 3.6 0 1 1 1.7 2.4 1.7s2.5-.6 2.5-1.6" /></>),
  shieldDown: (<><path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" /><path d="M12 8v6M9.5 11.5 12 14l2.5-2.5" /></>),
  sword: (<><path d="M14.5 4H20v5.5L10 19.5 4.5 14 14.5 4Z" /><path d="M4 20l3-3" /></>),
  pulse: <path d="M3 12h4l2-5 4 10 2-5h6" />,
  building: (<><path d="M4 21V7l8-4v18M12 9h8v12M2 21h20" /><path d="M7 10h2M7 14h2M15 13h2M15 17h2" /></>),
  person: (<><circle cx="12" cy="7" r="4" /><path d="M4 21c0-5 3.5-8 8-8s8 3 8 8" /></>),
  gavel: (<><path d="m14 4 6 6M11 7l6 6M12.5 5.5l5 5-3 3-5-5 3-3ZM9.5 10.5 3 17l2 2 6.5-6.5" /><path d="M3 21h9" /></>),
  copy: (<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>),
  check: <path d="m5 12 5 5 9-10" />,
  chevron: <path d="m6 9 6 6 6-6" />,
  map: (<><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>),
};

// ─── Cockpit ────────────────────────────────────────────────────────────────

function Kpi({ icon, label, children, tone, sub }: { icon: ReactNode; label: string; children: ReactNode; tone: string; sub?: ReactNode }) {
  return (
    <div className={`jur-kpi tone-${tone}`}>
      <span className="jur-kpi-icon"><Svg size={17}>{icon}</Svg></span>
      <span className="jur-kpi-value">{children}</span>
      <span className="jur-kpi-label">{label}</span>
      {sub && <span className="jur-kpi-sub">{sub}</span>}
    </div>
  );
}

function PoloBar({ porPolo }: { porPolo: Record<PoloKind | 'desconhecido', number> }) {
  const parts: { key: PoloKind | 'desconhecido'; label: string }[] = [
    { key: 'passivo', label: 'Polo passivo (réu / executado)' },
    { key: 'ativo', label: 'Polo ativo (autor / exequente)' },
    { key: 'outros', label: 'Outros participantes' },
    { key: 'desconhecido', label: 'Posição não identificada' },
  ];
  const total = parts.reduce((a, p) => a + porPolo[p.key], 0) || 1;
  return (
    <div className="jur-polo">
      <div className="jur-polo-bar">
        {parts.map((p, i) =>
          porPolo[p.key] > 0 ? (
            <motion.span
              key={p.key}
              className={`seg ${p.key}`}
              initial={{ width: 0 }}
              animate={{ width: `${(porPolo[p.key] / total) * 100}%` }}
              transition={{ duration: 0.9, delay: 0.25 + i * 0.12, ease: [0.2, 0.8, 0.2, 1] }}
              title={`${p.label}: ${porPolo[p.key]}`}
            />
          ) : null,
        )}
      </div>
      <div className="jur-polo-legend">
        {parts.map((p) =>
          porPolo[p.key] > 0 ? (
            <span key={p.key}>
              <i className={p.key} />
              {p.label}
              <b>{porPolo[p.key]}</b>
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

function YearBars({ porAno }: { porAno: { ano: number; count: number }[] }) {
  const max = Math.max(1, ...porAno.map((a) => a.count));
  return (
    <div className="jur-years" role="img" aria-label="Processos ajuizados por ano">
      {porAno.map((a, i) => (
        <div className="jur-year" key={a.ano} title={`${a.ano}: ${a.count} processo(s)`}>
          <span className="jur-year-count">{a.count > 0 ? a.count : ''}</span>
          <div className="jur-year-track">
            <motion.span
              className={`jur-year-bar ${a.count === max ? 'peak' : ''}`}
              initial={{ height: 0 }}
              animate={{ height: `${(a.count / max) * 100}%` }}
              transition={{ duration: 0.7, delay: 0.3 + i * 0.05, ease: [0.2, 1.2, 0.4, 1] }}
            />
          </div>
          <span className="jur-year-label">{String(a.ano).slice(2)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Contrapartes e advogados ───────────────────────────────────────────────

function nodeIdFor(c: Counterparty): string {
  if (c.pessoaJuridica) return c.documento ? companyId(c.documento) : `c:${c.key}`;
  return personId(c.documento ?? c.nome);
}

function Counterparties({ items, onGo }: { items: Counterparty[]; onGo: (id: string) => void }) {
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  const [showAll, setShowAll] = useState(false);
  const max = Math.max(1, ...items.map((c) => c.processos.length));
  const shown = showAll ? items : items.slice(0, 8);
  return (
    <section className="ef-section">
      <h3 className="ef-section-title">
        Quem aparece nos processos<span className="ef-count">{items.length}</span>
      </h3>
      <div className="jur-cps">
        {shown.map((c, i) => {
          const adverso = c.processos.filter((p) => p.relation === 'adverso').length;
          const coparte = c.processos.filter((p) => p.relation === 'coparte').length;
          const outros = c.processos.length - adverso - coparte;
          const id = nodeIdFor(c);
          const onMap = nodeIndex.has(id);
          return (
            <motion.div
              key={c.key}
              className="jur-cp"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, delay: Math.min(i * 0.04, 0.4) }}
            >
              <span className={`jur-cp-avatar ${c.pessoaJuridica ? 'pj' : 'pf'}`}>
                <Svg size={18}>{c.pessoaJuridica ? I.building : I.person}</Svg>
              </span>
              <div className="jur-cp-body">
                <strong>{c.nome}</strong>
                <small>
                  <DocValue doc={c.documento} />
                  {c.valorTotal > 0 && <span> · {formatCompactCurrency(c.valorTotal)} em causa</span>}
                </small>
                <div className="jur-cp-meter">
                  <motion.span
                    initial={{ width: 0 }}
                    animate={{ width: `${(c.processos.length / max) * 100}%` }}
                    transition={{ duration: 0.8, delay: 0.2 + Math.min(i * 0.04, 0.4) }}
                  />
                </div>
              </div>
              <div className="jur-cp-tags">
                {adverso > 0 && <span className="jur-tag adverso">{adverso}× contra</span>}
                {coparte > 0 && <span className="jur-tag coparte">{coparte}× mesmo lado</span>}
                {outros > 0 && <span className="jur-tag outros">{outros}× envolvido</span>}
              </div>
              {onMap && (
                <button type="button" className="jur-go" onClick={() => onGo(id)} title="Ver no mapa">
                  <Svg size={15}>{I.map}</Svg>
                  <span>Ver no mapa</span>
                </button>
              )}
            </motion.div>
          );
        })}
      </div>
      {items.length > 8 && (
        <button type="button" className="jur-more" onClick={() => setShowAll((v) => !v)}>
          {showAll ? 'Mostrar menos' : `Mostrar todos (${items.length})`}
        </button>
      )}
    </section>
  );
}

// ─── Cartão de processo ─────────────────────────────────────────────────────

function CopyNumber({ numero }: { numero: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`jur-num ${copied ? 'copied' : ''}`}
      onClick={() => {
        void navigator.clipboard?.writeText(numero).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        });
      }}
      title="Copiar número do processo"
    >
      <span>{numero}</span>
      <Svg size={13}>{copied ? I.check : I.copy}</Svg>
    </button>
  );
}

function ParteRow({ parte, isSelf }: { parte: ProcessoParte; isSelf: boolean }) {
  const rest = Object.entries(parte.raw).filter(
    ([k, v]) => !['nome', 'polo', 'documento', 'tipo_parte', 'tipo_pessoa', 'representantes'].includes(k) && v != null && v !== '',
  );
  return (
    <div className={`jur-parte ${isSelf ? 'self' : ''}`}>
      <span className={`jur-parte-icon ${parte.pessoaJuridica ? 'pj' : 'pf'}`}>
        <Svg size={14}>{parte.pessoaJuridica ? I.building : I.person}</Svg>
      </span>
      <div className="jur-parte-body">
        <strong>
          {parte.nome}
          {isSelf && <em className="jur-self">pessoa consultada</em>}
        </strong>
        <small>
          {parte.tipoParte && <span>{parte.tipoParte}</span>}
          <DocValue doc={parte.documento} />
        </small>
        {parte.representantes.length > 0 && (
          <ul className="jur-reps">
            {parte.representantes.map((r, i) => (
              <li key={`${r.nome}-${i}`}>
                <Svg size={12}>{I.gavel}</Svg>
                <span>{r.nome}</span>
                {r.oab && <b>OAB {r.oab}</b>}
                {r.cpf && <DocValue doc={r.cpf} />}
              </li>
            ))}
          </ul>
        )}
        {rest.length > 0 && (
          <div className="jur-extra">
            <ProfileCardEntries entries={rest} query="" onOpenImage={() => {}} />
          </div>
        )}
      </div>
    </div>
  );
}

function ProcessCard({ p, self, index, onOpenImage }: { p: Processo; self?: ProcessoParte; index: number; onOpenImage: (u: string) => void }) {
  const [open, setOpen] = useState(false);
  const polo = self?.polo;
  const groups: [PoloKind, ProcessoParte[]][] = (['ativo', 'passivo', 'outros'] as const)
    .map((k) => [k, p.partes.filter((x) => x.polo === k)] as [PoloKind, ProcessoParte[]])
    .filter(([, list]) => list.length > 0);
  const rest = Object.entries(p.raw).filter(([k, v]) => !PROCESSO_KNOWN_KEYS.includes(k) && v != null && v !== '');
  const recent = isRecent(p.ultimoMovimento?.data);

  return (
    <motion.article
      layout
      className={`jur-proc polo-${polo ?? 'na'}`}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.035, 0.35) }}
    >
      <header className="jur-proc-head">
        <div className="jur-proc-title">
          <h4>{p.classe ?? 'Processo'}</h4>
          {p.assunto && <p>{p.assunto}</p>}
        </div>
        <div className="jur-proc-value">
          {p.valor != null && p.valor > 0 ? formatCurrency(p.valor) : <span className="ef-muted">valor não informado</span>}
        </div>
      </header>
      <div className="jur-proc-chips">
        {polo && <span className={`jur-polo-chip ${polo}`}>{self?.tipoParte ?? POLO_LABEL[polo]}</span>}
        {p.tribunal && <span className="jur-chip">{p.tribunal}</span>}
        {p.ativo === false && <span className="jur-chip off">Inativo</span>}
        <CopyNumber numero={p.numero} />
      </div>
      <dl className="jur-proc-meta">
        {p.dataAjuizamento && (
          <div>
            <dt>Ajuizado em</dt>
            <dd>{formatDate(p.dataAjuizamento.slice(0, 10))}</dd>
          </div>
        )}
        {p.orgaoJulgador && (
          <div className="wide">
            <dt>Órgão julgador</dt>
            <dd>{p.orgaoJulgador}</dd>
          </div>
        )}
      </dl>
      {p.ultimoMovimento?.descricao && (
        <div className={`jur-mov ${recent ? 'recent' : ''}`}>
          <span className="jur-mov-dot" />
          <div>
            <b>{p.ultimoMovimento.descricao}</b>
            <small>
              {p.ultimoMovimento.data ? formatDate(p.ultimoMovimento.data.slice(0, 10)) : ''}
              {relativeTime(p.ultimoMovimento.data) ? ` · ${relativeTime(p.ultimoMovimento.data)}` : ''}
            </small>
          </div>
        </div>
      )}
      {(groups.length > 0 || rest.length > 0) && (
        <button type="button" className={`jur-toggle ${open ? 'open' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          Partes e representantes <span className="ef-count">{p.partes.length}</span>
          <Svg size={15}>{I.chevron}</Svg>
        </button>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="jur-partes"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28 }}
          >
            {groups.map(([k, list]) => (
              <div className={`jur-partes-group ${k}`} key={k}>
                <h5>{POLO_LABEL[k]}</h5>
                {list.map((x, i) => (
                  <ParteRow key={`${x.nome}-${i}`} parte={x} isSelf={x === self} />
                ))}
              </div>
            ))}
            {rest.length > 0 && (
              <div className="jur-extra">
                <h5>Outros campos</h5>
                <ProfileCardEntries entries={rest} query="" onOpenImage={onOpenImage} />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

// ─── Página ─────────────────────────────────────────────────────────────────

export function JuridicoPage({
  sections,
  serviceResponse,
  cpf,
  selfName,
  onGo,
  onOpenImage,
  onConsult,
}: {
  sections: SectionSpec[];
  serviceResponse: Dict;
  cpf: string;
  selfName?: string;
  onGo: (id: string) => void;
  onOpenImage: (url: string) => void;
  onConsult: (cpf: string) => void;
}) {
  const sr = serviceResponse;
  const processos = useMemo(() => extractProcessos(sr), [sr]);
  const stats = useMemo(() => judicialStats(processos, cpf, selfName), [processos, cpf, selfName]);
  const counterparties = useMemo(() => buildCounterparties(processos, cpf, selfName), [processos, cpf, selfName]);
  const selfNames = useMemo(() => collectSelfNames(processos, cpf, selfName), [processos, cpf, selfName]);
  const declared = processosDeclaredTotal(sr);

  const [polo, setPolo] = useState<PoloFilter>('todos');
  const [sort, setSort] = useState<Sort>('movimento');
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const query = normalizeText(q.trim());
    const withSelf = processos.map((p) => ({ p, self: findSelf(p, cpf, selfNames) }));
    return withSelf
      .filter(({ self }) => polo === 'todos' || self?.polo === polo)
      .filter(({ p }) => {
        if (!query) return true;
        const hay = normalizeText(
          [p.numero, p.classe, p.assunto, p.tribunal, p.orgaoJulgador, p.ultimoMovimento?.descricao, ...p.partes.map((x) => x.nome)]
            .filter(Boolean)
            .join(' '),
        );
        return hay.includes(query);
      })
      .sort((a, b) => {
        if (sort === 'valor') return (b.p.valor ?? 0) - (a.p.valor ?? 0);
        if (sort === 'ajuizamento') return (b.p.dataAjuizamento ?? '').localeCompare(a.p.dataAjuizamento ?? '');
        return (b.p.ultimoMovimento?.data ?? '').localeCompare(a.p.ultimoMovimento?.data ?? '');
      });
  }, [processos, cpf, selfNames, polo, q, sort]);

  const otherSections = sections.filter((s) => s.source !== 'processos' && sectionHasContent(s, sr));

  if (processos.length === 0) {
    return (
      <div className="jur">
        {sections.map((spec) => (
          <ProfileSectionView key={spec.title} spec={spec} serviceResponse={sr} query="" onOpenImage={onOpenImage} onConsult={onConsult} />
        ))}
      </div>
    );
  }

  const poloCounts: Record<PoloFilter, number> = {
    todos: processos.length,
    ativo: stats.porPolo.ativo,
    passivo: stats.porPolo.passivo,
    outros: stats.porPolo.outros,
  };

  return (
    <div className="jur">
      {/* Cockpit */}
      <div className="jur-cockpit">
        <div className="jur-kpis">
          <Kpi icon={I.scale} label="Processos" tone="base" sub={declared && declared > processos.length ? `${declared} no total declarado` : `${stats.ativos} ativos`}>
            <CountUp value={processos.length} />
          </Kpi>
          <Kpi icon={I.money} label="Valor em causa" tone="money">
            <CountUp value={stats.valorTotal} format={(v) => formatCompactCurrency(v)} duration={1400} />
          </Kpi>
          <Kpi icon={I.shieldDown} label="No polo passivo" tone="risk" sub={stats.valorComoPassivo > 0 ? `${formatCompactCurrency(stats.valorComoPassivo)} em causa` : undefined}>
            <CountUp value={stats.porPolo.passivo} />
          </Kpi>
          <Kpi icon={I.sword} label="No polo ativo" tone="ok">
            <CountUp value={stats.porPolo.ativo} />
          </Kpi>
          {stats.maisRecente && (
            <Kpi icon={I.pulse} label="Último movimento" tone={isRecent(stats.maisRecente.data) ? 'live' : 'base'} sub={stats.maisRecente.descricao}>
              {relativeTime(stats.maisRecente.data) ?? formatDate(stats.maisRecente.data.slice(0, 10))}
            </Kpi>
          )}
        </div>
        <div className="jur-panels">
          <div className="jur-panel">
            <h4>Posição da pessoa</h4>
            <PoloBar porPolo={stats.porPolo} />
            {stats.tribunais.length > 0 && (
              <div className="jur-tribunais">
                {stats.tribunais.map((t) => (
                  <span key={t.key}>
                    {t.label}
                    <b>{t.count}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
          {stats.porAno.length > 1 && (
            <div className="jur-panel">
              <h4>Ajuizamentos por ano</h4>
              <YearBars porAno={stats.porAno} />
            </div>
          )}
        </div>
      </div>

      {counterparties.length > 0 && <Counterparties items={counterparties} onGo={onGo} />}

      {stats.advogados.length > 0 && (
        <section className="ef-section">
          <h3 className="ef-section-title">
            Advogados da pessoa<span className="ef-count">{stats.advogados.length}</span>
          </h3>
          <div className="jur-lawyers">
            {stats.advogados.map((a) => (
              <div className="jur-lawyer" key={a.key}>
                <span className="jur-lawyer-icon"><Svg size={16}>{I.gavel}</Svg></span>
                <div>
                  <strong>{a.label}</strong>
                  {a.extra && <small>OAB {a.extra}</small>}
                </div>
                <b>{a.count}×</b>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="ef-section">
        <h3 className="ef-section-title">
          Processos<span className="ef-count">{list.length === processos.length ? processos.length : `${list.length} de ${processos.length}`}</span>
        </h3>
        <div className="jur-toolbar">
          <div className="jur-filters" role="group" aria-label="Filtrar por posição">
            {(['todos', 'passivo', 'ativo', 'outros'] as const).map((k) =>
              k === 'todos' || poloCounts[k] > 0 ? (
                <button key={k} type="button" className={`jur-filter ${k} ${polo === k ? 'active' : ''}`} onClick={() => setPolo(k)}>
                  {k === 'todos' ? 'Todos' : POLO_LABEL[k]}
                  <span>{poloCounts[k]}</span>
                </button>
              ) : null,
            )}
          </div>
          <input
            type="search"
            className="jur-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filtrar por número, classe, parte…"
            aria-label="Filtrar processos"
          />
          <select className="jur-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Ordenar processos">
            <option value="movimento">Movimento mais recente</option>
            <option value="valor">Maior valor</option>
            <option value="ajuizamento">Ajuizamento mais recente</option>
          </select>
        </div>
        <div className="jur-procs">
          <AnimatePresence initial={false}>
            {list.map(({ p, self }, i) => (
              <ProcessCard key={p.numero} p={p} self={self} index={i} onOpenImage={onOpenImage} />
            ))}
          </AnimatePresence>
          {list.length === 0 && <p className="ef-empty">Nenhum processo com esse filtro.</p>}
        </div>
      </section>

      {otherSections.map((spec) => (
        <ProfileSectionView key={spec.title} spec={spec} serviceResponse={sr} query="" onOpenImage={onOpenImage} onConsult={onConsult} />
      ))}
    </div>
  );
}
