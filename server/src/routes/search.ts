import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export function searchRoutes(ctx: AppContext) {
  return async function (app: FastifyInstance) {
    app.get(
      "/search",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["q"],
            properties: {
              q: { type: "string", minLength: 2, maxLength: 200 },
              limit: { type: "integer", minimum: 1, maximum: 25, default: 10 },
            },
          },
        },
      },
      async (req) => {
        const { q, limit } = req.query as { q: string; limit: number };
        const results = ctx.db.search(q, limit);
        // degree comes from the graph, not sqlite
        return results.map((r) => ({ ...r, degree: ctx.csr.degree(r.id) }));
      },
    );
  };
}
