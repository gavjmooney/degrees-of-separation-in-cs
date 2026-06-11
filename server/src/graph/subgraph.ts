/**
 * Extract a renderable k-hop neighbourhood around a path.
 *
 * Path nodes are always kept. Each hop ring admits the strongest candidates
 * (by connecting edge weight) within the node budget. Hubs (very high degree
 * nodes off the path) may appear as nodes but are never expanded, so one
 * prolific author can't flood the view.
 */
import type { CsrGraph } from "./csr.js";

const HUB_DEGREE = 1500;
const MAX_EDGES = 6000;

export interface SubgraphNode {
  id: number;
  hop: number; // 0 = on path
  onPath: boolean;
}

export interface SubgraphEdge {
  s: number;
  t: number;
  weight: number;
  onPath: boolean;
}

export function extractSubgraph(
  g: CsrGraph,
  path: number[],
  k: number,
  maxNodes: number,
  spLevels?: Map<number, number>,
): { nodes: SubgraphNode[]; edges: SubgraphEdge[] } {
  const hop = new Map<number, number>();
  for (const u of path) hop.set(u, 0);

  // "Shortest paths only" mode (k=0): the view IS the shortest-path DAG.
  // Fair share across levels so one wide level can't eat the budget; within
  // a level the DAG builder already ranked by weight. For k >= 1 the DAG is
  // NOT force-admitted — the k-hop neighbourhood bound wins over maxNodes —
  // but DAG members get priority among ring candidates below.
  if (k === 0 && spLevels) {
    const byLevel = new Map<number, number[]>();
    for (const [id, level] of spLevels) {
      if (hop.has(id)) continue;
      let list = byLevel.get(level);
      if (!list) byLevel.set(level, (list = []));
      list.push(id);
    }
    const levels = [...byLevel.values()];
    const cursors = new Array(levels.length).fill(0);
    let budget = maxNodes - hop.size;
    let progress = true;
    while (budget > 0 && progress) {
      progress = false;
      for (let i = 0; i < levels.length && budget > 0; i++) {
        if (cursors[i] < levels[i].length) {
          hop.set(levels[i][cursors[i]++], 0);
          budget--;
          progress = true;
        }
      }
    }
  }

  // Ring 1: fair-share admission across path nodes, so one hub endpoint
  // (an author with thousands of co-authors) can't flood the whole budget.
  // Each path node's neighbours are ranked by edge weight and admitted
  // round-robin until the budget runs out. Path nodes are always expanded,
  // hubs or not: their direct neighbours are what the user asked to see.
  let frontier: number[] = [];
  if (k >= 1) {
    const isSp = (v: number) => (spLevels?.has(v) ? 1 : 0);
    const perSeed: { v: number; w: number }[][] = path.map((u) => {
      const list: { v: number; w: number }[] = [];
      const stop = g.offsets[u + 1];
      for (let e = g.offsets[u]; e < stop; e++) {
        const v = g.neighbors[e];
        if (!hop.has(v)) list.push({ v, w: g.weights[e] });
      }
      // alternative-shortest-path members first, then by edge weight
      return list.sort((a, b) => isSp(b.v) - isSp(a.v) || b.w - a.w);
    });
    const cursors = new Array(perSeed.length).fill(0);
    let budget = maxNodes - hop.size;
    let progress = true;
    while (budget > 0 && progress) {
      progress = false;
      for (let s = 0; s < perSeed.length && budget > 0; s++) {
        const list = perSeed[s];
        while (cursors[s] < list.length && hop.has(list[cursors[s]].v)) cursors[s]++;
        if (cursors[s] < list.length) {
          const { v } = list[cursors[s]++];
          hop.set(v, 1);
          frontier.push(v);
          budget--;
          progress = true;
        }
      }
    }
  }

  // Rings 2..k: weight-ranked admission, hubs are not expanded.
  for (let ring = 2; ring <= k && hop.size < maxNodes; ring++) {
    const candidates = new Map<number, number>(); // id -> best edge weight into admitted set
    for (const u of frontier) {
      if (g.degree(u) > HUB_DEGREE) continue;
      const stop = g.offsets[u + 1];
      for (let e = g.offsets[u]; e < stop; e++) {
        const v = g.neighbors[e];
        if (hop.has(v)) continue;
        const w = g.weights[e];
        const prev = candidates.get(v);
        if (prev === undefined || w > prev) candidates.set(v, w);
      }
    }
    const budget = maxNodes - hop.size;
    const spBoost = (id: number) => (spLevels?.has(id) ? 1 : 0);
    const admitted = [...candidates.entries()]
      .sort((a, b) => spBoost(b[0]) - spBoost(a[0]) || b[1] - a[1])
      .slice(0, budget)
      .map(([id]) => id);
    for (const id of admitted) hop.set(id, ring);
    frontier = admitted;
    if (admitted.length === 0) break;
  }

  // Induce edges among admitted nodes (scan each node's CSR slice once).
  const pathEdges = new Set<string>();
  for (let i = 0; i + 1 < path.length; i++) {
    const [a, b] = [Math.min(path[i], path[i + 1]), Math.max(path[i], path[i + 1])];
    pathEdges.add(`${a}:${b}`);
  }
  let edges: SubgraphEdge[] = [];
  for (const [u] of hop) {
    const stop = g.offsets[u + 1];
    for (let e = g.offsets[u]; e < stop; e++) {
      const v = g.neighbors[e];
      if (v <= u || !hop.has(v)) continue; // each undirected edge once
      edges.push({ s: u, t: v, weight: g.weights[e], onPath: pathEdges.has(`${u}:${v}`) });
    }
  }
  if (edges.length > MAX_EDGES) {
    edges.sort((a, b) => Number(b.onPath) - Number(a.onPath) || b.weight - a.weight);
    edges = edges.slice(0, MAX_EDGES);
  }

  const pathSet = new Set(path);
  const nodes: SubgraphNode[] = [...hop.entries()].map(([id, h]) => ({
    id,
    hop: h,
    onPath: pathSet.has(id), // SP-DAG members also sit at hop 0 but are not the main path
  }));
  return { nodes, edges };
}
