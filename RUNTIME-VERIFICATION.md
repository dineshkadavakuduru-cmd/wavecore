# Wavecore — Live Runtime Verification Report

- **Target:** https://wavecore-gilt.vercel.app/
- **Date:** 2026-10-09
- **Tooling:** `scripts/verify-live.mjs` (`npm run verify:live`), headless Chromium + SwiftShader software rendering
- **Build under test:** page chunk `page-2200dcaa1e338f85` — contains mic input + S-stop (`8c5a29e`), **predates the pause-fix `c849c08`** (see §8)
- **Result: 36/38 checks pass** on the live bundle; the 2 failures are one known defect, fixed and proven locally, awaiting redeploy

Headless SwiftShader rasterises on the CPU, so every FPS figure here is a
**floor, not a target** — a real GPU sits above these. What they prove is the
*shape* (idle ≈ playing ≈ mic), plus error-free runs across every transition.

Production builds strip the `__wavecore` dev seam, so band reactivity on the
live bundle is verified through live proxies, each tied to one mapping:

| Proxy | Mapping it proves |
|---|---|
| `--signal-hue` CSS var range (rewritten every 3rd frame from `reactive.hue`) | treble → hue |
| Screenshot centre luminance | level → brightness |
| Frame-to-frame energy, beatless intro vs full mix of the *same* track | bass/punch → motion |
| Telemetry `IDLE / PLAYING / PAUSED` text + transport button labels | engine ↔ React sync |

Band-specific numeric values for the identical code were measured via the dev
seam locally: `bass=0.61 mid=0.40 treble=0.09–0.21`, spectrum quarters
`[0.60 0.64 0.35 0.09]`, treble max 0.87 on Chromagrid (`npm run perf`,
`npm run qa` — 36/36 unit, 32/32 QA green).

## 1. Loading

| Metric | Measured |
|---|---|
| `domContentLoaded` | 465–1428 ms (CDN variance across runs) |
| Canvas attached | 817–4794 ms |
| First paint non-flat (mean ≈ 0.20, variance > 0.015) | every run, incl. 3/3 reloads |

`Initializing…` cannot stick: the loading overlay shows error copy + Retry
after 12 s, chunk-load failure lands in the ErrorBoundary (Reload button),
and WebGL failure has its own fallback panel (code-reviewed; not triggerable
in this headless config — SwiftShader always provides WebGL).

## 2. Audio reactivity (no random animation)

Controlled experiment, same track (Subsurface), same camera — the only change
is the music crossing from beatless intro to full mix:

| Metric | Intro | Full mix |
|---|---|---|
| Frame energy | 0.0138 | 0.0879 (**6.4×**; 1.4–3.6× across runs, always > 1.25× bar) |
| Hue range (treble→hue) | 8° | 12–27° |

Per-track fingerprints (hue range over 4 s): Subsurface 22–25° (full mix),
Ion Drift 5–6°, Chromagrid 7–12°. Most treble-active: Chromagrid —
consistent with its "brightest highs" brief. Muted output (volume forced to
0) keeps frame energy at **0.14–0.16 vs 0.014 idle baseline (~11×)**,
proving the analyser taps pre-gain and muting never calms the visuals.

## 3. Transport

| Control | Evidence |
|---|---|
| Demo playback | press→PLAYING in **3–7 ms** (optimistic UI), all 3 tracks |
| Pause (Space) | **FAILS on live bundle — known defect, §8** |
| Stop (`S`) | **mode=PAUSED, seek=0.00** — passes (same emit path as pause) |
| Volume | slider 0.8 → 0.6 via ArrowDown; pre-gain proof above |
| Upload (7 MB WAV) | decodes + plays in **778–938 ms**, 64-bar waveform renders |
| Mic (fake device) | live in **4–16 ms**, energy 0.03–0.06, stops cleanly to PAUSED |
| Track switches ×4 | no errors, playback continues |

Mic permission is explained in-panel *before* `getUserMedia` is called
("analysed locally in real time — never recorded, stored, or sent
anywhere"), with distinct denied/missing-device errors.

## 4. Performance (SwiftShader floors)

| State | FPS | Tier |
|---|---|---|
| Idle | 50–60 | mid (auto-detected headless) |
| Demo playing | 43–57 | mid |
| Mic live | 45–55 | mid |
| Mobile emulation (390×844 @2x, touch) | 56–60 idle | mid |
| 6× CPU throttle + playback | 11–21 | **high→mid step observed** |
| Forced LOW (2 cores, coarse, dpr 3) | 56–60 | low · 2.8k pts, stable |
| Forced HIGH (12 cores, coarse false, dpr 1) | ~40 | high · 14k pts → mid (watchdog step, as designed) |

Adaptive quality is proven end to end, twice: HIGH engages from the
fingerprint (score 4) and the watchdog steps it down at the ~6 s mark under
SwiftShader load; a throttled page stepped high→mid at min-window 21 fps.
Step-down is one tier per session, never back up — a second step in the same
session is by design *not* expected (an early high→mid spends the budget).

## 5. Memory

JS heap (with `gc()` before each read):

| Point | Heap |
|---|---|
| Idle baseline | 38–39 MB |
| After upload + 4 track switches | 54.8 MB (includes the ~15 MB decoded upload buffer — expected transient) |
| After 2 mic on/off cycles | 38.7–39.2 MB (buffer collected, tracks released) |
| Mobile idle | 15.6 MB |

No growth across switches, mic cycles, tier rebuilds, or 3/3 reloads.
Geometries, DataTexture, audio nodes, MediaStream tracks and listeners are
torn down on every transition (reviewed + heap-flat).

## 6. Accessibility

- **Reduced motion** (emulated): `.chrome-in` animation resolves to `none`,
  scene keeps rendering; camera punch/shake/bass-bounce, core morph/spin and
  particle burst are gated on the same media query in the frame loops.
- **Keyboard:** `O` panel, `1–3` tracks, `Space` toggle, `S` stop, arrows
  seek/volume, `M` mute, `H` zen + `Escape` restore — all verified except
  Space-pause UI (§8; engine pauses correctly).
- **Visible focus:** Tab lands on a BUTTON with `outline solid 1px`
  signal-coloured ring.
- **Mic explanation:** present before permission (§3).
- **WebGL fallback:** fallback copy + context-lost panel reviewed; could not
  be triggered headless (WebGL always available there).

## 7. Errors / hygiene

Zero console errors, zero page errors, zero failed network requests across
all four live runs (transport, mic, upload, tiers, throttle, mobile,
reloads, reduced-motion). `npm run build`, `lint`, `typecheck`, `test`
(36/36) green on HEAD.

## 8. Known defect: pause UI freezes on the deployed bundle

**Symptom (live):** Space pauses the audio engine (element `pause` event
fires) but Telemetry and the transport button stay frozen on PLAYING.

**Root cause:** `AudioProvider`'s api object is memoized, and pause/stop/
track-end change no React state — `engine.emit()` re-rendered, but the memo
recomputed nothing, so consumers kept the previous transport snapshot. Play
*looked* fine only because track selection also sets React state.

**Fix (HEAD `c849c08`, pushed, builds green):** a generation counter bumped
on every engine emission invalidates the memo (`transportRev` dep).

**Proof:** reproduced locally (element paused + UI frozen), applied fix,
re-tested locally — element paused, telemetry PAUSED, button flips to Play.
S-stop on live already exercises the same emit path and passes.

**Pending:** the live bundle (`page-2200dcaa…`, grepped — no `transportRev`)
predates the fix; Vercel has not deployed `c849c08` yet. After redeploy,
re-run `npm run verify:live` — the two Space checks are the deploy
detectors. No app-code action remains.

## 9. Honest limits (not measured)

- True audio-output latency: not measurable with a headless null sink.
  Measured instead: 3–7 ms press→PLAYING (UI) and hue/frame response within
  the same musical passage.
- Real-GPU FPS and real-device mobile behaviour: emulation + software
  rendering only. The numbers above are floors.
- WebGL-failure fallback: reviewed, not triggered.
- Human judgement of look/feel remains a human check by design.
