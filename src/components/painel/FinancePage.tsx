import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { coveredKeysForFields, type FieldSpec, type SectionSpec } from '../../lib/profileSchema';
import { fmtText, getPath, isEmptyValue } from '../../lib/profileFormat';
import { classifyKey } from '../../lib/mask';
import { MaskedValue, ProfileCardEntries, countRecords } from './ProfileValue';
import { ProfileSectionView, sectionHasContent } from './ProfileSections';
import { ScoreGauge, bandLabel, readScores, scoreConsumedKeys } from './MotionBits';

/**
 * Aba "Financeiro & Consumo": um "cockpit" de inteligência financeira. No topo,
 * um veredito de risco calculado (cheques sem fundo / dívida ativa) e um painel
 * de sinais (bancos, PIX, IRPF, assinaturas, propensões…). Abaixo, filtro por
 * domínio e as seções — algumas com estrutura própria (contas como cartões,
 * IRPF como linha de restituições), outras pelo renderizador padrão.
 *
 * NADA é omitido: as seções genéricas continuam no `ProfileSectionView`; as
 * seções com cartão próprio (contas bancárias, IRPF) reaproveitam as MESMAS
 * primitivas seguras — `MaskedValue` para os campos mascarados e
 * `ProfileCardEntries` para TODO campo não curado do registro (idêntico ao que
 * o `ListSection` faz). O cockpit é aditivo e só usa contagens/estados.
 */

const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : [];

const num = (v: unknown): number => countRecords(v) ?? (isEmptyValue(v) ? 0 : 1);

const lastSeg = (path: string) => path.split('.').pop() ?? path;

function formattedOf(item: unknown, field: FieldSpec): string {
  const raw = field.path === '' ? item : getPath(item, field.path);
  return field.format ? field.format(raw) : fmtText(raw);
}

/** Valor de um campo curado, com o mesmo mascaramento do FieldCard padrão. */
function FieldVal({ item, field }: { item: unknown; field?: FieldSpec }) {
  if (!field) return <span className="ef-muted">—</span>;
  const formatted = formattedOf(item, field);
  if (formatted === '—') return <span className="ef-muted">—</span>;
  const cls = field.maskOverride ?? classifyKey(field.maskKey ?? lastSeg(field.path));
  return cls !== 'none' ? <MaskedValue value={formatted} cls={cls} /> : <>{formatted}</>;
}

/** Entradas [chave,valor] do registro ainda não cobertas pelos campos curados. */
function restEntries(item: unknown, fields: FieldSpec[]): [string, unknown][] {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
  const covered = coveredKeysForFields(fields);
  return Object.entries(item as Record<string, unknown>).filter(([k]) => !covered.has(k));
}

// ─── Ícones ────────────────────────────────────────────────────────────────
const I = {
  bank: (<><path d="M3 10 12 4l9 6" /><path d="M4 10v9M20 10v9M8 10v9M12 10v9M16 10v9M3 21h18" /></>),
  pix: (<><path d="M12 3l4.5 4.5L12 12 7.5 7.5 12 3ZM12 12l4.5 4.5L12 21l-4.5-4.5L12 12Z" /></>),
  receipt: (<><path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3Z" /><path d="M9 8h6M9 12h6" /></>),
  alert: (<><path d="M12 3 2 20h20L12 3Z" /><path d="M12 10v4M12 17h.01" /></>),
  shield: (<><path d="M12 3l7 3v5c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6l7-3Z" /><path d="M9.5 12.5 11 14l3.5-3.5" /></>),
  loan: (<><circle cx="12" cy="12" r="8" /><path d="M12 8v8M9.5 9.5c0-1 1-1.6 2.5-1.6s2.4.7 2.4 1.7c0 2.4-4.8 1.2-4.8 3.6 0 1 1 1.7 2.4 1.7s2.5-.6 2.5-1.6" /></>),
  cart: (<><circle cx="9" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" /><path d="M3 4h2l2.2 11h10L20 7H6" /></>),
  wifi: (<><path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8 15.5a5 5 0 0 1 8 0" /><circle cx="12" cy="19" r="1" /></>),
  bolt: (<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" />),
  dna: (<><path d="M6 3c0 6 12 6 12 12M18 3c0 6-12 6-12 12M6 21c0-2 12-2 12 0M6 6c0 2 12 2 12 0M6 18c0-2 12-2 12 0" /></>),
  sub: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 10h18M7 15h4" /></>),
  chip: (<><rect x="4" y="7" width="16" height="10" rx="2" /><path d="M4 11h16M9 7v10" /></>),
};

function Svg({ children, size = 18 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

// ─── Cartão de conta bancária ────────────────────────────────────────────────
function BankCard({ item, fields, onOpenImage }: { item: Record<string, unknown>; fields: FieldSpec[]; onOpenImage: (u: string) => void }) {
  const byPath = (p: string) => fields.find((f) => f.path === p);
  const banco = byPath('banco');
  const rest = restEntries(item, fields);
  const bancoTxt = banco ? formattedOf(item, banco) : '—';
  const codTxt = byPath('codBanco') ? formattedOf(item, byPath('codBanco')!) : '—';
  const hasFace = fields.some((f) => formattedOf(item, f) !== '—');
  if (!hasFace && rest.length === 0) return null;

  return (
    <div className="fin-bank">
      <div className="fin-bank-face">
        <div className="fin-bank-top">
          <span className="fin-bank-name">{bancoTxt !== '—' ? bancoTxt : 'Conta bancária'}</span>
          {codTxt !== '—' && <span className="fin-bank-cod">cód {codTxt}</span>}
        </div>
        <span className="fin-bank-chip"><Svg size={22}>{I.chip}</Svg></span>
        <div className="fin-bank-number"><FieldVal item={item} field={byPath('conta')} /></div>
        <div className="fin-bank-foot">
          <span>
            <small>Agência</small>
            <b><FieldVal item={item} field={byPath('agencia')} /></b>
          </span>
          <span className="fin-bank-brand"><Svg size={18}>{I.bank}</Svg></span>
        </div>
      </div>
      {rest.length > 0 && (
        <div className="fin-extra">
          <ProfileCardEntries entries={rest} query="" onOpenImage={onOpenImage} />
        </div>
      )}
    </div>
  );
}

function BankAccounts({ items, fields, onOpenImage }: { items: Record<string, unknown>[]; fields: FieldSpec[]; onOpenImage: (u: string) => void }) {
  return (
    <section className="ef-section">
      <h3 className="ef-section-title">Contas bancárias<span className="ef-count">{items.length}</span></h3>
      <div className="fin-banks">
        {items.map((item, i) => <BankCard key={i} item={item} fields={fields} onOpenImage={onOpenImage} />)}
      </div>
    </section>
  );
}

// ─── Linha de restituições de IRPF ───────────────────────────────────────────
function statusTone(situacao: string): string {
  const s = situacao.toLowerCase();
  if (s.includes('restitu') || s.includes('pago') || s.includes('credit')) return 'ok';
  if (s.includes('malha') || s.includes('pend') || s.includes('reten')) return 'warn';
  return 'info';
}

function IrpfTimeline({ items, fields, onOpenImage }: { items: Record<string, unknown>[]; fields: FieldSpec[]; onOpenImage: (u: string) => void }) {
  const byPath = (p: string) => fields.find((f) => f.path === p);
  const detailFields = fields.filter((f) => !['ano', 'situacao'].includes(f.path));
  const sorted = [...items].sort((a, b) => Number(b.ano ?? 0) - Number(a.ano ?? 0));

  return (
    <section className="ef-section">
      <h3 className="ef-section-title">Restituições de IRPF<span className="ef-count">{items.length}</span></h3>
      <div className="fin-irpf">
        {sorted.map((item, i) => {
          const anoTxt = byPath('ano') ? formattedOf(item, byPath('ano')!) : '—';
          const sitTxt = byPath('situacao') ? formattedOf(item, byPath('situacao')!) : '—';
          const details = detailFields.filter((f) => formattedOf(item, f) !== '—');
          const rest = restEntries(item, fields);
          return (
            <div className="fin-irpf-item" key={i}>
              <div className="fin-irpf-year">{anoTxt}</div>
              <div className="fin-irpf-card">
                {sitTxt !== '—' && <span className={`fin-irpf-status tone-${statusTone(sitTxt)}`}>{sitTxt}</span>}
                {details.length > 0 && (
                  <div className="fin-kv">
                    {details.map((f) => (
                      <span className="fin-kv-item" key={f.label}>
                        <small>{f.label}</small>
                        <b><FieldVal item={item} field={f} /></b>
                      </span>
                    ))}
                  </div>
                )}
                {rest.length > 0 && (
                  <div className="fin-extra">
                    <ProfileCardEntries entries={rest} query="" onOpenImage={onOpenImage} />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ─── Score de crédito (medidores) ────────────────────────────────────────────
function ScorePanel({ score, onOpenImage }: { score: unknown; onOpenImage: (u: string) => void }) {
  const scores = readScores(score);
  const consumed = scoreConsumedKeys(score);
  const rest = Object.entries(score as Record<string, unknown>).filter(([k]) => !consumed.has(k));
  return (
    <section className="ef-section">
      <h3 className="ef-section-title">Score de crédito<span className="ef-count">{scores.length}</span></h3>
      <div className="fin-scores">
        {scores.map((s) => (
          <div className="fin-score" key={s.key}>
            <ScoreGauge value={s.value} label={s.key.toUpperCase()} band={bandLabel(s.band)} size={190} dark={false} />
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <div className="fin-extra">
          <ProfileCardEntries entries={rest} query="" onOpenImage={onOpenImage} />
        </div>
      )}
    </section>
  );
}

// ─── Cockpit (veredito + sinais) ─────────────────────────────────────────────
const SKIP_PROP = new Set(['cpf', 'csb8', 'csb8_faixa']);
function activeProps(v: unknown): number {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 0;
  return Object.entries(v as Record<string, unknown>).filter(([k, val]) => !SKIP_PROP.has(k) && (val === 1 || val === true)).length;
}

const DOMAINS: { id: string; title: string; sub: string; color: string; sources: string[] }[] = [
  { id: 'score', title: 'Score de crédito', sub: 'Pontuação de crédito e demais indicadores financeiros', color: '#0ea5e9', sources: ['score', 'financeiro'] },
  { id: 'bancario', title: 'Bancos & Fisco', sub: 'Contas bancárias, chaves PIX e restituições de IRPF', color: '#2563eb', sources: ['contasBancos', 'chavesPix', 'irpf'] },
  { id: 'risco', title: 'Crédito & risco', sub: 'Cheques sem fundo, dívida ativa e empréstimos', color: '#dc2626', sources: ['ccf', 'dividaAtiva', 'emprestimos'] },
  { id: 'consumo', title: 'Assinaturas & serviços', sub: 'Assinaturas, compras, telecom e energia', color: '#7c3aed', sources: ['assinaturas', 'comprasOnline', 'planos', 'planosMoveis', 'energias'] },
  { id: 'perfil', title: 'Perfil de consumo', sub: 'Propensões e poder de compra estimados', color: '#059669', sources: ['propensoes'] },
];

export function FinancePage({
  sections,
  serviceResponse,
  onOpenImage,
  onConsult,
}: {
  sections: SectionSpec[];
  serviceResponse: Record<string, unknown>;
  onOpenImage: (url: string) => void;
  onConsult: (cpf: string) => void;
}) {
  const sr = serviceResponse;
  const [filter, setFilter] = useState<string>('all');

  const stats = useMemo(() => {
    const banks = arr(sr.contasBancos);
    const irpf = arr(sr.irpf);
    const ccf = num(sr.ccf);
    const divida = num(sr.dividaAtiva);
    const riskCount = (ccf > 0 ? 1 : 0) + (divida > 0 ? 1 : 0);
    return {
      banks: banks.length,
      pix: num(sr.chavesPix),
      irpf: irpf.length,
      ccf,
      divida,
      emprestimos: num(sr.emprestimos),
      assinaturas: num(sr.assinaturas),
      compras: num(sr.comprasOnline),
      planos: num(sr.planos) + num(sr.planosMoveis),
      energia: num(sr.energias),
      propAtivas: activeProps(sr.propensoes),
      riskCount,
    };
  }, [sr]);

  const bySource = (src: string) => sections.find((s) => s.source === src);

  const renderSection = (spec: SectionSpec): ReactNode => {
    if (spec.source === 'contasBancos') return <BankAccounts items={arr(sr.contasBancos)} fields={spec.fields ?? []} onOpenImage={onOpenImage} />;
    if (spec.source === 'irpf') return <IrpfTimeline items={arr(sr.irpf)} fields={spec.fields ?? []} onOpenImage={onOpenImage} />;
    if (spec.source === 'score' && readScores(sr.score).length > 0) return <ScorePanel score={sr.score} onOpenImage={onOpenImage} />;
    return <ProfileSectionView spec={spec} serviceResponse={sr} query="" onOpenImage={onOpenImage} onConsult={onConsult} />;
  };

  const domainsWithContent = DOMAINS.map((d) => ({
    domain: d,
    specs: d.sources.map(bySource).filter((s): s is SectionSpec => !!s && sectionHasContent(s, sr)),
  })).filter((d) => d.specs.length > 0);

  const verdictTone = stats.riskCount === 0 ? 'green' : stats.riskCount === 1 ? 'amber' : 'red';
  const verdictTitle = stats.riskCount === 0 ? 'Sem alertas de risco' : `${stats.riskCount} ${stats.riskCount > 1 ? 'sinais de atenção' : 'sinal de atenção'}`;
  const verdictSub = stats.riskCount === 0
    ? 'Nenhum cheque sem fundo ou dívida ativa localizada'
    : 'Cheque sem fundo e/ou dívida ativa detectados — veja "Crédito & risco"';

  const signals: { key: string; label: string; value: ReactNode; tone: string; icon: ReactNode }[] = [
    { key: 'banks', label: 'Contas bancárias', value: stats.banks, tone: stats.banks ? 'info' : 'muted', icon: I.bank },
    { key: 'pix', label: 'Chaves PIX', value: stats.pix, tone: stats.pix ? 'info' : 'muted', icon: I.pix },
    { key: 'irpf', label: 'Restituições IRPF', value: stats.irpf, tone: stats.irpf ? 'info' : 'muted', icon: I.receipt },
    { key: 'ccf', label: 'Cheques sem fundo', value: stats.ccf ? 'Consta' : 'Não consta', tone: stats.ccf ? 'risk' : 'ok', icon: I.alert },
    { key: 'divida', label: 'Dívida ativa', value: stats.divida ? 'Consta' : 'Não consta', tone: stats.divida ? 'risk' : 'ok', icon: I.alert },
    { key: 'emprestimos', label: 'Empréstimos', value: stats.emprestimos, tone: stats.emprestimos ? 'warn' : 'muted', icon: I.loan },
    { key: 'assinaturas', label: 'Assinaturas', value: stats.assinaturas, tone: stats.assinaturas ? 'info' : 'muted', icon: I.sub },
    { key: 'compras', label: 'Compras online', value: stats.compras, tone: stats.compras ? 'info' : 'muted', icon: I.cart },
    { key: 'planos', label: 'Telecom / planos', value: stats.planos, tone: stats.planos ? 'info' : 'muted', icon: I.wifi },
    { key: 'energia', label: 'Contas de energia', value: stats.energia, tone: stats.energia ? 'info' : 'muted', icon: I.bolt },
    { key: 'prop', label: 'Propensões ativas', value: stats.propAtivas, tone: stats.propAtivas ? 'accent' : 'muted', icon: I.dna },
  ];

  return (
    <div className="fin">
      {/* Cockpit */}
      <div className="fin-cockpit">
        <div className={`fin-verdict tone-${verdictTone}`}>
          <span className="fin-verdict-badge"><Svg size={26}>{I.shield}</Svg></span>
          <div className="fin-verdict-text">
            <b>{verdictTitle}</b>
            <small>{verdictSub}</small>
          </div>
        </div>
        <div className="fin-signals">
          {signals.map((s) => (
            <div className={`fin-signal tone-${s.tone}`} key={s.key}>
              <span className="fin-signal-icon"><Svg size={16}>{s.icon}</Svg></span>
              <span className="fin-signal-value">{s.value}</span>
              <span className="fin-signal-label">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Filtro por domínio */}
      {domainsWithContent.length > 1 && (
        <div className="fin-filters" role="group" aria-label="Filtrar por domínio">
          <button type="button" className={`fin-filter ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
            Tudo
          </button>
          {domainsWithContent.map(({ domain }) => {
            const active = filter === domain.id;
            return (
              <button
                key={domain.id}
                type="button"
                className={`fin-filter ${active ? 'active' : ''}`}
                onClick={() => setFilter(active ? 'all' : domain.id)}
                style={active ? { borderColor: domain.color, background: `${domain.color}14`, color: domain.color } : undefined}
              >
                <span className="fin-filter-dot" style={{ background: domain.color }} />
                {domain.title}
              </button>
            );
          })}
        </div>
      )}

      {/* Domínios */}
      {domainsWithContent
        .filter(({ domain }) => filter === 'all' || filter === domain.id)
        .map(({ domain, specs }, di) => (
          <motion.section
            key={domain.id}
            className="fin-domain"
            style={{ '--c': domain.color } as React.CSSProperties}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(di * 0.05, 0.2) }}
          >
            <header className="fin-domain-head">
              <h2 className="fin-domain-title">{domain.title}</h2>
              <p className="fin-domain-sub">{domain.sub}</p>
            </header>
            <div className="fin-domain-body">
              {specs.map((spec) => <div key={spec.title}>{renderSection(spec)}</div>)}
            </div>
          </motion.section>
        ))}
    </div>
  );
}
