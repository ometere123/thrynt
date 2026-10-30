import { chromium, devices } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir, copyFile, readdir } from "node:fs/promises";
import path from "node:path";

const base = process.env.THRYNT_E2E_BASE_URL ?? "https://thrynt.vercel.app";
const out = path.resolve("docs/assets/demo");
const explorer = "https://explorer.testnet.somnia.network/tokyo/tx/0xdd685a4c40f5a4fd025ff50588442823e57c581cae79e38dcc0877c67da580de";
const screens = ["Overview", "Strategy Studio", "Markets", "Live Pulse", "Positions & Risk", "Decision Trace", "Settings"];

await mkdir(out, { recursive: true });

async function openScreen(page, name, mobile = false) {
  const drawer = page.getByRole("button", { name: "Open navigation", exact: true });
  const close = page.getByRole("button", { name: "Close navigation", exact: true });
  if (mobile && await close.isVisible().catch(() => false)) {
    await close.evaluate((button) => button.click());
    await page.waitForTimeout(250);
  }
  if (mobile && await drawer.isVisible()) await drawer.click({ force: true });
  const nav = page.getByRole("button", { name, exact: true });
  const heading = page.getByRole("heading", { name, exact: true });
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    if (await heading.isVisible().catch(() => false)) break;
    await nav.scrollIntoViewIfNeeded();
    await nav.click({ force: true });
    try {
      await heading.waitFor({ state: "visible", timeout: 10_000 });
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      await page.waitForTimeout(1_000);
    }
  }
  await page.waitForTimeout(900);
}

async function captureScreenshots() {
  const browser = await chromium.launch({ headless: true });
  for (const [label, contextOptions, mobile] of [
    ["desktop", { viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 }, false],
    ["mobile", { ...devices["Pixel 5"] }, true],
  ]) {
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1_500);
    for (const screen of screens) {
      await openScreen(page, screen, mobile);
      await page.screenshot({ path: path.join(out, `${label}-${screen.toLowerCase().replaceAll(" ", "-").replaceAll("&", "and")}.png`), fullPage: true });
    }
    await context.close();
  }
  const explorerPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await explorerPage.goto(explorer, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await explorerPage.waitForTimeout(3_000);
    await explorerPage.screenshot({ path: path.join(out, "entry-explorer.png"), fullPage: true });
  } catch (error) {
    console.warn(`Explorer screenshot unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  await browser.close();
}

async function recordCut(name, selected, durationMs) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    recordVideo: { dir: out, size: { width: 1600, height: 1000 } },
  });
  const page = await context.newPage();
  const video = page.video();
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1_500);
  const perScreen = Math.max(900, Math.floor(durationMs / selected.length));
  for (const screen of selected) {
    await openScreen(page, screen);
    await page.waitForTimeout(perScreen);
  }
  await page.close();
  await context.close();
  if (video) await copyFile(await video.path(), path.join(out, name));
  await browser.close();
}

await captureScreenshots();
await recordCut("thrynt-main-browser-capture.webm", ["Overview", "Strategy Studio", "Markets", "Live Pulse", "Positions & Risk", "Decision Trace", "Settings"], 70_000);
execFileSync("ffmpeg", [
  "-y",
  "-i", path.join(out, "thrynt-main-browser-capture.webm"),
  "-t", "35",
  "-map", "0:v:0",
  "-c:v", "copy",
  "-an",
  path.join(out, "thrynt-social-cut.webm"),
], { stdio: "ignore" });
console.log((await readdir(out)).sort().join("\n"));
