import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { AppContext } from "./context.js";
import { searchRoutes } from "./routes/search.js";
import { pathRoutes } from "./routes/path.js";
import { authorRoutes } from "./routes/authors.js";
import { edgeRoutes } from "./routes/edge.js";
import { mapRoutes } from "./routes/map.js";
import { metaRoutes } from "./routes/meta.js";

export async function buildApp(ctx: AppContext, opts: { cors?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  if (opts.cors) await app.register(cors);
  await app.register(searchRoutes(ctx), { prefix: "/api" });
  await app.register(pathRoutes(ctx), { prefix: "/api" });
  await app.register(authorRoutes(ctx), { prefix: "/api" });
  await app.register(edgeRoutes(ctx), { prefix: "/api" });
  await app.register(mapRoutes(ctx), { prefix: "/api" });
  await app.register(metaRoutes(ctx), { prefix: "/api" });
  return app;
}
