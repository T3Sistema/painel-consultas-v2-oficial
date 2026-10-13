import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { prefersReducedMotion } from '../../lib/motion';
import { useGraphStore } from '../../store/graphStore';
import { usePersonProfileStore } from '../../store/personProfileStore';
import { formatCNPJ, formatCPF, formatCurrency, formatDate, normalizeText } from '../../lib/format';
import { PROFILE_PAGES, PROFILE_PAGE_NAMES, UNMAPPED_PAGE_NAME, unmappedGenericSections, type SectionSpec } from '../../lib/profileSchema';
import { RELATION_LABELS, isContextLink, linkLabel } from '../../lib/colors';
import { CompanyIcon, PersonIcon } from '../flow/icons';
import { ImageLightbox } from './ImageLightbox';
import { valueMatchesQuery } from './ProfileValue';
import { ProfileSectionView } from './ProfileSections';
import { PersonTimeline } from './PersonTimeline';
import { CadastralPage } from './CadastralPage';
import { ContactsPage } from './ContactsPage';
import { FinancePage } from './FinancePage';
import { CareerPage } from './CareerPage';
import { CyberPage } from './CyberPage';
import { PatrimonioPage } from './PatrimonioPage';
import { PresencePage } from './PresencePage';
import { JuridicoPage } from './JuridicoPage';
import { PersonDossier } from './PersonDossier';
import { ContextLinks, ExpandOnMap } from './ContextLinks';
import { fmtText } from '../../lib/profileFormat';
import type { GraphLink, GraphNode } from '../../types/graph';

const nid = (v: string | GraphNode) => (typeof v === 'string' ? v : v.id);

/** Abas exibidas (desabilitadas) enquanto o perfil ainda carrega — evita o layout "pular". */
const NAV_PLACEHOLDER = PROFILE_PAGE_NAMES;

/** Seções de uma página (a página "Saúde" recebe as chaves não mapeadas, p/ nada se perder). */
function sectionsForPage(pageIndex: number, sr: Record<string, unknown>): SectionSpec[] {
  const base = PROFILE_PAGES[pageIndex]?.sections ?? [];
  if (PROFILE_PAGES[pageIndex]?.name === UNMAPPED_PAGE_NAME) return [...base, ...unmappedGenericSections(sr)];
  return base;
}

/** Conexões (arestas) de um nó já carregadas no grafo. */
function useRelated(node: GraphNode | null) {
  const links = useGraphStore((s) => s.links);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  return useMemo(() => {
    if (!node) return [];
    return links
      .filter((l) => nid(l.source) === node.id || nid(l.target) === node.id)
      .map((l) => {
        const otherId = nid(l.source) === node.id ? nid(l.target) : nid(l.source);
        return { link: l, other: nodeIndex.get(otherId) };
      })
      .filter((r): r is { link: GraphLink; other: GraphNode } => !!r.other);
  }, [node, links, nodeIndex]);
}

/** Cartão simples rótulo/valor — usado pelas seções montadas manualmente (empresa). */
function FieldCard({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === '') return null;
  return (
    <div className="ef-card">
      <span className="ef-card-label">{label}</span>
      <div className="ef-card-value">{value}</div>
    </div>
  );
}

/** Lista de conexões clicáveis (navega para a entidade e centraliza no mapa). */
function Connections({ related, onGo }: { related: { link: GraphLink; other: GraphNode }[]; onGo: (id: string) => void }) {
  if (related.length === 0) {
    return <p className="ef-empty">Nenhuma conexão carregada no mapa.</p>;
  }
  return (
    <div className="ef-connections">
      {related.map(({ link, other }) => (
        <button className="ef-connection" key={link.id} onClick={() => onGo(other.id)} type="button">
          <span className={`ef-connection-icon ${other.kind}`}>
            {other.kind === 'company' ? <CompanyIcon className="tiny-company-icon" /> : <PersonIcon className="tiny-company-icon" />}
          </span>
          <span className="ef-connection-body">
            <strong>{other.label}</strong>
            <small>
              {other.kind === 'company' ? formatCNPJ(other.company?.cnpj ?? '') : formatCPF(other.person?.cpf ?? '')}
              {link.meta.dataEntrada ? ` · desde ${formatDate(link.meta.dataEntrada)}` : ''}
            </small>
          </span>
          <span className="ef-connection-tag">
            {isContextLink(link) ? linkLabel(link) : link.meta.funcao ?? RELATION_LABELS[link.type]}
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Empresa: página única ─────────────────────────────────────────────────

function CompanyDetail({ node, onGo }: { node: GraphNode; onGo: (id: string) => void }) {
  const related = useRelated(node);
  const c = node.company;
  if (!c) return null;

  const statusClass = c.situacao === 'ATIVA' ? 'ok' : c.situacao === 'BAIXADA' ? 'bad' : 'off';
  // vínculos de contexto (processo/família) aparecem em "Por que está no mapa", não como sócios
  const societario = related.filter((r) => !isContextLink(r.link));
  const relatedPeople = societario.filter((r) => r.other.kind === 'person');
  const relatedCompanies = societario.filter((r) => r.other.kind === 'company');

  return (
    <div className="ef-body">
      <div className="ef-hero">
        <div className="ef-hero-avatar company">
          <CompanyIcon className="ef-hero-avatar-icon" />
        </div>
        <div className="ef-hero-info">
          <h1 className="ef-hero-name">
            {node.label}
            <span className={`ef-status ${statusClass}`}>{c.situacao ?? 'DESCONHECIDA'}</span>
          </h1>
          <div className="ef-hero-badges">
            {c.cnpj && <span className="ef-badge mono">{formatCNPJ(c.cnpj)}</span>}
            {c.nomeFantasia && <span className="ef-hero-sub">{c.nomeFantasia}</span>}
            <span className="ef-hero-sub">Camada {node.depth} na rede</span>
          </div>
        </div>
      </div>

      <ContextLinks node={node} related={related} onGo={onGo} />
      <ExpandOnMap node={node} />

      <section className="ef-section">
        <h3 className="ef-section-title">Informações gerais</h3>
        <div className="ef-grid">
          <FieldCard label="Razão social" value={c.razaoSocial} />
          <FieldCard label="Nome fantasia" value={c.nomeFantasia} />
          <FieldCard label="Situação cadastral" value={c.situacao} />
          <FieldCard label="Natureza jurídica" value={c.naturezaJuridica} />
          <FieldCard label="Capital social" value={c.capitalSocial != null ? formatCurrency(c.capitalSocial) : undefined} />
          <FieldCard label="Data de abertura" value={c.dataAbertura ? formatDate(c.dataAbertura) : undefined} />
          <FieldCard label="Matriz / Filial" value={c.matriz == null ? undefined : c.matriz ? 'Matriz' : 'Filial'} />
          <FieldCard label="Município / UF" value={[c.municipio, c.uf].filter(Boolean).join(' · ') || undefined} />
          <FieldCard label="Endereço" value={c.endereco} />
          <FieldCard label="Telefone" value={c.telefone} />
          <FieldCard label="E-mail" value={c.email} />
        </div>
      </section>

      <section className="ef-section">
        <h3 className="ef-section-title">CNAEs & atividades</h3>
        <div className="ef-grid">
          <FieldCard
            label="CNAE principal"
            value={c.cnaePrincipal ? `${c.cnaePrincipal.codigo} — ${c.cnaePrincipal.descricao}` : undefined}
          />
        </div>
        {c.cnaesSecundarios && c.cnaesSecundarios.length > 0 ? (
          <div className="ef-group">
            <h4 className="ef-group-title">
              CNAEs secundários<span className="ef-count">{c.cnaesSecundarios.length}</span>
            </h4>
            <div className="ef-chips">
              {c.cnaesSecundarios.map((cn) => (
                <span className="ef-chip" key={cn.codigo}>
                  {cn.codigo} — {cn.descricao}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="ef-empty">Nenhum CNAE secundário listado.</p>
        )}
      </section>

      <section className="ef-section">
        <h3 className="ef-section-title">
          Sócios & relacionados
          <span className="ef-count">{related.length}</span>
        </h3>
        <div className="ef-stat-row">
          <div className="ef-stat">
            <b>{relatedPeople.length}</b>
            <small>sócios (pessoas)</small>
          </div>
          <div className="ef-stat">
            <b>{relatedCompanies.length}</b>
            <small>empresas relacionadas</small>
          </div>
        </div>
        <Connections related={related} onGo={onGo} />
      </section>
    </div>
  );
}

// ─── Pessoa: páginas em abas ───────────────────────────────────────────────

function PersonDetail({ node, onGo }: { node: GraphNode; onGo: (id: string) => void }) {
  const cpf = node.person?.cpf ?? '';
  const digits = cpf.replace(/\D+/g, '');
  const loadProfile = usePersonProfileStore((s) => s.loadProfile);
  const profile = usePersonProfileStore((s) => s.profilesByCpf.get(digits) ?? s.profilesByCpf.get(cpf));
  const loading = usePersonProfileStore((s) => s.requestsByCpf.has(digits) || s.requestsByCpf.has(cpf));
  const error = usePersonProfileStore((s) => s.errorsByCpf.get(digits) ?? s.errorsByCpf.get(cpf));
  const related = useRelated(node);
  const startPersonSearch = useGraphStore((s) => s.startPersonSearch);
  const unsavedChanges = useGraphStore((s) => s.unsavedChanges);

  const [activePage, setActivePage] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  useEffect(() => {
    if (digits) void loadProfile(digits);
    setActivePage(0);
    setSearchQuery('');
    setLightboxSrc(null);
  }, [digits, loadProfile]);

  const sr = profile?.SERVICE_RESPONSE ?? {};
  const cadastral = (sr.cadastral ?? {}) as Record<string, unknown>;
  const query = normalizeText(searchQuery.trim());

  // "Consultar" pivota para uma nova investigação (substitui o mapa atual) — com
  // confirmação quando há trabalho não salvo, pra não perder dados sem querer.
  const onConsult = (targetCpf: string) => {
    if (
      unsavedChanges &&
      !window.confirm('Isso abre uma nova consulta e substitui o mapa atual. Alterações não salvas serão perdidas. Continuar?')
    ) {
      return;
    }
    void startPersonSearch(targetCpf);
  };

  // Busca: percorre TODAS as páginas e mantém só as seções cujo título ou dados casam.
  const matchedSections = useMemo(() => {
    if (!query || !profile) return [];
    const all: SectionSpec[] = PROFILE_PAGES.flatMap((_, i) => sectionsForPage(i, sr));
    return all.filter(
      (s) => normalizeText(s.title).includes(query) || valueMatchesQuery(sr[s.source], query),
    );
  }, [query, profile, sr]);

  const activeSections = profile ? sectionsForPage(activePage, sr) : [];

  return (
    <>
      <nav className="ef-nav" aria-label="Seções do perfil">
        {NAV_PLACEHOLDER.map((name, i) => (
          <button
            key={name}
            type="button"
            className={`ef-tab ${!query && i === activePage ? 'active' : ''}`}
            disabled={!profile}
            onClick={() => {
              setActivePage(i);
              setSearchQuery('');
            }}
          >
            {!query && i === activePage && (
              <motion.span layoutId="ef-tab-indicator" className="ef-tab-indicator" transition={{ type: 'spring', stiffness: 380, damping: 34 }} />
            )}
            {name}
          </button>
        ))}
      </nav>

      <div className="ef-body person">
        <div className="ef-hero">
          <div className="ef-hero-avatar person">
            {node.person?.photoUrl ? (
              <img src={node.person.photoUrl} alt="" className="ef-hero-photo" />
            ) : (
              <PersonIcon className="ef-hero-avatar-icon" />
            )}
          </div>
          <div className="ef-hero-info">
            <h1 className="ef-hero-name">
              {node.label}
              <span className="ef-status">{node.person?.administrador ? 'ADMINISTRADOR' : 'PESSOA FÍSICA'}</span>
            </h1>
            <div className="ef-hero-badges">
              <span className="ef-badge mono">{formatCPF(cpf)}</span>
              {!isEmpty(cadastral.idade) && <span className="ef-hero-sub">{fmtText(cadastral.idade)} anos</span>}
              {!isEmpty(cadastral.classeSocial) && <span className="ef-hero-sub">Classe {fmtText(cadastral.classeSocial)}</span>}
              <span className="ef-hero-sub">Camada {node.depth} na rede</span>
            </div>
          </div>
          <label className="ef-search">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-4-4" />
            </svg>
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar nas informações"
              aria-label="Buscar nas informações da pessoa"
            />
          </label>
        </div>

        <ContextLinks node={node} related={related} onGo={onGo} />
        <ExpandOnMap node={node} />

        {!loading && !error && profile && !query && activePage === 0 && (
          <PersonDossier
            serviceResponse={sr}
            cpf={digits}
            selfName={node.label}
            onOpenPage={(name) => {
              const i = PROFILE_PAGE_NAMES.indexOf(name);
              if (i >= 0) setActivePage(i);
            }}
          />
        )}

        {loading && <p className="ef-status-msg">Carregando perfil…</p>}
        {!loading && error && (
          <p className="ef-status-msg ef-status-error">
            <span>{error}</span>
            <button type="button" className="btn plain" onClick={() => void loadProfile(digits)}>
              Tentar novamente
            </button>
          </p>
        )}

        {!loading && !error && profile && (
          <div className="ef-pages">
            {query ? (
              matchedSections.length === 0 ? (
                <p className="ef-empty">Nenhum registro encontrado para “{searchQuery.trim()}”.</p>
              ) : (
                matchedSections.map((spec, i) => (
                  <ProfileSectionView
                    key={`${spec.title}-${i}`}
                    spec={spec}
                    serviceResponse={sr}
                    query={query}
                    onOpenImage={setLightboxSrc}
                    onConsult={onConsult}
                  />
                ))
              )
            ) : PROFILE_PAGES[activePage]?.name === 'Timeline' ? (
              <PersonTimeline items={Array.isArray(sr.linhaDoTempo) ? (sr.linhaDoTempo as unknown[]) : []} />
            ) : PROFILE_PAGES[activePage]?.name === 'Cadastral & Civil' ? (
              <CadastralPage
                sections={activeSections}
                serviceResponse={sr}
                onOpenImage={setLightboxSrc}
                onConsult={onConsult}
              />
            ) : PROFILE_PAGES[activePage]?.name === 'Contatos & Endereços' ? (
              <ContactsPage
                sections={activeSections}
                serviceResponse={sr}
                onOpenImage={setLightboxSrc}
                onConsult={onConsult}
              />
            ) : PROFILE_PAGES[activePage]?.name === 'Financeiro & Consumo' ? (
              <FinancePage
                sections={activeSections}
                serviceResponse={sr}
                onOpenImage={setLightboxSrc}
                onConsult={onConsult}
              />
            ) : PROFILE_PAGES[activePage]?.name === 'Cyber Sec & Vazamentos' ? (
              <CyberPage
                sections={activeSections}
                serviceResponse={sr}
                onOpenImage={setLightboxSrc}
                onConsult={onConsult}
              />
            ) : PROFILE_PAGES[activePage]?.name === 'Bens & Patrimônio' ? (
              <PatrimonioPage
                sections={activeSections}
                serviceResponse={sr}
                onOpenImage={setLightboxSrc}
              />
            ) : PROFILE_PAGES[activePage]?.name === 'Presença & Viagens' ? (
              <PresencePage
                sections={activeSections}
                serviceResponse={sr}
                onOpenImage={setLightboxSrc}
              />
            ) : PROFILE_PAGES[activePage]?.name === 'Jurídico' ? (
              <JuridicoPage
                sections={activeSections}
                serviceResponse={sr}
                cpf={digits}
                selfName={node.label}
                onGo={onGo}
                onOpenImage={setLightboxSrc}
                onConsult={onConsult}
              />
            ) : PROFILE_PAGES[activePage]?.name === 'Carreira & Negócios' ? (
              <CareerPage
                sections={activeSections}
                serviceResponse={sr}
                onOpenImage={setLightboxSrc}
                onConsult={onConsult}
                connectionsSlot={
                  <section className="ef-section">
                    <h3 className="ef-section-title">
                      Conexões no mapa<span className="ef-count">{related.length}</span>
                    </h3>
                    <Connections related={related} onGo={onGo} />
                  </section>
                }
              />
            ) : (
              <>
                {activeSections.map((spec, i) => (
                  <ProfileSectionView
                    key={`${spec.title}-${i}`}
                    spec={spec}
                    serviceResponse={sr}
                    query=""
                    onOpenImage={setLightboxSrc}
                    onConsult={onConsult}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
      </div>
    </>
  );
}

const isEmpty = (v: unknown) => v == null || v === '' || String(v).toLowerCase() === 'n/a';

/**
 * Detalhe da entidade em TELA CHEIA (substitui o antigo painel lateral). Ao
 * clicar num nó do mapa, sobrepõe o app inteiro: pessoa em 9 páginas/abas
 * temáticas (incluindo a "Timeline"); empresa numa página única e
 * estruturada. O × (ou clicar numa conexão) volta ao mapa.
 */
/** Centro (na tela) do círculo de um nó do mapa — de onde o detalhe "nasce". */
function nodeScreenCenter(id: string | null): { x: number; y: number } {
  const fallback = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  if (!id) return fallback;
  const el = Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node')).find((n) => n.dataset.id === id);
  const circle = el?.querySelector('.rf-circle');
  if (!circle) return fallback;
  const r = circle.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Raio (em % — referência do clip-path: diagonal/√2 da caixa) que cobre a
 * tela inteira a partir de um ponto, com folga para redimensionamentos.
 */
function coverPercent(o: { x: number; y: number }): number {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const far = Math.max(Math.hypot(o.x, o.y), Math.hypot(w - o.x, o.y), Math.hypot(o.x, h - o.y), Math.hypot(w - o.x, h - o.y));
  const ref = Math.hypot(w, h) / Math.SQRT2;
  return Math.ceil((far / ref) * 100) + 10;
}

/**
 * Detalhe da entidade em TELA CHEIA (substitui o antigo painel lateral). Ao
 * clicar num nó do mapa, sobrepõe o app inteiro — e "nasce" do próprio nó:
 * um círculo se abre a partir dele até cobrir a tela, e ao fechar se recolhe
 * de volta para o nó. Pessoa em páginas/abas temáticas; empresa numa página
 * única e estruturada. O × (ou Esc) volta ao mapa.
 */
export function EntityDetail() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  const selectNode = useGraphStore((s) => s.selectNode);
  const focusNode = useGraphStore((s) => s.focusNode);

  const node = selectedNodeId ? nodeIndex.get(selectedNodeId) : null;
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const [origin, setOrigin] = useState(() => ({ x: 0, y: 0 }));

  useLayoutEffect(() => {
    if (selectedNodeId) setOrigin(nodeScreenCenter(selectedNodeId));
  }, [selectedNodeId]);

  useEffect(() => {
    if (!node) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') selectNode(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [node, selectNode]);

  const goTo = (id: string) => {
    selectNode(id);
    focusNode(id);
  };

  // holofote: o cartão sob o mouse recebe a posição do cursor
  const onPointerMove = (e: React.PointerEvent) => {
    const card = (e.target as HTMLElement).closest?.('.ef-card') as HTMLElement | null;
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${e.clientX - r.left}px`);
    card.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  // mesma unidade nas duas pontas (%), para a saída interpolar de volta ao nó
  const closed = `circle(0% at ${origin.x}px ${origin.y}px)`;
  const open = `circle(${coverPercent(origin)}% at ${origin.x}px ${origin.y}px)`;

  return (
    <AnimatePresence>
      {node && (
        <motion.div
          key="entity-full"
          className="entity-full"
          role="dialog"
          aria-modal="true"
          aria-label={`Detalhes de ${node.label}`}
          onPointerMove={onPointerMove}
          initial={reduced ? { opacity: 0 } : { clipPath: closed }}
          animate={reduced ? { opacity: 1 } : { clipPath: open }}
          exit={reduced ? { opacity: 0 } : { clipPath: closed }}
          transition={{ duration: reduced ? 0.15 : 0.6, ease: [0.7, 0, 0.2, 1] }}
        >
          <div className="entity-full-topbar">
            <span className="entity-full-kind">{node.kind === 'company' ? 'Empresa / CNPJ' : 'Pessoa / CPF'}</span>
            <button className="entity-full-close" onClick={() => selectNode(null)} aria-label="Fechar e voltar ao mapa" type="button">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
              <span>Voltar ao mapa</span>
            </button>
          </div>
          {node.kind === 'company' ? <CompanyDetail node={node} onGo={goTo} /> : <PersonDetail node={node} onGo={goTo} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
