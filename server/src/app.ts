import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppContext } from "./context.js";
import { searchRoutes } from "./routes/search.js";
import { pathRoutes } from "./routes/path.js";
import { authorRoutes } from "./routes/authors.js";
import { edgeRoutes } from "./routes/edge.js";
import { mapRoutes } from "./routes/map.js";
import { metaRoutes } from "./routes/meta.js";
import { recordsRoutes } from "./routes/records.js";

export async function buildApp(ctx: AppContext, opts: { cors?: boolean } = {}): Promise<FastifyInstance> {
  // trustProxy: the leaderboard's rate limit keys on req.ip, and in production
  // every request arrives from Caddy on localhost
  const app = Fastify({ logger: false, trustProxy: true });
  if (opts.cors) await app.register(cors);
  await app.register(searchRoutes(ctx), { prefix: "/api" });
  await app.register(pathRoutes(ctx), { prefix: "/api" });
  await app.register(authorRoutes(ctx), { prefix: "/api" });
  await app.register(edgeRoutes(ctx), { prefix: "/api" });
  await app.register(mapRoutes(ctx), { prefix: "/api" });
  await app.register(metaRoutes(ctx), { prefix: "/api" });
  await app.register(recordsRoutes(ctx), { prefix: "/api" });
  return app;
}
