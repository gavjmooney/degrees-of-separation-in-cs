import { useEffect, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import type { PathEdge, PathNode } from "../api/types";
import {
  deriveAltAndLayers,
  seedPositions,
  startLayout,
  type LayoutHandle,
  type ViewMode,
} from "../graph/layout";
import {
  AltSquareProgram,
  buildGraphAttributes,
  drawLabelAbove,
  EndpointSquareProgram,
  makeReducers,
  PathSquareProgram,
  COLORS,
  type ViewState,
} from "../graph/styling";
import { downloadSvg, type ExportContext } from "../graph/svgExport";

export interface ViewOptions {
  mode: ViewMode;
  spacing: number;
  minWeight: number;
  labelBudget: number;
}

export interface EdgeSelection {
  u: number;
  v: number;
  uName: string;
  vName: string;
  weight: number;
}

interface Props {
  nodes: PathNode[];
  edges: PathEdge[];
  hops: number;
  fromId: number;
  toId: number;
  options: ViewOptions;
  exportContext: ExportContext;
  /** mounted while the map fades out over us: start zoomed out and dive in */
  intro?: boolean;
  /** the map is fading in over us: drift the camera outward to meet it */
  outro?: boolean;
  onNodeClick: (id: number) => void;
  onEdgeClick: (sel: EdgeSelection) => void;
  onBackgroundClick: () => void;
}

type HoverInfo =
  | { kind: "node"; node: PathNode; isAlt: boolean }
  | { kind: "edge"; uName: string; vName: string; weight: number };

export function GraphCanvas({
  nodes,
  edges,
  hops,
  fromId,
  toId,
  options,
  exportContext,
  intro,
  outro,
  onNodeClick,
  onEdgeClick,
  onBackgroundClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const viewStateRef = useRef<ViewState>({
    hoveredNode: null,
    hoveredNeighbours: null,
    hoveredEdge: null,
    minWeight: options.minWeight,
    labelBudget: options.labelBudget,
  });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const callbacks = useRef({ onNodeClick, onEdgeClick, onBackgroundClick });
  callbacks.current = { onNodeClick, onEdgeClick, onBackgroundClick };
  // read at mount time only, so option changes never replay the intro
  const introRef = useRef(intro === true);
  introRef.current = intro === true;

  // full rebuild on data / layout-shaping changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || nodes.length === 0) return;

    const byId = new Map(nodes.map((n) => [String(n.id), n]));
    const extras = deriveAltAndLayers(nodes, edges, fromId, toId, hops);
    const positions = seedPositions(nodes, edges, options.mode, options.spacing, extras.layer);

    const graph = new Graph({ type: "undirected" });
    // node/edge px sizes shrink as spacing grows: the camera always fits the
    // whole graph, so on-screen whitespace comes from smaller items, while
    // the higher repulsion below changes the layout structure itself
    buildGraphAttributes(graph, nodes, edges, positions, extras, 1 / Math.sqrt(options.spacing));

    const state = viewStateRef.current;
    state.hoveredNode = null;
    state.hoveredNeighbours = null;
    state.hoveredEdge = null;
    const reducers = makeReducers(graph, state);
    const sigma = new Sigma(graph, container, {
      enableEdgeEvents: true,
      zIndex: true,
      nodeProgramClasses: {
        square: PathSquareProgram,
        endpointSquare: EndpointSquareProgram,
        altSquare: AltSquareProgram,
      },
      defaultDrawNodeLabel: drawLabelAbove,
      defaultDrawNodeHover: () => {}, // hover feedback comes from reducers + the info card
      labelColor: { color: COLORS.labelText },
      labelSize: Math.max(8, Math.round(11 / Math.sqrt(options.spacing))),
      labelDensity: 10, // importance budget decides labels, not the grid
      labelRenderedSizeThreshold: 0,
      nodeReducer: reducers.nodeReducer,
      edgeReducer: reducers.edgeReducer,
      stagePadding: 40,
      minCameraRatio: 0.05,
      maxCameraRatio: 4,
    });
    sigmaRef.current = sigma;
    // test/debug hook (used by the e2e driver to locate nodes/edges on screen)
    (window as unknown as { __sigma?: Sigma }).__sigma = sigma;

    // arriving from the map's zoom: continue the dive into the local view
    if (introRef.current) {
      const camera = sigma.getCamera();
      camera.setState({ ratio: 2.6 });
      camera.animate({ ratio: 1 }, { duration: 1400, easing: "quadraticOut" });
    }

    const layout: LayoutHandle = startLayout(graph, options.spacing);
    let raf = 0;
    const tick = () => {
      if (layout.step()) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    sigma.on("enterNode", ({ node }) => {
      state.hoveredNode = node;
      state.hoveredNeighbours = new Set(graph.neighbors(node));
      const data = byId.get(node);
      if (data) setHover({ kind: "node", node: data, isAlt: extras.altNodes.has(data.id) });
      container.style.cursor = "pointer";
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveNode", () => {
      state.hoveredNode = null;
      state.hoveredNeighbours = null;
      setHover(null);
      container.style.cursor = "default";
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("clickNode", ({ node }) => callbacks.current.onNodeClick(Number(node)));
    sigma.on("enterEdge", ({ edge }) => {
      state.hoveredEdge = edge;
      const [s, t] = graph.extremities(edge);
      setHover({
        kind: "edge",
        uName: byId.get(s)?.name ?? "?",
        vName: byId.get(t)?.name ?? "?",
        weight: graph.getEdgeAttribute(edge, "weight") as number,
      });
      container.style.cursor = "pointer";
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("leaveEdge", () => {
      state.hoveredEdge = null;
      setHover(null);
      container.style.cursor = "default";
      sigma.refresh({ skipIndexation: true });
    });
    sigma.on("clickEdge", ({ edge }) => {
      const [s, t] = graph.extremities(edge);
      const u = byId.get(s);
      const v = byId.get(t);
      if (u && v) {
        callbacks.current.onEdgeClick({
          u: u.id,
          v: v.id,
          uName: u.name,
          vName: v.name,
          weight: graph.getEdgeAttribute(edge, "weight") as number,
        });
      }
    });
    sigma.on("clickStage", () => callbacks.current.onBackgroundClick());

    return () => {
      cancelAnimationFrame(raf);
      layout.stop();
      sigma.kill();
      sigmaRef.current = null;
      setHover(null);
    };
  }, [nodes, edges, hops, fromId, toId, options.mode, options.spacing]);

  // cheap live updates: filtering + label budget only need a refresh
  useEffect(() => {
    viewStateRef.current.minWeight = options.minWeight;
    viewStateRef.current.labelBudget = options.labelBudget;
    sigmaRef.current?.refresh();
  }, [options.minWeight, options.labelBudget]);

  // a new query is starting: drift outward while the map fades in above us
  useEffect(() => {
    if (outro) {
      sigmaRef.current?.getCamera().animate({ ratio: 3.5 }, { duration: 1500, easing: "quadraticIn" });
    }
  }, [outro]);

  return (
    <div className="graph-wrap">
      <div ref={containerRef} className="graph-canvas" />
      <div className={`hover-card ${hover ? "" : "hover-card-empty"}`}>
        {hover === null && <span className="hover-hint">Hover a node or edge for details</span>}
        {hover?.kind === "node" && (
          <>
            <div className="hover-name">
              {hover.node.name}
              {hover.node.isDisambig && <span className="badge">disambiguation</span>}
            </div>
            <div className="hover-row">{hover.node.pubCount.toLocaleString()} publications</div>
            <div className="hover-row">{hover.node.degree.toLocaleString()} co-authors</div>
            {hover.node.onPath && <div className="hover-row on-path">on the shortest path</div>}
            {hover.isAlt && <div className="hover-row on-path">on an alternative shortest path</div>}
            {!hover.node.onPath && !hover.isAlt && (
              <div className="hover-row">{hover.node.hop} hop{hover.node.hop > 1 ? "s" : ""} from the path</div>
            )}
            <div className="hover-hint">click for details</div>
          </>
        )}
        {hover?.kind === "edge" && (
          <>
            <div className="hover-name">
              {hover.uName} <span className="edge-amp">&</span> {hover.vName}
            </div>
            <div className="hover-row">
              {hover.weight} co-authored {hover.weight === 1 ? "paper" : "papers"}
            </div>
            <div className="hover-hint">click to list them</div>
          </>
        )}
      </div>
      <button
        className="recenter"
        title="Re-center view"
        onClick={() => sigmaRef.current?.getCamera().animatedReset()}
      >
        ⌖
      </button>
      <button
        className="export-btn"
        title="Export the current view as SVG"
        onClick={() => sigmaRef.current && downloadSvg(sigmaRef.current, exportContext)}
      >
        ⤓ SVG
      </button>
    </div>
  );
}
