import { useEffect, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";
import type { PathEdge, PathNode } from "../api/types";
import {
  labelPriority,
  pickByBudget,
  pickNonOverlapping,
  type LabelBox,
  type LabelMode,
} from "../graph/labels";
import {
  DEFAULT_SPACING,
  deriveAltAndLayers,
  isShapeMode,
  seedPositions,
  startLayout,
  type LayoutHandle,
  type ViewMode,
} from "../graph/layout";
import {
  AltSquareProgram,
  buildGraphAttributes,
  type BuildExtras,
  drawLabelAbove,
  EndpointSquareProgram,
  getColors,
  LABEL_SIZE,
  labelFontFor,
  labelPillBox,
  makeReducers,
  NODE_SIZE_SCALE,
  PathSquareProgram,
  recolorGraph,
  setActivePalette,
  type ViewState,
} from "../graph/styling";
import { downloadSvg, type ExportContext } from "../graph/svgExport";
import { useTheme } from "../theme";

export interface ViewOptions {
  mode: ViewMode;
  minWeight: number;
  labels: LabelMode;
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
  const { theme } = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  // graph + source data kept for in-place recolouring on theme change
  const graphRef = useRef<Graph | null>(null);
  const dataRef = useRef<{ nodes: PathNode[]; edges: PathEdge[]; extras: BuildExtras } | null>(null);
  const viewStateRef = useRef<ViewState>({
    hoveredNode: null,
    hoveredNeighbours: null,
    hoveredEdge: null,
    minWeight: options.minWeight,
    labels: options.labels,
    labelSet: null,
  });
  // re-picks the labelled nodes for the current mode; owned by the build effect
  const applyLabelsRef = useRef<(() => void) | null>(null);
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
    // portrait screens: layered mode runs top-to-bottom so the path fits
    const flip = options.mode === "layered" && container.clientHeight > container.clientWidth;
    const positions = seedPositions(
      nodes,
      edges,
      options.mode,
      DEFAULT_SPACING,
      extras.layer,
      flip,
    );

    const graph = new Graph({ type: "undirected" });
    const palette = getColors(themeRef.current);
    setActivePalette(palette);
    buildGraphAttributes(graph, nodes, edges, positions, extras, NODE_SIZE_SCALE, palette);
    graphRef.current = graph;
    dataRef.current = { nodes, edges, extras };

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
      labelColor: { color: palette.labelText },
      labelSize: LABEL_SIZE,
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

    // ---- label selection ----
    // "custom" takes a prefix of the priority order; "few" walks the same order
    // but keeps only labels whose pill clears the ones already placed, which
    // has to be measured in screen space against the settled layout.
    const priority = labelPriority(nodes, extras.altNodes, fromId * 31 + toId);
    const pathIds = new Set(nodes.filter((n) => n.onPath).map((n) => n.id));
    const measure = document.createElement("canvas").getContext("2d");
    let settled = false;

    const isVisible = (id: number) =>
      (graph.getNodeAttribute(String(id), "maxWeight") as number) >= state.minWeight;

    const boxOf = (id: number): LabelBox | null => {
      const key = String(id);
      if (!measure || !graph.hasNode(key) || !isVisible(id)) return null;
      const attrs = graph.getNodeAttributes(key);
      const label = attrs.label as string | null;
      if (!label) return null;
      const { px, weight } = labelFontFor(attrs.type as string, LABEL_SIZE);
      measure.font = `${weight} ${px}px ${sigma.getSetting("labelFont")}`;
      const at = sigma.graphToViewport({ x: attrs.x as number, y: attrs.y as number });
      const nodePx = sigma.getNodeDisplayData(key)?.size ?? 0;
      return labelPillBox(at.x, at.y, nodePx, measure.measureText(label).width, px);
    };

    const applyLabels = () => {
      const mode = state.labels;
      if (mode.kind === "custom") {
        state.labelSet = pickByBudget(priority, mode.n, isVisible);
      } else if (mode.kind === "few") {
        // while the simulation is still running the nodes are moving, so hold
        // at the main path and fill the rest in once positions are final
        state.labelSet = settled
          ? pickNonOverlapping(priority, pathIds, boxOf)
          : new Set([...pathIds].map(String));
      } else {
        state.labelSet = null;
      }
      sigma.refresh({ skipIndexation: true });
    };
    applyLabelsRef.current = applyLabels;
    applyLabels();

    // the overlap test is screen-space, so re-pick whenever the view changes
    const camera = sigma.getCamera();
    let idleTimer = 0;
    const onViewChange = () => {
      if (!settled || state.labels.kind !== "few") return;
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(applyLabels, 150);
    };
    camera.on("updated", onViewChange);
    sigma.on("resize", onViewChange);

    const layout: LayoutHandle = startLayout(graph, DEFAULT_SPACING, {
      isotropic: isShapeMode(options.mode),
      onSettled: () => {
        settled = true;
        applyLabels();
      },
    });
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
      window.clearTimeout(idleTimer);
      camera.off("updated", onViewChange);
      layout.stop();
      sigma.kill();
      sigmaRef.current = null;
      applyLabelsRef.current = null;
      setHover(null);
    };
  }, [nodes, edges, hops, fromId, toId, options.mode]);

  // cheap live updates: filtering + label mode only need a re-pick and a refresh
  useEffect(() => {
    viewStateRef.current.minWeight = options.minWeight;
    viewStateRef.current.labels = options.labels;
    if (applyLabelsRef.current) applyLabelsRef.current();
    else sigmaRef.current?.refresh();
  }, [options.minWeight, options.labels]);

  // theme change: recolour the existing graph in place (no rebuild, so the
  // layout and camera are untouched)
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    const data = dataRef.current;
    if (!sigma || !graph || !data) return;
    const palette = getColors(theme);
    setActivePalette(palette);
    recolorGraph(graph, data.nodes, data.extras, palette);
    sigma.setSetting("labelColor", { color: palette.labelText });
    sigma.refresh();
  }, [theme]);

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
        onClick={() => sigmaRef.current && downloadSvg(sigmaRef.current, exportContext, theme)}
      >
        ⤓ SVG
      </button>
    </div>
  );
}
