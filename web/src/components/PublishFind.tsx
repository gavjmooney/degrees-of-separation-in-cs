/**
 * The confirm sheet for putting a find on the global board — the one place in
 * the app where something leaves the browser, so it says so plainly and is
 * always an explicit act. Used from both the explorer (right after a find) and
 * the records page (any row of your history).
 *
 * Only the author pair is sent: the server recomputes the path length itself.
 */
import { useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import type { LeaderboardRecord } from "../api/types";
import { keyOf, loadSubmitterName, markShared, saveSubmitterName, type Find } from "../finds/store";
import { getColors } from "../graph/styling";
import { useTheme } from "../theme";

/** How the leaderboard names its number, spelled out for clarity. */
export function pathLength(hops: number): string {
  return `shortest path length ${hops}`;
}

interface Props {
  find: Find;
  onCancel: () => void;
  onPublished: (record: LeaderboardRecord, alreadyListed: boolean) => void;
}

export function PublishFind({ find, onCancel, onPublished }: Props) {
  const { theme } = useTheme();
  const C = getColors(theme);
  const [name, setName] = useState(loadSubmitterName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // opened over the interactive graph, so escape has to work and the canvas
  // behind must not take clicks meant for the sheet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const publish = async () => {
    setBusy(true);
    setError(null);
    try {
      const { record, alreadyListed } = await api.submitRecord(find.a.id, find.b.id, name);
      saveSubmitterName(name);
      markShared(keyOf(find));
      onPublished(record, alreadyListed);
    } catch (e) {
      // stay open on failure so the attempt isn't silently lost
      setError(
        e instanceof ApiError
          ? e.status === 404
            ? "the global board is switched off on this deployment"
            : e.message
          : "the submission failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="publish-backdrop" onClick={() => !busy && onCancel()} />
      <div className="publish-sheet" role="dialog" aria-label="Publish this find">
        <h2>Publish this find</h2>
        <p>
          <span style={{ color: C.endpointA }}>{find.a.name}</span>
          <span className="muted"> → </span>
          <span style={{ color: C.endpointB }}>{find.b.name}</span>
          <span className="muted"> · {pathLength(find.hops)}</span>
        </p>
        <p className="publish-explains">
          This sends the two authors and the name below to the public board, where anyone can see
          them. The rest of your history stays in this browser.
        </p>
        <label>
          your name (optional)
          <input
            value={name}
            maxLength={24}
            placeholder="anonymous"
            autoFocus
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {error && <p className="publish-error">{error}</p>}
        <div className="publish-actions">
          <button className="primary" disabled={busy} onClick={publish}>
            {busy ? "publishing…" : "publish"}
          </button>
          <button disabled={busy} onClick={onCancel}>
            cancel
          </button>
        </div>
      </div>
    </>
  );
}
