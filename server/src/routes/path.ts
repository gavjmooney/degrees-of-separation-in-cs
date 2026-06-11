import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { extractSubgraph } from "../graph/subgraph.js";

/**
 * The BFS-found main path is arbitrary among equals; when it passes through a
 * disambiguation profile, re-route through the shortest-path DAG to minimise
 * how many such profiles the headline chain uses (0 when any clean shortest
 * path exists). Consequence for the UI: a disambiguation profile on the main
 * path means EVERY shortest path has one, so a caution note is warranted.
 */
function preferCleanPath(
  ctx: AppContext,
  path: number[],
  spLevels: Map<number, number>,
): number[] {
  if (path.length <= 2) return path; // nothing between the endpoints to re-route
  const disambigCost = (meta: Map<number, { isDisambig: boolean }>, id: number) =>
    meta.get(id)?.isDisambig ? 1 : 0;
  const pathMeta = ctx.db.getAuthorsBatch(path);
  // cost convention: every node after the first (endpoints can't be avoided,
  // but counting `to` on both sides keeps the comparison consistent)
  const oldCost = path.slice(1).reduce((s, id) => s + disambigCost(pathMeta, id), 0);
  if (oldCost === 0) return path;

  const meta = ctx.db.getAuthorsBatch([...spLevels.keys()]);
  const d = path.length - 1;
  const byLevel: number[][] = Array.from({ length: d + 1 }, () => []);
  for (const [id, level] of spLevels) byLevel[level].push(id);
  const cost = new Map<number, number>([[path[0], 0]]);
  const parent = new Map<number, number>();
  for (let level = 0; level < d; level++) {
    for (const u of byLevel[level]) {
      const cu = cost.get(u);
      if (cu === undefined) continue;
      const stop = ctx.csr.offsets[u + 1];
      for (let e = ctx.csr.offsets[u]; e < stop; e++) {
        const v = ctx.csr.neighbors[e];
        if (spLevels.get(v) !== level + 1) continue;
        const cv = cu + disambigCost(meta, v);
        const prev = cost.get(v);
        if (prev === undefined || cv < prev) {
          cost.set(v, cv);
          parent.set(v, u);
        }
      }
    }
  }
  const newCost = cost.get(path[d]);
  if (newCost === undefined || newCost >= oldCost) return path;
  const out = [path[d]];
  while (out[out.length - 1] !== path[0]) out.push(parent.get(out[out.length - 1])!);
  return out.reverse();
}

export function pathRoutes(ctx: AppContext) {
  return async function (app: FastifyInstance) {
    app.get(
      "/path",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["from", "to"],
            properties: {
              from: { type: "integer", minimum: 0 },
              to: { type: "integer", minimum: 0 },
              k: { type: "integer", minimum: 0, maximum: 2, default: 1 },
              maxNodes: { type: "integer", minimum: 10, maximum: 1000, default: 300 },
            },
          },
        },
      },
      async (req, reply) => {
        const { from, to, k, maxNodes } = req.query as {
          from: number;
          to: number;
          k: number;
          maxNodes: number;
        };
        if (from >= ctx.csr.n || to >= ctx.csr.n) {
          return reply.code(404).send({ error: "unknown author id" });
        }

        const result = ctx.pathFinder.shortestPathWithDag(from, to);
        if (result === null) {
          return reply.send({ found: false, hops: null, path: [], graph: { nodes: [], edges: [] } });
        }
        const { spLevels } = result;
        const path = preferCleanPath(ctx, result.path, spLevels);

        const sub = extractSubgraph(ctx.csr, path, k, maxNodes, spLevels);
        const metaById = ctx.db.getAuthorsBatch(sub.nodes.map((n) => n.id));
        const pathIndex = new Map(path.map((id, i) => [id, i]));
        return {
          found: true,
          hops: path.length - 1,
          path: path.map((id) => ({
            id,
            name: metaById.get(id)?.name ?? "?",
            isDisambig: metaById.get(id)?.isDisambig ?? false,
          })),
          graph: {
            nodes: sub.nodes.map((n) => {
              const m = metaById.get(n.id);
              return {
                id: n.id,
                name: m?.name ?? "?",
                pubCount: m?.pubCount ?? 0,
                isDisambig: m?.isDisambig ?? false,
                degree: ctx.csr.degree(n.id),
                hop: n.hop,
                onPath: n.onPath,
                pathIndex: pathIndex.get(n.id) ?? null,
                spLevel: spLevels.get(n.id) ?? null,
              };
            }),
            edges: sub.edges,
          },
        };
      },
    );
  };
}
