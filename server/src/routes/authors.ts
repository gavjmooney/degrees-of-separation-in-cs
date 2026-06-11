import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export function authorRoutes(ctx: AppContext) {
  return async function (app: FastifyInstance) {
    app.get(
      "/authors/:id",
      {
        schema: {
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "integer", minimum: 0 } },
          },
        },
      },
      async (req, reply) => {
        const { id } = req.params as { id: number };
        const author = ctx.db.getAuthor(id);
        if (!author) return reply.code(404).send({ error: "unknown author id" });
        return { ...author, degree: id < ctx.csr.n ? ctx.csr.degree(id) : 0 };
      },
    );

    app.get(
      "/authors/:id/coauthors",
      {
        schema: {
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "integer", minimum: 0 } },
          },
          querystring: {
            type: "object",
            properties: {
              offset: { type: "integer", minimum: 0, default: 0 },
              limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
            },
          },
        },
      },
      async (req, reply) => {
        const { id } = req.params as { id: number };
        const { offset, limit } = req.query as { offset: number; limit: number };
        if (id >= ctx.csr.n) return reply.code(404).send({ error: "unknown author id" });

        const lo = ctx.csr.offsets[id];
        const hi = ctx.csr.offsets[id + 1];
        const all: { id: number; weight: number }[] = [];
        for (let e = lo; e < hi; e++) {
          all.push({ id: ctx.csr.neighbors[e], weight: ctx.csr.weights[e] });
        }
        all.sort((a, b) => b.weight - a.weight || a.id - b.id);
        const page = all.slice(offset, offset + limit);
        const meta = ctx.db.getAuthorsBatch(page.map((c) => c.id));
        return {
          total: all.length,
          offset,
          coauthors: page.map((c) => {
            const m = meta.get(c.id);
            return {
              id: c.id,
              name: m?.name ?? "?",
              pubCount: m?.pubCount ?? 0,
              isDisambig: m?.isDisambig ?? false,
              weight: c.weight,
            };
          }),
        };
      },
    );

    app.get(
      "/authors/:id/papers",
      {
        schema: {
          params: {
            type: "object",
            required: ["id"],
            properties: { id: { type: "integer", minimum: 0 } },
          },
          querystring: {
            type: "object",
            properties: {
              offset: { type: "integer", minimum: 0, default: 0 },
              limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            },
          },
        },
      },
      async (req, reply) => {
        const { id } = req.params as { id: number };
        const { offset, limit } = req.query as { offset: number; limit: number };
        const author = ctx.db.getAuthor(id);
        if (!author) return reply.code(404).send({ error: "unknown author id" });
        return {
          total: author.pubCount,
          offset,
          papers: ctx.db.getPapers(id, limit, offset),
        };
      },
    );
  };
}
