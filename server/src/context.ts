import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadCsr, type CsrGraph } from "./graph/csr.js";
import { PathFinder } from "./graph/bfs.js";
import { Db } from "./db/sqlite.js";
import { RecordsDb } from "./db/records.js";

export interface AppContext {
  csr: CsrGraph;
  pathFinder: PathFinder;
  db: Db;
  meta: unknown;
  /** the dblp dump date these artifacts were built from */
  built: string;
  artifactsDir: string;
  /** normalized [0,1] x,y per node id from layout.f32, when the map stage has run */
  mapPositions: Float32Array | null;
  /** the writable leaderboard store; null when no state directory was given */
  records: RecordsDb | null;
}

/**
 * `stateDir` is where the one writable file (the leaderboard) lives. It is
 * separate from `artifactsDir` — which is read-only and gets replaced wholesale
 * by a pipeline rebuild — and omitting it disables the leaderboard entirely,
 * which is what tests and read-only deployments want.
 */
export function loadContext(artifactsDir: string, stateDir?: string): AppContext {
  for (const f of ["coauthor.csr", "dblp.sqlite", "meta.json"]) {
    if (!existsSync(join(artifactsDir, f))) {
      throw new Error(`missing artifact ${f} in ${artifactsDir} — run the pipeline first`);
    }
  }
  const csr = loadCsr(join(artifactsDir, "coauthor.csr"));
  let mapPositions: Float32Array | null = null;
  const layoutPath = join(artifactsDir, "layout.f32");
  if (existsSync(layoutPath) && existsSync(join(artifactsDir, "map-meta.json"))) {
    const buf = readFileSync(layoutPath);
    const ab = new ArrayBuffer(buf.byteLength);
    new Uint8Array(ab).set(buf);
    mapPositions = new Float32Array(ab);
  }
  const meta = JSON.parse(readFileSync(join(artifactsDir, "meta.json"), "utf8"));
  return {
    csr,
    pathFinder: new PathFinder(csr),
    db: new Db(join(artifactsDir, "dblp.sqlite")),
    meta,
    built: typeof meta.built === "string" ? meta.built : "unknown",
    artifactsDir,
    mapPositions,
    records: stateDir ? new RecordsDb(join(stateDir, "records.db")) : null,
  };
}
