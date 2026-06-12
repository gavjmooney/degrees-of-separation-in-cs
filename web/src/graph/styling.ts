/**
 * Visual encoding.
 *
 * - Path nodes are SQUARES in accent colours (shape + colour redundancy);
 *   everything else is a circle.
 * - Nodes/edges fade with hop distance from the path; edge thickness and
 *   opacity also encode co-authorship weight.
 * - Nodes on an *alternative* shortest path are dim amber squares.
 * - Labels render ABOVE nodes on a dark pill so path edges never cross them.
 *   Only the path, alternative-path nodes, and a budget of the most
 *   important neighbours (by publication count) get labels.
 */
import type Graph from "graphology";
import { NodeSquareProgram } from "@sigma/node-square";
import type { Settings } from "sigma/settings";
import type { PathEdge, PathNode } from "../api/types";
import type { SeedPos } from "./layout";

export const COLORS = {
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
};

function neighbourNodeColor(hop: number, isDisambig: boolean): string {
  const alpha = hop <= 1 ? 0.9 : 0.45;
  if (isDisambig) return `rgba(176,124,216,${alpha})`;
  return hop <= 1 ? `rgba(141,153,174,${alpha})` : `rgba(92,103,125,${alpha})`;
}

function neighbourEdgeColor(weight: number, minHop: number): string {
  const byWeight = 0.14 + 0.07 * Math.log2(1 + weight);
  const byHop = minHop === 0 ? 1 : minHop === 1 ? 0.65 : 0.35;
  return `rgba(76,88,116,${Math.min(0.55, byWeight * byHop).toFixed(2)})`;
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
  const tx = data.x;
  const ty = data.y - data.size - 5;
  context.fillStyle = `rgba(13,16,22,${pillAlpha})`;
  const pad = 3;
  context.fillRect(tx - width / 2 - pad, ty - fontSize - pad + 1, width + 2 * pad, fontSize + 2 * pad);
  context.fillStyle = COLORS.labelText;
  context.textAlign = "center";
  context.fillText(data.label, tx, ty - 2);
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
  drawPill(context, data, settings, 10.8, "700", 0.85);
}

/** Endpoint labels: boldest and largest. */
export function drawEndpointLabelAbove(
  context: CanvasRenderingContext2D,
  data: LabelData,
  settings: Settings,
): void {
  drawPill(context, data, settings, 12.4, "700", 0.85);
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

export function nodeColor(n: PathNode, pathLen: number, isAlt: boolean): string {
  if (n.pathIndex === 0) return COLORS.endpointA;
  if (n.pathIndex === pathLen - 1) return COLORS.endpointB;
  if (n.onPath) return COLORS.pathNode;
  if (isAlt) return COLORS.altNode;
  return neighbourNodeColor(n.hop, n.isDisambig);
}

export function buildGraphAttributes(
  graph: Graph,
  nodes: PathNode[],
  edges: PathEdge[],
  positions: Map<number, SeedPos>,
  extras: BuildExtras,
  sizeScale = 1,
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
      color: nodeColor(n, pathLen, isAlt),
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
      color: e.onPath ? COLORS.pathEdge : isAlt ? COLORS.altEdge : neighbourEdgeColor(e.weight, minHop),
      onPath: e.onPath,
      isAlt,
      zIndex: e.onPath ? 3 : isAlt ? 2 : 1,
    });
  });
}

export interface ViewState {
  hoveredNode: string | null;
  hoveredNeighbours: Set<string> | null;
  hoveredEdge: string | null;
  /** hide non-path edges below this co-authorship weight */
  minWeight: number;
  /** how many non-path nodes get permanent labels; -1 = main path only
   *  (alternative-path nodes are always labelled from 0 upward) */
  labelBudget: number;
}

export function makeReducers(graph: Graph, state: ViewState) {
  return {
    nodeReducer(node: string, data: Record<string, unknown>) {
      const res = { ...data };
      if (!data.onPath && (data.maxWeight as number) < state.minWeight) {
        res.hidden = true;
        return res;
      }
      const labelled =
        data.onPath === true ||
        (state.labelBudget >= 0 && data.isAlt === true) ||
        (data.labelRank as number) < state.labelBudget;
      if (!labelled) res.label = null;
      res.forceLabel = labelled;
      if (state.hoveredNode) {
        if (node === state.hoveredNode || state.hoveredNeighbours?.has(node)) {
          res.label = data.label;
          res.forceLabel = true;
          res.zIndex = 5;
        } else {
          res.color = COLORS.dimmed;
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
          res.color = COLORS.dimmed;
          res.zIndex = 0;
        } else {
          res.color = data.onPath ? COLORS.pathEdge : "rgba(159,180,220,0.9)";
          res.zIndex = 5;
        }
      }
      if (state.hoveredEdge === edge) {
        res.color = "rgba(159,180,220,0.95)";
        res.size = (data.size as number) * 1.8;
        res.zIndex = 6;
      }
      return res;
    },
  };
}
