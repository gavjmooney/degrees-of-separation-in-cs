/* Quick visual check: select a domain in the browse panel, screenshot the spotlight. */
import { chromium } from "playwright";

const domain = process.argv[2] ?? "Health";
const shot = process.argv[3] ?? "data/e2e/10-domain-highlight.png";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1480, height: 920 } });
await page.goto("http://localhost:3001");
await page.waitForSelector(".map-legend");
await page.waitForFunction(() => !document.querySelector(".loading-stage"));
await page.waitForTimeout(1500);
await page.click('.map-toolbar button:has-text("communities")');
await page.waitForSelector(".comm-domain");
await page.click(`.comm-domain:has-text("${domain}")`);
await page.waitForTimeout(1200);
console.log((await page.textContent(".map-info"))?.replace(/\s+/g, " ").trim());
await page.screenshot({ path: shot });
await browser.close();
