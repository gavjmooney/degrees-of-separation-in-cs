/* E2E driver: drives the real app in Chromium and captures evidence.
 *   node web/scripts/e2e.mjs [baseUrl] [shotDir] [q1:Name1] [q2:Name2] [q3:Name3]
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3001";
const shotDir = process.argv[3] ?? "data/e2e";
// author queries (override for artifact sets where the defaults are missing/disconnected)
const [Q1, N1] = (process.argv[4] ?? "donald knuth:Knuth").split(":");
const [Q2, N2] = (process.argv[5] ?? "yoshua bengio:Bengio").split(":");
const [Q3, N3] = (process.argv[6] ?? "leslie lamport:Lamport").split(":");
mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

const log = (s) => console.log(s);
const FIRST = 'input[placeholder="First author…"]';
const SECOND = 'input[placeholder="Second author…"]';

async function pickAuthor(selector, query, expectText) {
  await page.fill(selector, query);
  await page.waitForFunction(
    (t) => document.querySelector(".dropdown li")?.textContent?.includes(t),
    expectText,
  );
  await page.click(".dropdown li");
}

try {
  // 1. welcome state: whole-network map when built, text hero otherwise
  await page.goto(base);
  await page.waitForSelector(".map-legend, .welcome h1", { timeout: 20000 });
  const hasMap = (await page.$(".map-legend")) !== null;
  log(`welcome state: ${hasMap ? "whole-network map" : "text hero"}`);
  if (hasMap) {
    await page.waitForFunction(() => !document.querySelector(".loading-stage"), null, {
      timeout: 20000,
    });
    await page.waitForTimeout(600);
    log(`map legend: ${(await page.textContent(".map-legend"))?.replace(/\s+/g, " ").trim()}`);
    await page.screenshot({ path: `${shotDir}/01-map.png` });

    // wheel zoom + drag pan work (verified through the __map debug hook)
    const box = await (await page.$(".map-canvas")).boundingBox();
    const view0 = await page.evaluate(() => window.__map.view());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(300);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const view1 = await page.evaluate(() => window.__map.view());
    log(
      `wheel zoom + drag pan: scale ${view0.scale.toFixed(2)} -> ${view1.scale.toFixed(2)}, ` +
        `center (${view0.cx.toFixed(3)},${view0.cy.toFixed(3)}) -> (${view1.cx.toFixed(3)},${view1.cy.toFixed(3)})`,
    );
    await page.screenshot({ path: `${shotDir}/01d-zoom-pan.png` });
    await page.click('.map-toolbar button:has-text("reset")');
    await page.waitForTimeout(700);
  } else {
    log(`h1: ${await page.textContent(".welcome h1")}`);
    await page.screenshot({ path: `${shotDir}/01-welcome.png` });
  }

  // 2. disambiguation dropdown
  await page.fill(FIRST, "wei wang");
  await page.waitForSelector(".dropdown li");
  const rows = await page.$$eval(".dropdown li", (lis) => lis.slice(0, 4).map((li) => li.textContent));
  log("dropdown for 'wei wang':");
  for (const r of rows) log(`  - ${r}`);
  log(`disambiguation badges: ${await page.$$eval(".dropdown .badge", (b) => b.length)}`);
  await page.screenshot({ path: `${shotDir}/02-disambiguation.png` });

  // 3. pick endpoints -> query auto-runs (with map zoom when available)
  await pickAuthor(FIRST, Q1, N1);
  const selAName = (await page.textContent(".selected-name"))?.trim();
  log(`selected A: ${selAName}`);
  await pickAuthor(SECOND, Q2, N2);
  if (hasMap) {
    await page.waitForTimeout(1700); // mid-zoom (the query glide runs ~3.4s)
    await page.screenshot({ path: `${shotDir}/02b-zoom.png` });
    await page.waitForTimeout(2300); // glide done, path drawing link by link
    await page.screenshot({ path: `${shotDir}/02c-path-draw.png` });
    log("captured mid-zoom and path-draw frames");
  }
  await page.waitForSelector(".headline .hops", { timeout: 30000 });
  log(`headline: ${(await page.textContent(".headline"))?.replace(/\s+/g, " ").trim()}`);
  log(`path strip: ${(await page.textContent(".path-strip"))?.replace(/\s+/g, " ").trim()}`);
  log(`url: ${page.url()}`);
  await page.waitForSelector(".graph-canvas canvas");
  await page.waitForTimeout(5000); // layout settle
  await page.screenshot({ path: `${shotDir}/03-graph-organic.png` });

  // 4. consecutive search without leaving the page: swap second author.
  // With the map available this plays the zoom-out-to-full-network-then-back-in
  // transition before the new query loads.
  await page.click(".search-box.selected >> nth=1 >> .clear");
  await pickAuthor(SECOND, Q3, N3);
  if (hasMap) {
    await page.waitForSelector(".map-canvas", { timeout: 10000 });
    await page.waitForTimeout(900); // mid zoom-out
    await page.screenshot({ path: `${shotDir}/04a-zoom-out.png` });
    log("new query from existing one: map transition shown (mid zoom-out captured)");
  }
  await page.waitForFunction(
    (n) => document.querySelector(".headline")?.textContent?.includes(n),
    N3,
    { timeout: 30000 },
  );
  log(`second query headline: ${(await page.textContent(".headline"))?.replace(/\s+/g, " ").trim()}`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${shotDir}/04-second-query.png` });

  // 5. hover -> static info card (left side, not cursor tooltip)
  const findNode = (name) =>
    page.evaluate((needle) => {
      const sigma = window.__sigma;
      const graph = sigma.getGraph();
      let pos = null;
      graph.forEachNode((n, attrs) => {
        if (attrs.label === needle) pos = sigma.graphToViewport({ x: attrs.x, y: attrs.y });
      });
      return pos;
    }, name);
  const nodePos = await findNode(selAName);
  const canvasBox = await (await page.$(".graph-canvas")).boundingBox();
  await page.mouse.move(canvasBox.x + nodePos.x, canvasBox.y + nodePos.y);
  await page.waitForSelector(".hover-card .hover-name", { timeout: 5000 });
  log(`hover card: ${(await page.textContent(".hover-card"))?.replace(/\s+/g, " ").trim()}`);
  await page.screenshot({ path: `${shotDir}/05-hover-card.png` });

  // 6. node click -> author panel (re-locate first: layout may have drifted)
  const clickPos = await findNode(selAName);
  await page.mouse.click(canvasBox.x + clickPos.x, canvasBox.y + clickPos.y);
  await page.waitForSelector(".side-panel h2", { timeout: 10000 });
  await page.waitForSelector(".paper-list li", { timeout: 10000 });
  log(`panel author: ${(await page.textContent(".side-panel h2"))?.trim()}`);
  await page.screenshot({ path: `${shotDir}/06-author-panel.png` });

  // 6b. co-authors tab
  await page.click('.tabs .tab:has-text("Co-authors")');
  await page.waitForSelector(".coauthor-list li", { timeout: 10000 });
  const coauthors = await page.$$eval(".coauthor-list li", (lis) =>
    lis.slice(0, 3).map((li) => li.textContent?.replace(/\s+/g, " ").trim()),
  );
  log("co-authors tab (top 3):");
  for (const c of coauthors) log(`  - ${c}`);
  await page.screenshot({ path: `${shotDir}/06b-coauthors-tab.png` });
  // clicking a co-author opens that author's panel
  const prevPanel = (await page.textContent(".side-panel h2"))?.trim();
  await page.click(".coauthor-list li >> nth=0 >> button");
  await page.waitForFunction(
    (prev) => document.querySelector(".side-panel h2")?.textContent?.trim() !== prev,
    prevPanel,
    { timeout: 10000 },
  );
  log(`after co-author click, panel shows: ${(await page.textContent(".side-panel h2"))?.trim()}`);
  await page.click(".side-panel .close");

  // 7. live controls: min weight filter then label budget
  const visible = () =>
    page.evaluate(() => {
      const sigma = window.__sigma;
      const graph = sigma.getGraph();
      let nodes = 0;
      graph.forEachNode((n) => {
        if (!sigma.getNodeDisplayData(n)?.hidden) nodes++;
      });
      return nodes;
    });
  const before = await visible();
  await page.locator('.toolbar label:has-text("min papers/link") input[type=range]').fill("3");
  await page.waitForTimeout(400);
  const after = await visible();
  log(`min-weight slider 1 -> 3: visible nodes ${before} -> ${after}`);
  await page.screenshot({ path: `${shotDir}/07-filtered.png` });
  await page.locator('.toolbar label:has-text("min papers/link") input[type=range]').fill("1");
  await page.selectOption('.toolbar label:has-text("labels") select', "30");
  await page.waitForTimeout(400);

  // 7b. max-nodes slider triggers a refetch (debounced)
  await page.locator('.toolbar label:has-text("max nodes") input[type=range]').fill("600");
  await page.waitForTimeout(1200);
  log(`max-nodes slider -> 600: url ${page.url()}`);
  log(`visible nodes after refetch: ${await visible()}`);

  // 7c. "all shortest paths": every shortest path, no neighbourhood
  const nodeStats = () =>
    page.evaluate(() => {
      const sigma = window.__sigma;
      const graph = sigma.getGraph();
      let path = 0, alt = 0, other = 0;
      graph.forEachNode((n, a) => {
        if (a.onPath) path++;
        else if (a.isAlt) alt++;
        else other++;
      });
      return { path, alt, other };
    });
  await page.selectOption('.toolbar label:has-text("neighbours") select', "all");
  await page.waitForTimeout(3500);
  const spAll = await nodeStats();
  log(`all-shortest-paths: ${spAll.path} path, ${spAll.alt} alternative-path, ${spAll.other} other nodes`);
  await page.screenshot({ path: `${shotDir}/07c-all-shortest-paths.png` });

  // 7d. "shortest path only": just the single main path
  await page.selectOption('.toolbar label:has-text("neighbours") select', "0");
  await page.waitForTimeout(3500);
  const spOne = await nodeStats();
  log(`shortest-path-only: ${spOne.path} path, ${spOne.alt} alternative-path, ${spOne.other} other nodes`);
  await page.screenshot({ path: `${shotDir}/07d-single-path.png` });
  await page.selectOption('.toolbar label:has-text("neighbours") select', "1");
  await page.waitForTimeout(2000);

  // 8a. spacing visibly changes item sizes
  const avgSize = () =>
    page.evaluate(() => {
      const graph = window.__sigma.getGraph();
      let s = 0, c = 0;
      graph.forEachNode((_n, a) => {
        s += a.size;
        c++;
      });
      return s / c;
    });
  const sizeNormal = await avgSize();
  await page.selectOption('.toolbar label:has-text("spacing") select', "airy");
  await page.waitForTimeout(3500);
  const sizeAiry = await avgSize();
  log(`spacing normal -> airy: avg node size ${sizeNormal.toFixed(2)} -> ${sizeAiry.toFixed(2)}`);
  await page.screenshot({ path: `${shotDir}/08a-airy.png` });
  await page.selectOption('.toolbar label:has-text("spacing") select', "normal");
  await page.waitForTimeout(2000);

  // 8. layered view
  await page.selectOption('.toolbar label:has-text("view") select', "layered");
  await page.waitForTimeout(4500);
  log("switched to layered view");
  await page.screenshot({ path: `${shotDir}/08-layered.png` });

  // 8c. SVG export of the current (layered) view
  const downloadPromise = page.waitForEvent("download");
  await page.click(".export-btn");
  const download = await downloadPromise;
  const svgPath = `${shotDir}/export.svg`;
  await download.saveAs(svgPath);
  const svg = readFileSync(svgPath, "utf8");
  log(`svg export: ${download.suggestedFilename()} (${(svg.length / 1024).toFixed(0)} KB)`);
  log(`  contains header: ${svg.includes("Degrees of Separation in CS")}`);
  log(`  contains endpoints: ${svg.includes(N1) && svg.includes(N3)}`);
  log(`  contains legend: ${svg.includes("alternative shortest path")}`);
  log(`  contains controls: ${svg.includes("min papers/link")}`);
  await page.goto(`file:///${svgPath.replace(/\\/g, "/")}`);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${shotDir}/09-svg-rendered.png` });
  await page.goBack();

  // 8d. clicking the title plays the zoom-out-home animation, then clears both searches
  if (hasMap) {
    await page.click(".brand");
    await page.waitForSelector(".map-canvas", { timeout: 15000 });
    await page.waitForTimeout(700); // mid pull-back
    await page.screenshot({ path: `${shotDir}/08d-home-zoom-out.png` });
    await page.waitForFunction(
      () => document.querySelectorAll("input[placeholder$='author…']").length === 2,
      null,
      { timeout: 15000 },
    );
    log("title click -> zoom-out-home animation played, search boxes cleared");
    await page.screenshot({ path: `${shotDir}/08d-back-to-map.png` });
  }

  // 9. probe: deep link with bad id
  await page.goto(`${base}/path/0/999999999`);
  await page.waitForSelector(".headline .error", { timeout: 15000 });
  log(`bad-id headline: ${(await page.textContent(".headline .error"))?.trim()}`);

  log(`\nJS errors during session: ${errors.length}`);
  for (const e of errors) log(`  ${e}`);
} finally {
  await browser.close();
}
