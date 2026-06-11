import { useEffect, useState } from "react";
import { api, dblpPaperUrl, dblpUrl } from "../api/client";
import type { AuthorDetail, Coauthor, Paper } from "../api/types";
import type { EdgeSelection } from "./GraphCanvas";

export type Selection = { type: "node"; id: number } | { type: "edge"; edge: EdgeSelection };

function PaperList({ papers }: { papers: Paper[] }) {
  return (
    <ul className="paper-list">
      {papers.map((p) => (
        <li key={p.id}>
          <a href={dblpPaperUrl(p)} target="_blank" rel="noreferrer">
            {p.title ?? p.dblpKey}
          </a>
          <span className="paper-meta">
            {p.venue && `${p.venue} · `}
            {p.year ?? ""}
            {p.informal && " · preprint"}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PapersTab({ id, total }: { id: number; total: number }) {
  const [papers, setPapers] = useState<Paper[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setPapers([]);
    api.papers(id, 0).then((p) => setPapers(p.papers), console.error);
  }, [id]);

  return (
    <>
      <PaperList papers={papers} />
      {papers.length > 0 && papers.length < total && (
        <button
          className="load-more"
          disabled={loadingMore}
          onClick={async () => {
            setLoadingMore(true);
            try {
              const more = await api.papers(id, papers.length);
              setPapers([...papers, ...more.papers]);
            } finally {
              setLoadingMore(false);
            }
          }}
        >
          {loadingMore ? "Loading…" : `Show more (${papers.length} of ${total})`}
        </button>
      )}
    </>
  );
}

function CoauthorsTab({ id, onOpenAuthor }: { id: number; onOpenAuthor: (id: number) => void }) {
  const [coauthors, setCoauthors] = useState<Coauthor[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    setCoauthors([]);
    api.coauthors(id, 0).then((r) => {
      setCoauthors(r.coauthors);
      setTotal(r.total);
    }, console.error);
  }, [id]);

  return (
    <>
      {total === 0 && <div className="panel-loading">No co-authors in the graph.</div>}
      <ul className="coauthor-list">
        {coauthors.map((c) => (
          <li key={c.id}>
            <button className="coauthor" onClick={() => onOpenAuthor(c.id)}>
              <span className="coauthor-name">
                {c.name}
                {c.isDisambig && <span className="badge">disambiguation</span>}
              </span>
              <span className="coauthor-meta">
                {c.weight} shared {c.weight === 1 ? "paper" : "papers"} ·{" "}
                {c.pubCount.toLocaleString()} publications
              </span>
            </button>
          </li>
        ))}
      </ul>
      {coauthors.length > 0 && coauthors.length < total && (
        <button
          className="load-more"
          disabled={loadingMore}
          onClick={async () => {
            setLoadingMore(true);
            try {
              const more = await api.coauthors(id, coauthors.length);
              setCoauthors([...coauthors, ...more.coauthors]);
            } finally {
              setLoadingMore(false);
            }
          }}
        >
          {loadingMore ? "Loading…" : `Show more (${coauthors.length} of ${total})`}
        </button>
      )}
    </>
  );
}

function AuthorContent({ id, onOpenAuthor }: { id: number; onOpenAuthor: (id: number) => void }) {
  const [author, setAuthor] = useState<AuthorDetail | null>(null);
  const [tab, setTab] = useState<"papers" | "coauthors">("papers");

  useEffect(() => {
    setAuthor(null);
    setTab("papers");
    api.author(id).then(setAuthor, console.error);
  }, [id]);

  if (!author) return <div className="panel-loading">Loading…</div>;
  return (
    <>
      <h2>
        {author.name}
        {author.isDisambig && <span className="badge">disambiguation</span>}
      </h2>
      {author.isDisambig && (
        <p className="note">
          This is a dblp disambiguation profile: a bin of publications by several distinct,
          not-yet-disambiguated people sharing this name.
        </p>
      )}
      <div className="stats">
        <span>{author.pubCount.toLocaleString()} publications</span>
        <span>{author.degree.toLocaleString()} co-authors</span>
        {author.firstYear && (
          <span>
            active {author.firstYear}–{author.lastYear}
          </span>
        )}
      </div>
      {author.topVenues.length > 0 && (
        <p className="venues">Top venues: {author.topVenues.join(", ")}</p>
      )}
      {author.aliases.length > 0 && (
        <p className="venues">Also published as: {author.aliases.join("; ")}</p>
      )}
      <a className="ext-link" href={dblpUrl(author)} target="_blank" rel="noreferrer">
        View on dblp.org ↗
      </a>
      <div className="tabs">
        <button className={tab === "papers" ? "tab active" : "tab"} onClick={() => setTab("papers")}>
          Publications
        </button>
        <button
          className={tab === "coauthors" ? "tab active" : "tab"}
          onClick={() => setTab("coauthors")}
        >
          Co-authors ({author.degree.toLocaleString()})
        </button>
      </div>
      {tab === "papers" ? (
        <PapersTab id={id} total={author.pubCount} />
      ) : (
        <CoauthorsTab id={id} onOpenAuthor={onOpenAuthor} />
      )}
    </>
  );
}

function EdgeContent({ edge }: { edge: EdgeSelection }) {
  const [papers, setPapers] = useState<Paper[] | null>(null);
  useEffect(() => {
    setPapers(null);
    api.edge(edge.u, edge.v).then((r) => setPapers(r.papers), console.error);
  }, [edge.u, edge.v]);

  return (
    <>
      <h2 className="edge-title">
        {edge.uName} <span className="edge-amp">&</span> {edge.vName}
      </h2>
      <div className="stats">
        <span>
          {edge.weight} co-authored {edge.weight === 1 ? "paper" : "papers"}
        </span>
      </div>
      <h3>Shared publications</h3>
      {papers === null ? <div className="panel-loading">Loading…</div> : <PaperList papers={papers} />}
    </>
  );
}

export function SidePanel({
  selection,
  onClose,
  onOpenAuthor,
}: {
  selection: Selection;
  onClose: () => void;
  onOpenAuthor: (id: number) => void;
}) {
  return (
    <aside className="side-panel">
      <button className="close" onClick={onClose} title="Close">
        ×
      </button>
      {selection.type === "node" ? (
        <AuthorContent id={selection.id} onOpenAuthor={onOpenAuthor} />
      ) : (
        <EdgeContent edge={selection.edge} />
      )}
    </aside>
  );
}
