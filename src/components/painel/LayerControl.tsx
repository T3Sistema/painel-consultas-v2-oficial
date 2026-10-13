import { useMemo } from 'react';
import { useGraphStore } from '../../store/graphStore';

/**
 * Controle flutuante de camadas, sobreposto ao topo do canvas do mapa:
 * [ − ] Camada N [ + ]
 */
export function LayerControl() {
  const currentLayer = useGraphStore((s) => s.currentLayer);
  const layerLoading = useGraphStore((s) => s.layerLoading);
  const nodes = useGraphStore((s) => s.nodes);
  const nextLayer = useGraphStore((s) => s.nextLayer);
  const prevLayer = useGraphStore((s) => s.prevLayer);

  // há próxima camada se existirem nós já carregados no nível seguinte
  // ou nós ainda não expandidos nas camadas visíveis (descoberta progressiva)
  const canAdvance = useMemo(
    () =>
      nodes.some((n) => n.depth === currentLayer + 1) ||
      // nós de contexto (processo/família) não entram na cascata — ver GraphNode.context
      nodes.some((n) => !n.expanded && !n.context && n.depth <= currentLayer),
    [nodes, currentLayer],
  );

  return (
    <div className="layer-control" role="group" aria-label="Controle de camadas do mapa">
      <button
        onClick={prevLayer}
        disabled={currentLayer <= 1 || layerLoading}
        aria-label="Voltar uma camada"
        title="Voltar uma camada"
      >
        −
      </button>
      <span className="layer-label">
        Camada {currentLayer}
        {layerLoading && <i className="layer-spinner" aria-label="Carregando camada" />}
      </span>
      <button
        onClick={() => void nextLayer()}
        disabled={!canAdvance || layerLoading}
        aria-label="Avançar uma camada"
        title="Avançar uma camada"
      >
        +
      </button>
    </div>
  );
}
