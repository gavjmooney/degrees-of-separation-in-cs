/**
 * The global leaderboard of long chains — the only thing this server writes.
 *
 * Lives in its own SQLite file, deliberately OUTSIDE the artifacts directory so
 * pipeline rebuilds and `rsync` of artifacts can never clobber it. Rows hold the
 * hop count this server computed itself; a number sent by a client is never
 * stored, so a forged submission just gets overwritten by the truth.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

export interface RecordAuthor {
  id: number;
  name: string;
  pubCount: number;
}

export interface FindRecord {
  id: number;
  a: RecordAuthor;
  b: RecordAuthor;
  hops: number;
  /** submitter's chosen display name; null = anonymous. Unverified by nature. */
  by: string | null;
  /** data build the hop count was verified against */
  built: string;
  /** true when `built` is not the build now loaded — hops may no longer hold */
  stale: boolean;
  found: string;
}

interface Row {
  id: number;
  a_id: number;
  a_name: string;
  a_pub_count: number;
  b_id: number;
  b_name: string;
  b_pub_count: number;
  hops: number;
  by_name: string | null;
  built: string;
  stale: number;
  created_at: string;
}

function toRecord(r: Row): FindRecord {
  return {
    id: r.id,
    a: { id: r.a_id, name: r.a_name, pubCount: r.a_pub_count },
    b: { id: r.b_id, name: r.b_name, pubCount: r.b_pub_count },
    hops: r.hops,
    by: r.by_name,
    built: r.built,
    stale: r.stale === 1,
    found: r.created_at,
  };
}

const MAX_NAME = 24;

/**
 * Reduce a submitted display name to something safe to render, or null for
 * anonymous. Strips control characters and anything URL-shaped (the board is
 * public, so it would otherwise be a link-spam surface), collapses whitespace
 * and truncates. Markup needs no escaping here — React renders it as text.
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/\p{C}/gu, "")
    .replace(/\b(?:https?:\/\/|www\.)\S*/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME)
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/** Pairs are unordered: store and look them up with the lower id first. */
function ordered<T extends { id: number }>(a: T, b: T): [T, T] {
  return a.id <= b.id ? [a, b] : [b, a];
}

export class RecordsDb {
  private db: Database.Database;
  private stmts;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        a_id INTEGER NOT NULL,
        a_name TEXT NOT NULL,
        a_pub_count INTEGER NOT NULL DEFAULT 0,
        b_id INTEGER NOT NULL,
        b_name TEXT NOT NULL,
        b_pub_count INTEGER NOT NULL DEFAULT 0,
        hops INTEGER NOT NULL,
        by_name TEXT,
        built TEXT NOT NULL,
        stale INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        UNIQUE (a_id, b_id)
      );
      CREATE INDEX IF NOT EXISTS records_rank ON records (hops DESC, created_at ASC);
    `);
    this.stmts = {
      // longest first; ties go to whoever found it first
      list: this.db.prepare(
        `SELECT * FROM records ORDER BY hops DESC, created_at ASC, id ASC LIMIT ?`,
      ),
      get: this.db.prepare(`SELECT * FROM records WHERE a_id = ? AND b_id = ?`),
      byId: this.db.prepare(`SELECT * FROM records WHERE id = ?`),
      insert: this.db.prepare(
        `INSERT INTO records
           (a_id, a_name, a_pub_count, b_id, b_name, b_pub_count, hops, by_name, built, stale, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      ),
      remove: this.db.prepare(`DELETE FROM records WHERE id = ?`),
      markStale: this.db.prepare(`UPDATE records SET stale = 1 WHERE built <> ?`),
      stale: this.db.prepare(`SELECT * FROM records WHERE stale = 1 ORDER BY hops DESC LIMIT ?`),
      refresh: this.db.prepare(
        `UPDATE records SET hops = ?, built = ?, stale = 0 WHERE id = ?`,
      ),
      count: this.db.prepare(`SELECT COUNT(*) AS n FROM records`),
    };
  }

  list(limit = 100): FindRecord[] {
    return (this.stmts.list.all(limit) as Row[]).map(toRecord);
  }

  get(aId: number, bId: number): FindRecord | null {
    const [lo, hi] = aId <= bId ? [aId, bId] : [bId, aId];
    const row = this.stmts.get.get(lo, hi) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  count(): number {
    return (this.stmts.count.get() as { n: number }).n;
  }

  /** Insert a verified find. Returns the existing row if the pair is listed. */
  add(input: {
    a: RecordAuthor;
    b: RecordAuthor;
    hops: number;
    by: string | null;
    built: string;
  }): FindRecord {
    const [a, b] = ordered(input.a, input.b);
    const existing = this.get(a.id, b.id);
    if (existing) return existing;
    const info = this.stmts.insert.run(
      a.id, a.name, a.pubCount,
      b.id, b.name, b.pubCount,
      input.hops, input.by, input.built,
      new Date().toISOString(),
    );
    return toRecord(this.stmts.byId.get(info.lastInsertRowid) as Row);
  }

  remove(id: number): boolean {
    return this.stmts.remove.run(id).changes > 0;
  }

  /** Flag everything verified against a different data build. Returns the count. */
  markStaleExcept(built: string): number {
    return this.stmts.markStale.run(built).changes;
  }

  staleRecords(limit = 500): FindRecord[] {
    return (this.stmts.stale.all(limit) as Row[]).map(toRecord);
  }

  refresh(id: number, hops: number, built: string): void {
    this.stmts.refresh.run(hops, built, id);
  }

  close(): void {
    this.db.close();
  }
}

export interface ReverifyDeps {
  built: string;
  namesOf(ids: number[]): Map<number, { name: string; pubCount: number }>;
  hopsBetween(a: number, b: number): number | null;
}

/**
 * After a new dblp dump the stored ids may point at different authors, so every
 * row verified against an older build is re-checked: if both ids still resolve
 * to the same names the hop count is recomputed and re-stamped, otherwise the
 * row stays flagged for a human to look at. Each check runs a synchronous BFS,
 * which blocks the event loop, so checks are spaced by `gapMs`.
 */
export async function reverifyStale(
  records: RecordsDb,
  deps: ReverifyDeps,
  { gapMs = 250, limit = 500 }: { gapMs?: number; limit?: number } = {},
): Promise<{ checked: number; updated: number; flagged: number }> {
  const rows = records.staleRecords(limit);
  let updated = 0;
  let flagged = 0;
  for (const row of rows) {
    const meta = deps.namesOf([row.a.id, row.b.id]);
    const sameAuthors =
      meta.get(row.a.id)?.name === row.a.name && meta.get(row.b.id)?.name === row.b.name;
    const hops = sameAuthors ? deps.hopsBetween(row.a.id, row.b.id) : null;
    if (hops === null) {
      flagged++;
    } else {
      records.refresh(row.id, hops, deps.built);
      updated++;
    }
    if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
  }
  return { checked: rows.length, updated, flagged };
}
