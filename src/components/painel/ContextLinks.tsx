import { motion } from 'framer-motion';
import { useGraphStore } from '../../store/graphStore';
import { LINK_COLORS, isContextLink, linkLabel } from '../../lib/colors';
import { formatDate, isValidCNPJ, isValidCPF, onlyDigits } from '../../lib/format';
import type { GraphLink, GraphNode } from '../../types/graph';

/**
 * "Por que esta entidade está no mapa": para um nó que entrou pela rede de
 * contexto (parte de processo ou parente), lista o vínculo com quem o
 * revelou — parentesco e cada processo em comum (classe, nº, ajuizamento).
 */
export function ContextLinks({
  node,
  related,
  onGo,
}: {
  node: GraphNode;
  related: { link: GraphLink; other: GraphNode }[];
  onGo: (id: string) => void;
}) {
  if (!node.context) return null;
  const ctx = related.filter((r) => isContextLink(r.link));
  if (ctx.length === 0) return null;

  return (
    <section className="ctx-why">
      <h3 className="ctx-why-title">
        <span className={`ctx-why-badge ${node.context}`}>{node.context === 'familia' ? '♥' : '⚖'}</span>
        Por que está no mapa
      </h3>
      {ctx.map(({ link, other }, i) => {
        const processos = (link.meta.evidencias ?? []).filter((e) => e.relation === 'PROCESSO' || e.relation === 'COPARTE');
        const familia = (link.meta.evidencias ?? []).find((e) => e.relation === 'PARENTE');
        return (
          <motion.div
            key={link.id}
            className="ctx-why-card"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, delay: i * 0.06 }}
          >
            <div className="ctx-why-head">
              <button type="button" className="ctx-why-other" onClick={() => onGo(other.id)}>
                {other.label}
              </button>
              <span className="ctx-why-tag" style={{ color: LINK_COLORS[familia ? 'PARENTE' : 'PROCESSO'] }}>
                {linkLabel(link)}
              </span>
            </div>
            {familia && <p className="ctx-why-line">Vínculo familiar declarado: {familia.qualificacao ?? 'parente'}.</p>}
            {processos.length > 0 && (
              <ul className="ctx-why-procs">
                {processos.map((e) => (
                  <li key={`${e.origem}-${e.relation}`}>
                    <i className={e.relation === 'COPARTE' ? 'coparte' : 'adverso'} />
                    <span>
                      <b>{e.qualificacao ?? 'Processo'}</b>
                      <small>
                        {e.origem?.replace(/^Processo\s+/, 'nº ')}
                        {e.dataEntrada ? ` · ajuizado em ${formatDate(e.dataEntrada)}` : ''}
                        {e.relation === 'COPARTE' ? ' · mesmo lado' : ''}
                      </small>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        );
      })}
    </section>
  );
}

/** Documento consultável do nó (CPF/CNPJ válido) — sem ele não há o que expandir. */
function hasQueryableDoc(node: GraphNode): boolean {
  if (node.kind === 'company') return isValidCNPJ(onlyDigits(node.company?.cnpj ?? ''));
  return isValidCPF(onlyDigits(node.person?.cpf ?? ''));
}

/**
 * Expansão explícita a partir do detalhe — o caminho garantido para nós de
 * contexto, que ficam fora da cascata automática de camadas. Volta ao mapa
 * para a pessoa ver as novas conexões nascendo.
 */
export function ExpandOnMap({ node }: { node: GraphNode }) {
  const expandNode = useGraphStore((s) => s.expandNode);
  const selectNode = useGraphStore((s) => s.selectNode);
  const focusNode = useGraphStore((s) => s.focusNode);
  const expanding = useGraphStore((s) => s.expandingIds.has(node.id));
  if (node.expanded || !hasQueryableDoc(node)) return null;

  return (
    <div className="expand-cta">
      <div>
        <b>{node.kind === 'company' ? 'Abrir o quadro societário desta empresa' : 'Expandir as conexões desta pessoa'}</b>
        <small>
          {node.context
            ? 'Esta entidade entrou pelo contexto da investigação e não é expandida automaticamente pelas camadas. Isso faz uma nova consulta.'
            : 'Faz uma nova consulta e desenha as conexões encontradas no mapa.'}
        </small>
      </div>
      <button
        type="button"
        className="expand-cta-btn"
        disabled={expanding}
        onClick={() => {
          selectNode(null);
          focusNode(node.id);
          void expandNode(node.id);
        }}
      >
        {expanding ? 'Expandindo…' : 'Expandir no mapa'}
      </button>
    </div>
  );
}
