#!/usr/bin/env node
/**
 * Automated QA pass.
 *
 * Scope is deliberate and matches what a headless browser can actually prove:
 *   ✓ the WebGL scene initialises, compiles its shaders and renders non-flat frames
 *   ✓ track selection, play/pause, scrubbing and upload all function
 *   ✓ zero console errors or page errors
 *   ✓ the analyser produces real data once audio is playing (dev builds only,
 *     via the `window.__wavecore` seam)
 *
 * It cannot prove the scene *looks good* in response to audio. That is a human
 * check and it is the one that matters most for this project.
 *
 * Uses playwright-core against the Chrome already on this machine, so nothing
 * downloads. Drives `next dev` because the reactive seam is stripped from
 * production builds.
 *
 *   node scripts/qa.mjs
 */

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.QA_PORT ?? 3117);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = join(ROOT, ".qa-shots");

const CHROME_CANDIDATES = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];

const results = [];
const consoleErrors = [];
const pageErrors = [];
const shaderErrors = [];
/** Non-2xx responses, so a bare "404" console entry isn't the whole story. */
const badResponses = [];

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/* ── server ───────────────────────────────────────────────────────────── */

/** True when something already answers on the port (a dev server left running). */
async function serverAlreadyUp() {
  try {
    const res = await fetch(BASE, { redirect: "manual", signal: AbortSignal.timeout(1500) });
    return res.status < 500;
  } catch {
    return false;
  }
}

function startServer() {
  const child = spawn(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["next", "dev", "-p", String(PORT)],
    { cwd: ROOT, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.on("data", () => {});
  child.stderr.on("data", (d) => {
    const text = String(d);
    if (/\bError\b/.test(text)) process.stderr.write(`[server] ${text}`);
  });
  return child;
}

/**
 * `next dev` is spawned through a shell wrapper on Windows, so killing the
 * wrapper leaves the actual server holding the port. Kill the whole tree.
 */
function stopServer(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") {
      // Synchronous: this runs immediately before process.exit, and an async
      // spawn here would leave the dev server holding the port.
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
      if (res.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`server did not come up within ${timeoutMs}ms`);
}

/* ── image analysis (no image deps: decode PNG in the page itself) ─────── */

/**
 * Brings the chrome back before anything is queried.
 *
 * This is not a workaround — it is the feature. Once the chrome auto-hides the
 * layer goes `inert`, which removes it from the accessibility tree, so role
 * queries legitimately stop finding the transport until the pointer moves.
 */
async function revealChrome(page) {
  await page.mouse.move(720, 450);
  await page.mouse.move(724, 452);
  await page.waitForTimeout(500);
}

/**
 * Reveal, then click.
 *
 * A screenshot in a software-rendered headless browser can take longer than the
 * chrome's 3.6 s auto-hide delay, so a single reveal before a click is a race.
 * The retry is not papering over a bug: the chrome hiding again is the correct
 * behaviour, the test just has to wake it back up.
 */
async function clickWithReveal(page, locator) {
  await revealChrome(page);
  try {
    await locator.click({ timeout: 4000 });
  } catch {
    await revealChrome(page);
    await locator.click({ timeout: 10_000 });
  }
}

async function chromeState(page) {
  return page.evaluate(() => document.documentElement.dataset.chrome ?? "unset");
}

/**
 * DOM-only snapshot of the source panel.
 *
 * Deliberately not a role/label query. Once the chrome auto-hides the layer goes
 * `inert`, which removes it from the accessibility tree — correct behaviour, but
 * it means a11y queries race the 3.6 s auto-hide against Playwright's (slow,
 * software-rendered) screenshots. Structure checks read the DOM directly;
 * role queries are reserved for the places that genuinely have to click.
 */
async function panelInfo(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[aria-label="Source panel"]');
    if (!panel) return { open: false, rows: 0, bars: 0, spans: 0 };
    const buttons = Array.from(panel.querySelectorAll("button"));
    return {
      open: true,
      rows: buttons.filter((b) => /bpm/.test(b.textContent ?? "")).length,
      bars: panel.querySelectorAll(".gap-px > span").length,
      spans: panel.querySelectorAll("span").length,
      text: (panel.textContent ?? "").replace(/\s+/g, " ").slice(0, 80),
    };
  });
}

/**
 * Cheap framing metrics, computed by decoding the PNG back inside the page.
 *
 * These exist as a stand-in for looking at the render: luminance centroid finds
 * the core, bright coverage catches a core that is either a speck or spilling
 * off every edge, and the border mean confirms the frame is actually composed
 * rather than evenly filled.
 */
async function frameStats(page) {
  const buffer = await page.screenshot();
  const base64 = buffer.toString("base64");
  return page.evaluate(async (data) => {
    const W = 320;
    const H = 180;
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, W, H);
    const pixels = ctx.getImageData(0, 0, W, H).data;

    let sum = 0;
    let sumSq = 0;
    let weightedX = 0;
    let weightedY = 0;
    let weight = 0;
    let bright = 0;
    let mid = 0;
    let borderSum = 0;
    let borderCount = 0;
    let centerSum = 0;
    let centerCount = 0;
    const n = W * H;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4;
        const l =
          (pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722) / 255;
        sum += l;
        sumSq += l * l;
        weightedX += x * l;
        weightedY += y * l;
        weight += l;
        if (l > 0.5) bright += 1;
        if (l > 0.18) mid += 1;
        if (x < W * 0.06 || x > W * 0.94 || y < H * 0.06 || y > H * 0.94) {
          borderSum += l;
          borderCount += 1;
        }
        if (
          x > W * 0.3 &&
          x < W * 0.7 &&
          y > H * 0.3 &&
          y < H * 0.7
        ) {
          centerSum += l;
          centerCount += 1;
        }
      }
    }

    const mean = sum / n;
    return {
      mean,
      variance: sumSq / n - mean * mean,
      brightFraction: bright / n,
      midFraction: mid / n,
      centroidX: weight > 0 ? weightedX / weight / W : 0.5,
      centroidY: weight > 0 ? weightedY / weight / H : 0.5,
      borderMean: borderSum / borderCount,
      centerMean: centerSum / centerCount,
    };
  }, base64);
}

/**
 * Averages the framing metrics over several frames.
 *
 * A single sample of a scene that swings from quiet to fully lit on every kick
 * is far too noisy to assert against — the same build measured 0.72 / 0.82 /
 * 0.95 centre luminance on three consecutive runs. Averaging a few samples a
 * beat apart turns it into a metric that can actually detect a regression.
 */
async function averageStats(page, samples = 3) {
  const all = [];
  for (let i = 0; i < samples; i++) {
    all.push(await frameStats(page));
    if (i < samples - 1) await page.waitForTimeout(650);
  }
  const keys = Object.keys(all[0]);
  const averaged = {};
  for (const key of keys) {
    averaged[key] = all.reduce((sum, s) => sum + s[key], 0) / all.length;
  }
  return averaged;
}

/* ── main ─────────────────────────────────────────────────────────────── */

const reusingServer = await serverAlreadyUp();
const server = reusingServer ? null : startServer();
let browser;

try {
  if (reusingServer) {
    console.log(`reusing the dev server already listening on :${PORT}`);
  } else {
    console.log(`starting next dev on :${PORT} …`);
  }
  await waitForServer();
  mkdirSync(SHOTS, { recursive: true });

  const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      // Headless Chrome has no GPU; SwiftShader still compiles and runs the
      // shaders, which is what this pass is actually checking for.
      "--enable-unsafe-swiftshader",
      "--use-gl=angle",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
    ],
  });

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  page.on("console", (msg) => {
    const text = msg.text();
    if (msg.type() === "error") {
      consoleErrors.push(text);
      if (/shader|program|glsl/i.test(text)) shaderErrors.push(text);
    }
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  // Console messages for failed loads don't include the URL, so track responses
  // too — otherwise "404" is the entire diagnostic.
  page.on("response", (res) => {
    if (res.status() >= 400) badResponses.push(`${res.status()} ${res.url()}`);
  });
  page.on("requestfailed", (req) => {
    const reason = req.failure()?.errorText ?? "?";
    // ERR_ABORTED is expected, not a defect: switching tracks or loading an
    // upload deliberately cancels the in-flight media request for the outgoing
    // source. Chrome reports the cancel here and logs nothing to the console.
    if (reason === "net::ERR_ABORTED") return;
    badResponses.push(`FAILED ${req.url()} (${reason})`);
  });

  console.log(`\nopening ${BASE}\n`);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas", { timeout: 30_000 });
  // Let the mount reveal play through and shaders finish compiling.
  await page.waitForTimeout(6000);

  /* 1. canvas + webgl context */
  const webgl = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return null;
    return {
      width: canvas.width,
      height: canvas.height,
      version: canvas.getContext("webgl2") ? 2 : 1,
    };
  });
  record(
    "canvas + WebGL context",
    Boolean(webgl && webgl.width > 0 && webgl.height > 0),
    webgl ? `${webgl.width}×${webgl.height}, webgl${webgl.version}` : "no canvas",
  );
  record("WebGL2 available", webgl?.version === 2, `webgl${webgl?.version}`);

  /* 2. idle state renders real frames (captured before anything auto-hides) */
  const idle = await averageStats(page);
  await page.screenshot({ path: join(SHOTS, "01-idle.png") });
  record(
    "idle frame is not flat/black",
    idle.mean > 0.004 && idle.variance > 0.0008,
    `mean=${idle.mean.toFixed(4)} variance=${idle.variance.toFixed(5)}`,
  );
  // Targets, not vibes. "Cinematic dark backdrop" means most of the frame is
  // dark and a small area is hot; if these bands drift, the grade has drifted.
  const grade = (s) =>
    `bright=${(s.brightFraction * 100).toFixed(1)}% mid=${(s.midFraction * 100).toFixed(1)}% centroid=(${s.centroidX.toFixed(2)},${s.centroidY.toFixed(2)}) border=${s.borderMean.toFixed(3)} centre=${s.centerMean.toFixed(3)} contrast=${(s.centerMean / Math.max(s.borderMean, 1e-3)).toFixed(1)}x`;

  // "Cinematic dark backdrop" is really a contrast claim: dark, vignetted edges
  // with a hot centre. Absolute brightness bands alone would fail a legitimately
  // bold hero object for filling the middle of the frame, which is the point.
  record(
    "idle grade is a dark frame with a hot centre",
    idle.midFraction < 0.5 &&
      idle.borderMean < 0.2 &&
      idle.centerMean / Math.max(idle.borderMean, 1e-3) > 1.6 &&
      idle.centroidX > 0.3 &&
      idle.centroidX < 0.7 &&
      idle.centroidY > 0.2 &&
      idle.centroidY < 0.8,
    grade(idle),
  );

  const idleReactive = await page.evaluate(() => ({ ...window.__wavecore }));
  record(
    "idle bed breathes (bass/mid/treble non-zero before play)",
    idleReactive.bass > 0.02 && idleReactive.mid > 0.01 && idleReactive.treble > 0.005,
    `bass=${idleReactive.bass.toFixed(3)} mid=${idleReactive.mid.toFixed(3)} treble=${idleReactive.treble.toFixed(3)}`,
  );
  record(
    "idle reports ambient mode",
    idleReactive.mode === "idle" && idleReactive.ambient > 0.9,
    `mode=${idleReactive.mode} ambient=${idleReactive.ambient.toFixed(2)}`,
  );

  /* 3. auto-hide, then reveal on pointer movement */
  await page.waitForTimeout(4200);
  record(
    "chrome auto-hides while idle",
    (await chromeState(page)) === "hidden",
    `data-chrome=${await chromeState(page)}`,
  );
  await page.screenshot({ path: join(SHOTS, "02-autohidden.png") });

  await revealChrome(page);
  record(
    "chrome returns on pointer movement",
    (await chromeState(page)) === "visible",
    `data-chrome=${await chromeState(page)}`,
  );

  /* 4. idle → playing */
  const idlePixels = await page.screenshot();
  await clickWithReveal(page, page.getByRole("button", { name: /Subsurface/ }).first());
  // Subsurface is beatless for its first four bars; wait past that so the
  // measurements below describe a full mix (kick + sub + hats + arp + clap).
  await page.waitForTimeout(15_000);
  await page.screenshot({ path: join(SHOTS, "03-playing.png") });

  const playingReactive = await page.evaluate(() => ({ ...window.__wavecore }));
  const playingPixels = await page.screenshot();
  record(
    "idle → playing transition renders a different frame",
    !idlePixels.equals(playingPixels),
    `${idlePixels.length}B → ${playingPixels.length}B`,
  );
  record(
    "reactive mode flips to playing",
    playingReactive.mode === "playing",
    `mode=${playingReactive.mode}`,
  );
  record(
    "ambient bed crossfades out once audio is live",
    playingReactive.ambient < 0.2,
    `ambient=${playingReactive.ambient.toFixed(3)}`,
  );

  // In headless Chrome the audio sink is a null device. Whether the analyser
  // clock advances varies by platform, so this is reported rather than treated
  // as a hard failure — it is exactly the part the brief says needs a human.
  const bassLive = playingReactive.bass > 0.03;
  record(
    "analyser delivers bass energy from real audio",
    bassLive,
    bassLive
      ? `bass=${playingReactive.bass.toFixed(3)} mid=${playingReactive.mid.toFixed(3)} treble=${playingReactive.treble.toFixed(3)}`
      : "no signal — expected in some headless audio setups; verify by ear in a real browser",
  );

  // Profile the eased spectrum so a dead band (e.g. a treble range that never
  // rises above the analyser's dB floor) is visible as data, not as a hunch.
  const spectrum = await page.evaluate(() => {
    const data = window.__wavecoreSpectrum;
    if (!data) return null;
    const quarter = Math.floor(data.length / 4);
    const mean = (from, to) => {
      let total = 0;
      for (let i = from; i < to; i++) total += data[i];
      return Number((total / (to - from)).toFixed(4));
    };
    let peak = 0;
    for (let i = 0; i < data.length; i++) if (data[i] > peak) peak = data[i];
    return {
      length: data.length,
      low: mean(0, quarter),
      lowerMid: mean(quarter, quarter * 2),
      upperMid: mean(quarter * 2, quarter * 3),
      high: mean(quarter * 3, data.length),
      peak: Number(peak.toFixed(3)),
    };
  });
  record(
    "eased spectrum is alive across the whole range",
    Boolean(spectrum && spectrum.low > 0.02 && spectrum.high > 0.004),
    spectrum ? JSON.stringify(spectrum) : "no spectrum exposed",
  );

  const playingFrame = await averageStats(page);
  record(
    "playing grade keeps its contrast without blowing the core out",
    playingFrame.midFraction < 0.62 &&
      playingFrame.borderMean < 0.3 &&
      playingFrame.centerMean / Math.max(playingFrame.borderMean, 1e-3) > 1.4 &&
      playingFrame.brightFraction > 0.01 &&
      // A fully white centre means the core's own surface detail is gone, and
      // that surface is the subject. Bright, but with structure left in it —
      // averaged over several frames, so a brief peak blowing out is fine.
      playingFrame.centerMean < 0.86,
    grade(playingFrame),
  );

  /* 4b. band dynamic range.

     This is the check that catches a band being too quiet to drive anything.
     Music is bass-heavy by nature, so if the treble band never rises above a
     few percent the hue would be effectively pinned for the whole track, no
     matter how correct the shader is. */
  const bands = await page.evaluate(async () => {
    const acc = { bass: [], mid: [], treble: [], level: [] };
    const started = performance.now();
    while (performance.now() - started < 4000) {
      const r = window.__wavecore;
      acc.bass.push(r.bass);
      acc.mid.push(r.mid);
      acc.treble.push(r.treble);
      acc.level.push(r.level);
      await new Promise((resolve) => setTimeout(resolve, 55));
    }
    const stat = (values) => ({
      mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)),
      max: Number(Math.max(...values).toFixed(3)),
    });
    return {
      samples: acc.bass.length,
      bass: stat(acc.bass),
      mid: stat(acc.mid),
      treble: stat(acc.treble),
      level: stat(acc.level),
    };
  });
  record(
    "all three bands have usable dynamic range",
    bands.bass.max > 0.25 && bands.mid.max > 0.2 && bands.treble.max > 0.12,
    `bass ${bands.bass.mean}/${bands.bass.max} · mid ${bands.mid.mean}/${bands.mid.max} · treble ${bands.treble.mean}/${bands.treble.max} (mean/max, n=${bands.samples})`,
  );

  /* 5. play / pause */
  await revealChrome(page);
  const dockPlay = page.getByRole("button", { name: /^(Play|Pause)$/ });
  record(
    "transport exposes a play/pause control",
    (await dockPlay.count()) > 0,
    `count=${await dockPlay.count()}`,
  );

  await page.keyboard.press("Space");
  await page.waitForTimeout(900);
  const paused = await page.evaluate(() => ({ ...window.__wavecore }));
  record("spacebar pauses", paused.mode === "paused", `mode=${paused.mode}`);

  await page.keyboard.press("Space");
  await page.waitForTimeout(900);
  const resumed = await page.evaluate(() => ({ ...window.__wavecore }));
  record("spacebar resumes", resumed.mode === "playing", `mode=${resumed.mode}`);

  /* 6. source panel + track list */
  await revealChrome(page);
  await page.keyboard.press("o");
  await page.waitForTimeout(700);

  const panel = await panelInfo(page);
  record("source panel opens", panel.open);
  record(
    "demo track list is populated",
    panel.rows >= 3,
    `rows=${panel.rows} · "${panel.text}"`,
  );
  await page.screenshot({ path: join(SHOTS, "04-panel.png") });

  await clickWithReveal(page, page.getByRole("button", { name: /Ion Drift/ }).first());
  await page.waitForTimeout(2200);
  const second = await page.evaluate(() => ({
    state: { ...window.__wavecore },
    // The anime.js reveal renders into the only <h2> on the page.
    revealTitle: document.querySelector("h2")?.textContent ?? null,
  }));
  record(
    "selecting another track keeps playing",
    second.state.mode === "playing",
    `mode=${second.state.mode}`,
  );
  record(
    "track switch re-triggers the anime.js title reveal",
    // Spaces are rendered as NBSP so the per-character spans don't collapse.
    second.revealTitle?.replace(/\u00a0/g, " ") === "Ion Drift",
    `h2=${JSON.stringify(second.revealTitle)}`,
  );
  await page.screenshot({ path: join(SHOTS, "05-second-track.png") });

  /* 7. upload */
  const fixture = join(ROOT, "public", "tracks", "chromagrid.wav");
  await revealChrome(page);
  await page.setInputFiles('input[type="file"]', fixture);
  // Wait for the ~7 MB read plus decode.
  await page.waitForTimeout(12_000);

  const uploaded = await page.evaluate(() => ({
    reactive: { ...window.__wavecore },
    errorText: document.body.innerText.includes("couldn't be decoded"),
  }));
  // Assert on the DOM before the screenshot, so PNG encoding can't race the
  // chrome's auto-hide.
  const uploadedPanel = await panelInfo(page);
  record(
    "upload decodes and plays",
    uploaded.reactive.mode === "playing" && !uploaded.errorText,
    `mode=${uploaded.reactive.mode}${uploaded.errorText ? " (decode error shown)" : ""}`,
  );
  record(
    "upload produces a decoded waveform overview",
    uploadedPanel.bars > 8,
    `panel=${uploadedPanel.open} bars=${uploadedPanel.bars} spans=${uploadedPanel.spans}`,
  );
  await page.screenshot({ path: join(SHOTS, "06-uploaded.png") });

  /* 8. hide-everything mode */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.keyboard.press("h");
  await page.waitForTimeout(1500);
  const zenShot = await page.screenshot({ path: join(SHOTS, "07-zen.png") });
  const zenState = await page.evaluate(() => ({
    chrome: document.documentElement.dataset.chrome ?? "unset",
    panelVisible: Boolean(document.querySelector('[aria-label="Source panel"]')),
    bodyText: document.body.innerText.replace(/\s+/g, " ").trim().slice(0, 120),
  }));
  record(
    "hide-everything mode clears the chrome",
    zenState.chrome === "hidden" && !zenState.panelVisible,
    `data-chrome=${zenState.chrome} panel=${zenState.panelVisible} zen shot ${zenShot.length}B`,
  );
  await page.keyboard.press("h");
  await page.waitForTimeout(900);
  record(
    "leaving hide-everything mode restores the chrome",
    (await chromeState(page)) === "visible",
    `data-chrome=${await chromeState(page)}`,
  );

  /* 9. mobile.

     A separate context with a coarse pointer and deviceScaleFactor 2, so this
     exercises the tier detection, the DPR clamp and the layout at a real phone
     width rather than a resized desktop window.

     The desktop page is closed first: two simultaneously-animating WebGL
     contexts under software rendering starve each other badly enough that the
     second one never gets its first frame. */
  await page.close();

  let mobile = null;
  try {
    mobile = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    mobile.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(`[mobile] ${msg.text()}`);
    });
    mobile.on("pageerror", (err) => pageErrors.push(`[mobile] ${err.message}`));
    mobile.on("response", (res) => {
      if (res.status() >= 400) badResponses.push(`[mobile] ${res.status()} ${res.url()}`);
    });

    await mobile.goto(BASE, { waitUntil: "domcontentloaded" });
    await mobile.waitForSelector("canvas", { timeout: 90_000 });
    await mobile.waitForTimeout(9000);

    const mobileIdle = await averageStats(mobile, 2);
    await mobile.screenshot({ path: join(SHOTS, "08-mobile-idle.png") });
    record(
      "mobile: scene renders at a phone viewport",
      mobileIdle.mean > 0.004 &&
        mobileIdle.variance > 0.0008 &&
        mobileIdle.centroidX > 0.25 &&
        mobileIdle.centroidX < 0.75,
      `mean=${mobileIdle.mean.toFixed(4)} variance=${mobileIdle.variance.toFixed(5)} centroid=(${mobileIdle.centroidX.toFixed(2)},${mobileIdle.centroidY.toFixed(2)})`,
    );

    // Pre-play only, so the hero copy is present; the dock carries the status dot.
    await mobile.mouse.move(195, 420);
    await mobile.mouse.move(198, 424);
    await mobile.waitForTimeout(700);
    await mobile.getByRole("button", { name: /Subsurface/ }).first().tap({ timeout: 20_000 });
    await mobile.waitForTimeout(12_000);
    const mobilePlaying = await mobile.evaluate(() => ({
      mode: window.__wavecore?.mode,
      bass: window.__wavecore?.bass,
      tripped: document.body.innerText.includes("can't start WebGL2"),
    }));
    await mobile.screenshot({ path: join(SHOTS, "09-mobile-playing.png") });
    record(
      "mobile: tap starts a track and the scene reacts",
      mobilePlaying.mode === "playing" && !mobilePlaying.tripped,
      `mode=${mobilePlaying.mode} bass=${mobilePlaying.bass?.toFixed(3)}`,
    );
  } catch (err) {
    record(
      "mobile checks ran",
      false,
      err instanceof Error ? err.message.split("\n")[0] : String(err),
    );
  } finally {
    await mobile?.close();
  }

  /* 10. errors */
  record(
    "no shader compile errors",
    shaderErrors.length === 0,
    shaderErrors.slice(0, 2).join(" | "),
  );
  record(
    "no uncaught page errors",
    pageErrors.length === 0,
    pageErrors.slice(0, 2).join(" | "),
  );
  record(
    "zero failed network requests",
    badResponses.length === 0,
    badResponses.slice(0, 4).join(" | "),
  );
  record(
    "zero console errors",
    consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(" | ") : "",
  );
} catch (err) {
  record("qa run completed", false, err instanceof Error ? err.message : String(err));
} finally {
  await browser?.close();
  stopServer(server);
}

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed. screenshots → .qa-shots/\n`,
);  writeFileSync(
    join(ROOT, ".qa-shots", "report.json"),
    JSON.stringify({ results, consoleErrors, pageErrors, badResponses }, null, 2),
  );

process.exit(failed.length > 0 ? 1 : 0);
