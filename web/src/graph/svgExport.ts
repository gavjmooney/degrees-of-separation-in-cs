/**
 * Vector export of the current view: header (authors, degrees, active
 * filters), the visualization exactly as rendered (reducer state — filters,
 * label budget — included, since display data is read post-reducer), and the
 * legend. Built straight from the graph model, so the output is true SVG,
 * not a raster of the WebGL canvas.
 */
import type Sigma from "sigma";
import { COLORS } from "./styling";

export interface ExportContext {
  fromName: string;
  toName: string;
  hops: number;
  pathNames: string[];
  controls: {
    view: string;
    neighbours: string;
    maxNodes: number;
    minWeight: number;
    spacing: string;
    labels: string;
  };
}

const HEADER_H = 100;
const FONT = "'Segoe UI', system-ui, sans-serif";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function labelFont(type: string, defaultSize: number): { size: number; weight: number } {
  if (type === "endpointSquare") return { size: 12.4, weight: 700 };
  if (type === "square") return { size: 10.8, weight: 700 };
  return { size: defaultSize, weight: 500 };
}

export function buildSvg(sigma: Sigma, ctx: ExportContext): string {
  const { width, height } = sigma.getDimensions();
  const graph = sigma.getGraph();
  const totalH = HEADER_H + height;
  const defaultLabelSize = (sigma.getSetting("labelSize") as number) ?? 12;

  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH}" ` +
      `viewBox="0 0 ${width} ${totalH}" font-family="${FONT}">`,
  );
  out.push(`<rect width="${width}" height="${totalH}" fill="${COLORS.background}"/>`);

  // ---- header ----
  out.push(`<rect width="${width}" height="${HEADER_H}" fill="#161b24"/>`);
  out.push(`<line x1="0" y1="${HEADER_H}" x2="${width}" y2="${HEADER_H}" stroke="#2b3245"/>`);
  const degrees =
    ctx.hops === 0 ? "same author" : `${ctx.hops} ${ctx.hops === 1 ? "degree" : "degrees"}`;
  out.push(
    `<text x="20" y="30" font-size="15">` +
      `<tspan fill="#e8eaf0" font-weight="700">Degrees of Separation in CS</tspan>` +
      `<tspan fill="#9aa3b5">   ·   </tspan>` +
      `<tspan fill="${COLORS.endpointA}" font-weight="700">${esc(ctx.fromName)}</tspan>` +
      `<tspan fill="#9aa3b5"> · ${degrees} · </tspan>` +
      `<tspan fill="${COLORS.endpointB}" font-weight="700">${esc(ctx.toName)}</tspan>` +
      `</text>`,
  );
  const c = ctx.controls;
  out.push(
    `<text x="20" y="56" font-size="12" fill="#9aa3b5">` +
      esc(
        `view ${c.view}   ·   neighbours ${c.neighbours}   ·   max nodes ${c.maxNodes}   ·   ` +
          `min papers/link ${c.minWeight === 1 ? "all" : `${c.minWeight}+`}   ·   ` +
          `spacing ${c.spacing}   ·   labels ${c.labels}`,
      ) +
      `</text>`,
  );
  out.push(
    `<text x="20" y="82" font-size="12.5" fill="${COLORS.pathNode}">` +
      esc(ctx.pathNames.join("  —  ")) +
      `</text>`,
  );

  // ---- graph (clipped to the canvas area) ----
  out.push(`<defs><clipPath id="cv"><rect x="0" y="0" width="${width}" height="${height}"/></clipPath></defs>`);
  out.push(`<g transform="translate(0 ${HEADER_H})" clip-path="url(#cv)">`);

  const pos = new Map<string, { x: number; y: number }>();
  graph.forEachNode((node, attrs) => {
    pos.set(node, sigma.graphToViewport({ x: attrs.x, y: attrs.y }));
  });

  const edgeParts: { z: number; s: string }[] = [];
  graph.forEachEdge((edge, attrs, s, t) => {
    const dd = sigma.getEdgeDisplayData(edge);
    if (!dd || dd.hidden) return;
    const a = pos.get(s)!;
    const b = pos.get(t)!;
    edgeParts.push({
      z: (attrs.zIndex as number) ?? 1,
      s:
        `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" ` +
        `y2="${b.y.toFixed(1)}" stroke="${dd.color}" stroke-width="${dd.size.toFixed(2)}" stroke-linecap="round"/>`,
    });
  });
  edgeParts.sort((a, b) => a.z - b.z);
  out.push(...edgeParts.map((e) => e.s));

  const nodeParts: { z: number; s: string }[] = [];
  const labelParts: string[] = [];
  graph.forEachNode((node, attrs) => {
    const dd = sigma.getNodeDisplayData(node);
    if (!dd || dd.hidden) return;
    const p = pos.get(node)!;
    if (p.x < -60 || p.x > width + 60 || p.y < -60 || p.y > height + 60) return;
    const type = (attrs.type as string) ?? "circle";
    const z = (attrs.zIndex as number) ?? 1;
    if (type === "circle") {
      nodeParts.push({
        z,
        s: `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${dd.size.toFixed(2)}" fill="${dd.color}"/>`,
      });
    } else {
      const r = dd.size;
      nodeParts.push({
        z,
        s:
          `<rect x="${(p.x - r).toFixed(1)}" y="${(p.y - r).toFixed(1)}" ` +
          `width="${(2 * r).toFixed(1)}" height="${(2 * r).toFixed(1)}" fill="${dd.color}"/>`,
      });
    }
    const reduced = dd as unknown as { label?: string | null; forceLabel?: boolean };
    if (reduced.label && reduced.forceLabel) {
      const { size: fs, weight } = labelFont(type, defaultLabelSize);
      const tw = reduced.label.length * fs * 0.56;
      const ty = p.y - dd.size - 5;
      labelParts.push(
        `<rect x="${(p.x - tw / 2 - 3).toFixed(1)}" y="${(ty - fs - 2).toFixed(1)}" ` +
          `width="${(tw + 6).toFixed(1)}" height="${(fs + 5).toFixed(1)}" fill="rgba(13,16,22,0.8)"/>` +
          `<text x="${p.x.toFixed(1)}" y="${(ty - 2).toFixed(1)}" text-anchor="middle" ` +
          `font-size="${fs}" font-weight="${weight}" fill="${COLORS.labelText}">${esc(reduced.label)}</text>`,
      );
    }
  });
  nodeParts.sort((a, b) => a.z - b.z);
  out.push(...nodeParts.map((n) => n.s));
  out.push(...labelParts);
  out.push(`</g>`);

  // ---- legend (bottom-left, mirrors the on-screen legend) ----
  const entries: { color: string; square: boolean; text: string }[] = [
    { color: COLORS.endpointA, square: true, text: "start" },
    { color: COLORS.endpointB, square: true, text: "end" },
    { color: COLORS.pathNode, square: true, text: "shortest path" },
    { color: COLORS.altNode, square: true, text: "alternative shortest path" },
    { color: COLORS.legendNeighbour, square: false, text: "neighbourhood (fades with distance)" },
    { color: COLORS.disambig, square: false, text: "disambiguation profile" },
    { color: COLORS.legendNeighbour, square: false, text: "node size = publications" },
    { color: "#76869a", square: false, text: "edge thickness & opacity = shared papers" },
  ];
  const lh = 17;
  const legendH = entries.length * lh + 16;
  const legendW = 270;
  const ly = totalH - legendH - 14;
  out.push(
    `<g transform="translate(14 ${ly})">` +
      `<rect width="${legendW}" height="${legendH}" rx="8" fill="rgba(16,19,26,0.85)" stroke="#2b3245"/>`,
  );
  entries.forEach((e, i) => {
    const cy = 14 + i * lh;
    out.push(
      e.square
        ? `<rect x="10" y="${cy - 4}" width="8" height="8" fill="${e.color}"/>`
        : `<circle cx="14" cy="${cy}" r="4" fill="${e.color}"/>`,
    );
    out.push(`<text x="26" y="${cy + 3.5}" font-size="10.5" fill="#9aa3b5">${esc(e.text)}</text>`);
  });
  out.push(`</g>`);

  out.push(`</svg>`);
  return out.join("\n");
}

export function downloadSvg(sigma: Sigma, ctx: ExportContext): void {
  const svg = buildSvg(sigma, ctx);
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `degrees-${slug(ctx.fromName)}-${slug(ctx.toName)}.svg`;
  a.click();
  URL.revokeObjectURL(url);
}
