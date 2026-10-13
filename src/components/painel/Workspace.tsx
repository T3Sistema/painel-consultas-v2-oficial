import { useEffect, useMemo } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { computeStats } from '../../lib/filtering';
import { FlowCanvas } from '../flow/FlowCanvas';
import { LayerControl } from './LayerControl';
import { MapConfig } from './MapConfig';

export function Workspace({ workspaceRef }: { workspaceRef: React.RefObject<HTMLDivElement> }) {
  const nodes = useGraphStore((s) => s.nodes);
  const links = useGraphStore((s) => s.links);
  const nodeIndex = useGraphStore((s) => s.nodeIndex);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const maxDepth = useGraphStore((s) => s.maxDepth);
  const notice = useGraphStore((s) => s.notice);
  const layerLoading = useGraphStore((s) => s.layerLoading);
  const expandingCount = useGraphStore((s) => s.expandingIds.size);
  const scanning = layerLoading || expandingCount > 0;
  const clearNotice = useGraphStore((s) => s.clearNotice);

  const stats = useMemo(() => computeStats(nodes, links), [nodes, links]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(clearNotice, 4000);
    return () => clearTimeout(t);
  }, [notice, clearNotice]);

  const selectedDepth = selectedNodeId ? nodeIndex.get(selectedNodeId)?.depth ?? stats.maxDepth : stats.maxDepth;

  return (
    <main className="workspace" ref={workspaceRef}>
      <FlowCanvas />
      {scanning && (
        <div className="map-scan" aria-hidden="true">
          <span className="map-scan-pill">
            <i />
            Mapeando conexões…
          </span>
        </div>
      )}
      <LayerControl />
      <MapConfig />

      <div className="level">
        Nível {selectedDepth} de {maxDepth === Infinity ? '∞' : maxDepth}
      </div>

      <div className={`toast ${notice ? 'show' : ''}`} role="status">
        {notice}
      </div>
    </main>
  );
}
