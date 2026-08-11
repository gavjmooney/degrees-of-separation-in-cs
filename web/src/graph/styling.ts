/**
 * Visual encoding.
 *
 * - Path nodes are SQUARES in accent colours (shape + colour redundancy);
 *   everything else is a circle.
 * - Nodes/edges fade with hop distance from the path; edge thickness and
 *   opacity also encode co-authorship weight.
 * - Nodes on an *alternative* shortest path are dim amber squares.
 * - Labels render ABOVE nodes on a dark pill so path edges never cross them.
 *   Which nodes get one is decided either by a per-node rule (path only, all
 *   shortest paths, or a budget of the most important neighbours by
 *   publication count) or by an explicit id set computed over the whole graph
 *   — see labels.ts.
 */
import type Graph from "graphology";
import { NodeSquareProgram } from "@sigma/node-square";
import type { Settings } from "sigma/settings";
import type { PathEdge, PathNode } from "../api/types";
import type { LabelMode } from "./labels";
import type { SeedPos } from "./layout";

/** Node/edge px scale and label px size. Layout separation is a fixed constant
 *  (DEFAULT_SPACING) rather than a user control, so these are constants too:
 *  they hold the graphics at their old "normal" weight while the layout runs
 *  airier than it used to. */
export const NODE_SIZE_SCALE = 0.7;
export const LABEL_SIZE = 9;
const PATH_LABEL_PX = 10.8;
const ENDPOINT_LABEL_PX = 12.4;

export interface Palette {
  endpointA: string;
  endpointB: string;
  pathNode: string;
  pathEdge: string;
  altNode: string;
  altEdge: string;
  disambig: string;
  labelText: string;
  background: string;
  dimmed: string;
  legendNeighbour: string;
  edgeHover: string;
  /** "r,g,b" components used inside rgba(...) so alpha can vary */
  pillBg: string;
  neighbourNear: string;
  neighbourFar: string;
  neighbourDisambig: string;
  edgeRgb: string;
  /** scales / caps the per-edge alpha (light needs more, white bg hides faint edges) */
  edgeAlphaMul: number;
  edgeAlphaCap: number;
}

export const DARK_COLORS: Palette = {
  endpointA: "#ff7b39",
  endpointB: "#3fc1ff",
  pathNode: "#ffd166",
  pathEdge: "#ffd166",
  altNode: "#5fd99a",
  altEdge: "rgba(95,217,154,0.45)",
  disambig: "#b07cd8",
  labelText: "#e8eaf0",
  background: "#11141a",
  dimmed: "rgba(43,50,69,0.5)",
  legendNeighbour: "#8d99ae",
  edgeHover: "rgba(159,180,220,0.92)",
  pillBg: "13,16,22",
  neighbourNear: "141,153,174",
  neighbourFar: "92,103,125",
  neighbourDisambig: "176,124,216",
  edgeRgb: "76,88,116",
  edgeAlphaMul: 1,
  edgeAlphaCap: 0.55,
};

// Hand-tuned for a light background: accents deepened for contrast, neighbour
// greys darkened (near) / lightened (far) so they still fade with distance,
// and label pills flipped to white with dark text.
export const LIGHT_COLORS: Palette = {
  endpointA: "#e8590c",
  endpointB: "#1668b5",
  pathNode: "#bb8400",
  pathEdge: "#bb8400",
  altNode: "#0d8048",
  altEdge: "rgba(13,128,72,0.75)",
  disambig: "#7c4fb0",
  labelText: "#1a1f29",
  background: "#f6f7f9",
  dimmed: "rgba(150,158,175,0.55)",
  legendNeighbour: "#5a6480",
  edgeHover: "rgba(20,86,168,0.9)",
  pillBg: "255,255,255",
  neighbourNear: "84,94,118",
  neighbourFar: "132,142,162",
  neighbourDisambig: "126,79,176",
  edgeRgb: "84,96,124",
  edgeAlphaMul: 2.6,
  edgeAlphaCap: 0.9,
};

/** Back-compat default (dark) for code paths that aren't theme-aware (e.g. SVG export). */
export const COLORS = DARK_COLORS;

export function getColors(theme: "light" | "dark"): Palette {
  return theme === "light" ? LIGHT_COLORS : DARK_COLORS;
}

// The sigma label drawers and reducers run as callbacks we don't pass args to,
// so they read the current palette from this module-level slot, updated on theme
// change (then sigma.refresh re-runs them). Node/edge base colours are baked in
// at build/recolor time via an explicit palette argument instead.
let activePalette: Palette = DARK_COLORS;
export function setActivePalette(p: Palette): void {
  activePalette = p;
}

function neighbourNodeColor(hop: number, isDisambig: boolean, p: Palette): string {
  const alpha = hop <= 1 ? 0.9 : 0.45;
  const rgb = isDisambig ? p.neighbourDisambig : hop <= 1 ? p.neighbourNear : p.neighbourFar;
  return `rgba(${rgb},${alpha})`;
}

function neighbourEdgeColor(weight: number, minHop: number, p: Palette): string {
  const byWeight = 0.14 + 0.07 * Math.log2(1 + weight);
  const byHop = minHop === 0 ? 1 : minHop === 1 ? 0.65 : 0.35;
  const alpha = Math.min(p.edgeAlphaCap, byWeight * byHop * p.edgeAlphaMul);
  return `rgba(${p.edgeRgb},${alpha.toFixed(2)})`;
}

export function nodeSize(pubCount: number): number {
  return Math.min(16, 3.5 + 2.2 * Math.log10(1 + pubCount));
}

export function edgeSize(weight: number, onPath: boolean, onAlt: boolean): number {
  if (onPath) return 5;
  if (onAlt) return 2.5;
  return Math.min(2, 0.4 + 0.35 * Math.log2(1 + weight));
}

interface LabelData {
  x: number;
  y: number;
  size: number;
  label?: string | null;
}

/** Font a node's label is drawn in, by node type. */
export function labelFontFor(type: string, defaultPx: number): { px: number; weight: number } {
  if (type === "endpointSquare") return { px: ENDPOINT_LABEL_PX, weight: 700 };
  if (type === "square") return { px: PATH_LABEL_PX, weight: 700 };
  return { px: defaultPx, weight: 500 };
}

/**
 * The pill rect drawn for a label, in the same space as its inputs. Shared with
 * the overlap test behind the "few" label mode, so what that test measures is
 * exactly what gets painted.
 */
export function labelPillBox(
  x: number,
  y: number,
  nodeSize: number,
  textWidth: number,
  fontPx: number,
): { x: number; y: number; w: number; h: number } {
  const pad = 3;
  const ty = y - nodeSize - 5;
  return {
    x: x - textWidth / 2 - pad,
    y: ty - fontPx - pad + 1,
    w: textWidth + 2 * pad,
    h: fontPx + 2 * pad,
  };
}

/** Draw a label centred ABOVE the node on a translucent pill. */
function drawPill(
  context: CanvasRenderingContext2D,
  data: LabelData,
  settings: Settings,
  fontSize: number,
  fontWeight: string,
  pillAlpha: number,
): void {
  if (!data.label) return;
  context.font = `${fontWeight} ${fontSize}px ${settings.labelFont}`;
  const width = context.measureText(data.label).width;
  const box = labelPillBox(data.x, data.y, data.size, width, fontSize);
  context.fillStyle = `rgba(${activePalette.pillBg},${pillAlpha})`;
  context.fillRect(box.x, box.y, box.w, box.h);
  context.fillStyle = activePalette.labelText;
  context.textAlign = "center";
  context.fillText(data.label, data.x, data.y - data.size - 7);
  context.textAlign = "left"; // restore canvas default for other drawers
}

/** Neighbour (circle) labels. */
export function drawLabelAbove(
  context: CanvasRenderingContext2D,
  data: LabelData,
  settings: Settings,
): void {
  drawPill(context, data, settings, settings.labelSize, "500", 0.72);
}

/** Intermediate path-node labels: bold. */
export function drawPathLabelAbove(
  context: CanvasRenderingContext2D,
  data: LabelData,
  settings: Settings,
): void {
  drawPill(context, data, settings, PATH_LABEL_PX, "700", 0.85);
}

/** Endpoint labels: boldest and largest. */
export function drawEndpointLabelAbove(
  context: CanvasRenderingContext2D,
  data: LabelData,
  settings: Settings,
): void {
  drawPill(context, data, settings, ENDPOINT_LABEL_PX, "700", 0.85);
}

/**
 * The square program ships its own classic right-of-node drawLabel/drawHover,
 * which sigma prefers over the settings defaults — override both so path
 * nodes use the above-node pill style like everything else.
 */
export class PathSquareProgram extends NodeSquareProgram {
  drawLabel = drawPathLabelAbove as NodeSquareProgram["drawLabel"];
  drawHover = (() => {}) as NodeSquareProgram["drawHover"];
}

/** Endpoints: largest bold labels. */
export class EndpointSquareProgram extends NodeSquareProgram {
  drawLabel = drawEndpointLabelAbove as NodeSquareProgram["drawLabel"];
  drawHover = (() => {}) as NodeSquareProgram["drawHover"];
}

/** Alternative-path squares keep the regular (non-bold) label styling. */
export class AltSquareProgram extends NodeSquareProgram {
  drawLabel = drawLabelAbove as NodeSquareProgram["drawLabel"];
  drawHover = (() => {}) as NodeSquareProgram["drawHover"];
}

export interface BuildExtras {
  altNodes: Set<number>;
  altEdges: Set<number>;
}

export function nodeColor(n: PathNode, pathLen: number, isAlt: boolean, p: Palette): string {
  if (n.pathIndex === 0) return p.endpointA;
  if (n.pathIndex === pathLen - 1) return p.endpointB;
  if (n.onPath) return p.pathNode;
  if (isAlt) return p.altNode;
  return neighbourNodeColor(n.hop, n.isDisambig, p);
}

export function buildGraphAttributes(
  graph: Graph,
  nodes: PathNode[],
  edges: PathEdge[],
  positions: Map<number, SeedPos>,
  extras: BuildExtras,
  sizeScale = 1,
  palette: Palette = DARK_COLORS,
): void {
  const pathLen = nodes.filter((n) => n.onPath).length;

  // label budget ranking: alternative-path nodes first, then by pub count
  const ranked = nodes
    .filter((n) => !n.onPath)
    .sort((a, b) => {
      const aAlt = extras.altNodes.has(a.id) ? 1 : 0;
      const bAlt = extras.altNodes.has(b.id) ? 1 : 0;
      return bAlt - aAlt || b.pubCount - a.pubCount;
    });
  const labelRank = new Map(ranked.map((n, i) => [n.id, i]));

  // max incident weight, for hiding nodes once all their edges are filtered
  const maxW = new Map<number, number>();
  for (const e of edges) {
    maxW.set(e.s, Math.max(maxW.get(e.s) ?? 0, e.weight));
    maxW.set(e.t, Math.max(maxW.get(e.t) ?? 0, e.weight));
  }

  for (const n of nodes) {
    const p = positions.get(n.id)!;
    const isEndpoint = n.pathIndex === 0 || n.pathIndex === pathLen - 1;
    const isAlt = extras.altNodes.has(n.id);
    graph.addNode(String(n.id), {
      x: p.x,
      y: p.y,
      anchorX: p.ax,
      anchorY: p.ay,
      fixedX: p.fixedX,
      fixedY: p.fixedY,
      type: n.onPath
        ? isEndpoint
          ? "endpointSquare"
          : "square"
        : isAlt
          ? "altSquare"
          : "circle",
      label: n.isDisambig ? `${n.name} (disambiguation)` : n.name,
      size:
        (n.onPath
          ? Math.max(nodeSize(n.pubCount) + 2, isEndpoint ? 16 : 11)
          : Math.min(nodeSize(n.pubCount), 9) * (isAlt ? 1.15 : 1)) * sizeScale,
      color: nodeColor(n, pathLen, isAlt, palette),
      pinned: n.onPath,
      onPath: n.onPath,
      isAlt,
      labelRank: labelRank.get(n.id) ?? Infinity,
      maxWeight: n.onPath || isAlt ? Infinity : (maxW.get(n.id) ?? 0),
      zIndex: n.onPath ? 3 : isAlt ? 2 : 1,
    });
  }
  const hopOf = new Map(nodes.map((n) => [n.id, n.hop]));
  edges.forEach((e, i) => {
    const isAlt = extras.altEdges.has(i);
    const minHop = Math.min(hopOf.get(e.s) ?? 9, hopOf.get(e.t) ?? 9);
    graph.addEdge(String(e.s), String(e.t), {
      weight: e.weight,
      size: edgeSize(e.weight, e.onPath, isAlt) * sizeScale,
      color: e.onPath ? palette.pathEdge : isAlt ? palette.altEdge : neighbourEdgeColor(e.weight, minHop, palette),
      onPath: e.onPath,
      isAlt,
      zIndex: e.onPath ? 3 : isAlt ? 2 : 1,
    });
  });
}

/**
 * Re-apply node/edge colours for a new palette in place — same graph, same
 * layout, just recoloured (no rebuild). Mirrors the colour logic in
 * buildGraphAttributes; callers also setActivePalette + sigma.refresh.
 */
export function recolorGraph(
  graph: Graph,
  nodes: PathNode[],
  extras: BuildExtras,
  p: Palette,
): void {
  const pathLen = nodes.filter((n) => n.onPath).length;
  for (const n of nodes) {
    const id = String(n.id);
    if (graph.hasNode(id)) {
      graph.setNodeAttribute(id, "color", nodeColor(n, pathLen, extras.altNodes.has(n.id), p));
    }
  }
  const hopOf = new Map(nodes.map((n) => [n.id, n.hop]));
  graph.forEachEdge((edge, attrs, s, t) => {
    const onPath = attrs.onPath as boolean;
    const isAlt = attrs.isAlt as boolean;
    const weight = attrs.weight as number;
    const minHop = Math.min(hopOf.get(Number(s)) ?? 9, hopOf.get(Number(t)) ?? 9);
    graph.setEdgeAttribute(
      edge,
      "color",
      onPath ? p.pathEdge : isAlt ? p.altEdge : neighbourEdgeColor(weight, minHop, p),
    );
  });
}

export interface ViewState {
  hoveredNode: string | null;
  hoveredNeighbours: Set<string> | null;
  hoveredEdge: string | null;
  /** hide non-path edges below this co-authorship weight */
  minWeight: number;
  labels: LabelMode;
  /** the exact nodes to label, for the modes that resolve to a set ("few",
   *  "custom"); null means fall back to `labels`' per-node rule */
  labelSet: Set<string> | null;
}

/** Per-node labelling rule for the budget-style modes. */
function labelledByRule(mode: LabelMode, data: Record<string, unknown>): boolean {
  if (data.onPath === true) return true;
  if (mode.kind === "path") return false;
  if (data.isAlt === true) return true;
  return mode.kind === "top" && (data.labelRank as number) < mode.n;
}

export function makeReducers(graph: Graph, state: ViewState) {
  return {
    nodeReducer(node: string, data: Record<string, unknown>) {
      const res = { ...data };
      if (!data.onPath && (data.maxWeight as number) < state.minWeight) {
        res.hidden = true;
        return res;
      }
      const labelled = state.labelSet
        ? state.labelSet.has(node)
        : labelledByRule(state.labels, data);
      if (!labelled) res.label = null;
      res.forceLabel = labelled;
      if (state.hoveredNode) {
        if (node === state.hoveredNode || state.hoveredNeighbours?.has(node)) {
          res.label = data.label;
          res.forceLabel = true;
          res.zIndex = 5;
        } else {
          res.color = activePalette.dimmed;
          res.label = null;
          res.forceLabel = false;
        }
      }
      return res;
    },
    edgeReducer(edge: string, data: Record<string, unknown>) {
      const res = { ...data };
      if (!data.onPath && (data.weight as number) < state.minWeight) {
        res.hidden = true;
        return res;
      }
      if (state.hoveredNode) {
        const [s, t] = graph.extremities(edge);
        if (s !== state.hoveredNode && t !== state.hoveredNode) {
          res.color = activePalette.dimmed;
          res.zIndex = 0;
        } else {
          res.color = data.onPath ? activePalette.pathEdge : activePalette.edgeHover;
          res.zIndex = 5;
        }
      }
      if (state.hoveredEdge === edge) {
        res.color = activePalette.edgeHover;
        res.size = (data.size as number) * 1.8;
        res.zIndex = 6;
      }
      return res;
    },
  };
}
