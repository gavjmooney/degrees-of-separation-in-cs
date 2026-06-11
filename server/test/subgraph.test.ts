import { describe, expect, it } from "vitest";
import { extractSubgraph } from "../src/graph/subgraph.js";
import { csrFromEdges } from "./helpers.js";

describe("extractSubgraph", () => {
  it("keeps path nodes and marks path edges", () => {
    const g = csrFromEdges(6, [[0, 1, 3], [1, 2, 1], [0, 3, 1], [1, 4, 1], [2, 5, 1]]);
    const { nodes, edges } = extractSubgraph(g, [0, 1, 2], 1, 100);
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids).toEqual(new Set([0, 1, 2, 3, 4, 5]));
    const pathEdges = edges.filter((e) => e.onPath);
    expect(pathEdges).toHaveLength(2);
    expect(nodes.find((n) => n.id === 0)!.onPath).toBe(true);
    expect(nodes.find((n) => n.id === 3)!.hop).toBe(1);
  });

  it("respects maxNodes, admitting strongest edges first", () => {
    // path node 0 has neighbours 1..5 with increasing weights
    const g = csrFromEdges(6, [[0, 1, 1], [0, 2, 2], [0, 3, 3], [0, 4, 4], [0, 5, 5]]);
    const { nodes } = extractSubgraph(g, [0], 1, 3);
    const ids = new Set(nodes.map((n) => n.id));
    expect(ids).toEqual(new Set([0, 5, 4])); // budget 2 after the path node
  });

  it("k=0 returns only the path with its edges", () => {
    const g = csrFromEdges(4, [[0, 1], [1, 2], [2, 3]]);
    const { nodes, edges } = extractSubgraph(g, [0, 1, 2], 0, 100);
    expect(nodes.map((n) => n.id).sort()).toEqual([0, 1, 2]);
    expect(edges).toHaveLength(2);
    expect(edges.every((e) => e.onPath)).toBe(true);
  });

  it("k bound supersedes maxNodes: huge budget never pads beyond k hops", () => {
    // path [0,1]; 2 is 1 hop from 1; 3 and 4 are 2+ hops away
    const g = csrFromEdges(5, [[0, 1], [1, 2], [2, 3], [3, 4]]);
    const { nodes } = extractSubgraph(g, [0, 1], 1, 1000);
    expect(new Set(nodes.map((n) => n.id))).toEqual(new Set([0, 1, 2]));
  });

  it("SP-DAG nodes are only force-admitted at k=0", () => {
    // diamond 0-1-3 / 0-2-3 plus a pendant 5 off node 4 (2 hops from path)
    const g = csrFromEdges(6, [[0, 1], [1, 3], [0, 2], [2, 3], [3, 4], [4, 5]]);
    const sp = new Map([[0, 0], [1, 1], [2, 1], [3, 2]]);
    // k=0: exactly the DAG
    const k0 = extractSubgraph(g, [0, 1, 3], 0, 1000, sp);
    expect(new Set(k0.nodes.map((n) => n.id))).toEqual(new Set([0, 1, 2, 3]));
    // k=1: 1-hop neighbourhood only (2 and 4 are 1 hop; 5 is 2 hops -> excluded)
    const k1 = extractSubgraph(g, [0, 1, 3], 1, 1000, sp);
    expect(new Set(k1.nodes.map((n) => n.id))).toEqual(new Set([0, 1, 2, 3, 4]));
    // tight budget at k=1: the SP member (2) wins the single slot over 4
    const tight = extractSubgraph(g, [0, 1, 3], 1, 4, sp);
    expect(new Set(tight.nodes.map((n) => n.id))).toEqual(new Set([0, 1, 3, 2]));
  });

  it("k=2 reaches two rings", () => {
    const g = csrFromEdges(4, [[0, 1], [1, 2], [2, 3]]);
    const { nodes } = extractSubgraph(g, [0], 2, 100);
    expect(new Set(nodes.map((n) => n.id))).toEqual(new Set([0, 1, 2]));
    expect(nodes.find((n) => n.id === 2)!.hop).toBe(2);
  });
});
