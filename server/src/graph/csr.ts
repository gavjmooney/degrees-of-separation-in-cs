/**
 * Loader for the "DCSR" binary CSR co-authorship graph produced by the
 * Python pipeline (see pipeline/dblp_pipeline/csr_format.py for the spec).
 */
import { readFileSync } from "node:fs";

const MAGIC = 0x52534344; // "DCSR" little-endian
const HEADER_SIZE = 48;

export interface CsrGraph {
  n: number;
  m: number;
  /** offsets[u]..offsets[u+1] indexes neighbors/weights; u32 is safe since m < 2^32 */
  offsets: Uint32Array;
  neighbors: Uint32Array;
  weights: Uint16Array;
  degree(u: number): number;
}

export function loadCsr(path: string): CsrGraph {
  const buf = readFileSync(path);
  // Copy into a fresh ArrayBuffer so every section view is correctly aligned.
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);

  const dv = new DataView(ab);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error(`${path}: bad magic`);
  const version = dv.getUint32(4, true);
  if (version !== 1) throw new Error(`${path}: unsupported version ${version}`);
  const n = Number(dv.getBigUint64(8, true));
  const m = Number(dv.getBigUint64(16, true));
  if (m >= 2 ** 32) throw new Error(`${path}: edge count ${m} exceeds u32 range`);

  const offsets64 = new BigUint64Array(ab, HEADER_SIZE, n + 1);
  const offsets = new Uint32Array(n + 1);
  for (let i = 0; i <= n; i++) offsets[i] = Number(offsets64[i]);

  const neighborsStart = HEADER_SIZE + 8 * (n + 1);
  const neighbors = new Uint32Array(ab, neighborsStart, m);
  const weights = new Uint16Array(ab, neighborsStart + 4 * m, m);
  if (offsets[n] !== m) throw new Error(`${path}: offsets[n] != m`);

  return {
    n,
    m,
    offsets,
    neighbors,
    weights,
    degree(u: number) {
      return this.offsets[u + 1] - this.offsets[u];
    },
  };
}
