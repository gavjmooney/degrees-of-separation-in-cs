import type {
  AuthorDetail,
  AuthorSummary,
  Coauthor,
  LeaderboardRecord,
  MapMeta,
  Meta,
  Paper,
  PathResponse,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new ApiError(`${url}: ${res.status}`, res.status);
  return res.json() as Promise<T>;
}

/** POST JSON, surfacing the server's own `error` message when it sends one. */
async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let message = `${url}: ${res.status}`;
    try {
      const payload = (await res.json()) as { error?: string };
      if (payload?.error) message = payload.error;
    } catch {
      // non-JSON error body: keep the status-based message
    }
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  search: (q: string, signal?: AbortSignal) =>
    get<AuthorSummary[]>(`/api/search?q=${encodeURIComponent(q)}&limit=10`, signal),
  path: (from: number, to: number, k: number, maxNodes: number) =>
    get<PathResponse>(`/api/path?from=${from}&to=${to}&k=${k}&maxNodes=${maxNodes}`),
  author: (id: number) => get<AuthorDetail>(`/api/authors/${id}`),
  papers: (id: number, offset: number, limit = 25) =>
    get<{ total: number; offset: number; papers: Paper[] }>(
      `/api/authors/${id}/papers?offset=${offset}&limit=${limit}`,
    ),
  coauthors: (id: number, offset: number, limit = 50) =>
    get<{ total: number; offset: number; coauthors: Coauthor[] }>(
      `/api/authors/${id}/coauthors?offset=${offset}&limit=${limit}`,
    ),
  edge: (u: number, v: number) =>
    get<{ papers: Paper[] }>(`/api/edge?u=${u}&v=${v}&limit=50`),
  meta: () => get<Meta>("/api/meta"),
  /** null when the deployment runs with the leaderboard switched off */
  records: async (limit = 100): Promise<{ records: LeaderboardRecord[]; total: number } | null> => {
    try {
      return await get<{ records: LeaderboardRecord[]; total: number }>(`/api/records?limit=${limit}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  /** Publish a find. The server recomputes the hop count; we only send the pair. */
  submitRecord: (from: number, to: number, by: string) =>
    post<{ record: LeaderboardRecord; alreadyListed: boolean }>("/api/records", {
      from,
      to,
      ...(by.trim() ? { by: by.trim() } : {}),
    }),
  mapMeta: async (): Promise<MapMeta | null> => {
    try {
      return await get<MapMeta>("/api/map/meta");
    } catch {
      return null; // map stage not built for these artifacts
    }
  },
  mapIndex: async (): Promise<Uint16Array> => {
    const res = await fetch("/api/map/index");
    if (!res.ok) throw new ApiError("map index", res.status);
    return new Uint16Array(await res.arrayBuffer());
  },
  mapPositions: (ids: number[]) =>
    get<{ positions: { id: number; x: number; y: number }[] }>(
      `/api/map/positions?ids=${ids.join(",")}`,
    ),
};

/** dblp.org profile URL for an author (person key -> pid URL, else search). */
export function dblpUrl(author: { dblpKey?: string | null; name: string }): string {
  if (author.dblpKey?.startsWith("homepages/")) {
    return `https://dblp.org/pid/${author.dblpKey.slice("homepages/".length)}.html`;
  }
  return `https://dblp.org/search?q=${encodeURIComponent(author.name)}`;
}

export function dblpPaperUrl(paper: { dblpKey: string }): string {
  return `https://dblp.org/rec/${paper.dblpKey}.html`;
}
