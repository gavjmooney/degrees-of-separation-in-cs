/**
 * Your query history, kept in this browser and nowhere else.
 *
 * Every resolved query is recorded automatically so the hunt for a long chain
 * needs no discipline; nothing is sent anywhere unless you explicitly publish a
 * find to the global board. Writes are best-effort: a browser with storage
 * disabled or full degrades to "no history", never to a broken page.
 */
export interface FindAuthor {
  id: number;
  name: string;
  pubCount: number;
  isDisambig: boolean;
}

export interface Find {
  a: FindAuthor;
  b: FindAuthor;
  hops: number;
  /** author names along the chain, for display */
  chain: string[];
  /** ISO timestamp of when this pair was first found */
  at: string;
  /** dblp build the query ran against */
  built: string;
  /** published to the global board */
  shared?: boolean;
}

const KEY = "dos.finds.v1";
/** Plenty for a hunt, small enough to stay well inside a localStorage quota. */
const CAP = 500;

/** Pairs are unordered, so a find has one key either way round. */
export function findKey(aId: number, bId: number): string {
  return aId <= bId ? `${aId}-${bId}` : `${bId}-${aId}`;
}

export function keyOf(find: Find): string {
  return findKey(find.a.id, find.b.id);
}

export function loadFinds(): Find[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Find[]).filter(isFind) : [];
  } catch {
    return []; // unreadable or disabled storage: start empty rather than throw
  }
}

function isFind(f: unknown): f is Find {
  const c = f as Find;
  return (
    !!c && typeof c.hops === "number" && !!c.a && !!c.b &&
    typeof c.a.id === "number" && typeof c.b.id === "number"
  );
}

function write(finds: Find[]): Find[] {
  try {
    localStorage.setItem(KEY, JSON.stringify(finds));
  } catch {
    // full or unavailable: the in-memory list still drives this session
  }
  return finds;
}

/** Longest first, ties to whichever was found first. */
export function byLength(finds: Find[]): Find[] {
  return [...finds].sort((x, y) => y.hops - x.hops || x.at.localeCompare(y.at));
}

/**
 * Record a resolved query. A pair already in the history keeps its original
 * discovery date and shared flag, but takes the new hop count — a rebuilt dump
 * can legitimately change the answer.
 */
export function recordFind(find: Find): Find[] {
  const key = keyOf(find);
  const finds = loadFinds();
  const existing = finds.find((f) => keyOf(f) === key);
  const merged = existing
    ? finds.map((f) =>
        keyOf(f) === key ? { ...find, at: f.at, shared: f.shared } : f,
      )
    : [...finds, find];
  return write(existing ? merged : evict(merged));
}

/** Trim to CAP, dropping the oldest — but never anything already published. */
function evict(finds: Find[]): Find[] {
  if (finds.length <= CAP) return finds;
  const oldestFirst = [...finds].sort((x, y) => x.at.localeCompare(y.at));
  const doomed = new Set<string>();
  for (const f of oldestFirst) {
    if (finds.length - doomed.size <= CAP) break;
    if (!f.shared) doomed.add(keyOf(f));
  }
  return finds.filter((f) => !doomed.has(keyOf(f)));
}

export function removeFind(key: string): Find[] {
  return write(loadFinds().filter((f) => keyOf(f) !== key));
}

export function clearFinds(): Find[] {
  return write([]);
}

export function markShared(key: string): Find[] {
  return write(loadFinds().map((f) => (keyOf(f) === key ? { ...f, shared: true } : f)));
}

/** The longest chain in the history, for the "new personal best" nudge. */
export function bestHops(finds: Find[]): number {
  return finds.reduce((best, f) => Math.max(best, f.hops), 0);
}

const NAME_KEY = "dos.finds.name";

export function loadSubmitterName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveSubmitterName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    // nothing to do: the name just won't be remembered next time
  }
}
