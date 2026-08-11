/**
 * The hunt for long chains: your own query history (kept in this browser) and
 * the global board of published finds. Publishing is deliberate — one row at a
 * time, behind a confirm that says what leaves the browser.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { LeaderboardRecord } from "../api/types";
import { PublishFind, pathLength } from "../components/PublishFind";
import {
  byLength,
  clearFinds,
  findKey,
  keyOf,
  loadFinds,
  removeFind,
  type Find,
} from "../finds/store";
import { getColors } from "../graph/styling";
import { ThemeToggle, useTheme } from "../theme";
import { MEASURED } from "./About";

type Tab = "mine" | "global";

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
}

function queryPath(aId: number, bId: number): string {
  return `/path/${aId}/${bId}`;
}

export function Records() {
  const { theme } = useTheme();
  const C = getColors(theme);
  const [tab, setTab] = useState<Tab>("mine");
  const [finds, setFinds] = useState<Find[]>([]);
  const [board, setBoard] = useState<LeaderboardRecord[] | null>(null);
  const [boardOff, setBoardOff] = useState(false);
  const [boardError, setBoardError] = useState(false);
  const [publishing, setPublishing] = useState<Find | null>(null);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    setFinds(loadFinds());
  }, []);

  const refreshBoard = () =>
    api.records().then(
      (r) => {
        setBoardError(false);
        if (r === null) setBoardOff(true);
        else setBoard(r.records);
      },
      // a failed fetch must land in its own state: leaving `board` null would
      // otherwise read as "still loading" forever
      () => setBoardError(true),
    );
  useEffect(() => {
    refreshBoard();
  }, []);

  const ranked = useMemo(() => byLength(finds), [finds]);
  const best = ranked[0]?.hops ?? 0;
  const published = useMemo(
    () => new Set((board ?? []).map((r) => findKey(r.a.id, r.b.id))),
    [board],
  );

  const onPublished = async (record: LeaderboardRecord, alreadyListed: boolean) => {
    setFinds(loadFinds()); // PublishFind has already flagged the row as shared
    setPublishing(null);
    await refreshBoard();
    setNote({
      kind: "ok",
      text: alreadyListed
        ? `already on the board — found by ${record.by ?? "anonymous"} on ${shortDate(record.found)}`
        : `published: ${pathLength(record.hops)}`,
    });
    setTab("global");
  };

  const copyLink = async (find: Find) => {
    const url = `${location.origin}${queryPath(find.a.id, find.b.id)}`;
    try {
      await navigator.clipboard.writeText(url);
      setNote({ kind: "ok", text: "link copied" });
    } catch {
      setNote({ kind: "error", text: url }); // no clipboard permission: show it to copy by hand
    }
  };

  return (
    <div className="records">
      <header className="about-header">
        <div className="brand-block">
          <Link to="/" className="brand-logo-link" title="Back to the explorer">
            <img className="brand-logo" src="/logo.png" alt="" />
          </Link>
          <div className="brand-col">
            <Link to="/" className="brand" title="Back to the explorer">
              Degrees of Separation in CS
            </Link>
            <div className="byline">
              by{" "}
              <a href="https://gavjmooney.com" target="_blank" rel="noopener noreferrer">
                Gavin J. Mooney
              </a>
            </div>
          </div>
        </div>
        <div className="header-actions">
          <ThemeToggle />
          <Link to="/about" className="nav-link">
            About
          </Link>
          <Link to="/" className="nav-link">
            ← Explorer
          </Link>
        </div>
      </header>

      <div className="records-body">
        <h1 className="about-title">The long way round</h1>
        <p className="about-lede">
          Most pairs of researchers turn out to have a shortest path of four to six. The longest in
          this network is <strong>{MEASURED.diameter}</strong> — so that is the ceiling, and nobody
          has to stop before it. Every query you run is saved here automatically, in this browser
          only. Publish the ones you're proud of.
        </p>

        <div className="records-tabs">
          <button className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>
            my finds{finds.length > 0 && <span className="tab-count">{finds.length}</span>}
          </button>
          <button className={tab === "global" ? "active" : ""} onClick={() => setTab("global")}>
            global board
            {board && board.length > 0 && <span className="tab-count">{board.length}</span>}
          </button>
        </div>

        {note && <div className={`records-note ${note.kind}`}>{note.text}</div>}

        {tab === "mine" && (
          <>
            <div className="records-stats">
              {finds.length === 0 ? (
                <span className="muted">nothing yet</span>
              ) : (
                <>
                  <span>
                    <strong>{finds.length}</strong> {finds.length === 1 ? "pair" : "pairs"} searched
                  </span>
                  <span>
                    longest shortest path:{" "}
                    <strong style={{ color: C.pathNode }}>{best}</strong>
                  </span>
                  <span>
                    published: <strong>{finds.filter((f) => f.shared).length}</strong>
                  </span>
                </>
              )}
              {finds.length > 0 &&
                (confirmClear ? (
                  <span className="records-clear">
                    delete all {finds.length}?
                    <button
                      className="danger"
                      onClick={() => {
                        setFinds(clearFinds());
                        setConfirmClear(false);
                      }}
                    >
                      yes, clear
                    </button>
                    <button onClick={() => setConfirmClear(false)}>keep</button>
                  </span>
                ) : (
                  <button className="records-clear" onClick={() => setConfirmClear(true)}>
                    clear history
                  </button>
                ))}
            </div>

            {finds.length === 0 ? (
              <p className="records-empty">
                Search for two authors in the <Link to="/">explorer</Link> and they'll appear here.
                Pairs from different fields, and researchers with only a paper or two, tend to sit
                the furthest apart.
              </p>
            ) : (
              <table className="records-table">
                <thead>
                  <tr>
                    <th className="col-rank">#</th>
                    <th className="col-hops">shortest path length</th>
                    <th>chain</th>
                    <th className="col-date">found</th>
                    <th className="col-actions" />
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((f, i) => {
                    const key = keyOf(f);
                    const onBoard = f.shared || published.has(key);
                    return (
                      <tr key={key}>
                        <td className="col-rank">{i + 1}</td>
                        <td className="col-hops">
                          <span className="hops-badge">{f.hops}</span>
                        </td>
                        <td>
                          <Link className="records-pair" to={queryPath(f.a.id, f.b.id)}>
                            <span style={{ color: C.endpointA }}>{f.a.name}</span>
                            <span className="muted"> → </span>
                            <span style={{ color: C.endpointB }}>{f.b.name}</span>
                          </Link>
                          {f.chain.length > 2 && (
                            <div className="records-chain">{f.chain.join(" — ")}</div>
                          )}
                        </td>
                        <td className="col-date">{shortDate(f.at)}</td>
                        <td className="col-actions">
                          <button title="Copy a link to this query" onClick={() => copyLink(f)}>
                            link
                          </button>
                          {boardOff ? null : onBoard ? (
                            <span className="published" title="Published to the global board">
                              ★
                            </span>
                          ) : (
                            <button
                              className="publish"
                              title="Publish this find to the global board"
                              onClick={() => {
                                setNote(null);
                                setPublishing(f);
                              }}
                            >
                              ☆ publish
                            </button>
                          )}
                          <button
                            className="danger"
                            title="Remove from your history"
                            onClick={() => setFinds(removeFind(key))}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}

        {tab === "global" && (
          <>
            {boardOff && (
              <p className="records-empty">
                The global board is switched off on this deployment. Your own finds are still saved
                in this browser.
              </p>
            )}
            {!boardOff && boardError && (
              <p className="records-empty">
                Couldn't reach the global board.{" "}
                <button
                  className="records-retry"
                  onClick={() => {
                    setBoardError(false);
                    refreshBoard();
                  }}
                >
                  try again
                </button>
              </p>
            )}
            {!boardOff && !boardError && board === null && (
              <p className="records-empty">loading…</p>
            )}
            {!boardOff && board?.length === 0 && (
              <p className="records-empty">
                Nobody has published a find yet. Publish one from <strong>my finds</strong> and it
                will be the first.
              </p>
            )}
            {!boardOff && board && board.length > 0 && (
              <table className="records-table">
                <thead>
                  <tr>
                    <th className="col-rank">#</th>
                    <th className="col-hops">shortest path length</th>
                    <th>pair</th>
                    <th className="col-by">found by</th>
                    <th className="col-date">on</th>
                  </tr>
                </thead>
                <tbody>
                  {board.map((r, i) => (
                    <tr key={r.id} className={r.stale ? "stale" : ""}>
                      <td className="col-rank">{i + 1}</td>
                      <td className="col-hops">
                        <span className="hops-badge">{r.hops}</span>
                      </td>
                      <td>
                        <Link className="records-pair" to={queryPath(r.a.id, r.b.id)}>
                          <span style={{ color: C.endpointA }}>{r.a.name}</span>
                          <span className="muted"> → </span>
                          <span style={{ color: C.endpointB }}>{r.b.name}</span>
                        </Link>
                        <div className="records-chain">
                          {r.a.pubCount.toLocaleString()} and {r.b.pubCount.toLocaleString()}{" "}
                          publications
                          {r.stale && " · verified against an older dblp build"}
                        </div>
                      </td>
                      <td className="col-by">{r.by ?? <span className="muted">anonymous</span>}</td>
                      <td className="col-date">{shortDate(r.found)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="records-fineprint">
              Hop counts are recomputed on the server when a find is published, so the board can't
              be talked into a number. Names are whatever the submitter typed — there are no
              accounts, so treat them as decoration.
            </p>
          </>
        )}

        {publishing && (
          <PublishFind
            find={publishing}
            onCancel={() => setPublishing(null)}
            onPublished={onPublished}
          />
        )}
      </div>
    </div>
  );
}
