import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { AuthorSummary, MapMeta, Meta, PathResponse } from "../api/types";
import { AuthorSearchBox } from "../components/AuthorSearchBox";
import { GraphCanvas, type ViewOptions } from "../components/GraphCanvas";
import { fitView, MapView, type MapZoomPlan, type PathPoint } from "../components/MapView";
import { SidePanel, type Selection } from "../components/SidePanel";
import { COLORS } from "../graph/styling";
import type { ViewMode } from "../graph/layout";

const SPACING = { cozy: 1, normal: 2, airy: 4 } as const;
type SpacingKey = keyof typeof SPACING;

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
  const [spacing, setSpacing] = useState<SpacingKey>("normal");
  const [minWeight, setMinWeight] = useState(1);
  const [labelBudget, setLabelBudget] = useState(12);
  const options: ViewOptions = { mode, spacing: SPACING[spacing], minWeight, labelBudget };

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
              { x: pa.x, y: pa.y, color: COLORS.endpointA, name: a.name },
              { x: pb.x, y: pb.y, color: COLORS.endpointB, name: b.name },
            ],
            pathPoints,
            oldTargets:
              oldPath && oldEnds
                ? [
                    { ...oldEnds[0], color: COLORS.endpointA, name: oldPath[0].name },
                    { ...oldEnds[1], color: COLORS.endpointB, name: oldPath[oldPath.length - 1].name },
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

  const finishHome = () => {
    setA(null);
    setB(null);
    setData(null);
    setError(null);
    setZoomPlan(null);
    setHandoff(null);
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
            { x: pa.x, y: pa.y, color: COLORS.endpointA, name: path[0].name },
            { x: pb.x, y: pb.y, color: COLORS.endpointB, name: path[path.length - 1].name },
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

  return (
    <div className="explorer">
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
        {hasQuery && (
          <button
            className="back-to-map"
            title="Back to the whole-network map (clears the search)"
            onClick={goHome}
          >
            ◎ whole network
          </button>
        )}
        <div className="search-row compact">
          <AuthorSearchBox label="First author…" accent={COLORS.endpointA} value={a} onSelect={setA} />
          <button
            className="swap"
            title="Swap"
            onClick={() => {
              setA(b);
              setB(a);
            }}
          >
            ⇄
          </button>
          <AuthorSearchBox label="Second author…" accent={COLORS.endpointB} value={b} onSelect={setB} />
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
              <span style={{ color: COLORS.endpointA }}>{endpoints.a.name}</span>
              <span className="hops">
                {data.hops === 0 ? "is" : `· ${data.hops} ${data.hops === 1 ? "degree" : "degrees"} ·`}
              </span>
              <span style={{ color: COLORS.endpointB }}>{endpoints.b.name}</span>
            </>
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
            spacing
            <select value={spacing} onChange={(e) => setSpacing(e.target.value as SpacingKey)}>
              <option value="cozy">cozy</option>
              <option value="normal">normal</option>
              <option value="airy">airy</option>
            </select>
          </label>
          <label>
            labels
            <select value={labelBudget} onChange={(e) => setLabelBudget(Number(e.target.value))}>
              <option value="-1">path only</option>
              <option value="0">all shortest paths</option>
              <option value="12">key authors</option>
              <option value="30">many</option>
              <option value="9999">all</option>
            </select>
          </label>
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
                spacing,
                labels:
                  { [-1]: "path only", 0: "all shortest paths", 12: "key authors", 30: "many", 9999: "all" }[
                    labelBudget
                  ] ?? String(labelBudget),
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
        {selection && (
          <SidePanel
            selection={selection}
            onClose={() => setSelection(null)}
            onOpenAuthor={(id) => setSelection({ type: "node", id })}
          />
        )}
        {hasQuery && !zoomPlan && data?.found && (
          <div className="legend">
            <span><i className="sq" style={{ background: COLORS.endpointA }} /> start</span>
            <span><i className="sq" style={{ background: COLORS.endpointB }} /> end</span>
            <span><i className="sq" style={{ background: COLORS.pathNode }} /> shortest path</span>
            <span><i className="sq" style={{ background: COLORS.altNode }} /> alternative shortest path</span>
            <span><i style={{ background: COLORS.legendNeighbour }} /> neighbourhood (fades with distance)</span>
            <span><i style={{ background: COLORS.disambig }} /> disambiguation profile</span>
            <span className="legend-glyphs">
              <i className="dot-s" style={{ background: COLORS.legendNeighbour }} />
              <i className="dot-l" style={{ background: COLORS.legendNeighbour }} /> node size = publications
            </span>
            <span>
              <i className="edge-glyph" /> edge thickness &amp; opacity = shared papers
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
