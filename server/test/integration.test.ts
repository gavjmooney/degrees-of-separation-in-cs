/**
 * Integration tests against real (dev-subset) artifacts. Skipped automatically
 * if data/artifacts-dev has not been built yet.
 */
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { loadContext } from "../src/context.js";
import { buildApp } from "../src/app.js";

const artifactsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "data",
  "artifacts-dev",
);
const available = existsSync(`${artifactsDir}/coauthor.csr`) && existsSync(`${artifactsDir}/dblp.sqlite`);

describe.skipIf(!available)("API integration (dev artifacts)", () => {
  let app: FastifyInstance;
  let ctx: ReturnType<typeof loadContext>;

  beforeAll(async () => {
    ctx = loadContext(artifactsDir);
    app = await buildApp(ctx);
  });
  afterAll(async () => {
    await app?.close();
  });

  /** any node with at least one neighbour, scanning from a fixed offset */
  function connectedNode(start: number): number {
    for (let u = start; u < ctx.csr.n; u++) if (ctx.csr.degree(u) > 0) return u;
    throw new Error("no connected node found");
  }

  it("search returns ranked, disambiguation-aware results", async () => {
    const res = await app.inject({ url: "/api/search?q=wang" });
    expect(res.statusCode).toBe(200);
    const results = res.json();
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty("pubCount");
    expect(results[0]).toHaveProperty("topVenues");
    expect(results[0]).toHaveProperty("degree");
    // ranked by pub count
    const counts = results.map((r: { pubCount: number }) => r.pubCount);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it("search rejects too-short queries", async () => {
    const res = await app.inject({ url: "/api/search?q=a" });
    expect(res.statusCode).toBe(400);
  });

  it("path between direct co-authors is 1 hop with a subgraph", async () => {
    const u = connectedNode(1000);
    const v = ctx.csr.neighbors[ctx.csr.offsets[u]];
    const res = await app.inject({ url: `/api/path?from=${u}&to=${v}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.found).toBe(true);
    expect(body.hops).toBe(1);
    expect(body.path).toHaveLength(2);
    expect(body.graph.nodes.length).toBeGreaterThanOrEqual(2);
    expect(body.graph.nodes.length).toBeLessThanOrEqual(300);
    const pathEdge = body.graph.edges.find((e: { onPath: boolean }) => e.onPath);
    expect(pathEdge).toBeDefined();
    const names = body.graph.nodes.map((n: { name: string }) => n.name);
    expect(names.every((n: string) => n && n !== "?")).toBe(true);
  });

  it("path to self is 0 hops", async () => {
    const u = connectedNode(1000);
    const res = await app.inject({ url: `/api/path?from=${u}&to=${u}` });
    expect(res.json().hops).toBe(0);
  });

  it("path respects maxNodes", async () => {
    const u = connectedNode(5000);
    const v = ctx.csr.neighbors[ctx.csr.offsets[u]];
    const res = await app.inject({ url: `/api/path?from=${u}&to=${v}&k=2&maxNodes=50` });
    expect(res.json().graph.nodes.length).toBeLessThanOrEqual(50);
  });

  it("author detail + papers + edge endpoints", async () => {
    const u = connectedNode(1000);
    const v = ctx.csr.neighbors[ctx.csr.offsets[u]];
    const w = ctx.csr.weights[ctx.csr.offsets[u]];

    const author = (await app.inject({ url: `/api/authors/${u}` })).json();
    expect(author.name).toBeTruthy();
    expect(author.pubCount).toBeGreaterThan(0);

    const papers = (await app.inject({ url: `/api/authors/${u}/papers` })).json();
    expect(papers.papers.length).toBeGreaterThan(0);
    expect(papers.papers.length).toBeLessThanOrEqual(25);
    expect(papers.total).toBe(author.pubCount);

    const edge = (await app.inject({ url: `/api/edge?u=${u}&v=${v}` })).json();
    // at least the CSR edge weight's worth of shared papers (response capped at 25)
    expect(edge.papers.length).toBeGreaterThanOrEqual(Math.min(w, 25));
  });

  it("coauthors endpoint: weight-sorted, paginated, matches CSR degree", async () => {
    const u = connectedNode(1000);
    const res = (await app.inject({ url: `/api/authors/${u}/coauthors?limit=10` })).json();
    expect(res.total).toBe(ctx.csr.degree(u));
    expect(res.coauthors.length).toBeLessThanOrEqual(10);
    const weights = res.coauthors.map((c: { weight: number }) => c.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
    expect(res.coauthors[0].name).toBeTruthy();
    // pagination: second page starts where the first ended
    const page2 = (await app.inject({ url: `/api/authors/${u}/coauthors?limit=10&offset=10` })).json();
    if (res.total > 10) {
      expect(page2.coauthors[0]?.id).not.toBe(res.coauthors[0].id);
    }
  });

  it("404 on unknown ids", async () => {
    expect((await app.inject({ url: `/api/authors/${ctx.csr.n + 5}` })).statusCode).toBe(404);
    expect((await app.inject({ url: `/api/path?from=0&to=${ctx.csr.n + 5}` })).statusCode).toBe(404);
  });

  it("meta endpoint", async () => {
    const meta = (await app.inject({ url: "/api/meta" })).json();
    expect(meta.graph.nodes).toBe(ctx.csr.n);
  });
});
