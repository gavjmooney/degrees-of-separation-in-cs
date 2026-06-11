import type { CsrGraph } from "../src/graph/csr.js";

/** Build a CsrGraph from undirected weighted edges, for tests. */
export function csrFromEdges(n: number, edges: [number, number, number?][]): CsrGraph {
  const adj: Map<number, number>[] = Array.from({ length: n }, () => new Map());
  for (const [u, v, w = 1] of edges) {
    adj[u].set(v, w);
    adj[v].set(u, w);
  }
  const offsets = new Uint32Array(n + 1);
  for (let u = 0; u < n; u++) offsets[u + 1] = offsets[u] + adj[u].size;
  const m = offsets[n];
  const neighbors = new Uint32Array(m);
  const weights = new Uint16Array(m);
  for (let u = 0; u < n; u++) {
    const sorted = [...adj[u].entries()].sort((a, b) => a[0] - b[0]);
    sorted.forEach(([v, w], i) => {
      neighbors[offsets[u] + i] = v;
      weights[offsets[u] + i] = w;
    });
  }
  return {
    n,
    m,
    offsets,
    neighbors,
    weights,
    degree(u: number) {
      return this.offsets[u + 1] - this.offsets[u];
    },
  };
}
