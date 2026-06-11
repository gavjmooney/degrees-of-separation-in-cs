import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export function edgeRoutes(ctx: AppContext) {
  return async function (app: FastifyInstance) {
    app.get(
      "/edge",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["u", "v"],
            properties: {
              u: { type: "integer", minimum: 0 },
              v: { type: "integer", minimum: 0 },
              limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
            },
          },
        },
      },
      async (req, reply) => {
        const { u, v, limit } = req.query as { u: number; v: number; limit: number };
        if (u >= ctx.csr.n || v >= ctx.csr.n) {
          return reply.code(404).send({ error: "unknown author id" });
        }
        return { papers: ctx.db.getSharedPapers(u, v, limit) };
      },
    );
  };
}
