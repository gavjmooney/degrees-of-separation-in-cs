/**
 * Bidirectional BFS for unweighted shortest paths on the co-author graph.
 *
 * Scratch arrays are preallocated once and "cleared" by bumping an epoch
 * counter, so each query is allocation-free and O(visited) regardless of N.
 * Level-synchronized expansion from the smaller frontier; after a meeting is
 * found we keep expanding until no shorter total is possible (completed
 * depths La + Lb + 2 >= best), which makes the result exact.
 */
import type { CsrGraph } from "./csr.js";

export class PathFinder {
  private readonly epochA: Uint32Array;
  private readonly epochB: Uint32Array;
  private readonly distA: Int32Array;
  private readonly distB: Int32Array;
  private readonly parentA: Int32Array;
  private readonly parentB: Int32Array;
  private readonly queueA: Uint32Array;
  private readonly queueB: Uint32Array;
  private epoch = 0;

  constructor(private readonly g: CsrGraph) {
    const n = g.n;
    this.epochA = new Uint32Array(n);
    this.epochB = new Uint32Array(n);
    this.distA = new Int32Array(n);
    this.distB = new Int32Array(n);
    this.parentA = new Int32Array(n);
    this.parentB = new Int32Array(n);
    this.queueA = new Uint32Array(n);
    this.queueB = new Uint32Array(n);
  }

  /** Returns the node sequence from `from` to `to`, or null if disconnected. */
  shortestPath(from: number, to: number): number[] | null {
    return this.shortestPathWithDag(from, to)?.path ?? null;
  }

  /**
   * Shortest path plus the shortest-path DAG: `spLevels` maps every node that
   * lies on SOME shortest path to its distance from `from`. Levels can be
   * capped (`perLevelCap`, weight-ranked) so hub-heavy pairs stay bounded;
   * the returned path's nodes are always present.
   *
   * After the bidirectional search completes with distance d and completed
   * depths La/Lb (La+Lb >= d), both distance arrays are exact on a middle
   * level Lmid (Lmid <= La and d-Lmid <= Lb), which certifies the full
   * SP set there. From that band the DAG closes outward: a neighbour u of an
   * SP node at level L with distA[u] == L-1 satisfies
   * distA(u)+distTo(u) <= (L-1) + (d-L+1) = d, so u is on a shortest path
   * too (and symmetrically toward `to` using distB).
   */
  shortestPathWithDag(
    from: number,
    to: number,
    perLevelCap = 400,
  ): { path: number[]; spLevels: Map<number, number> } | null {
    const { g } = this;
    if (from === to) return { path: [from], spLevels: new Map([[from, 0]]) };
    this.epoch++;
    const { epochA, epochB, distA, distB, parentA, parentB, queueA, queueB, epoch } = this;

    epochA[from] = epoch;
    distA[from] = 0;
    parentA[from] = -1;
    queueA[0] = from;
    epochB[to] = epoch;
    distB[to] = 0;
    parentB[to] = -1;
    queueB[0] = to;

    // queue[lo..hi) = current level, hi..end grows with the next level
    let loA = 0, hiA = 1, loB = 0, hiB = 1;
    let depthA = 0, depthB = 0;
    let best = -1, meet = -1;

    while (hiA > loA && hiB > loB) {
      const expandA = hiA - loA <= hiB - loB;
      const [queue, epochThis, epochOther, distThis, distOther, parentThis] = expandA
        ? [queueA, epochA, epochB, distA, distB, parentA]
        : [queueB, epochB, epochA, distB, distA, parentB];
      let lo = expandA ? loA : loB;
      let hi = expandA ? hiA : hiB;
      let end = hi;

      for (let i = lo; i < hi; i++) {
        const u = queue[i];
        const du = distThis[u];
        const stop = g.offsets[u + 1];
        for (let e = g.offsets[u]; e < stop; e++) {
          const v = g.neighbors[e];
          if (epochThis[v] !== epoch) {
            epochThis[v] = epoch;
            distThis[v] = du + 1;
            parentThis[v] = u;
            queue[end++] = v;
          }
          if (epochOther[v] === epoch) {
            const total = distThis[v] + distOther[v];
            if (best === -1 || total < best) {
              best = total;
              meet = v;
            }
          }
        }
      }

      if (expandA) {
        loA = hi; hiA = end; depthA++;
      } else {
        loB = hi; hiB = end; depthB++;
      }
      // Keep expanding past the first meeting until both searches have fully
      // covered some common level (depthA + depthB >= best). This both makes
      // `best` provably optimal and guarantees the DAG seed band below exists.
      if (best !== -1 && depthA + depthB >= best) break;
    }

    if (best === -1) return null;

    const path: number[] = [];
    for (let v = meet; v !== -1; v = parentA[v]) path.push(v);
    path.reverse();
    for (let v = parentB[meet]; v !== -1; v = parentB[v]) path.push(v);

    // ---- shortest-path DAG ----
    const d = best;
    // distX is exact for all nodes at distance <= depthX; an emptied frontier
    // means that side exhausted its component, i.e. exact everywhere.
    const effA = hiA > loA ? depthA : d;
    const effB = hiB > loB ? depthB : d;
    const Lmid = Math.min(effA, d); // d - Lmid <= effB since effA + effB >= d
    const spLevels = new Map<number, number>();
    const levelLists: number[][] = Array.from({ length: d + 1 }, () => []);
    const add = (v: number, level: number) => {
      spLevels.set(v, level);
      levelLists[level].push(v);
    };
    // seed: the one level where both distance arrays are exact (scan of all
    // A-visited nodes; queueA[0..hiA) is exactly that set)
    for (let i = 0; i < hiA; i++) {
      const v = queueA[i];
      if (distA[v] === Lmid && epochB[v] === epoch && distB[v] === d - Lmid) add(v, Lmid);
    }
    for (let i = 0; i < path.length; i++) {
      if (!spLevels.has(path[i])) add(path[i], i);
    }
    // close toward `from` using exact distA…
    for (let L = Lmid; L >= 1; L--) {
      const cands = new Map<number, number>(); // id -> strongest edge into level L
      for (const v of levelLists[L]) {
        const stop = g.offsets[v + 1];
        for (let e = g.offsets[v]; e < stop; e++) {
          const u = g.neighbors[e];
          if (spLevels.has(u)) continue;
          if (epochA[u] === epoch && distA[u] === L - 1) {
            const w = g.weights[e];
            const prev = cands.get(u);
            if (prev === undefined || w > prev) cands.set(u, w);
          }
        }
      }
      const ranked = [...cands.entries()].sort((a, b) => b[1] - a[1]).slice(0, perLevelCap);
      for (const [u] of ranked) add(u, L - 1);
    }
    // …and toward `to` using exact distB
    for (let L = Lmid; L <= d - 1; L++) {
      const cands = new Map<number, number>();
      for (const v of levelLists[L]) {
        const stop = g.offsets[v + 1];
        for (let e = g.offsets[v]; e < stop; e++) {
          const w = g.neighbors[e];
          if (spLevels.has(w)) continue;
          if (epochB[w] === epoch && distB[w] === d - L - 1) {
            const wt = g.weights[e];
            const prev = cands.get(w);
            if (prev === undefined || wt > prev) cands.set(w, wt);
          }
        }
      }
      const ranked = [...cands.entries()].sort((a, b) => b[1] - a[1]).slice(0, perLevelCap);
      for (const [u] of ranked) add(u, L + 1);
    }

    return { path, spLevels };
  }
}
