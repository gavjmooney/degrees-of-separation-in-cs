/**
 * Benchmark shortest-path queries on the loaded graph:
 *   npm run bench --workspace server [-- --artifacts ../data/artifacts --pairs 1000]
 */
import { resolve } from "node:path";
import { loadCsr } from "../src/graph/csr.js";
import { PathFinder } from "../src/graph/bfs.js";

const args = process.argv.slice(2);
function arg(name: string, fallback: string): string {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

const artifactsDir = resolve(arg("artifacts", "../data/artifacts"));
const nPairs = Number(arg("pairs", "1000"));

console.log(`loading ${artifactsDir}/coauthor.csr ...`);
let t = performance.now();
const csr = loadCsr(`${artifactsDir}/coauthor.csr`);
console.log(`loaded ${csr.n.toLocaleString()} nodes, ${(csr.m / 2).toLocaleString()} edges in ${(performance.now() - t).toFixed(0)}ms`);
const pf = new PathFinder(csr);

// LCG for reproducible pairs
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

const times: number[] = [];
const hopHist = new Map<number | "none", number>();
t = performance.now();
for (let i = 0; i < nPairs; i++) {
  const a = Math.floor(rand() * csr.n);
  const b = Math.floor(rand() * csr.n);
  const t0 = performance.now();
  const path = pf.shortestPath(a, b);
  times.push(performance.now() - t0);
  const key = path === null ? "none" : path.length - 1;
  hopHist.set(key, (hopHist.get(key) ?? 0) + 1);
}
const total = performance.now() - t;

times.sort((x, y) => x - y);
const pct = (p: number) => times[Math.min(times.length - 1, Math.floor((p / 100) * times.length))];
console.log(`\n${nPairs} random pairs in ${(total / 1000).toFixed(1)}s`);
console.log(`p50 ${pct(50).toFixed(2)}ms  p90 ${pct(90).toFixed(2)}ms  p95 ${pct(95).toFixed(2)}ms  p99 ${pct(99).toFixed(2)}ms  max ${times[times.length - 1].toFixed(1)}ms`);
console.log("hop distribution:",
  [...hopHist.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }))
    .map(([k, v]) => `${k}:${v}`).join("  "));
console.log(`rss ${(process.memoryUsage().rss / 1e6).toFixed(0)}MB`);
