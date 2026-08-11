/**
 * The global leaderboard API. Submissions are opt-in (the client stars a find)
 * and carry only a pair of author ids: the hop count is recomputed here, so the
 * board can't be gamed by editing a request. Registered only when the server was
 * started with a state directory, so a deployment can run without the feature.
 */
import { timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../context.js";
import { cleanName } from "../db/records.js";

/** Sliding-window limiter, per key, kept in process memory. */
export class RateLimit {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  take(key: string, now = Date.now()): boolean {
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 5000) this.prune(cutoff); // keep the map bounded
    return true;
  }

  private prune(cutoff: number): void {
    for (const [key, times] of this.hits) {
      if (times.every((t) => t <= cutoff)) this.hits.delete(key);
    }
  }
}

function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function recordsRoutes(ctx: AppContext) {
  return async function (app: FastifyInstance) {
    const records = ctx.records;
    if (!records) return; // feature off: no routes, so the client hides the board

    // verification is a full BFS, and long-chain hunting is exactly the case
    // that visits the most nodes, so submissions are limited harder than reads
    const submitLimit = new RateLimit(10, 60 * 60 * 1000);
    const adminToken = process.env.RECORDS_ADMIN_TOKEN;

    app.get(
      "/records",
      {
        schema: {
          querystring: {
            type: "object",
            properties: { limit: { type: "integer", minimum: 1, maximum: 200, default: 100 } },
          },
        },
      },
      async (req) => {
        const { limit } = req.query as { limit: number };
        return { records: records.list(limit), total: records.count() };
      },
    );

    app.post(
      "/records",
      {
        schema: {
          body: {
            type: "object",
            required: ["from", "to"],
            properties: {
              from: { type: "integer", minimum: 0 },
              to: { type: "integer", minimum: 0 },
              by: { type: "string", maxLength: 200 },
            },
          },
        },
      },
      async (req, reply) => {
        const { from, to, by } = req.body as { from: number; to: number; by?: string };
        if (from === to) return reply.code(400).send({ error: "pick two different authors" });
        if (from >= ctx.csr.n || to >= ctx.csr.n) {
          return reply.code(404).send({ error: "unknown author id" });
        }
        // an already-listed pair needs no BFS, so check before spending the budget
        const listed = records.get(from, to);
        if (listed) return reply.send({ record: listed, alreadyListed: true });
        if (!submitLimit.take(req.ip)) {
          return reply.code(429).send({ error: "too many submissions from here — try later" });
        }

        const path = ctx.pathFinder.shortestPath(from, to);
        if (path === null) {
          return reply.code(422).send({ error: "these authors aren't connected" });
        }
        const meta = ctx.db.getAuthorsBatch([from, to]);
        const author = (id: number) => ({
          id,
          name: meta.get(id)?.name ?? "?",
          pubCount: meta.get(id)?.pubCount ?? 0,
        });
        const record = records.add({
          a: author(from),
          b: author(to),
          hops: path.length - 1, // computed here, never taken from the request
          by: cleanName(by),
          built: ctx.built,
        });
        return reply.code(201).send({ record, alreadyListed: false });
      },
    );

    // moderation: enabled only when RECORDS_ADMIN_TOKEN is set on the server
    app.delete("/records/:id", async (req, reply) => {
      if (!adminToken) return reply.code(404).send({ error: "not found" });
      const given = req.headers["x-admin-token"];
      if (typeof given !== "string" || !tokensMatch(given, adminToken)) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const { id } = req.params as { id: string };
      return records.remove(Number(id))
        ? { deleted: true }
        : reply.code(404).send({ error: "not found" });
    });
  };
}
