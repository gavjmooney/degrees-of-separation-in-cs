/**
 * Which nodes get a permanent label.
 *
 * Three of the modes are budget-free rules evaluated per node in the reducer
 * (see ViewState in styling.ts). The other two need to see the whole graph at
 * once, so they resolve to an explicit set of node ids:
 *
 *  - "few": the main path, plus as many further labels as fit without any two
 *    pills overlapping on screen.
 *  - "custom": the first N in a fixed priority order — author 1, author 2, the
 *    main path left to right, alternative-shortest-path nodes, everything else.
 *
 * The two tail groups are shuffled with a seed derived from the query, so the
 * order is stable: dragging the custom slider only ever adds labels, and a
 * re-render never reshuffles the ones already on screen.
 */
import type { PathNode } from "../api/types";

export type LabelMode =
  | { kind: "path" }
  /** main path + every alternative-shortest-path node */
  | { kind: "allsp" }
  /** main path + alternative-path nodes + the top n neighbours by publications */
  | { kind: "top"; n: number }
  | { kind: "few" }
  | { kind: "custom"; n: number };

/** True for the modes that resolve to an explicit id set rather than a rule. */
export function isSetMode(mode: LabelMode): boolean {
  return mode.kind === "few" || mode.kind === "custom";
}

/** Deterministic Fisher-Yates using a seeded xorshift32. */
function shuffled(ids: number[], seed: number): number[] {
  let s = seed | 0 || 0x2545f491;
  const rnd = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Node ids in labelling priority order: author 1, author 2, the intermediate
 * path nodes left to right, then alternative-path nodes and finally all
 * remaining nodes, each group shuffled deterministically.
 */
export function labelPriority(
  nodes: PathNode[],
  altNodes: Set<number>,
  seed: number,
): number[] {
  const path = nodes
    .filter((n) => n.onPath)
    .sort((a, b) => (a.pathIndex ?? 0) - (b.pathIndex ?? 0));
  const order: number[] = [];
  if (path.length > 0) order.push(path[0].id);
  if (path.length > 1) order.push(path[path.length - 1].id);
  for (const n of path.slice(1, -1)) order.push(n.id);

  const alt: number[] = [];
  const rest: number[] = [];
  for (const n of nodes) {
    if (n.onPath) continue;
    (altNodes.has(n.id) ? alt : rest).push(n.id);
  }
  order.push(...shuffled(alt, seed), ...shuffled(rest, seed ^ 0x9e3779b9));
  return order;
}

/** Viewport-space box of a label pill. */
export interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * "custom": the first `n` ids in priority order that are currently on screen
 * (a node hidden by the min-papers filter must not eat budget).
 */
export function pickByBudget(
  order: number[],
  n: number,
  isVisible: (id: number) => boolean,
): Set<string> {
  const out = new Set<string>();
  for (const id of order) {
    if (out.size >= n) break;
    if (isVisible(id)) out.add(String(id));
  }
  return out;
}

/**
 * "few": place `always` (the main path) whatever happens, then walk the rest of
 * the priority order adding a label only when its pill clears every pill
 * already placed. `boxOf` returns null for nodes that aren't labellable now.
 */
export function pickNonOverlapping(
  order: number[],
  always: Set<number>,
  boxOf: (id: number) => LabelBox | null,
): Set<string> {
  const out = new Set<string>();
  const placed: LabelBox[] = [];
  for (const id of order) {
    const box = boxOf(id);
    if (!box) continue;
    if (always.has(id)) {
      out.add(String(id));
      placed.push(box);
      continue;
    }
    if (placed.some((p) => overlaps(p, box))) continue;
    out.add(String(id));
    placed.push(box);
  }
  return out;
}
