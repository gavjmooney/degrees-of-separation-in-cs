import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export function metaRoutes(ctx: AppContext) {
  return async function (app: FastifyInstance) {
    app.get("/meta", async () => ctx.meta as object);
  };
}
