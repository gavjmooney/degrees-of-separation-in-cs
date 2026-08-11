import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { AuthorSummary, MapMeta, Meta, PathResponse } from "../api/types";
import { AuthorSearchBox } from "../components/AuthorSearchBox";
import { GraphCanvas, type ViewOptions } from "../components/GraphCanvas";
import { fitView, MapView, type MapZoomPlan, type PathPoint } from "../components/MapView";
import { SidePanel, type Selection } from "../components/SidePanel";
import { PublishFind } from "../components/PublishFind";
import { bestHops, findKey, keyOf, loadFinds, recordFind, type Find } from "../finds/store";
import { getColors } from "../graph/styling";
import type { LabelMode } from "../graph/labels";
import type { ViewMode } from "../graph/layout";
import { ThemeToggle, useTheme } from "../theme";

// label modes, in dropdown order. "few" labels the main path plus as many more
// as fit without overlapping; "custom" is driven by its own slider.
const LABEL_CHOICES = {
  path: "path only",
  few: "few",
  allsp: "all shortest paths",
  many: "many",
  all: "all",
  custom: "custom",
} as const;
type LabelChoice = keyof typeof LABEL_CHOICES;

/** Map positions for every hop of a path, or undefined if any hop is unmapped. */
function pathPointsFor(
  path: { id: number; name: string }[],
  pos: Map<number, { x: number; y: number }>,
): PathPoint[] | undefined {
  const pts: PathPoint[] = [];
  for (const p of path) {
    const at = pos.get(p.id);
    if (!at) return undefined;
    pts.push({ x: at.x, y: at.y, name: p.name });
  }
  return pts.length >= 2 ? pts : undefined;
}

export function Explorer() {
  const { fromId, toId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { theme } = useTheme();
  const C = getColors(theme);

  // k: "0" = the single main shortest path, "all" = every shortest path
  // (the server's SP-DAG, fetched as k=0), "1"/"2" = neighbourhood hops
  const k = params.get("k") ?? "1";
  const maxNodes = Number(params.get("max") ?? 300);

  const [a, setA] = useState<AuthorSummary | null>(null);
  const [b, setB] = useState<AuthorSummary | null>(null);
  const [data, setData] = useState<PathResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [mapMeta, setMapMeta] = useState<MapMeta | null | undefined>(undefined);
  const [zoomPlan, setZoomPlan] = useState<(MapZoomPlan & { dest: string }) | null>(null);
  // after the map glide finishes, the map lingers and fades out over the
  // incoming local view so the handover doesn't jump
  const [handoff, setHandoff] = useState<typeof zoomPlan>(null);
  // the path response fetched while planning the zoom, reused after navigation
  const prefetchRef = useRef<{ key: string; resp: PathResponse } | null>(null);

  const [mode, setMode] = useState<ViewMode>("organic");
  const [legendOpen, setLegendOpen] = useState(false); // mobile only: legend is a toggle
  // mobile only: collapse the search/controls chrome to maximise the canvas
  const [chromeHidden, setChromeHidden] = useState(false);
  const [minWeight, setMinWeight] = useState(1);
  const [labelChoice, setLabelChoice] = useState<LabelChoice>("few");
  const [labelCount, setLabelCount] = useState(12); // "custom" only
  // stable identity: GraphCanvas re-picks its labels whenever this changes
  const labels = useMemo<LabelMode>(() => {
    switch (labelChoice) {
      case "path":
        return { kind: "path" };
      case "allsp":
        return { kind: "allsp" };
      case "many":
        return { kind: "top", n: 30 };
      case "all":
        return { kind: "top", n: 9999 };
      case "custom":
        return { kind: "custom", n: labelCount };
      default:
        return { kind: "few" };
    }
  }, [labelChoice, labelCount]);
  const options: ViewOptions = { mode, minWeight, labels };

  // sliders: max-nodes changes refetch (debounced); min-weight filters live
  const [maxNodesLocal, setMaxNodesLocal] = useState(maxNodes);
  useEffect(() => setMaxNodesLocal(maxNodes), [maxNodes]);
  useEffect(() => {
    if (maxNodesLocal === maxNodes) return;
    const t = setTimeout(() => setParams({ k, max: String(maxNodesLocal) }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxNodesLocal]);
  const minNodesBound = Math.max(10, data?.path.length ?? 2);
  const maxWeightBound = useMemo(() => {
    if (!data?.found) return 10;
    let m = 2;
    for (const e of data.graph.edges) if (e.weight > m) m = e.weight;
    return Math.min(30, m);
  }, [data]);

  useEffect(() => {
    api.meta().then(setMeta, () => {});
    api.mapMeta().then(setMapMeta, () => setMapMeta(null));
  }, []);

  // deep link: hydrate empty search boxes from URL ids
  useEffect(() => {
    if (fromId && !a) api.author(Number(fromId)).then(setA, () => {});
    if (toId && !b) api.author(Number(toId)).then(setB, () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // selections drive the URL; the URL drives the query. Navigation is
  // preceded by an animated zoom on the map: when a query is already showing
  // the camera first pulls back to the full network, then glides in to frame
  // the new shortest path (prefetched here) and draws it link by link.
  useEffect(() => {
    if (!(a && b && a.id !== b.id)) return;
    const target = `/path/${a.id}/${b.id}`;
    if (`/path/${fromId}/${toId}` === target) return;
    const dest = `${target}?${params.toString()}`;
    // swapping the two current endpoints is the same query reversed: skip the animation
    const ids = new Set([fromId, toId]);
    const swapped = ids.has(String(a.id)) && ids.has(String(b.id));
    if (!mapMeta || swapped) {
      navigate(dest);
      return;
    }
    // the outgoing query, shown during the pull-back phase of the animation
    const oldPath =
      fromId && toId && data?.found && dataMatchesUrl ? data.path : null;
    const oldIds = fromId && toId ? [Number(fromId), Number(toId)] : [];
    const kFetch = k === "all" ? 0 : Number(k);
    api
      .path(a.id, b.id, kFetch, maxNodes)
      .then((resp) => {
        prefetchRef.current = { key: `${a.id}/${b.id}/${kFetch}/${maxNodes}`, resp };
        const pathIds = resp.found ? resp.path.map((p) => p.id) : [];
        const oldPathIds = oldPath ? oldPath.map((p) => p.id) : [];
        const wanted = [...new Set([a.id, b.id, ...oldIds, ...pathIds, ...oldPathIds])];
        return api.mapPositions(wanted).then((r) => {
          const pos = new Map(r.positions.map((p) => [p.id, p]));
          const pa = pos.get(a.id);
          const pb = pos.get(b.id);
          if (!(pa && pb)) {
            navigate(dest);
            return;
          }
          const pathPoints = resp.found ? pathPointsFor(resp.path, pos) : undefined;
          const oldPathPoints = oldPath ? pathPointsFor(oldPath, pos) : undefined;
          const po = pos.get(oldIds[0]);
          const pt = pos.get(oldIds[1]);
          const oldEnds = po && pt ? ([po, pt] as { x: number; y: number }[]) : null;
          setZoomPlan({
            targets: [
              { x: pa.x, y: pa.y, color: C.endpointA, name: a.name },
              { x: pb.x, y: pb.y, color: C.endpointB, name: b.name },
            ],
            pathPoints,
            oldTargets:
              oldPath && oldEnds
                ? [
                    { ...oldEnds[0], color: C.endpointA, name: oldPath[0].name },
                    { ...oldEnds[1], color: C.endpointB, name: oldPath[oldPath.length - 1].name },
                  ]
                : undefined,
            oldPathPoints,
            dest,
            // resume from where the previous query's animation left the camera
            startView: oldEnds ? fitView(oldPathPoints ?? oldEnds) : undefined,
          });
        });
      })
      .catch(() => navigate(dest));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b]);

  useEffect(() => {
    if (!fromId || !toId) return;
    setError(null);
    setSelection(null);
    // the zoom-plan effect may have fetched exactly this query already
    const kFetch = k === "all" ? 0 : Number(k);
    const pre = prefetchRef.current;
    if (pre && pre.key === `${fromId}/${toId}/${kFetch}/${maxNodes}`) {
      prefetchRef.current = null;
      setData(pre.resp);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .path(Number(fromId), Number(toId), kFetch, maxNodes)
      .then(setData, (e) => {
        setData(null);
        if (e instanceof ApiError && e.status === 404) {
          setError("Unknown author — this link may point at an id from an older data build.");
        } else {
          setError("The query failed. Is the server running?");
        }
      })
      .finally(() => setLoading(false));
  }, [fromId, toId, k, maxNodes]);

  const endpoints = data?.found ? { a: data.path[0], b: data.path[data.path.length - 1] } : null;
  const hasQuery = Boolean(fromId && toId);
  // guards against rendering a stale graph for one frame right after navigation
  const dataMatchesUrl = Boolean(
    endpoints && endpoints.a.id === Number(fromId) && endpoints.b.id === Number(toId),
  );

  // Every resolved query joins the local history that drives /records — this
  // browser only, nothing sent anywhere. Beating your own longest chain raises a
  // nudge; the best is tracked in a ref so recording can't re-trigger itself.
  const bestRef = useRef(0);
  const [newBest, setNewBest] = useState<number | null>(null);
  // the current query as a storable find, so it can be published from here
  const [currentFind, setCurrentFind] = useState<Find | null>(null);
  const [published, setPublished] = useState(false);
  const [publishing, setPublishing] = useState<Find | null>(null);
  // is there a global board on this deployment? one tiny request settles it
  const [boardOn, setBoardOn] = useState(false);
  useEffect(() => {
    bestRef.current = bestHops(loadFinds());
    api.records(1).then((r) => setBoardOn(r !== null), () => setBoardOn(false));
  }, []);
  useEffect(() => {
    const hops = data?.hops ?? 0;
    if (!(data?.found && dataMatchesUrl && meta) || hops < 1) {
      setNewBest(null);
      setCurrentFind(null);
      return;
    }
    const pubCounts = new Map(data.graph.nodes.map((n) => [n.id, n.pubCount]));
    const endpoint = (p: { id: number; name: string; isDisambig: boolean }) => ({
      id: p.id,
      name: p.name,
      isDisambig: p.isDisambig,
      pubCount: pubCounts.get(p.id) ?? 0,
    });
    const find: Find = {
      a: endpoint(data.path[0]),
      b: endpoint(data.path[data.path.length - 1]),
      hops,
      chain: data.path.map((p) => p.name),
      at: new Date().toISOString(),
      built: meta.built,
    };
    const history = recordFind(find);
    const key = findKey(find.a.id, find.b.id);
    setCurrentFind(find);
    setPublished(history.some((f) => keyOf(f) === key && f.shared === true));
    if (hops > bestRef.current) {
      bestRef.current = hops;
      setNewBest(hops);
    } else {
      setNewBest(null);
    }
  }, [data, dataMatchesUrl, meta]);

  const finishHome = () => {
    setA(null);
    setB(null);
    setData(null);
    setError(null);
    setZoomPlan(null);
    setHandoff(null);
    setChromeHidden(false); // search must be visible on the welcome map
    navigate("/");
  };

  // leaving a query plays the reverse animation: the map fades in framed on
  // the current path, retracts it link by link, then pulls back out
  const goHome = () => {
    setHandoff(null);
    if (!(fromId && toId && mapMeta && !zoomPlan && data?.found && dataMatchesUrl)) {
      finishHome();
      return;
    }
    const path = data.path;
    api.mapPositions(path.map((p) => p.id)).then(
      (r) => {
        const pos = new Map(r.positions.map((p) => [p.id, p]));
        const pa = pos.get(path[0].id);
        const pb = pos.get(path[path.length - 1].id);
        if (!(pa && pb)) {
          finishHome();
          return;
        }
        const pathPoints = pathPointsFor(path, pos);
        setZoomPlan({
          targets: [
            { x: pa.x, y: pa.y, color: C.endpointA, name: path[0].name },
            { x: pb.x, y: pb.y, color: C.endpointB, name: path[path.length - 1].name },
          ],
          pathPoints,
          startView: fitView(pathPoints ?? [pa, pb]),
          home: true,
          dest: "/",
        });
      },
      () => finishHome(),
    );
  };

  // k=0 ("shortest path only"): the server's k=0 response is the full SP-DAG,
  // so trim it to just the main path client-side
  const displayGraph = useMemo(() => {
    if (!data?.found) return null;
    if (k !== "0") return data.graph;
    return {
      nodes: data.graph.nodes.filter((n) => n.onPath),
      edges: data.graph.edges.filter((e) => e.onPath),
    };
  }, [data, k]);
  // the custom slider tops out at "every node in the current view"
  const labelMax = Math.max(1, displayGraph?.nodes.length ?? 1);

  return (
    <div className={`explorer ${chromeHidden ? "chrome-hidden" : ""}`}>
      <header>
        <div className="brand-block">
          <img
            className="brand-logo"
            src="/logo.png"
            alt=""
            title="Back to the whole-network map (clears the search)"
            onClick={goHome}
          />
          <div className="brand-col">
            <button
              className="brand"
              title="Back to the whole-network map (clears the search)"
              onClick={goHome}
            >
              Degrees of Separation in CS
            </button>
            <div className="byline">
              by{" "}
              <a href="https://gavjmooney.com" target="_blank" rel="noopener noreferrer">
                Gavin J. Mooney
              </a>
            </div>
          </div>
        </div>
        <div className="header-actions">
          {hasQuery && (
            <button
              className="chrome-toggle"
              title={chromeHidden ? "Show search and view options" : "Hide search and view options"}
              onClick={() => setChromeHidden(!chromeHidden)}
            >
              {chromeHidden ? "⌄ show" : "⌃ hide"}
            </button>
          )}
          <ThemeToggle />
          <Link to="/records" className="nav-link">
            Records
          </Link>
          <Link to="/about" className="nav-link">
            About
          </Link>
        </div>
        <div className="search-row compact">
          <AuthorSearchBox label="First author…" accent={C.endpointA} value={a} onSelect={setA} />
          <AuthorSearchBox label="Second author…" accent={C.endpointB} value={b} onSelect={setB} />
        </div>
        <div className="headline">
          {!hasQuery && !zoomPlan && !(a && b) && (
            <span className="muted">enter two authors to find the separation between them</span>
          )}
          {((zoomPlan && !zoomPlan.home) || loading) && <span className="muted">searching…</span>}
          {!zoomPlan && !loading && error && <span className="error">{error}</span>}
          {!zoomPlan && !loading && a && b && a.id === b.id && (
            <span className="error">pick two different authors</span>
          )}
          {!zoomPlan && !loading && data && !data.found && (
            <span>no connection — these authors are in disconnected parts of the network</span>
          )}
          {!zoomPlan && !loading && data?.found && endpoints && (
            <>
              <span style={{ color: C.endpointA }}>{endpoints.a.name}</span>
              <span className="hops">
                {data.hops === 0 ? "is" : `· ${data.hops} ${data.hops === 1 ? "degree" : "degrees"} ·`}
              </span>
              <span style={{ color: C.endpointB }}>{endpoints.b.name}</span>
            </>
          )}
          {!zoomPlan && !loading && newBest !== null && (
            <Link className="new-best" to="/records" title="See your saved finds">
              ★ your longest yet
            </Link>
          )}
        </div>
      </header>

      {hasQuery && !zoomPlan && (
        <div className="toolbar">
          <label>
            view
            <select value={mode} onChange={(e) => setMode(e.target.value as ViewMode)}>
              <option value="organic">organic</option>
              <option value="layered">layered</option>
              <option value="polygon">polygon</option>
              <option value="spiral">spiral</option>
              <option value="grid">grid</option>
            </select>
          </label>
          <label>
            neighbours
            <select
              value={k}
              onChange={(e) => setParams({ k: e.target.value, max: String(maxNodes) })}
            >
              <option value="0">shortest path only</option>
              <option value="all">all shortest paths</option>
              <option value="1">1 hop</option>
              <option value="2">2 hops</option>
            </select>
          </label>
          <label>
            max nodes
            <input
              type="range"
              min={minNodesBound}
              max={1000}
              step={10}
              value={maxNodesLocal}
              onChange={(e) => setMaxNodesLocal(Number(e.target.value))}
            />
            <span className="slider-val">{maxNodesLocal}</span>
          </label>
          <label>
            min papers/link
            <input
              type="range"
              min={1}
              max={maxWeightBound}
              step={1}
              value={Math.min(minWeight, maxWeightBound)}
              onChange={(e) => setMinWeight(Number(e.target.value))}
            />
            <span className="slider-val">{minWeight === 1 ? "all" : `${minWeight}+`}</span>
          </label>
          <label>
            labels
            <select
              value={labelChoice}
              onChange={(e) => setLabelChoice(e.target.value as LabelChoice)}
            >
              {Object.entries(LABEL_CHOICES).map(([key, text]) => (
                <option key={key} value={key}>
                  {text}
                </option>
              ))}
            </select>
          </label>
          {labelChoice === "custom" && (
            <label>
              how many
              <input
                type="range"
                min={1}
                max={labelMax}
                step={1}
                value={Math.min(labelCount, labelMax)}
                onChange={(e) => setLabelCount(Number(e.target.value))}
              />
              <span className="slider-val">{Math.min(labelCount, labelMax)}</span>
            </label>
          )}
        </div>
      )}

      {hasQuery && !zoomPlan && data?.found && (
        <div className="path-strip">
          {data.path.map((p, i) => (
            <span key={p.id}>
              {i > 0 && <span className="path-arrow"> — </span>}
              <button className="path-author" onClick={() => setSelection({ type: "node", id: p.id })}>
                {p.name}
                {p.isDisambig && "*"}
              </button>
            </span>
          ))}
          {data.path.some((p) => p.isDisambig) && (
            // the server prefers disambiguation-free chains, so one appearing
            // here means every shortest path passes through such a profile
            <div className="path-caution">
              * disambiguation profile — every shortest chain between these authors passes through
              one. These profiles can conflate the work of several people, so read this connection
              cautiously.
            </div>
          )}
        </div>
      )}

      <div className="canvas-area">
        {(!hasQuery || zoomPlan || handoff) && mapMeta && (
          <MapView
            dumpMeta={meta}
            plan={zoomPlan ?? handoff}
            fade={zoomPlan ? (zoomPlan.startView ? "in" : null) : handoff ? "out" : null}
            onZoomDone={() => {
              const plan = zoomPlan;
              setZoomPlan(null);
              if (!plan) return;
              if (plan.home) {
                finishHome();
              } else {
                navigate(plan.dest);
                setHandoff(plan);
                setTimeout(() => setHandoff(null), 1200);
              }
            }}
          />
        )}
        {!hasQuery && mapMeta === null && (
          <div className="welcome">
            <h1>Degrees of Separation in CS</h1>
            <p>
              How far apart are two computing researchers in the co-authorship network? Pick two
              authors above to find the shortest chain of co-authored papers connecting them — the
              Erdős-number idea, over all of dblp.
            </p>
            {meta && (
              <p className="welcome-meta">
                dblp dump of {meta.built} (CC0) · {meta.graph.nodes.toLocaleString()} authors ·{" "}
                {meta.graph.undirected_edges.toLocaleString()} co-author links
              </p>
            )}
          </div>
        )}
        {hasQuery &&
          dataMatchesUrl &&
          (!zoomPlan || zoomPlan.startView) &&
          data?.found &&
          endpoints &&
          displayGraph && (
          <GraphCanvas
            nodes={displayGraph.nodes}
            edges={displayGraph.edges}
            hops={data.hops ?? 0}
            fromId={Number(fromId)}
            toId={Number(toId)}
            options={options}
            intro={handoff !== null}
            outro={zoomPlan !== null}
            exportContext={{
              fromName: endpoints.a.name,
              toName: endpoints.b.name,
              hops: data.hops ?? 0,
              pathNames: data.path.map((p) => p.name),
              controls: {
                view: mode,
                neighbours:
                  k === "0"
                    ? "shortest path only"
                    : k === "all"
                      ? "all shortest paths"
                      : `${k} hop${k === "1" ? "" : "s"}`,
                maxNodes,
                minWeight,
                labels:
                  labelChoice === "custom"
                    ? `custom (${Math.min(labelCount, labelMax)})`
                    : LABEL_CHOICES[labelChoice],
              },
            }}
            onNodeClick={(id) => setSelection({ type: "node", id })}
            onEdgeClick={(edge) => setSelection({ type: "edge", edge })}
            onBackgroundClick={() => setSelection(null)}
          />
        )}
        {hasQuery && !zoomPlan && loading && (
          <div className="loading-stage">Running breadth-first search…</div>
        )}
        {/* publishing lives here too, at the moment of the find — not only on /records */}
        {hasQuery && !zoomPlan && !loading && boardOn && currentFind && dataMatchesUrl && (
          published ? (
            <span className="publish-btn on-board" title="This find is on the global board">
              ★ on the board
            </span>
          ) : (
            <button
              className="publish-btn"
              title="Publish this find to the global board"
              onClick={() => setPublishing(currentFind)}
            >
              ☆ publish
            </button>
          )
        )}
        {publishing && (
          <PublishFind
            find={publishing}
            onCancel={() => setPublishing(null)}
            onPublished={() => {
              setPublishing(null);
              setPublished(true);
            }}
          />
        )}
        {selection && (
          <SidePanel
            selection={selection}
            onClose={() => setSelection(null)}
            onOpenAuthor={(id) => setSelection({ type: "node", id })}
          />
        )}
        {hasQuery && !zoomPlan && data?.found && (
          <button
            className={`legend-toggle ${legendOpen ? "active" : ""}`}
            onClick={() => setLegendOpen(!legendOpen)}
          >
            ⓘ legend
          </button>
        )}
        {hasQuery && !zoomPlan && data?.found && (
          <div className={`legend ${legendOpen ? "legend-open" : ""}`}>
            <span><i className="sq glyph-author" style={{ background: C.endpointA }} /> author 1</span>
            <span><i className="sq glyph-author" style={{ background: C.endpointB }} /> author 2</span>
            <span><i className="sq glyph-path" style={{ background: C.pathNode }} /> shortest path</span>
            <span><i className="sq glyph-alt" style={{ background: C.altNode }} /> alternative shortest path(s)</span>
            <span><i className="glyph-neighbour" style={{ background: C.legendNeighbour }} /> neighbourhood</span>
            <span><i className="glyph-neighbour" style={{ background: C.disambig }} /> disambiguation profile</span>
            <span className="legend-glyphs">
              <i className="dot-s" style={{ background: C.legendNeighbour }} />
              <i className="dot-l" style={{ background: C.legendNeighbour }} /> node size = # of publications
              <span className="legend-note">
                authors 1 &amp; 2 are always the largest; shortest-path nodes a little bigger
              </span>
            </span>
            <span>
              <i className="edge-glyph" /> edge thickness &amp; opacity = # of shared papers
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
