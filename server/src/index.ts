import { existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app.js";
import { loadContext } from "./context.js";
import { reverifyStale } from "./db/records.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");

const artifactsDir = process.env.ARTIFACTS_DIR
  ? resolve(process.env.ARTIFACTS_DIR)
  : join(repoRoot, "data", "artifacts");
const port = Number(process.env.PORT ?? 3001);
// RECORDS_ENABLED=false turns the leaderboard off without a code change
const stateDir =
  process.env.RECORDS_ENABLED === "false"
    ? undefined
    : process.env.STATE_DIR
      ? resolve(process.env.STATE_DIR)
      : join(repoRoot, "data", "state");

console.log(`loading artifacts from ${artifactsDir} ...`);
const t0 = performance.now();
const ctx = loadContext(artifactsDir, stateDir);
console.log(
  `loaded ${ctx.csr.n.toLocaleString()} authors, ${(ctx.csr.m / 2).toLocaleString()} edges ` +
    `in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
);

const app = await buildApp(ctx, { cors: true });

// In production the built SPA is served from web/dist by this same process.
const webDist = join(repoRoot, "web", "dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
    return reply.sendFile("index.html");
  });
  console.log(`serving SPA from ${webDist}`);
}

await app.listen({ port, host: "0.0.0.0" });
console.log(`listening on http://localhost:${port}`);

// Leaderboard rows verified against an older dump are re-checked in the
// background: each check is a synchronous BFS, so this runs spaced out after
// the server is already serving rather than delaying startup.
if (ctx.records) {
  const flagged = ctx.records.markStaleExcept(ctx.built);
  console.log(
    `leaderboard: ${ctx.records.count()} records in ${stateDir}` +
      (flagged > 0 ? `, ${flagged} from an older build — re-verifying` : ""),
  );
  if (flagged > 0) {
    void reverifyStale(ctx.records, {
      built: ctx.built,
      namesOf: (ids) => ctx.db.getAuthorsBatch(ids),
      hopsBetween: (a, b) => {
        const path = ctx.pathFinder.shortestPath(a, b);
        return path ? path.length - 1 : null;
      },
    }).then(({ checked, updated, flagged: left }) =>
      console.log(`leaderboard re-verify: ${checked} checked, ${updated} updated, ${left} flagged`),
    );
  }
}
