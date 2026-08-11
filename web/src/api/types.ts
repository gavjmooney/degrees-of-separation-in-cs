export interface AuthorSummary {
  id: number;
  name: string;
  aliases: string[];
  isDisambig: boolean;
  pubCount: number;
  firstYear: number | null;
  lastYear: number | null;
  topVenues: string[];
  degree: number;
}

export interface AuthorDetail extends AuthorSummary {
  dblpKey: string | null;
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

export interface Coauthor {
  id: number;
  name: string;
  pubCount: number;
  isDisambig: boolean;
  weight: number;
}

export interface PathNode {
  id: number;
  name: string;
  pubCount: number;
  isDisambig: boolean;
  degree: number;
  hop: number;
  onPath: boolean;
  pathIndex: number | null;
  /** distance from the start author if this node is on SOME shortest path, else null */
  spLevel: number | null;
}

export interface PathEdge {
  s: number;
  t: number;
  weight: number;
  onPath: boolean;
}

export interface PathResponse {
  found: boolean;
  hops: number | null;
  path: { id: number; name: string; isDisambig: boolean }[];
  graph: { nodes: PathNode[]; edges: PathEdge[] };
}

export interface Meta {
  built: string;
  graph: { nodes: number; undirected_edges: number };
}

/** A published find on the global board. Hop counts are the server's own. */
export interface LeaderboardRecord {
  id: number;
  a: { id: number; name: string; pubCount: number };
  b: { id: number; name: string; pubCount: number };
  hops: number;
  /** submitter's chosen name, or null for anonymous; unverified either way */
  by: string | null;
  built: string;
  /** verified against an older dblp build than the one now deployed */
  stale: boolean;
  found: string;
}

export interface MapCommunity {
  id: number;
  label: string;
  /** curated top-level domain ("continent") this community belongs to */
  domain: string;
  /** the community's dominant venues (secondary detail under the field label) */
  venues: string[];
  color: string;
  members: number;
  cx: number;
  cy: number;
}

export interface MapDomain {
  name: string;
  color: string;
  members: number;
  cx: number;
  cy: number;
}

export interface MapMeta {
  imageSize: number;
  indexSize: number;
  nodes: number;
  laidOut: number;
  domains: MapDomain[];
  communities: MapCommunity[];
  otherColor: string;
}
