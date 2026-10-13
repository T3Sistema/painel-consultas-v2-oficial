import { useMemo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { extractProcessos, judicialStats } from '../../lib/judicial';
import { formatCompactCurrency, formatCurrency, formatDate } from '../../lib/format';
import { CountUp, ScoreGauge, bandLabel, readScores } from './MotionBits';

type Dict = Record<string, unknown>;

const asDict = (v: unknown): Dict => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Dict) : {});
const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};

/** Idade a partir da data de nascimento (AAAA-MM-DD…) — ou do campo pronto, quando vier. */
export function ageFrom(cadastral: Dict, today = new Date()): number | undefined {
  const pronta = num(cadastral.idade);
  if (pronta != null) return pronta;
  const m = typeof cadastral.dataNasc === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(cadastral.dataNasc) : null;
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < mo || (today.getMonth() + 1 === mo && today.getDate() < d)) age -= 1;
  return age >= 0 && age < 130 ? age : undefined;
}

function Tile({
  i,
  label,
  children,
  sub,
  tone = 'base',
  onClick,
}: {
  i: number;
  label: string;
  children: ReactNode;
  sub?: ReactNode;
  tone?: string;
  onClick?: () => void;
}) {
  const Comp = onClick ? motion.button : motion.div;
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      className={`dos-tile tone-${tone} ${onClick ? 'clickable' : ''}`}
      onClick={onClick}
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.45, delay: 0.05 + i * 0.06, ease: [0.2, 0.9, 0.3, 1] }}
    >
      <span className="dos-label">{label}</span>
      <span className="dos-value">{children}</span>
      {sub && <span className="dos-sub">{sub}</span>}
    </Comp>
  );
}

/**
 * Faixa-resumo no topo da pessoa: os números que mais importam numa
 * investigação, cada um levando à aba de onde veio. Só aparece o que a
 * consulta trouxe — sem dado, sem cartão.
 */
export function PersonDossier({
  serviceResponse: sr,
  cpf,
  selfName,
  onOpenPage,
}: {
  serviceResponse: Dict;
  cpf: string;
  selfName?: string;
  onOpenPage: (pageName: string) => void;
}) {
  const cadastral = asDict(sr.cadastral);
  const cnh = asDict(sr.cnh);
  const scores = readScores(sr.score);
  const best = scores.length ? scores.reduce((a, b) => (b.value > a.value ? b : a)) : undefined;
  const processos = useMemo(() => extractProcessos(sr), [sr]);
  const jstats = useMemo(() => judicialStats(processos, cpf, selfName), [processos, cpf, selfName]);

  const idade = ageFrom(cadastral);
  const renda = num(cadastral.renda);
  const contatos = { tel: len(sr.telefones), email: len(sr.emails), end: len(sr.enderecos) };
  const totalContatos = contatos.tel + contatos.email + contatos.end;
  const parentes = len(sr.parentes);
  const cnhCat = typeof cnh.categoria === 'string' ? cnh.categoria : undefined;
  const cnhValidade = typeof cnh.validade === 'string' ? cnh.validade : undefined;
  const cnhVencida = cnh.validade_vencida === true;

  let i = 0;
  const tiles: ReactNode[] = [];
  if (idade != null) {
    tiles.push(
      <Tile key="idade" i={i++} label="Idade" sub={typeof cadastral.dataNasc === 'string' ? `nasc. ${formatDate(cadastral.dataNasc)}` : undefined}>
        <CountUp value={idade} /> <small>anos</small>
      </Tile>,
    );
  }
  if (renda != null) {
    tiles.push(
      <Tile key="renda" i={i++} label="Renda estimada" tone="money" sub="mensal" onClick={() => onOpenPage('Financeiro & Consumo')}>
        <CountUp value={renda} format={(v) => formatCurrency(v)} duration={1300} />
      </Tile>,
    );
  }
  if (processos.length > 0) {
    tiles.push(
      <Tile
        key="proc"
        i={i++}
        label="Processos judiciais"
        tone={jstats.porPolo.passivo > 0 ? 'risk' : 'base'}
        sub={`${formatCompactCurrency(jstats.valorTotal)} em causa · ${jstats.porPolo.passivo} no polo passivo`}
        onClick={() => onOpenPage('Jurídico')}
      >
        <CountUp value={processos.length} />
      </Tile>,
    );
  }
  if (totalContatos > 0) {
    tiles.push(
      <Tile
        key="cont"
        i={i++}
        label="Contatos"
        sub={[contatos.tel && `${contatos.tel} tel.`, contatos.email && `${contatos.email} e-mails`, contatos.end && `${contatos.end} end.`].filter(Boolean).join(' · ')}
        onClick={() => onOpenPage('Contatos & Endereços')}
      >
        <CountUp value={totalContatos} />
      </Tile>,
    );
  }
  if (cnhCat || cnhValidade) {
    tiles.push(
      <Tile
        key="cnh"
        i={i++}
        label="Habilitação"
        tone={cnhVencida ? 'risk' : 'ok'}
        sub={cnhValidade ? `${cnhVencida ? 'vencida em' : 'válida até'} ${formatDate(cnhValidade)}` : undefined}
        onClick={() => onOpenPage('Cadastral & Civil')}
      >
        {cnhCat ? `Cat. ${cnhCat}` : 'CNH'}
      </Tile>,
    );
  }
  if (parentes > 0) {
    tiles.push(
      <Tile key="fam" i={i++} label="Família" tone="family" sub="vínculos declarados" onClick={() => onOpenPage('Cadastral & Civil')}>
        <CountUp value={parentes} />
      </Tile>,
    );
  }

  if (!best && tiles.length === 0) return null;

  return (
    <div className="dos">
      {best && (
        <motion.button
          type="button"
          className="dos-score"
          onClick={() => onOpenPage('Financeiro & Consumo')}
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          title="Ver detalhes financeiros"
        >
          <span className="dos-label">Score de crédito</span>
          <ScoreGauge value={best.value} label={best.key.toUpperCase()} band={bandLabel(best.band)} size={150} dark={false} />
        </motion.button>
      )}
      <div className="dos-tiles">{tiles}</div>
    </div>
  );
}
