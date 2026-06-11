import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";

export function mapRoutes(ctx: AppContext) {
  const hasMap = ctx.mapPositions !== null;
  return async function (app: FastifyInstance) {
    app.get("/map/meta", async (_req, reply) => {
      if (!hasMap) return reply.code(404).send({ error: "map not built" });
      const meta = JSON.parse(
        await readFile(join(ctx.artifactsDir, "map-meta.json"), "utf8"),
      );
      return meta;
    });

    app.get("/map/image", async (_req, reply) => {
      if (!hasMap) return reply.code(404).send({ error: "map not built" });
      return reply
        .type("image/png")
        .header("cache-control", "public, max-age=86400")
        .send(createReadStream(join(ctx.artifactsDir, "map.png")));
    });

    app.get("/map/index", async (_req, reply) => {
      if (!hasMap) return reply.code(404).send({ error: "map not built" });
      return reply
        .type("application/octet-stream")
        .header("cache-control", "public, max-age=86400")
        .send(createReadStream(join(ctx.artifactsDir, "map-index.u16")));
    });

    app.get(
      "/map/positions",
      {
        schema: {
          querystring: {
            type: "object",
            required: ["ids"],
            properties: { ids: { type: "string", maxLength: 2000 } },
          },
        },
      },
      async (req, reply) => {
        if (!ctx.mapPositions) return reply.code(404).send({ error: "map not built" });
        const ids = (req.query as { ids: string }).ids
          .split(",")
          .slice(0, 100)
          .map(Number)
          .filter((id) => Number.isInteger(id) && id >= 0 && id < ctx.csr.n);
        return {
          positions: ids.map((id) => ({
            id,
            x: ctx.mapPositions![2 * id],
            y: ctx.mapPositions![2 * id + 1],
          })),
        };
      },
    );
  };
}
