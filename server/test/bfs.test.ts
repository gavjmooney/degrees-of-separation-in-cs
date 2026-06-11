import { describe, expect, it } from "vitest";
import { PathFinder } from "../src/graph/bfs.js";
import { csrFromEdges } from "./helpers.js";

describe("PathFinder", () => {
  it("trivial cases", () => {
    const g = csrFromEdges(3, [[0, 1]]);
    const pf = new PathFinder(g);
    expect(pf.shortestPath(0, 0)).toEqual([0]);
    expect(pf.shortestPath(0, 1)).toEqual([0, 1]);
    expect(pf.shortestPath(1, 0)).toEqual([1, 0]);
  });

  it("line graph", () => {
    const n = 11;
    const g = csrFromEdges(n, Array.from({ length: n - 1 }, (_, i) => [i, i + 1] as [number, number]));
    const pf = new PathFinder(g);
    expect(pf.shortestPath(0, 10)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(pf.shortestPath(3, 7)).toEqual([3, 4, 5, 6, 7]);
  });

  it("star graph", () => {
    const g = csrFromEdges(6, [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5]]);
    const pf = new PathFinder(g);
    expect(pf.shortestPath(1, 5)).toEqual([1, 0, 5]);
  });

  it("disconnected", () => {
    const g = csrFromEdges(4, [[0, 1], [2, 3]]);
    const pf = new PathFinder(g);
    expect(pf.shortestPath(0, 3)).toBeNull();
    expect(pf.shortestPath(0, 1)).toEqual([0, 1]); // finder still reusable after a miss
  });

  it("picks the shorter of two routes", () => {
    // 0-1-2-3-4 long way, 0-5-4 short way
    const g = csrFromEdges(6, [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 4]]);
    const pf = new PathFinder(g);
    expect(pf.shortestPath(0, 4)).toEqual([0, 5, 4]);
  });

  it("isolated node", () => {
    const g = csrFromEdges(3, [[0, 1]]);
    const pf = new PathFinder(g);
    expect(pf.shortestPath(0, 2)).toBeNull();
  });

  it("shortest-path DAG: diamond graph finds both routes", () => {
    // 0-1-3 and 0-2-3 are both shortest (d=2); 4 is a dead-end off 0
    const g = csrFromEdges(5, [[0, 1], [1, 3], [0, 2], [2, 3], [0, 4]]);
    const pf = new PathFinder(g);
    const res = pf.shortestPathWithDag(0, 3)!;
    expect(res.path.length - 1).toBe(2);
    expect(new Map(res.spLevels)).toEqual(new Map([[0, 0], [1, 1], [2, 1], [3, 2]]));
  });

  it("shortest-path DAG: levels match exact distances on random graphs", () => {
    let seed = 999;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const n = 150;
    const edges: [number, number][] = [];
    for (let i = 0; i < 280; i++) {
      const u = Math.floor(rand() * n);
      const v = Math.floor(rand() * n);
      if (u !== v) edges.push([u, v]);
    }
    const g = csrFromEdges(n, edges);
    const pf = new PathFinder(g);
    const dist = (s: number): Int32Array => {
      const d = new Int32Array(n).fill(-1);
      d[s] = 0;
      const q = [s];
      for (let i = 0; i < q.length; i++) {
        for (let e = g.offsets[q[i]]; e < g.offsets[q[i] + 1]; e++) {
          const v = g.neighbors[e];
          if (d[v] === -1) {
            d[v] = d[q[i]] + 1;
            q.push(v);
          }
        }
      }
      return d;
    };
    for (let trial = 0; trial < 80; trial++) {
      const s = Math.floor(rand() * n);
      const t = Math.floor(rand() * n);
      const res = pf.shortestPathWithDag(s, t, 10000);
      const dS = dist(s);
      const dT = dist(t);
      if (res === null) {
        expect(dS[t]).toBe(-1);
        continue;
      }
      const d = res.path.length - 1;
      expect(dS[t]).toBe(d);
      // every reported SP node really is on a shortest path, at the right level
      for (const [v, level] of res.spLevels) {
        expect(dS[v]).toBe(level);
        expect(dS[v] + dT[v]).toBe(d);
      }
      // and with no cap, EVERY shortest-path node is reported
      for (let v = 0; v < n; v++) {
        if (dS[v] >= 0 && dT[v] >= 0 && dS[v] + dT[v] === d) {
          expect(res.spLevels.has(v)).toBe(true);
        }
      }
    }
  });

  it("matches reference BFS on random graphs", () => {
    // deterministic LCG so the test is reproducible
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const n = 200;
    const edges: [number, number][] = [];
    for (let i = 0; i < 400; i++) {
      const u = Math.floor(rand() * n);
      const v = Math.floor(rand() * n);
      if (u !== v) edges.push([u, v]);
    }
    const g = csrFromEdges(n, edges);
    const pf = new PathFinder(g);

    const refDist = (s: number, t: number): number => {
      const dist = new Int32Array(n).fill(-1);
      dist[s] = 0;
      const q = [s];
      for (let i = 0; i < q.length; i++) {
        const u = q[i];
        for (let e = g.offsets[u]; e < g.offsets[u + 1]; e++) {
          const v = g.neighbors[e];
          if (dist[v] === -1) {
            dist[v] = dist[u] + 1;
            q.push(v);
          }
        }
      }
      return dist[t];
    };

    for (let trial = 0; trial < 300; trial++) {
      const s = Math.floor(rand() * n);
      const t = Math.floor(rand() * n);
      const expected = refDist(s, t);
      const path = pf.shortestPath(s, t);
      if (expected === -1) {
        expect(path).toBeNull();
      } else {
        expect(path).not.toBeNull();
        expect(path!.length - 1).toBe(expected);
        expect(path![0]).toBe(s);
        expect(path![path!.length - 1]).toBe(t);
        for (let i = 0; i + 1 < path!.length; i++) {
          // every step must be a real edge
          const nbrs = g.neighbors.slice(g.offsets[path![i]], g.offsets[path![i] + 1]);
          expect([...nbrs]).toContain(path![i + 1]);
        }
      }
    }
  });
});
