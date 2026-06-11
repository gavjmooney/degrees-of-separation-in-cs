import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadCsr, type CsrGraph } from "./graph/csr.js";
import { PathFinder } from "./graph/bfs.js";
import { Db } from "./db/sqlite.js";

export interface AppContext {
  csr: CsrGraph;
  pathFinder: PathFinder;
  db: Db;
  meta: unknown;
  artifactsDir: string;
  /** normalized [0,1] x,y per node id from layout.f32, when the map stage has run */
  mapPositions: Float32Array | null;
}

export function loadContext(artifactsDir: string): AppContext {
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
  return {
    csr,
    pathFinder: new PathFinder(csr),
    db: new Db(join(artifactsDir, "dblp.sqlite")),
    meta: JSON.parse(readFileSync(join(artifactsDir, "meta.json"), "utf8")),
    artifactsDir,
    mapPositions,
  };
}
