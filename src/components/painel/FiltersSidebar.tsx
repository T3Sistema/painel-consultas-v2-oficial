import { useMemo, useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { LINK_COLORS, NODE_LEGEND, RELATION_LABELS } from '../../lib/colors';
import { CompanyIcon, PersonIcon } from '../flow/icons';
import { normalizeText } from '../../lib/format';
import type { RelationType } from '../../types/graph';

/** Busca de CNAE por código ou descrição, digitando — em vez de rolar um &lt;select&gt; longo. */
function CnaeSearch({
  cnaes,
  value,
  onChange,
}: {
  cnaes: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selected = cnaes.find(([cod]) => cod === value);

  const matches = useMemo(() => {
    const q = normalizeText(query.trim());
    if (!q) return cnaes;
    return cnaes.filter(([cod, desc]) => normalizeText(desc).includes(q) || cod.includes(q));
  }, [cnaes, query]);

  return (
    <div className="cnae-search">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (value) onChange('');
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={selected ? `${selected[0]} — ${selected[1]}` : 'Buscar por código ou descrição...'}
        aria-label="Buscar CNAE"
      />
      {value && (
        <button
          type="button"
          className="cnae-clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('');
            setQuery('');
          }}
          aria-label="Limpar filtro de CNAE"
        >
          ×
        </button>
      )}
      {open && matches.length > 0 && (
        <div className="cnae-results">
          {matches.map(([cod, desc]) => (
            <button
              key={cod}
              onMouseDown={() => {
                onChange(cod);
                setQuery('');
                setOpen(false);
              }}
            >
              <b>{cod}</b> — {desc}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterRow({
  label,
  icon,
  checked,
  onChange,
}: {
  label: string;
  icon?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="filter-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {icon && <span className="filter-icon">{icon}</span>}
      {label}
      <span className="switch" />
    </label>
  );
}

export function FiltersSidebar({ open, onToggle }: { open: boolean; onToggle?: () => void }) {
  const filters = useGraphStore((s) => s.filters);
  const setFilters = useGraphStore((s) => s.setFilters);
  const resetFilters = useGraphStore((s) => s.resetFilters);
  const nodes = useGraphStore((s) => s.nodes);

  const ufs = useMemo(
    () => [...new Set(nodes.map((n) => n.company?.uf).filter((v): v is string => !!v))].sort(),
    [nodes],
  );
  const cnaes = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) {
      if (n.company?.cnaePrincipal) m.set(n.company.cnaePrincipal.codigo, n.company.cnaePrincipal.descricao);
    }
    return [...m.entries()].sort();
  }, [nodes]);

  // Recolhido: vira um trilho fino no MESMO lugar, com o botão de reabrir no topo.
  if (!open) {
    return (
      <aside className="filters collapsed" id="filters">
        <button
          type="button"
          className="filters-rail"
          onClick={() => onToggle?.()}
          title="Expandir filtros da rede"
          aria-label="Expandir filtros da rede"
        >
          <span className="filters-rail-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 6l6 6-6 6" />
              <path d="M6 6l6 6-6 6" />
            </svg>
          </span>
          <span className="filters-rail-label">Filtros da rede</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="filters open" id="filters">
      <div className="section-title">
        <b>Filtros da rede</b>
        <div className="section-title-actions">
          <button className="btn plain" style={{ padding: '2px 8px', fontSize: 11 }} onClick={resetFilters}>
            Limpar
          </button>
          <button
            type="button"
            className="filters-collapse"
            onClick={() => onToggle?.()}
            title="Recolher filtros"
            aria-label="Recolher filtros"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 6l-6 6 6 6" />
              <path d="M18 6l-6 6 6 6" />
            </svg>
          </button>
        </div>
      </div>

      <FilterRow
        label="Pessoas"
        icon={<PersonIcon className="filter-icon" />}
        checked={filters.showPeople}
        onChange={(v) => setFilters({ showPeople: v })}
      />
      <FilterRow
        label="Empresas"
        icon={<CompanyIcon className="filter-icon" />}
        checked={filters.showCompanies}
        onChange={(v) => setFilters({ showCompanies: v })}
      />
      <FilterRow
        label="Somente ativas"
        icon={<span style={{ color: 'var(--blue)' }}>●</span>}
        checked={filters.onlyActive}
        onChange={(v) => setFilters({ onlyActive: v, onlyBaixadas: false })}
      />
      <FilterRow
        label="Somente baixadas"
        icon={<span style={{ color: 'var(--red)' }}>●</span>}
        checked={filters.onlyBaixadas}
        onChange={(v) => setFilters({ onlyBaixadas: v, onlyActive: false })}
      />
      <FilterRow
        label="Administradores"
        icon={<span style={{ color: 'var(--amber)' }}>●</span>}
        checked={filters.onlyAdmins}
        onChange={(v) => setFilters({ onlyAdmins: v })}
      />
      <FilterRow
        label="Sócios / participações"
        icon={<span style={{ color: 'var(--purple)' }}>●</span>}
        checked={filters.onlyPartners}
        onChange={(v) => setFilters({ onlyPartners: v })}
      />
      <FilterRow
        label="Filiais"
        icon={<span style={{ color: 'var(--orange)' }}>●</span>}
        checked={filters.showBranches}
        onChange={(v) => setFilters({ showBranches: v })}
      />
      <FilterRow
        label="Matrizes"
        icon={<span style={{ color: 'var(--purple)' }}>⌘</span>}
        checked={filters.showHeadquarters}
        onChange={(v) => setFilters({ showHeadquarters: v })}
      />
      <FilterRow
        label="Vínculos judiciais"
        icon={<span style={{ color: LINK_COLORS.PROCESSO }}>⚖</span>}
        checked={filters.showJudicial !== false}
        onChange={(v) => setFilters({ showJudicial: v })}
      />
      <FilterRow
        label="Família"
        icon={<span style={{ color: LINK_COLORS.PARENTE }}>♥</span>}
        checked={filters.showFamily !== false}
        onChange={(v) => setFilters({ showFamily: v })}
      />

      <div className="rule" />
      <div className="label-line">
        <span>Estado (UF)</span>
      </div>
      <select value={filters.uf} onChange={(e) => setFilters({ uf: e.target.value })}>
        <option value="">Todos</option>
        {ufs.map((uf) => (
          <option key={uf} value={uf}>
            {uf}
          </option>
        ))}
      </select>

      <div className="label-line">
        <span>CNAE Principal</span>
      </div>
      <CnaeSearch cnaes={cnaes} value={filters.cnae} onChange={(cnae) => setFilters({ cnae })} />

      <div className="label-line">
        <span>Abertas após</span>
      </div>
      <input type="date" value={filters.openedAfter} onChange={(e) => setFilters({ openedAfter: e.target.value })} />

      <div className="rule" />
      <div className="label-line">
        <b>Legenda</b>
      </div>
      <div className="legend">
        {NODE_LEGEND.map((item) => (
          <div key={item.label}>
            <i style={{ background: item.color }} />
            {item.label}
          </div>
        ))}
      </div>
      <div className="rule" />
      <div className="label-line">
        <b>Conexões</b>
      </div>
      <div className="legend">
        {(Object.keys(LINK_COLORS) as RelationType[]).map((type) => (
          <div key={type}>
            <i className="line-sample" style={{ background: LINK_COLORS[type], borderRadius: 2, height: 3, width: 14 }} />
            {RELATION_LABELS[type]}
          </div>
        ))}
      </div>
    </aside>
  );
}
