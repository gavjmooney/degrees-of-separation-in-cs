import { axisBottom, axisLeft, format, max, scaleBand, scaleLinear, select } from "d3";
import { useEffect, useRef, useState } from "react";

/**
 * Both charts are drawn with D3 from values measured offline over the dblp
 * co-authorship graph (the binary CSR, dump 2026-06-10):
 *
 *  - PATH_LEN: single-source breadth-first search from 250 nodes sampled
 *    uniformly at random from the giant component; each entry is the share (%)
 *    of reached ordered pairs at that shortest-path length. Mean = ASPL.
 *  - DEGREE_BASE / DEGREE_TAIL: an exact census of every researcher's degree
 *    (number of distinct co-authors). Degrees 0–75 are individual bars; the
 *    tail (76+) is one pooled bar that expands, on hover, into wider range bins.
 */
export const ASPL = 5.3;

const PATH_LEN: { d: number; pct: number }[] = [
  { d: 1, pct: 0.0 },
  { d: 2, pct: 0.04 },
  { d: 3, pct: 2.19 },
  { d: 4, pct: 18.65 },
  { d: 5, pct: 40.94 },
  { d: 6, pct: 27.07 },
  { d: 7, pct: 8.27 },
  { d: 8, pct: 2.03 },
  { d: 9, pct: 0.56 },
  { d: 10, pct: 0.19 },
  { d: 11, pct: 0.03 },
  { d: 12, pct: 0.01 },
];

type Bar = { label: string; count: number; kind?: "overflow" | "tail" };

// Collapsed view: degrees 0–75 individually, plus one pooled "76+" bar.
const DEGREE_BASE: Bar[] = [
  139480, 326651, 469200, 469320, 400963, 331294, 246235, 197476, 157242, 130453, 106911, 91518,
  78466, 67872, 60061, 52550, 46613, 42126, 38259, 34366, 31157, 28422, 26173, 24426, 22619, 20749,
  19648, 17929, 16655, 15773, 14961, 14172, 13347, 12333, 11674, 11074, 10738, 10162, 9754, 9095,
  8857, 8398, 7931, 7755, 7498, 7133, 6619, 6616, 6303, 5999, 5572, 5297, 5036, 4946, 4649, 4592,
  4237, 4239, 3933, 3897, 3893, 3511, 3640, 3432, 3199, 3193, 3061, 3044, 2758, 2755, 2658, 2632,
  2599, 2541, 2433, 2331,
].map((count, deg) => ({ label: String(deg), count }));

const DEGREE_OVERFLOW: Bar = { label: "76+", count: 119219, kind: "overflow" };

// Expanded view: the 76+ pool broken into ranges (shown as wider bars).
const DEGREE_TAIL: Bar[] = [
  { label: "76–100", count: 42161, kind: "tail" },
  { label: "101–250", count: 62428, kind: "tail" },
  { label: "251–500", count: 11219, kind: "tail" },
  { label: "501–1k", count: 2572, kind: "tail" },
  { label: "1k+", count: 839, kind: "tail" },
];

const W = 680;
const H = 380;
const ACCENT_A = "#ff7b39";

type Tip = { x: number; y: number; html: string };
type SetTip = (t: Tip | null) => void;
type DrawFn = (svg: SVGSVGElement, setTip: SetTip, host: HTMLElement) => void;

/** Position the tooltip relative to the figure host from a pointer event. */
function tipPos(event: MouseEvent, host: HTMLElement, html: string): Tip {
  const r = host.getBoundingClientRect();
  return { x: event.clientX - r.left + 12, y: event.clientY - r.top + 12, html };
}

function addTitles(
  svg: ReturnType<typeof select<SVGSVGElement, unknown>>,
  m: { top: number; left: number },
  iw: number,
  ih: number,
  title: string,
  xTitle: string,
  yTitle: string,
) {
  svg
    .append("text")
    .attr("class", "chart-title")
    .attr("x", W / 2)
    .attr("y", 22)
    .attr("text-anchor", "middle")
    .text(title);
  svg
    .append("text")
    .attr("class", "axis-title")
    .attr("x", m.left + iw / 2)
    .attr("y", H - 8)
    .attr("text-anchor", "middle")
    .text(xTitle);
  svg
    .append("text")
    .attr("class", "axis-title")
    .attr("transform", `translate(14,${m.top + ih / 2}) rotate(-90)`)
    .attr("text-anchor", "middle")
    .text(yTitle);
}

export const drawPathLength: DrawFn = (node, setTip, host) => {
  const m = { top: 46, right: 20, bottom: 52, left: 62 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const svg = select(node);
  svg.selectAll("*").remove();
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);

  const x = scaleBand()
    .domain(PATH_LEN.map((p) => String(p.d)))
    .range([0, iw])
    .padding(0.22);
  const y = scaleLinear().domain([0, 44]).range([ih, 0]).nice();

  // faint horizontal gridlines behind the bars
  g.append("g")
    .attr("class", "grid")
    .selectAll("line")
    .data(y.ticks(5))
    .join("line")
    .attr("x1", 0)
    .attr("x2", iw)
    .attr("y1", (d) => y(d))
    .attr("y2", (d) => y(d));

  g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(axisBottom(x));
  g.append("g")
    .attr("class", "axis")
    .call(axisLeft(y).ticks(5).tickFormat((d) => `${d}%`));

  g.selectAll("rect.bar")
    .data(PATH_LEN)
    .join("rect")
    .attr("class", "bar")
    .attr("x", (d) => x(String(d.d))!)
    .attr("y", (d) => y(d.pct))
    .attr("width", x.bandwidth())
    .attr("height", (d) => ih - y(d.pct))
    .on("mousemove", (event: MouseEvent, d) =>
      setTip(tipPos(event, host, `<b>path length ${d.d}</b><br>${d.pct}% of pairs`)),
    )
    .on("mouseleave", () => setTip(null));

  const meanX = x(String(1))! + x.bandwidth() / 2 + (ASPL - 1) * x.step();
  g.append("line")
    .attr("class", "mean-line")
    .attr("x1", meanX)
    .attr("x2", meanX)
    .attr("y1", 0)
    .attr("y2", ih);

  addTitles(
    svg,
    m,
    iw,
    ih,
    "Distribution of shortest path lengths",
    "Degrees of separation (path length)",
    "Share of connected pairs",
  );

  const lg = svg
    .append("g")
    .attr("class", "chart-legend")
    .attr("transform", `translate(${W - m.right - 150},${m.top + 4})`);
  lg.append("rect").attr("width", 12).attr("height", 12).attr("rx", 2).attr("fill", ACCENT_A);
  lg.append("text").attr("x", 18).attr("y", 11).text("% of pairs");
  lg.append("line").attr("x1", 0).attr("x2", 12).attr("y1", 26).attr("y2", 26).attr("class", "mean-line");
  lg.append("text").attr("x", 18).attr("y", 30).text(`mean ≈ ${ASPL}`);
};

/**
 * Degree histogram. Collapsed, it shows degrees 0–75 as individual bars plus one
 * pooled "76+" bar. Hovering that bar calls setExtended(true), which re-renders
 * with the 76+ pool broken into range bins drawn as wider bars with clear,
 * horizontal labels. Leaving the chart collapses it again.
 */
export function drawDegreeHistogram(
  node: SVGSVGElement,
  setTip: SetTip,
  host: HTMLElement,
  extended: boolean,
  setExtended: (v: boolean) => void,
) {
  const m = { top: 46, right: 20, bottom: 52, left: 64 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const svg = select(node);
  svg.selectAll("*").remove();
  const g = svg.append("g").attr("transform", `translate(${m.left},${m.top})`);
  const sFmt = format("~s");

  // y is fixed by the tallest bar (degree 3) so the axis never jumps on expand
  const y = scaleLinear()
    .domain([0, max(DEGREE_BASE, (d) => d.count) ?? 0])
    .range([ih, 0])
    .nice();

  // faint horizontal gridlines behind the bars
  g.append("g")
    .attr("class", "grid")
    .selectAll("line")
    .data(y.ticks(5))
    .join("line")
    .attr("x1", 0)
    .attr("x2", iw)
    .attr("y1", (d) => y(d))
    .attr("y2", (d) => y(d));

  g.append("g")
    .attr("class", "axis")
    .call(axisLeft(y).ticks(5).tickFormat((d) => sFmt(d as number)));

  const baseTip = (d: Bar) =>
    `<b>${d.label} co-author${d.label === "1" ? "" : "s"}</b><br>${d.count.toLocaleString()} researchers`;

  if (!extended) {
    // ---- collapsed: 0–75 individual bars + pooled "76+" ----
    const data: Bar[] = [...DEGREE_BASE, DEGREE_OVERFLOW];
    const x = scaleBand()
      .domain(data.map((d) => d.label))
      .range([0, iw])
      .padding(0.12);

    g.append("g")
      .attr("class", "axis")
      .attr("transform", `translate(0,${ih})`)
      .call(axisBottom(x).tickValues(["0", "15", "30", "45", "60", "76+"]));

    g.selectAll("rect.bar")
      .data(data)
      .join("rect")
      .attr("class", (d) => (d.kind ? `bar ${d.kind}` : "bar"))
      .attr("x", (d) => x(d.label)!)
      .attr("y", (d) => y(d.count))
      .attr("width", x.bandwidth())
      .attr("height", (d) => ih - y(d.count))
      .style("cursor", (d) => (d.kind === "overflow" ? "pointer" : "default"))
      .on("mousemove", (event: MouseEvent, d) =>
        setTip(
          tipPos(
            event,
            host,
            d.kind === "overflow"
              ? `<b>76+ co-authors</b><br>${d.count.toLocaleString()} researchers<br><i>hover to expand</i>`
              : baseTip(d),
          ),
        ),
      )
      .on("mouseenter", (_event, d) => {
        if (d.kind === "overflow") setExtended(true);
      })
      .on("mouseleave", () => setTip(null));
  } else {
    // ---- expanded: narrow base bars (0–75) + wider tail range bins ----
    // give each tail bin a fixed, generous slot so its label reads horizontally
    const tailW = 48;
    const baseTotal = iw - DEGREE_TAIL.length * tailW;
    const baseW = baseTotal / DEGREE_BASE.length;
    const baseCenter = (deg: number) => deg * baseW + baseW / 2;
    const tailCenter = (j: number) => baseTotal + j * tailW + tailW / 2;

    // base bars (per degree)
    const baseG = g.append("g");
    baseG
      .selectAll("rect")
      .data(DEGREE_BASE)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (_d, i) => i * baseW + 0.3)
      .attr("y", (d) => y(d.count))
      .attr("width", Math.max(1, baseW - 0.6))
      .attr("height", (d) => ih - y(d.count))
      .on("mousemove", (event: MouseEvent, d) => setTip(tipPos(event, host, baseTip(d))))
      .on("mouseleave", () => setTip(null));

    // tail bins (wider, distinct)
    const tailG = g.append("g");
    tailG
      .selectAll("rect")
      .data(DEGREE_TAIL)
      .join("rect")
      .attr("class", "bar tail")
      .attr("x", (_d, j) => baseTotal + j * tailW + 3)
      .attr("y", (d) => y(d.count))
      .attr("width", tailW - 6)
      .attr("height", (d) => ih - y(d.count))
      .on("mousemove", (event: MouseEvent, d) =>
        setTip(tipPos(event, host, `<b>${d.label} co-authors</b><br>${d.count.toLocaleString()} researchers`)),
      )
      .on("mouseleave", () => setTip(null));

    // boundary between the per-degree region and the binned tail
    g.append("line").attr("class", "tail-divider").attr("x1", baseTotal).attr("x2", baseTotal).attr("y1", 0).attr("y2", ih);

    // manual x-axis: domain line + base ticks (in an .axis group) and tail labels
    const xax = g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`);
    xax.append("line").attr("x1", 0).attr("x2", iw).attr("y1", 0).attr("y2", 0);
    for (const deg of [0, 15, 30, 45, 60]) {
      xax.append("line").attr("x1", baseCenter(deg)).attr("x2", baseCenter(deg)).attr("y1", 0).attr("y2", 6);
      xax.append("text").attr("x", baseCenter(deg)).attr("y", 18).attr("text-anchor", "middle").text(deg);
    }
    DEGREE_TAIL.forEach((_d, j) =>
      xax.append("line").attr("x1", tailCenter(j)).attr("x2", tailCenter(j)).attr("y1", 0).attr("y2", 6),
    );
    // tail labels sit outside the .axis group so they keep their own (smaller) size
    g.selectAll("text.tail-label")
      .data(DEGREE_TAIL)
      .join("text")
      .attr("class", "tail-label")
      .attr("x", (_d, j) => tailCenter(j))
      .attr("y", ih + 18)
      .attr("text-anchor", "middle")
      .text((d) => d.label);
  }

  addTitles(
    svg,
    m,
    iw,
    ih,
    "Degree distribution (histogram)",
    "Co-authors per researcher (degree)",
    "Number of researchers",
  );

  const lg = svg
    .append("g")
    .attr("class", "chart-legend")
    .attr("transform", `translate(${W - m.right - 178},${m.top + 4})`);
  lg.append("rect").attr("width", 12).attr("height", 12).attr("rx", 2).attr("fill", ACCENT_A);
  lg.append("text").attr("x", 18).attr("y", 11).text("researchers (0–75)");
  lg.append("rect").attr("y", 18).attr("width", 12).attr("height", 12).attr("rx", 2).attr("fill", ACCENT_A).attr("opacity", 0.5);
  lg.append("text").attr("x", 18).attr("y", 29).text(extended ? "76+ in ranges" : "76+ pooled — hover to expand");
}

/** A figure wrapper that hosts the SVG plus an absolutely-positioned tooltip. */
function ChartFigure({ draw, caption }: { draw: DrawFn; caption: React.ReactNode }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    if (svgRef.current && hostRef.current) draw(svgRef.current, setTip, hostRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <figure className="chart">
      <div className="chart-host" ref={hostRef}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" />
        {tip && (
          <div
            className="chart-tip"
            style={{ left: tip.x, top: tip.y }}
            dangerouslySetInnerHTML={{ __html: tip.html }}
          />
        )}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

export function PathLengthChart() {
  return (
    <ChartFigure
      draw={drawPathLength}
      caption={
        <>
          Share of connected researcher-pairs at each shortest-path length, from breadth-first search
          on 250 sampled researchers. About 95% of pairs have a path length of 4–7 — the signature of
          a small-world graph.
        </>
      }
    />
  );
}

export function DegreeHistogram() {
  const svgRef = useRef<SVGSVGElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const [extended, setExtended] = useState(false);

  useEffect(() => {
    if (svgRef.current && hostRef.current)
      drawDegreeHistogram(svgRef.current, setTip, hostRef.current, extended, setExtended);
  }, [extended]);

  return (
    <figure className="chart">
      <div
        className="chart-host"
        ref={hostRef}
        onMouseLeave={() => {
          setExtended(false);
          setTip(null);
        }}
      >
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" />
        {tip && (
          <div
            className="chart-tip"
            style={{ left: tip.x, top: tip.y }}
            dangerouslySetInnerHTML={{ __html: tip.html }}
          />
        )}
      </div>
      <figcaption>
        Number of researchers by their exact number of co-authors. Counts peak at two or three
        co-authors and fall away steeply into a long tail. Hover the <b>76+</b> bar to expand that
        tail into ranges; move off the chart to collapse it again.
      </figcaption>
    </figure>
  );
}
