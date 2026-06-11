/**
 * Whole-network map: a static pre-rendered image of the entire co-authorship
 * network (every dot is a researcher; no edges). The colouring follows the
 * network's community structure but is presented purely as visual texture —
 * the map deliberately doesn't label or explain it.
 *
 * Interactions: wheel zoom (cursor-anchored) + drag pan. When a query starts,
 * endpoint markers fade in with a pulsing ring, the camera slowly glides in
 * to frame the shortest path, and the path is drawn link by link before the
 * local view takes over. Going home plays the reverse: pull back from the
 * query's frame to the whole network.
 */
import { useEffect, useRef, useState } from "react";
import type { Meta } from "../api/types";

export interface ZoomTarget {
  x: number;
  y: number;
  color: string;
  name: string;
}

export interface PathPoint {
  x: number;
  y: number;
  name: string;
}

/** A scripted camera sequence played when a query starts or ends. */
export interface MapZoomPlan {
  /** endpoint markers */
  targets: ZoomTarget[];
  /** the shortest path (endpoints included, in order): after the glide the
   *  links are drawn one at a time before handing over to the local view.
   *  For a home plan this is the OLD path, retracted link by link instead. */
  pathPoints?: PathPoint[];
  /** when set, the camera starts here (the previous query's frame) and pulls
   *  back to the full network before gliding in */
  startView?: MapViewState | null;
  /** the previous query, shown during the pull-back phase; the view swaps to
   *  `targets`/`pathPoints` once fully zoomed out */
  oldTargets?: ZoomTarget[];
  oldPathPoints?: PathPoint[];
  /** going home: retract the path, then pull back to the full network and stop */
  home?: boolean;
}

interface Props {
  dumpMeta: Meta | null;
  plan: MapZoomPlan | null;
  /** cross-fade with the local query view underneath: "in" while the old
   *  graph zooms away, "out" while the new graph takes over */
  fade?: "in" | "out" | null;
  onZoomDone: () => void;
}

export interface MapViewState {
  scale: number;
  cx: number;
  cy: number;
}

const QUERY_ZOOM_MS = 3400;
const ZOOM_OUT_MS = 1500;
const HOME_ZOOM_MS = 2200;
const PATH_HOLD_MS = 650;
const MARKER_FADE_MS = 700;
const PULSE_MS = 1400;
const MAX_SCALE = 16;
/** zooming out below the fitted view just shrinks the map in place */
const MIN_SCALE = 0.6;
/** the resting view fits the whole network */
const DEFAULT_SCALE = 1;
/** virtual padding (in world units) around the image: panning may pull the
 *  map edge this far inside the viewport, so wide screens can pan left/right
 *  even when the square image fits the width */
const VIEW_PAD = 0.25;
/** minimum pan slack per axis, even when the image fits the viewport with
 *  room to spare (e.g. left/right at full zoom-out on a wide screen) */
const MIN_SLACK = 0.12;
const PATH_COLOR = "#ffd166"; // matches COLORS.pathNode in the local view

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** The camera view that frames a set of map points (the glide destination). */
export function fitView(points: { x: number; y: number }[]): MapViewState {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 0.06);
  return {
    scale: Math.min(12, 0.55 / span),
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
  };
}

export function MapView({ dumpMeta, plan, fade, onZoomDone }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const viewRef = useRef<MapViewState>({ scale: DEFAULT_SCALE, cx: 0.5, cy: 0.5 });
  const dragRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const animRef = useRef(0);
  const queryZoomRef = useRef(false);
  const zoomStartRef = useRef(0);
  /** path-draw progress in links: 2.4 = two links done + 40% of the third */
  const pathProgRef = useRef(0);
  /** which query the overlay shows: "out" = the old one while pulling back */
  const phaseRef = useRef<"out" | "in">("in");

  const [ready, setReady] = useState(false);
  const zoomDoneRef = useRef(onZoomDone);
  zoomDoneRef.current = onZoomDone;

  const clampView = () => {
    const v = viewRef.current;
    v.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale));
    const canvas = canvasRef.current;
    if (!canvas) return;
    const S = Math.min(canvas.width, canvas.height);
    for (const [axis, dim] of [["cx", canvas.width], ["cy", canvas.height]] as const) {
      const half = dim / (2 * S * v.scale); // visible half-extent in world units
      const lo = Math.min(half - VIEW_PAD, 0.5 - MIN_SLACK);
      const hi = Math.max(1 + VIEW_PAD - half, 0.5 + MIN_SLACK);
      v[axis] = Math.min(hi, Math.max(lo, v[axis]));
    }
  };

  const draw = () => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img) return;
    const ctx2d = canvas.getContext("2d")!;
    const { width: W, height: H } = canvas;
    const { scale, cx, cy } = viewRef.current;
    const S = Math.min(W, H);
    const side = S * scale;
    const toX = (x: number) => W / 2 + side * (x - cx);
    const toY = (y: number) => H / 2 + side * (y - cy);

    // background glow centred on the network itself, so it pans/zooms along
    // (the container's flat colour matches the gradient's outer stop)
    ctx2d.clearRect(0, 0, W, H);
    const gx = toX(0.5);
    const gy = toY(0.5);
    const grad = ctx2d.createRadialGradient(gx, gy, 0, gx, gy, side * 0.72);
    grad.addColorStop(0, "#161b27");
    grad.addColorStop(0.55, "#0d1016");
    grad.addColorStop(1, "#08090c");
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, W, H);
    ctx2d.imageSmoothingEnabled = true;
    ctx2d.drawImage(img, toX(0), toY(0), side, side);

    // during the pull-back phase the overlay still shows the old query; the
    // swap to the new one happens when the view reaches the full network
    const out = !plan?.home && phaseRef.current === "out";

    // the shortest path, drawn link by link after the glide
    const pts = out ? plan?.oldPathPoints : plan?.pathPoints;
    const prog = pathProgRef.current;
    if (pts && pts.length >= 2 && prog > 0) {
      const whole = Math.floor(Math.min(prog, pts.length - 1));
      const frac = Math.min(prog, pts.length - 1) - whole;
      ctx2d.beginPath();
      ctx2d.moveTo(toX(pts[0].x), toY(pts[0].y));
      for (let i = 1; i <= whole; i++) ctx2d.lineTo(toX(pts[i].x), toY(pts[i].y));
      if (frac > 0 && whole + 1 < pts.length) {
        const a = pts[whole];
        const b = pts[whole + 1];
        ctx2d.lineTo(toX(a.x + (b.x - a.x) * frac), toY(a.y + (b.y - a.y) * frac));
      }
      ctx2d.lineWidth = 2.5;
      ctx2d.lineCap = "round";
      ctx2d.lineJoin = "round";
      ctx2d.strokeStyle = PATH_COLOR;
      ctx2d.stroke();
      // intermediate hops light up as the line reaches them
      ctx2d.textAlign = "center";
      for (let i = 1; i <= whole && i < pts.length - 1; i++) {
        const x = toX(pts[i].x);
        const y = toY(pts[i].y);
        ctx2d.beginPath();
        ctx2d.arc(x, y, 4.5, 0, 2 * Math.PI);
        ctx2d.fillStyle = PATH_COLOR;
        ctx2d.fill();
        ctx2d.lineWidth = 1.5;
        ctx2d.strokeStyle = "#ffffff";
        ctx2d.stroke();
        ctx2d.font = "600 11px 'Segoe UI', system-ui, sans-serif";
        ctx2d.fillStyle = "rgba(10,12,16,0.8)";
        const tw = ctx2d.measureText(pts[i].name).width;
        ctx2d.fillRect(x - tw / 2 - 3, y - 26, tw + 6, 15);
        ctx2d.fillStyle = PATH_COLOR;
        ctx2d.fillText(pts[i].name, x, y - 15);
      }
    }

    // endpoint markers: fade in, then pulse softly while the camera glides
    const targets = out ? plan?.oldTargets : plan?.targets;
    if (targets) {
      const elapsed = queryZoomRef.current ? performance.now() - zoomStartRef.current : Infinity;
      const fade = Math.min(1, elapsed / MARKER_FADE_MS);
      const pulse = (elapsed % PULSE_MS) / PULSE_MS;
      ctx2d.textAlign = "center";
      for (const t of targets) {
        const x = toX(t.x);
        const y = toY(t.y);
        if (Number.isFinite(elapsed)) {
          // expanding ripple ring, repeating
          ctx2d.beginPath();
          ctx2d.arc(x, y, 8 + 20 * pulse, 0, 2 * Math.PI);
          ctx2d.lineWidth = 2;
          ctx2d.strokeStyle = t.color;
          ctx2d.globalAlpha = fade * 0.55 * (1 - pulse);
          ctx2d.stroke();
          ctx2d.globalAlpha = fade;
        }
        ctx2d.beginPath();
        ctx2d.arc(x, y, 7, 0, 2 * Math.PI);
        ctx2d.fillStyle = t.color;
        ctx2d.fill();
        ctx2d.lineWidth = 2.5;
        ctx2d.strokeStyle = "#ffffff";
        ctx2d.stroke();
        ctx2d.font = "700 13px 'Segoe UI', system-ui, sans-serif";
        ctx2d.fillStyle = "rgba(10,12,16,0.8)";
        const tw = ctx2d.measureText(t.name).width;
        ctx2d.fillRect(x - tw / 2 - 4, y - 32, tw + 8, 18);
        ctx2d.fillStyle = t.color;
        ctx2d.fillText(t.name, x, y - 18);
        ctx2d.globalAlpha = 1;
      }
    }
  };

  const animateTo = (target: MapViewState, ms: number, done?: () => void) => {
    cancelAnimationFrame(animRef.current);
    const from = { ...viewRef.current };
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = easeInOutCubic(t);
      viewRef.current = {
        scale: from.scale + (target.scale - from.scale) * e,
        cx: from.cx + (target.cx - from.cx) * e,
        cy: from.cy + (target.cy - from.cy) * e,
      };
      clampView();
      draw();
      if (t < 1) animRef.current = requestAnimationFrame(tick);
      else done?.();
    };
    animRef.current = requestAnimationFrame(tick);
  };

  // load image once; wire resize + wheel
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      imageRef.current = img;
      setReady(true);
      resize();
    };
    img.src = "/api/map/image";
    const resize = () => {
      const container = containerRef.current;
      const canvas = canvasRef.current;
      if (!container || !canvas) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      clampView();
      draw();
    };
    const ro = new ResizeObserver(resize);
    if (containerRef.current) ro.observe(containerRef.current);

    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (queryZoomRef.current) return;
      cancelAnimationFrame(animRef.current);
      const rect = canvas.getBoundingClientRect();
      const S = Math.min(canvas.width, canvas.height);
      const v = viewRef.current;
      const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * Math.exp(-e.deltaY * 0.0016)));
      const mx = e.clientX - rect.left - canvas.width / 2;
      const my = e.clientY - rect.top - canvas.height / 2;
      // keep the point under the cursor fixed while scaling
      v.cx = mx / (S * v.scale) + v.cx - mx / (S * next);
      v.cy = my / (S * v.scale) + v.cy - my / (S * next);
      v.scale = next;
      clampView();
      draw();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      cancelled = true;
      ro.disconnect();
      canvas.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(animRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // test/debug hook (mirrors window.__sigma in GraphCanvas)
  (window as unknown as { __map?: object }).__map = {
    view: () => ({ ...viewRef.current }),
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (queryZoomRef.current) return;
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      cx: viewRef.current.cx,
      cy: viewRef.current.cy,
    };
  };

  const onMove = (e: React.MouseEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const canvas = canvasRef.current!;
    const S = Math.min(canvas.width, canvas.height);
    viewRef.current.cx = drag.cx - (e.clientX - drag.x) / (S * viewRef.current.scale);
    viewRef.current.cy = drag.cy - (e.clientY - drag.y) / (S * viewRef.current.scale);
    clampView();
    draw();
  };

  // draw (or retract) the path one link at a time, then hand over
  const animatePath = (pts: PathPoint[], done: () => void, reverse = false) => {
    const links = pts.length - 1;
    const per = links <= 3 ? 450 : links <= 6 ? 330 : 240; // ms per link
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(links, (now - start) / per);
      pathProgRef.current = reverse ? links - p : p;
      draw();
      if (p < links) animRef.current = requestAnimationFrame(tick);
      else if (reverse) done();
      else window.setTimeout(done, PATH_HOLD_MS);
    };
    animRef.current = requestAnimationFrame(tick);
  };

  // scripted camera sequence when a plan arrives
  useEffect(() => {
    if (!plan) {
      queryZoomRef.current = false;
      pathProgRef.current = 0;
      phaseRef.current = "in";
      draw();
      return;
    }
    queryZoomRef.current = true;
    zoomStartRef.current = performance.now();
    const done = () => zoomDoneRef.current();
    if (plan.startView) {
      viewRef.current = { ...plan.startView };
      clampView();
    }
    if (plan.home) {
      // leaving a query: retract its path link by link, then pull back out
      // (landing on the default resting view)
      phaseRef.current = "in";
      const links = plan.pathPoints ? plan.pathPoints.length - 1 : 0;
      pathProgRef.current = links;
      draw();
      const pullBack = () =>
        animateTo({ scale: DEFAULT_SCALE, cx: 0.5, cy: 0.5 }, HOME_ZOOM_MS, done);
      if (plan.pathPoints) animatePath(plan.pathPoints, pullBack, true);
      else pullBack();
    } else {
      const dest = fitView(plan.pathPoints ?? plan.targets);
      const after = plan.pathPoints ? () => animatePath(plan.pathPoints!, done) : done;
      const glideIn = () => animateTo(dest, QUERY_ZOOM_MS, after);
      if (plan.startView) {
        // coming from a previous query: retract its path link by link, pull
        // back to the full network, then swap the overlay to the new query
        phaseRef.current = "out";
        pathProgRef.current = plan.oldPathPoints ? plan.oldPathPoints.length - 1 : 0;
        draw();
        const pullBack = () =>
          animateTo({ scale: 1, cx: 0.5, cy: 0.5 }, ZOOM_OUT_MS, () => {
            phaseRef.current = "in";
            pathProgRef.current = 0;
            zoomStartRef.current = performance.now(); // new markers fade in now
            glideIn();
          });
        if (plan.oldPathPoints) animatePath(plan.oldPathPoints, pullBack, true);
        else pullBack();
      } else {
        phaseRef.current = "in";
        pathProgRef.current = 0;
        draw();
        glideIn();
      }
    }
    return () => cancelAnimationFrame(animRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  return (
    <div className={`map-view${fade ? ` map-fade-${fade}` : ""}`} ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onMouseDown={onMouseDown}
        onMouseMove={onMove}
        onMouseUp={() => (dragRef.current = null)}
        onMouseLeave={() => (dragRef.current = null)}
      />
      {!ready && <div className="loading-stage">Loading the map of computing science…</div>}

      <div className="map-toolbar">
        <button
          title="Reset view"
          onClick={() => animateTo({ scale: DEFAULT_SCALE, cx: 0.5, cy: 0.5 }, 500)}
        >
          ⌖ reset
        </button>
      </div>

      <div className="legend map-legend">
        <span className="legend-title">Map of computing science</span>
        {dumpMeta && (
          <span>
            {dumpMeta.graph.nodes.toLocaleString()} researchers ·{" "}
            {dumpMeta.graph.undirected_edges.toLocaleString()} co-author links
          </span>
        )}
        <span>
          inspired by the{" "}
          <a href="https://oakland.edu/enp/" target="_blank" rel="noopener noreferrer">
            Erdős Number Project
          </a>{" "}
          and{" "}
          <a
            href="https://en.wikipedia.org/wiki/Six_degrees_of_separation"
            target="_blank"
            rel="noopener noreferrer"
          >
            six degrees of separation
          </a>
        </span>
        <span className="legend-dim">
          data:{" "}
          <a href="https://dblp.org" target="_blank" rel="noopener noreferrer">
            dblp
          </a>{" "}
          {dumpMeta?.built} (CC0)
        </span>
      </div>
    </div>
  );
}
