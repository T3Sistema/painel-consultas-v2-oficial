import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useGraphStore } from '../../store/graphStore';
import { applyFilters, degreeMap } from '../../lib/filtering';
import { NODE_COLORS, isContextLink, linkColor, linkLabel, linkProcessCount, nodeColor, nodeKindClass } from '../../lib/colors';
import { formatCNPJ } from '../../lib/format';
import { placeAround, radialLayout, type XY } from '../../lib/flowLayout';
import { ForceRefiner, type SimNode } from '../../lib/forceSim';
import {
  boundsOf,
  easeInOutCubic,
  easeOutBack,
  initialEntrance,
  lerp,
  prefersReducedMotion,
} from '../../lib/motion';
import type { GraphLink, GraphNode } from '../../types/graph';
import { EntityNode, type EntityFlowNode } from './EntityNode';
import { FloatingEdge, type FloatingFlowEdge } from './FloatingEdge';

const nid = (v: string | GraphNode) => (typeof v === 'string' ? v : v.id);

const nodeTypes = { entity: EntityNode };
const edgeTypes = { floating: FloatingEdge };

/** Acima disso as partículas "ambiente" somem (só as da vizinhança em foco ficam). */
const AMBIENT_PARTICLE_LIMIT = 70;
/** Duração do voo de um nó recém-descoberto até o seu lugar. */
const FLIGHT_MS = 820;
/** Duração da reorganização (todos os nós deslizando para o novo layout). */
const REFLOW_MS = 760;

interface Tween {
  from: XY;
  to: XY;
  start: number;
  dur: number;
  ease: (t: number) => number;
}

/** Aresta já com dados de coreografia — o estado de foco (hover) é aplicado depois, num memo barato. */
type BaseEdge = Omit<FloatingFlowEdge, 'data'> & { data: NonNullable<FloatingFlowEdge['data']> };

function FlowCanvasInner() {
  const nodes = useGraphStore((s) => s.nodes);
  const links = useGraphStore((s) => s.links);
  const filters = useGraphStore((s) => s.filters);
  const rootId = useGraphStore((s) => s.rootId);
  const currentLayer = useGraphStore((s) => s.currentLayer);
  const theme = useGraphStore((s) => s.theme);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const expandingIds = useGraphStore((s) => s.expandingIds);
  const highlightedNodeId = useGraphStore((s) => s.highlightedNodeId);
  const focusRequest = useGraphStore((s) => s.focusRequest);
  const organizeRequest = useGraphStore((s) => s.organizeRequest);
  const forceSettings = useGraphStore((s) => s.forceSettings);
  const forceCustomized = useGraphStore((s) => s.forceCustomized);
  const animateRequest = useGraphStore((s) => s.animateRequest);
  const selectNode = useGraphStore((s) => s.selectNode);
  const expandNode = useGraphStore((s) => s.expandNode);

  const { fitView, fitBounds, getViewport, setCenter } = useReactFlow();
  /** posições-alvo (onde cada nó "mora"); a posição renderizada pode estar em voo até lá */
  const positionsRef = useRef(new Map<string, XY>());
  const prevRootRef = useRef<string | null>(null);
  const [rfNodes, setRfNodes] = useState<EntityFlowNode[]>([]);
  const [baseEdges, setBaseEdges] = useState<BaseEdge[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  // refs para a simulação de forças (painel "Configurar mapa")
  const simRef = useRef<ForceRefiner | null>(null);
  const rfNodesRef = useRef<EntityFlowNode[]>([]);
  rfNodesRef.current = rfNodes;
  const settingsRef = useRef(forceSettings);
  settingsRef.current = forceSettings;
  const customizedRef = useRef(forceCustomized);
  customizedRef.current = forceCustomized;
  const runSimRef = useRef<() => void>(() => {});

  // ─── Motor de interpolação (voo dos nós) ─────────────────────────────────────
  const tweensRef = useRef(new Map<string, Tween>());
  const livePosRef = useRef(new Map<string, XY>());
  const rafRef = useRef<number | null>(null);
  /** atraso de entrada (ms) por nó recém-nascido — some depois que a animação termina */
  const enterDelayRef = useRef(new Map<string, number>());

  const tick = useCallback(() => {
    const now = performance.now();
    const updates = new Map<string, XY>();
    for (const [id, tw] of tweensRef.current) {
      const t = Math.min(1, Math.max(0, (now - tw.start) / tw.dur));
      const p = lerp(tw.from, tw.to, tw.ease(t));
      updates.set(id, p);
      livePosRef.current.set(id, p);
      if (t >= 1) tweensRef.current.delete(id);
    }
    if (updates.size > 0) {
      setRfNodes((prev) => prev.map((n) => (updates.has(n.id) ? { ...n, position: updates.get(n.id)! } : n)));
    }
    rafRef.current = tweensRef.current.size > 0 ? requestAnimationFrame(tick) : null;
  }, []);

  const flyTo = useCallback(
    (id: string, from: XY, to: XY, delay: number, dur: number, ease: (t: number) => number) => {
      tweensRef.current.set(id, { from, to, start: performance.now() + delay, dur, ease });
      livePosRef.current.set(id, from);
      if (rafRef.current == null) rafRef.current = requestAnimationFrame(tick);
    },
    [tick],
  );

  /** Encerra todos os voos já no destino (antes de simulação/arrasto assumirem as posições). */
  const settleTweens = useCallback(() => {
    if (tweensRef.current.size === 0) return;
    const done = new Map<string, XY>();
    for (const [id, tw] of tweensRef.current) done.set(id, tw.to);
    tweensRef.current.clear();
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setRfNodes((prev) => prev.map((n) => (done.has(n.id) ? { ...n, position: done.get(n.id)! } : n)));
  }, []);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  /** Posição renderizada agora (em voo ou parada). */
  const renderedPos = useCallback((id: string): XY | undefined => {
    if (tweensRef.current.has(id)) return livePosRef.current.get(id);
    return positionsRef.current.get(id);
  }, []);

  /** Enquadra suavemente as posições-ALVO (não as atuais, que podem estar no meio do voo). */
  const frameTargets = useCallback(
    (ids: string[], duration: number, padding = 0.16) => {
      const b = boundsOf(ids.map((id) => positionsRef.current.get(id)).filter((p): p is XY => !!p));
      if (b) void fitBounds(b, { padding, duration });
    },
    [fitBounds],
  );

  // camadas cumulativas: exibe apenas nós até a camada atual do controle
  const visible = useMemo(() => {
    const depthFiltered = nodes.filter((n) => n.depth <= currentLayer);
    return applyFilters(depthFiltered, links, filters, rootId);
  }, [nodes, links, filters, rootId, currentLayer]);

  const degrees = useMemo(() => degreeMap(visible.links), [visible.links]);

  /** Peso judicial de cada nó (nº de processos nas arestas) — contrapartes recorrentes ficam maiores. */
  const processWeight = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of visible.links) {
      const n = linkProcessCount(l);
      if (n === 0) continue;
      for (const id of [nid(l.source), nid(l.target)]) m.set(id, (m.get(id) ?? 0) + n);
    }
    return m;
  }, [visible.links]);

  /** Vizinhança do nó sob o mouse (ele + quem está ligado a ele). */
  const focusSet = useMemo(() => {
    if (!hoveredId) return null;
    const set = new Set<string>([hoveredId]);
    for (const l of visible.links) {
      const s = nid(l.source);
      const t = nid(l.target);
      if (s === hoveredId) set.add(t);
      if (t === hoveredId) set.add(s);
    }
    return set;
  }, [hoveredId, visible.links]);

  const buildRfNode = useCallback(
    (n: GraphNode, pos: XY): EntityFlowNode => {
      const isRoot = n.id === rootId;
      const deg = degrees.get(n.id) ?? 1;
      const capital = n.company?.capitalSocial ?? 0;
      const capitalBoost = capital > 0 ? Math.min(6, Math.log10(capital) / 2) : 0;
      const processBoost = Math.min(9, (processWeight.get(n.id) ?? 0) * 1.6);
      const base = n.kind === 'company' ? 34 : 30;
      const radius = isRoot
        ? 50
        : Math.min(46, Math.round(base + Math.min(10, deg * 1.1) + capitalBoost + (n.context ? processBoost : 0)));
      const matrizAtiva = n.company?.matriz === true && n.company?.situacao === 'ATIVA';
      const enterDelay = enterDelayRef.current.get(n.id);
      return {
        id: n.id,
        type: 'entity',
        position: pos,
        selected: n.id === selectedNodeId,
        data: {
          kind: nodeKindClass(n),
          isPerson: n.kind === 'person',
          color: nodeColor(n),
          ring: isRoot ? '#0d63e8' : matrizAtiva && !isRoot ? NODE_COLORS.matriz : undefined,
          radius,
          label: n.label,
          subLabel: n.company?.nomeFantasia,
          idLabel:
            n.kind === 'company'
              ? n.company?.cnpj
                ? formatCNPJ(n.company.cnpj)
                : undefined
              : n.person?.cpf || undefined,
          role: n.kind === 'person' && n.person?.administrador ? 'Administrador' : undefined,
          photoUrl: n.person?.photoUrl,
          main: isRoot,
          context: n.context,
          expanded: n.expanded,
          expanding: expandingIds.has(n.id),
          highlighted: n.id === highlightedNodeId,
          enterDelay: reduced ? undefined : enterDelay,
          dimmed: !!focusSet && !focusSet.has(n.id),
          focused: !!focusSet && focusSet.has(n.id) && n.id !== hoveredId,
        },
      };
    },
    [rootId, degrees, processWeight, selectedNodeId, expandingIds, highlightedNodeId, reduced, focusSet, hoveredId],
  );

  /** Marca nascimentos e agenda a limpeza (um nó que reaparece depois entra sem esperar a onda antiga). */
  const markBorn = useCallback((steps: { id: string; delay: number }[]) => {
    for (const s of steps) enterDelayRef.current.set(s.id, s.delay);
    const longest = steps.reduce((m, s) => Math.max(m, s.delay), 0);
    const ids = steps.map((s) => s.id);
    setTimeout(() => {
      for (const id of ids) enterDelayRef.current.delete(id);
    }, longest + FLIGHT_MS + 600);
  }, []);

  // Sincroniza o grafo do store com os nós do React Flow, preservando posições
  useEffect(() => {
    const pos = positionsRef.current;
    if (prevRootRef.current !== rootId) {
      pos.clear();
      tweensRef.current.clear();
      enterDelayRef.current.clear();
      prevRootRef.current = rootId;
    }

    const newcomers = visible.nodes.filter((n) => !pos.has(n.id));
    const firstLoad = newcomers.length > 0 && pos.size === 0;

    if (newcomers.length > 0) {
      if (firstLoad) {
        // primeira carga: layout radial completo, revelado em ondas a partir da raiz
        const layout = radialLayout(visible.nodes, visible.links, rootId);
        layout.forEach((p, id) => pos.set(id, p));
        if (reduced) {
          setTimeout(() => fitView({ padding: 0.18, duration: 0 }), 60);
        } else {
          const depthOf = new Map(visible.nodes.map((n) => [n.id, n.id === rootId ? 0 : n.depth]));
          const parentOf = (id: string) => {
            let best: string | undefined;
            for (const l of visible.links) {
              const s = nid(l.source);
              const t = nid(l.target);
              const other = s === id ? t : t === id ? s : undefined;
              if (!other) continue;
              if ((depthOf.get(other) ?? 99) < (depthOf.get(id) ?? 99) && (!best || (depthOf.get(other) ?? 99) < (depthOf.get(best) ?? 99))) {
                best = other;
              }
            }
            return best;
          };
          const steps = initialEntrance(visible.nodes, pos, parentOf, rootId);
          markBorn(steps);
          for (const st of steps) flyTo(st.id, st.from, pos.get(st.id)!, st.delay, FLIGHT_MS, easeOutBack);
          // câmera: começa colada na raiz e abre junto com a explosão
          // (no próximo quadro: o painel do mapa acabou de montar e ainda não tem tamanho)
          const rootPos = (rootId && pos.get(rootId)) || { x: 0, y: 0 };
          const ids = visible.nodes.map((n) => n.id);
          requestAnimationFrame(() => {
            void setCenter(rootPos.x + 75, rootPos.y + 60, { zoom: 1.35, duration: 0 });
            setTimeout(() => frameTargets(ids, 1500, 0.18), 260);
          });
        }
      } else {
        // expansão incremental: agrupa os novos nós pelo nó âncora já posicionado
        const taken = [...pos.values()];
        const groups = new Map<string, GraphNode[]>();
        for (const n of newcomers) {
          const link = visible.links.find(
            (l) =>
              (nid(l.source) === n.id && pos.has(nid(l.target))) ||
              (nid(l.target) === n.id && pos.has(nid(l.source))),
          );
          const anchor = link ? (nid(link.source) === n.id ? nid(link.target) : nid(link.source)) : rootId ?? '';
          if (!groups.has(anchor)) groups.set(anchor, []);
          groups.get(anchor)!.push(n);
        }
        const steps: { id: string; delay: number; from: XY }[] = [];
        for (const [anchorId, group] of groups) {
          const anchorPos = pos.get(anchorId) ?? { x: 0, y: 0 };
          // centroide dos vizinhos já posicionados do âncora → expande na direção oposta
          const neighborPos: XY[] = [];
          for (const l of visible.links) {
            const s = nid(l.source);
            const t = nid(l.target);
            if (s === anchorId && pos.has(t) && !group.some((g) => g.id === t)) neighborPos.push(pos.get(t)!);
            if (t === anchorId && pos.has(s) && !group.some((g) => g.id === s)) neighborPos.push(pos.get(s)!);
          }
          const awayFrom =
            neighborPos.length > 0
              ? {
                  x: neighborPos.reduce((a, p) => a + p.x, 0) / neighborPos.length,
                  y: neighborPos.reduce((a, p) => a + p.y, 0) / neighborPos.length,
                }
              : null;
          const placed = placeAround(anchorPos, awayFrom, group.length, taken);
          const from = renderedPos(anchorId) ?? anchorPos;
          group.forEach((n, i) => {
            pos.set(n.id, placed[i]);
            steps.push({ id: n.id, delay: Math.min(700, steps.length * 55), from });
          });
        }
        if (!reduced) {
          markBorn(steps);
          for (const st of steps) flyTo(st.id, st.from, pos.get(st.id)!, st.delay, FLIGHT_MS, easeOutBack);
        }
        // câmera só se move se algum recém-chegado for nascer fora da tela
        const pane = document.querySelector('#reactflow-root');
        if (pane) {
          const { width, height } = pane.getBoundingClientRect();
          const { x, y, zoom } = getViewport();
          const out = steps.some(({ id }) => {
            const p = pos.get(id)!;
            return p.x * zoom + x < 0 || (p.x + 150) * zoom + x > width || p.y * zoom + y < 0 || (p.y + 120) * zoom + y > height;
          });
          if (out) setTimeout(() => frameTargets(visible.nodes.map((n) => n.id), reduced ? 0 : 900), 80);
        }
      }
    }

    // reconstrói os dados mas preserva a medição feita pelo React Flow — sem ela o
    // nó volta a "não inicializado" e as arestas dele deixam de ser desenhadas
    setRfNodes((prev) => {
      const measured = new Map(prev.map((n) => [n.id, n.measured]));
      return visible.nodes.map((n) => {
        const built = buildRfNode(n, renderedPos(n.id) ?? pos.get(n.id)!);
        const m = measured.get(n.id);
        return m ? { ...built, measured: m } : built;
      });
    });

    // com forças personalizadas, novos nós disparam o refinamento automático (depois do voo)
    if (newcomers.length > 0 && customizedRef.current) {
      const t = setTimeout(() => runSimRef.current(), reduced ? 150 : FLIGHT_MS + 200);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, rootId, buildRfNode]);

  // Arestas: coreografia calculada junto com os nós (o atraso de entrada vem do mesmo plano)
  useEffect(() => {
    const nodeById = new Map(visible.nodes.map((n) => [n.id, n]));
    const ambient = !reduced && visible.links.length <= AMBIENT_PARTICLE_LIMIT;
    setBaseEdges(
      visible.links.map((l: GraphLink) => {
        const s = nid(l.source);
        const t = nid(l.target);
        const color = linkColor(l);
        const targetNode = nodeById.get(t);
        const sourceNode = nodeById.get(s);
        const involvesBaixada =
          targetNode?.company?.situacao === 'BAIXADA' || sourceNode?.company?.situacao === 'BAIXADA';
        const ds = enterDelayRef.current.get(s);
        const dt = enterDelayRef.current.get(t);
        const born = ds !== undefined || dt !== undefined;
        const context = isContextLink(l);
        return {
          id: l.id,
          source: s,
          target: t,
          type: 'floating',
          data: {
            color,
            label: linkLabel(l),
            dashed: l.meta.situacao === 'RETIRADO' || involvesBaixada,
            context,
            weight: linkProcessCount(l),
            ambient,
            // desenha do nó mais antigo para o recém-chegado, quando o nó termina de voar
            enterDelay: reduced ? undefined : born ? Math.max(ds ?? 0, dt ?? 0) + 120 : 0,
            drawReverse: (ds ?? -1) > (dt ?? -1),
          },
          // vínculo de contexto não tem "sentido" — sem seta
          markerEnd: context ? undefined : { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
        };
      }),
    );
  }, [visible, reduced]);

  const rfEdges = useMemo<FloatingFlowEdge[]>(() => {
    const focusId = hoveredId;
    if (!focusId) return baseEdges;
    return baseEdges.map((e) => {
      const hot = e.source === focusId || e.target === focusId;
      return { ...e, zIndex: hot ? 5 : 0, data: { ...e.data, active: hot, dimmed: !hot } };
    });
  }, [baseEdges, hoveredId]);

  // Reorganizar: re-executa o layout radial completo e DESLIZA os nós até ele;
  // com forças personalizadas, o refinamento por simulação roda em seguida
  useEffect(() => {
    if (organizeRequest === 0) return;
    simRef.current?.stop();
    const layout = radialLayout(visible.nodes, visible.links, rootId);
    const pos = positionsRef.current;
    if (reduced) {
      layout.forEach((p, id) => pos.set(id, p));
      setRfNodes((prev) => prev.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })));
    } else {
      layout.forEach((p, id) => {
        const from = renderedPos(id) ?? p;
        pos.set(id, p);
        if (Math.hypot(from.x - p.x, from.y - p.y) > 1) flyTo(id, from, p, 0, REFLOW_MS, easeInOutCubic);
      });
    }
    setTimeout(() => frameTargets(visible.nodes.map((n) => n.id), reduced ? 0 : REFLOW_MS), 40);
    if (customizedRef.current) {
      const t = setTimeout(() => runSimRef.current(), REFLOW_MS + 100);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizeRequest]);

  // Busca / breadcrumb: centraliza e aplica zoom no nó
  useEffect(() => {
    if (!focusRequest) return;
    fitView({ nodes: [{ id: focusRequest.nodeId }], maxZoom: 1.55, duration: 500 });
  }, [focusRequest, fitView]);

  // ─── Simulação de forças (refinamento estilo Obsidian) ──────────────────────

  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  /** Enquadra suavemente apenas se algum nó saiu da área visível */
  const fitIfOutOfView = useCallback(() => {
    const pane = document.querySelector('#reactflow-root');
    if (!pane) return;
    const { width, height } = pane.getBoundingClientRect();
    const { x, y, zoom } = getViewport();
    const view = { x0: -x / zoom, y0: -y / zoom, x1: (-x + width) / zoom, y1: (-y + height) / zoom };
    const margin = 40;
    const out = rfNodesRef.current.some(
      (n) =>
        n.position.x < view.x0 - margin ||
        n.position.x > view.x1 + margin ||
        n.position.y < view.y0 - margin ||
        n.position.y > view.y1 + margin,
    );
    if (out) fitView({ padding: 0.16, duration: 500 });
  }, [getViewport, fitView]);

  /**
   * Roda a simulação a partir das posições atuais. Interrompe qualquer
   * simulação anterior; atualiza somente x/y (IDs e dados intactos).
   */
  const runSimulation = useCallback(() => {
    simRef.current?.stop();
    settleTweens();
    const pos = positionsRef.current;
    const current = rfNodesRef.current;
    if (current.length < 2) return;
    const simNodes: SimNode[] = current.map((n) => ({
      id: n.id,
      x: pos.get(n.id)?.x ?? n.position.x,
      y: pos.get(n.id)?.y ?? n.position.y,
      radius: n.data.radius,
    }));
    const simLinks = visibleRef.current.links.map((l) => ({ source: nid(l.source), target: nid(l.target) }));
    const refiner = new ForceRefiner(simNodes, simLinks, settingsRef.current);
    simRef.current = refiner;
    refiner.start(
      (ns) => {
        const byId = new Map(ns.map((n) => [n.id, n]));
        for (const n of ns) pos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
        setRfNodes((prev) =>
          prev.map((n) => {
            const s = byId.get(n.id);
            return s ? { ...n, position: { x: s.x ?? 0, y: s.y ?? 0 } } : n;
          }),
        );
      },
      () => fitIfOutOfView(),
    );
  }, [fitIfOutOfView, settleTweens]);
  runSimRef.current = runSimulation;

  // slider movido → debounce curto, sem fitView a cada passo
  const settingsTouched = useRef(false);
  useEffect(() => {
    if (!settingsTouched.current) {
      settingsTouched.current = true;
      return; // primeira renderização (inclusive valores vindos do localStorage)
    }
    const t = setTimeout(() => runSimulation(), 300);
    return () => clearTimeout(t);
  }, [forceSettings, runSimulation]);

  // botão "Animar"
  useEffect(() => {
    if (animateRequest === 0) return;
    runSimulation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animateRequest]);

  // simulação e voo nunca brigam com o arrasto manual
  const onNodeDragStart = useCallback((_: unknown, node: EntityFlowNode) => {
    simRef.current?.stop();
    const tw = tweensRef.current.get(node.id);
    if (tw) {
      tweensRef.current.delete(node.id);
      positionsRef.current.set(node.id, livePosRef.current.get(node.id) ?? tw.to);
    }
  }, []);

  useEffect(() => () => simRef.current?.stop(), []);

  const onNodesChange = useCallback((changes: NodeChange<EntityFlowNode>[]) => {
    setRfNodes((prev) => applyNodeChanges(changes, prev));
    for (const ch of changes) {
      if (ch.type === 'position' && ch.position && !ch.dragging) {
        positionsRef.current.set(ch.id, ch.position);
      }
    }
  }, []);

  // um clique seleciona (painel de detalhes); dois cliques expandem as conexões
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: EntityFlowNode) => {
      selectNode(node.id);
    },
    [selectNode],
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: EntityFlowNode) => {
      selectNode(node.id);
      if (!node.data.expanded) void expandNode(node.id);
    },
    [selectNode, expandNode],
  );

  const onNodeMouseEnter = useCallback((_: React.MouseEvent, node: EntityFlowNode) => setHoveredId(node.id), []);
  const onNodeMouseLeave = useCallback(() => setHoveredId(null), []);

  return (
    <div id="reactflow-root" className={hoveredId ? 'has-focus' : undefined} aria-label="Mapa societário interativo">
      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStart={onNodeDragStart}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onPaneClick={() => selectNode(null)}
        zoomOnDoubleClick={false}
        minZoom={0.15}
        maxZoom={1.8}
        nodesConnectable={false}
        edgesReconnectable={false}
        proOptions={{ hideAttribution: true }}
        colorMode={theme}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#d5dde8" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );
}
