/** Read-only access to dblp.sqlite (metadata, papers, FTS5 autocomplete). */
import Database from "better-sqlite3";

export interface AuthorSummary {
  id: number;
  name: string;
  aliases: string[];
  isDisambig: boolean;
  pubCount: number;
  firstYear: number | null;
  lastYear: number | null;
  topVenues: string[];
}

export interface Paper {
  id: number;
  dblpKey: string;
  type: string;
  informal: boolean;
  title: string | null;
  year: number | null;
  venue: string | null;
  nAuthors: number;
}

interface AuthorRow {
  id: number;
  name: string;
  dblp_key: string | null;
  is_disambig: number;
  pub_count: number;
  first_year: number | null;
  last_year: number | null;
  top_venues: string | null;
}

const PAPER_COLS =
  "p.id, p.dblp_key AS dblpKey, p.type, p.informal, p.title, p.year, p.venue, p.n_authors AS nAuthors";

export class Db {
  private db: Database.Database;
  private stmts;

  constructor(path: string) {
    this.db = new Database(path, { readonly: true, fileMustExist: true });
    this.db.pragma("mmap_size = 536870912");
    this.stmts = {
      search: this.db.prepare(
        `SELECT a.id, a.name, a.dblp_key, a.is_disambig, a.pub_count,
                a.first_year, a.last_year, a.top_venues
         FROM (SELECT DISTINCT author_id FROM author_fts WHERE author_fts MATCH ?) f
         JOIN authors a ON a.id = f.author_id
         ORDER BY a.pub_count DESC LIMIT ?`,
      ),
      author: this.db.prepare("SELECT * FROM authors WHERE id = ?"),
      aliases: this.db.prepare(
        "SELECT alias FROM author_aliases WHERE author_id = ?",
      ),
      papers: this.db.prepare(
        `SELECT ${PAPER_COLS} FROM paper_authors pa JOIN papers p ON p.id = pa.paper_id
         WHERE pa.author_id = ?
         ORDER BY p.year DESC, p.id LIMIT ? OFFSET ?`,
      ),
      sharedPapers: this.db.prepare(
        `SELECT ${PAPER_COLS} FROM paper_authors a
         JOIN paper_authors b ON b.paper_id = a.paper_id AND b.author_id = ?
         JOIN papers p ON p.id = a.paper_id
         WHERE a.author_id = ?
         ORDER BY p.year DESC, p.id LIMIT ?`,
      ),
    };
  }

  /** Turn free-text input into an FTS5 prefix query: `"wei" "wang"*` */
  static ftsQuery(input: string): string | null {
    const tokens = input
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .slice(0, 8);
    if (tokens.length === 0) return null;
    return tokens.map((t, i) => `"${t}"${i === tokens.length - 1 ? "*" : ""}`).join(" ");
  }

  private toSummary(row: AuthorRow, withAliases = true): AuthorSummary {
    return {
      id: row.id,
      name: row.name,
      aliases: withAliases
        ? this.stmts.aliases.all(row.id).map((r) => (r as { alias: string }).alias)
        : [],
      isDisambig: row.is_disambig === 1,
      pubCount: row.pub_count,
      firstYear: row.first_year,
      lastYear: row.last_year,
      topVenues: row.top_venues ? JSON.parse(row.top_venues) : [],
    };
  }

  search(query: string, limit: number): AuthorSummary[] {
    const fts = Db.ftsQuery(query);
    if (!fts) return [];
    const rows = this.stmts.search.all(fts, limit) as AuthorRow[];
    return rows.map((r) => this.toSummary(r));
  }

  getAuthor(id: number): (AuthorSummary & { dblpKey: string | null }) | null {
    const row = this.stmts.author.get(id) as AuthorRow | undefined;
    if (!row) return null;
    return { ...this.toSummary(row), dblpKey: row.dblp_key };
  }

  getAuthorsBatch(ids: number[]): Map<number, { name: string; pubCount: number; isDisambig: boolean }> {
    const out = new Map();
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const rows = this.db
        .prepare(
          `SELECT id, name, pub_count, is_disambig FROM authors
           WHERE id IN (${chunk.map(() => "?").join(",")})`,
        )
        .all(...chunk) as { id: number; name: string; pub_count: number; is_disambig: number }[];
      for (const r of rows) {
        out.set(r.id, { name: r.name, pubCount: r.pub_count, isDisambig: r.is_disambig === 1 });
      }
    }
    return out;
  }

  getPapers(authorId: number, limit: number, offset: number): Paper[] {
    return (this.stmts.papers.all(authorId, limit, offset) as RawPaper[]).map(normalizePaper);
  }

  getSharedPapers(u: number, v: number, limit: number): Paper[] {
    return (this.stmts.sharedPapers.all(v, u, limit) as RawPaper[]).map(normalizePaper);
  }
}

type RawPaper = Omit<Paper, "informal"> & { informal: number };

function normalizePaper(p: RawPaper): Paper {
  return { ...p, informal: p.informal === 1 };
}
