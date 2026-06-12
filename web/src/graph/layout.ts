/**
 * Layouts for path-neighbourhood subgraphs (≤ ~800 nodes).
 *
 * Two modes:
 *  - "organic": path nodes pinned to a horizontal backbone, neighbours settle
 *    around the path node they connect to most strongly (force simulation).
 *  - "layered": every node's x is fixed to its BFS distance from the start
 *    endpoint (within the subgraph), the main path runs through the middle,
 *    and only y relaxes. Nodes on *some* shortest path stand out as columns.
 *
 * The simulation is stepped from requestAnimationFrame so settling is
 * animated and the UI stays live. O(n^2) repulsion is fine at this scale.
 */
import type Graph from "graphology";
import type { PathEdge, PathNode } from "../api/types";

export const BACKBONE_SPACING = 260;
export type ViewMode = "organic" | "layered";

export interface LayoutHandle {
  /** advance the simulation; returns false once settled */
  step(): boolean;
  stop(): void;
}

export interface SeedPos {
  x: number;
  y: number;
  /** anchor the node is gravitationally pulled toward */
  ax: number;
  ay: number;
  /** layered mode: x never moves */
  fixedX: boolean;
  /** layered mode on portrait screens: y never moves (layers run downward) */
  fixedY: boolean;
}

/** BFS hop counts from `start` over the subgraph's edges. */
export function bfsDistances(nodeIds: number[], edges: PathEdge[], start: number): Map<number, number> {
  const adj = new Map<number, number[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    adj.get(e.s)?.push(e.t);
    adj.get(e.t)?.push(e.s);
  }
  const dist = new Map<number, number>([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    const du = dist.get(u)!;
    for (const v of adj.get(u) ?? []) {
      if (!dist.has(v)) {
        dist.set(v, du + 1);
        queue.push(v);
      }
    }
  }
  return dist;
}

/**
 * Derive alternative-shortest-path marks and layered-mode columns. The
 * server computes the global shortest-path DAG and sends each member's
 * level in `spLevel`; an edge is on a shortest path iff it connects
 * consecutive DAG levels. Non-DAG nodes fall back to subgraph BFS
 * distances for their column.
 */
export function deriveAltAndLayers(
  nodes: PathNode[],
  edges: PathEdge[],
  from: number,
  to: number,
  hops: number,
): { altNodes: Set<number>; altEdges: Set<number>; layer: Map<number, number> } {
  const spOf = new Map(nodes.map((n) => [n.id, n.spLevel]));
  const altNodes = new Set<number>();
  for (const n of nodes) {
    if (!n.onPath && n.spLevel !== null) altNodes.add(n.id);
  }
  const altEdges = new Set<number>();
  edges.forEach((e, i) => {
    if (e.onPath) return;
    const a = spOf.get(e.s);
    const b = spOf.get(e.t);
    if (a != null && b != null && Math.abs(a - b) === 1) altEdges.add(i);
  });
  // layered-mode column: DAG level when known, else BFS distance from the
  // start within the subgraph, else mirrored distance from the end
  const ids = nodes.map((n) => n.id);
  const dF = bfsDistances(ids, edges, from);
  const dT = bfsDistances(ids, edges, to);
  const layer = new Map<number, number>();
  for (const n of nodes) {
    const a = n.spLevel ?? dF.get(n.id);
    const b = dT.get(n.id);
    layer.set(n.id, a ?? (b !== undefined ? Math.max(0, hops - b) : Math.round(hops / 2)));
  }
  return { altNodes, altEdges, layer };
}

export function seedPositions(
  nodes: PathNode[],
  edges: PathEdge[],
  mode: ViewMode,
  spacing: number,
  layer: Map<number, number>,
  /** layered mode on portrait screens: layers run top-to-bottom and nodes
   *  spread horizontally instead */
  flip = false,
): Map<number, SeedPos> {
  const pos = new Map<number, SeedPos>();
  const span = BACKBONE_SPACING * spacing;
  const path = nodes
    .filter((n) => n.onPath)
    .sort((a, b) => (a.pathIndex ?? 0) - (b.pathIndex ?? 0));

  // vertical spread grows superlinearly with spacing: airier views should
  // fill the height, not just stretch the backbone
  const vStretch = spacing * Math.sqrt(spacing);

  if (mode === "layered") {
    let i = 0;
    for (const n of nodes) {
      const along = layer.get(n.id)! * span; // position along the backbone
      const isPath = n.onPath;
      const main = isPath ? (n.pathIndex ?? 0) * span : along;
      let across = 0;
      if (!isPath) {
        const side = i++ % 2 === 0 ? 1 : -1;
        across = side * (80 + 240 * Math.random()) * vStretch;
      }
      pos.set(
        n.id,
        flip
          ? { x: across, y: main, ax: 0, ay: along, fixedX: false, fixedY: true }
          : { x: main, y: across, ax: along, ay: 0, fixedX: true, fixedY: false },
      );
    }
    return pos;
  }

  path.forEach((n, i) =>
    pos.set(n.id, { x: i * span, y: 0, ax: i * span, ay: 0, fixedX: false, fixedY: false }),
  );
  // anchor = strongest already-placed neighbour; process rings outward
  const byHop = [...nodes].sort((a, b) => a.hop - b.hop);
  const bestAnchor = new Map<number, { id: number; w: number }>();
  for (const e of edges) {
    for (const [a, b] of [
      [e.s, e.t],
      [e.t, e.s],
    ]) {
      const prev = bestAnchor.get(a);
      if (!prev || e.weight > prev.w) bestAnchor.set(a, { id: b, w: e.weight });
    }
  }
  let i = 0;
  for (const n of byHop) {
    if (pos.has(n.id)) continue;
    const anchor = bestAnchor.get(n.id);
    const base = (anchor && pos.get(anchor.id)) ?? { x: 0, y: 0, ax: 0, ay: 0 };
    const angle = (i++ * 2.399963) % (2 * Math.PI); // golden angle: spreads fan-outs
    const r = (60 + 50 * Math.random()) * spacing;
    pos.set(n.id, {
      x: base.x + r * Math.cos(angle),
      y: base.y + r * Math.sin(angle) * (vStretch / spacing),
      // cluster around the path node at the root of this node's anchor chain
      ax: base.ax,
      ay: base.ay,
      fixedX: false,
      fixedY: false,
    });
  }
  return pos;
}

interface Body {
  key: string;
  x: number;
  y: number;
  ax: number;
  ay: number;
  pinned: boolean;
  fixedX: boolean;
  fixedY: boolean;
}

export function startLayout(graph: Graph, spacing: number, onSettled?: () => void): LayoutHandle {
  const bodies: Body[] = [];
  const index = new Map<string, number>();
  graph.forEachNode((key, attrs) => {
    index.set(key, bodies.length);
    bodies.push({
      key,
      x: attrs.x,
      y: attrs.y,
      ax: attrs.anchorX ?? attrs.x,
      ay: attrs.anchorY ?? attrs.y,
      pinned: attrs.pinned === true,
      fixedX: attrs.fixedX === true,
      fixedY: attrs.fixedY === true,
    });
  });
  const springs: { a: number; b: number; strength: number }[] = [];
  graph.forEachEdge((_e, attrs, s, t) => {
    springs.push({
      a: index.get(s)!,
      b: index.get(t)!,
      strength: 1 + Math.log2(1 + (attrs.weight ?? 1)),
    });
  });

  const n = bodies.length;
  const fx = new Float64Array(n);
  const fy = new Float64Array(n);
  // grows superlinearly so the airier settings push hard enough to actually
  // win against the springs (in layered mode x is pinned, so all of this
  // extra force becomes vertical spread)
  const REPULSION = 13000 * spacing ** 2.5;
  const SPRING = 0.004;
  const SPRING_REST = 90 * spacing;
  const ANCHOR_GRAVITY = 0.02; // pull each node toward its anchor
  // the backbone is horizontal, so vertical spread is what fills the stage:
  // weaken the vertical pull as spacing grows for a much taller settle
  const Y_GRAVITY = ANCHOR_GRAVITY / (spacing * Math.sqrt(spacing));
  let temperature = 32 * spacing; // headroom for the stronger repulsion to act
  let stopped = false;
  let steps = 0;

  function step(): boolean {
    if (stopped) return false;
    fx.fill(0);
    fy.fill(0);
    for (let i = 0; i < n; i++) {
      const bi = bodies[i];
      for (let j = i + 1; j < n; j++) {
        const bj = bodies[j];
        let dx = bi.x - bj.x;
        let dy = bi.y - bj.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const f = REPULSION / d2;
        const d = Math.sqrt(d2);
        fx[i] += (dx / d) * f;
        fy[i] += (dy / d) * f;
        fx[j] -= (dx / d) * f;
        fy[j] -= (dy / d) * f;
      }
    }
    for (const s of springs) {
      const a = bodies[s.a];
      const b = bodies[s.b];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const f = SPRING * s.strength * (d - SPRING_REST);
      fx[s.a] += (dx / d) * f;
      fy[s.a] += (dy / d) * f;
      fx[s.b] -= (dx / d) * f;
      fy[s.b] -= (dy / d) * f;
    }
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const b = bodies[i];
      if (b.pinned) continue;
      // weak gravity on the spread axis (perpendicular to the backbone),
      // regular gravity along it
      fx[i] += (b.ax - b.x) * (b.fixedY ? Y_GRAVITY * 0.25 : ANCHOR_GRAVITY);
      fy[i] += (b.ay - b.y) * (b.fixedX ? Y_GRAVITY * 0.25 : Y_GRAVITY);
      const f = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i]);
      if (f < 0.01) continue;
      const cap = Math.min(f, temperature);
      if (!b.fixedX) b.x += (fx[i] / f) * cap;
      if (!b.fixedY) b.y += (fy[i] / f) * cap;
      moved += cap;
    }
    for (const b of bodies) graph.setNodeAttribute(b.key, "x", b.x);
    for (const b of bodies) graph.setNodeAttribute(b.key, "y", b.y);

    temperature = Math.max(1, temperature * 0.97);
    steps++;
    const settled = steps > 250 || moved / Math.max(1, n) < 0.05;
    if (settled) {
      stopped = true;
      onSettled?.();
    }
    return !settled;
  }

  return {
    step,
    stop() {
      stopped = true;
    },
  };
}
