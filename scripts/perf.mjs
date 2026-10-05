#!/usr/bin/env node
/**
 * Performance + audio-pipeline probe.
 *
 * Drives `next dev` headless (SwiftShader, no GPU) and reports what a
 * software renderer can actually prove:
 *
 *   idle FPS → playing FPS → stop → microphone FPS
 *   reactive bands + spectrum quarters from the live `__wavecore` seam
 *   zero console/page errors throughout
 *
 * These numbers are a floor, not a target: SwiftShader rasterises on the CPU,
 * so any real GPU will sit well above them. What matters here is the *shape* —
 * idle vs playing vs mic staying in the same band, bands responding to real
 * FFT data, and no errors across every transport transition.
 *
 *   node scripts/perf.mjs
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PERF_PORT ?? 3127);
const BASE = `http://127.0.0.1:${PORT}`;

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const failures = [];
const consoleErrors = [];
const pageErrors = [];

function check(name, ok, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

function startServer() {
  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "dev", "-p", String(PORT)],
    { cwd: ROOT, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", () => {});
  child.stderr.on("data", () => {});
  return child;
}

function stopServer(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    /* already gone */
  }
}

async function waitForServer(timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(BASE, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`server did not come up within ${timeoutMs}ms`);
}

/** Mean FPS over `ms` measured with rAF inside the page. */
async function measureFps(page, ms = 5000) {
  return page.evaluate((window_ms) => new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const tick = () => {
      frames += 1;
      if (performance.now() - start < window_ms) requestAnimationFrame(tick);
      else resolve(frames / ((performance.now() - start) / 1000));
    };
    requestAnimationFrame(tick);
  }), ms);
}

async function reactiveSnapshot(page) {
  return page.evaluate(() => {
    const r = window.__wavecore;
    const spec = window.__wavecoreSpectrum;
    if (!r || !spec) return null;
    const quarter = Math.floor(spec.length / 4);
    const mean = (from, to) => {
      let total = 0;
      for (let i = from; i < to; i++) total += spec[i];
      return Number((total / (to - from)).toFixed(4));
    };
    return {
      mode: r.mode,
      bass: Number(r.bass.toFixed(4)),
      mid: Number(r.mid.toFixed(4)),
      treble: Number(r.treble.toFixed(4)),
      level: Number(r.level.toFixed(4)),
      ambient: Number(r.ambient.toFixed(4)),
      punch: Number(r.punch.toFixed(4)),
      spectrum: [mean(0, quarter), mean(quarter, quarter * 2), mean(quarter * 2, quarter * 3), mean(quarter * 3, spec.length)],
    };
  });
}

async function transportState(page) {
  return page.evaluate(() => {
    const elapsed = document.querySelector('[aria-label="Seek"]');
    return { seekValue: elapsed ? Number(elapsed.value) : null };
  });
}

/** Current quality tier, read off the telemetry readout in the DOM. */
async function qualityTier(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("dt"));
    const render = rows.find((el) => el.textContent === "render");
    const value = render?.nextElementSibling?.textContent ?? "";
    const tier = value.split("·")[0]?.trim() ?? "?";
    return tier || "?";
  });
}

/** Wake the auto-hiding chrome (and with it, the panel) back up. */
async function revealChrome(page) {
  await page.mouse.move(640, 400);
  await page.mouse.move(644, 402);
  await page.waitForTimeout(600);
}

/** Source-panel body text, or null when the panel is closed/hidden. */
async function panelText(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[aria-label="Source panel"]');
    if (!panel) return null;
    return (panel.textContent ?? "").replace(/\s+/g, " ").slice(0, 400);
  });
}

const server = startServer();
let browser;
try {
  console.log(`starting next dev on :${PORT} …`);
  await waitForServer();

  const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
      // Fake mic: permission auto-grants, device yields a pulsing test tone.
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));

  console.log(`\nopening ${BASE}\n`);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: 30_000 });
  await page.waitForFunction(() => Boolean(window.__wavecore), null, { timeout: 30_000 });
  await page.waitForTimeout(5000);

  /* ── 1. idle ─────────────────────────────────────────────────────── */
  console.log("idle (no audio):");
  const idleFps = await measureFps(page, 5000);
  const idle = await reactiveSnapshot(page);
  const idleTier = await qualityTier(page);
  console.log(`  fps=${idleFps.toFixed(1)} tier=${idleTier}`);
  check("idle bed breathes", idle.bass > 0.02 && idle.mid > 0.01 && idle.treble > 0.005,
    `bass=${idle.bass} mid=${idle.mid} treble=${idle.treble}`);
  check("idle reports ambient mode", idle.mode === "idle" && idle.ambient > 0.9,
    `mode=${idle.mode} ambient=${idle.ambient}`);

  /* ── 2. playing (keyboard "1" = first demo track, autoplay) ───────── */
  console.log("playing (demo track 1):");
  await page.keyboard.press("1");
  await page.waitForTimeout(12_000);
  const playing = await reactiveSnapshot(page);
  const playingFps = await measureFps(page, 5000);
  const playingTier = await qualityTier(page);
  console.log(`  fps=${playingFps.toFixed(1)} tier=${playingTier}`);
  check("mode flips to playing", playing.mode === "playing", `mode=${playing.mode}`);
  check("ambient crossfades out", playing.ambient < 0.2, `ambient=${playing.ambient}`);
  const live = playing.bass > 0.03 || playing.mid > 0.03 || playing.treble > 0.03;
  check("FFT bands carry real signal", live,
    `bass=${playing.bass} mid=${playing.mid} treble=${playing.treble} level=${playing.level} spectrum=[${playing.spectrum.join(" ")}]`);

  /* ── 3. stop ("S" = pause + rewind) ───────────────────────────────── */
  console.log("stop:");
  const beforeStop = await transportState(page);
  await page.keyboard.press("s");
  await page.waitForTimeout(800);
  const stopped = await reactiveSnapshot(page);
  const afterStop = await transportState(page);
  const beforeT = beforeStop.seekValue === null ? "n/a" : `${beforeStop.seekValue.toFixed(1)}s`;
  check("stop pauses and rewinds",
    stopped.mode === "paused" && afterStop.seekValue !== null && afterStop.seekValue < 0.5,
    `mode=${stopped.mode} t=${beforeT}→${afterStop.seekValue?.toFixed(2) ?? "n/a"}s`);

  /* ── 4. microphone (fake device) ─────────────────────────────────── */
  console.log("microphone (fake device):");
  await page.keyboard.press("o"); // open source panel
  await page.waitForTimeout(1200);
  await revealChrome(page);
  await page.getByRole("button", { name: /microphone/i }).click({ timeout: 10_000 });
  await page.waitForTimeout(6000);
  const mic = await reactiveSnapshot(page);
  const micFps = await measureFps(page, 5000);
  const micTier = await qualityTier(page);
  console.log(`  fps=${micFps.toFixed(1)} tier=${micTier}`);
  await revealChrome(page);
  const micPanel = await panelText(page);
  console.log(`  panel: ${(micPanel ?? "(closed)").slice(0, 160)}`);
  const listening = micPanel !== null && /listening/i.test(micPanel);
  check("mic goes live without a permission hang", listening && mic.mode === "playing",
    `mode=${mic.mode} bass=${mic.bass} mid=${mic.mid} treble=${mic.treble} spectrum=[${mic.spectrum.join(" ")}]`);
  // Stop the mic again from the same button.
  await page.getByRole("button", { name: /listening/i }).click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  const micOff = await reactiveSnapshot(page);
  check("mic stops cleanly", micOff.mode !== "playing", `mode=${micOff.mode}`);

  /* ── 5. watchdog step-down (4x CPU throttle on a fresh page) ───────
     Forces sustained sub-42 fps so the ReactiveBridge watchdog must fire its
     one budgeted step-down. Proves the adaptive-quality path end to end. */
  console.log("adaptive quality (throttled CPU):");
  const slowPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  slowPage.on("pageerror", (err) => pageErrors.push(`throttled: ${err.message}`));
  const cdp = await slowPage.context().newCDPSession(slowPage);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await slowPage.goto(BASE, { waitUntil: "domcontentloaded" });
  await slowPage.waitForSelector("canvas", { timeout: 60_000 });
  await slowPage.waitForFunction(() => Boolean(window.__wavecore), null, { timeout: 60_000 });
  const startTier = await qualityTier(slowPage);
  await slowPage.waitForTimeout(16_000); // warmup 3.5s + several 2.5s windows
  const endTier = await qualityTier(slowPage);
  const steppedDown = startTier !== endTier;
  check("FPS watchdog steps quality down under sustained load", steppedDown,
    `tier ${startTier}→${endTier}`);
  const slowFps = await measureFps(slowPage, 4000);
  console.log(`  throttled fps=${slowFps.toFixed(1)} tier=${endTier}`);
  await slowPage.close();

  /* ── 6. mobile emulation (small viewport, touch, 3x throttle) ─────── */
  console.log("mobile emulation:");
  const mobileCtx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const mobilePage = await mobileCtx.newPage();
  mobilePage.on("pageerror", (err) => pageErrors.push(`mobile: ${err.message}`));
  const mobileCdp = await mobileCtx.newCDPSession(mobilePage);
  await mobileCdp.send("Emulation.setCPUThrottlingRate", { rate: 3 });
  await mobilePage.goto(BASE, { waitUntil: "domcontentloaded" });
  await mobilePage.waitForSelector("canvas", { timeout: 60_000 });
  await mobilePage.waitForFunction(() => Boolean(window.__wavecore), null, { timeout: 60_000 });
  await mobilePage.waitForTimeout(6000);
  const mobileFps = await measureFps(mobilePage, 5000);
  const mobileTier = await qualityTier(mobilePage);
  const mobileReactive = await reactiveSnapshot(mobilePage);
  console.log(`  fps=${mobileFps.toFixed(1)} tier=${mobileTier}`);
  check("mobile emulation renders a live idle bed",
    mobileReactive.bass > 0.02 && mobileReactive.mode === "idle",
    `fps=${mobileFps.toFixed(1)} tier=${mobileTier} bass=${mobileReactive.bass}`);
  await mobileCtx.close();

  /* ── 7. error hygiene ────────────────────────────────────────────── */
  console.log("errors:");
  check("zero console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  check("zero page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

  console.log(`\nFPS summary (SwiftShader software rendering — a floor, not a target):`);
  console.log(`  idle=${idleFps.toFixed(1)} playing=${playingFps.toFixed(1)} mic=${micFps.toFixed(1)} throttled=${slowFps.toFixed(1)} mobile=${mobileFps.toFixed(1)}`);
} finally {
  await browser?.close();
  stopServer(server);
}

if (failures.length > 0) {
  console.log(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nall perf checks passed.");
