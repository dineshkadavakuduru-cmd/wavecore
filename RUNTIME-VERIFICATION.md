# Wavecore — Runtime Verification Report

- **Target (this run):** local production export — `npm run build` → `out/`,
  served by `scripts/serve.mjs` at `http://127.0.0.1:4173/`
- **Date:** 2026-10-18
- **Tooling:** `scripts/verify-live.mjs` (`npm run verify:live`), headless
  Chromium + SwiftShader software rendering
- **Build under test:** HEAD (`master`) with the fixes in [CHANGELOG.md](./CHANGELOG.md)
- **Result: 40/40 checks pass**, zero console errors, zero page errors, zero
  failed requests

> **Deployment note.** The public Vercel bundle is stale — it predates the
> `transportRev` memo fix (`c849c08`) and still ships the corrupt
> `chromagrid.ogg`. Until it redeploys, verification is run against the same
> code built and served locally (`out/`), which is the exact static bundle the
> export produces. `npm run verify:live https://wavecore-gilt.vercel.app/` is
> the deploy detector: the two Space checks and the corrupt-asset track check
> flip to green once the deploy catches up.

Headless SwiftShader rasterises on the CPU, so every FPS figure here is a
**floor, not a target** — a real GPU sits above these. What they prove is the
*shape* (idle ≈ playing ≈ mic) plus error-free runs across every transition.

Production builds strip the `__wavecore` dev seam, so band reactivity is
verified through live proxies, each tied to one mapping:

| Proxy | Mapping it proves |
|---|---|
| `--signal-hue` CSS var range (rewritten every 3rd frame from `reactive.hue`) | treble → hue |
| Screenshot centre luminance | level → brightness |
| Frame-to-frame energy, beatless intro vs full mix of the *same* track | bass/punch → motion |
| Telemetry `IDLE / PLAYING / PAUSED` text + transport button labels | engine ↔ React sync |

Band-specific numeric values for the identical code were measured via the dev
seam locally: `bass=0.61 mid=0.40 treble=0.09–0.21`, spectrum quarters
`[0.60 0.64 0.35 0.09]`, treble max 0.87 on Chromagrid
(`npm run perf`, `npm run qa` — 36/36 unit, QA green).

## 1. Loading

| Metric | Measured |
|---|---|
| `domContentLoaded` | 69–3446 ms (machine-load variance) |
| Canvas attached | 484–5017 ms |
| First paint non-flat (mean ≈ 0.20, variance > 0.015) | every run, incl. 3/3 reloads |

`Initializing…` cannot stick: the loading overlay shows error copy + Retry
after 12 s, chunk-load failure lands in the ErrorBoundary (Reload button),
and WebGL failure has its own fallback panel (code-reviewed; not triggerable
here — SwiftShader always provides WebGL).

## 2. Audio reactivity (no random animation)

Controlled experiment, same track (Subsurface), same camera — the only change
is the music crossing from beatless intro to full mix:

| Metric | Intro | Full mix |
|---|---|---|
| Frame energy | 0.0144 | 0.0598 (**4.1×**; 1.4–6.4× across runs, always > 1.25× bar) |
| Hue range (treble→hue) | 9° | 11–27° |

Per-track fingerprints (hue range over 4 s): Ion Drift 6°, Chromagrid 7–12°.
Most treble-active: Chromagrid — consistent with its "brightest highs" brief.
Muted output (volume forced to 0) keeps frame energy at **9.5×** the idle
baseline, proving the analyser taps pre-gain and muting never calms the
visuals.

## 3. Transport

| Control | Evidence |
|---|---|
| Demo playback | press→PLAYING in **2–4 ms** (optimistic UI), all 3 tracks |
| Pause (Space) | **PASS — 12 ms**, UI flips to PAUSED |
| Resume (Space) | **PASS — 8 ms** |
| Stop (`S`) | **mode=PAUSED, seek=0.00** |
| Volume | slider 0.8 → 0.6 via ArrowDown; pre-gain proof above |
| Upload (7 MB WAV) | decodes + plays in **597–2926 ms**, 64-bar waveform renders |
| Mic (fake device) | live in **17–19 ms**, energy ~0.12, stops cleanly to PAUSED |
| Track switches ×4 | no errors, playback continues |

Mic permission is explained in-panel *before* `getUserMedia` is called
("analysed locally in real time — never recorded, stored, or sent anywhere"),
with distinct denied / not-found / busy-device errors, and a live teardown if
the device disappears mid-session.

## 4. Performance (SwiftShader floors)

| State | FPS | Tier |
|---|---|---|
| Idle | 30–48 | mid (auto-detected) |
| Demo playing | 41–48 | mid |
| Mic live | 38–48 | mid |
| Mobile emulation (390×844 @2x, touch) | 48–55 idle | mid |
| 375 px (low-end fingerprint) | renders, 0 overflow | **low · 2.8k pts** |
| 6× CPU throttle + playback | 6.7–21 | **high→mid step observed** |
| Forced LOW (2 cores, coarse, dpr 3) | 44–48 | low · 2.8k pts, stable |
| Forced HIGH (12 cores, coarse false, dpr 1) | ~38–48 | high · 14k pts → mid (watchdog step, as designed) |

Adaptive quality is proven end to end, twice: HIGH engages from the
fingerprint (score 4) and the watchdog steps it down at the ~6 s mark under
SwiftShader load; a throttled page stepped high→mid at min-window 6.7 fps.
Step-down is one tier per session, never back up. The 375 px check confirms
the particle count scales down (2.8k, not the 14k desktop default) and the
layout has no horizontal overflow at the narrowest mainstream width.

## 5. Memory

JS heap (with `gc()` before each read):

| Point | Heap |
|---|---|
| Idle baseline | 38–39 MB |
| After upload + 4 track switches | 54.3 MB (includes the ~15 MB decoded upload buffer — expected transient) |
| After 2 mic on/off cycles | 38.7 MB (uploaded buffer collected, tracks released) |
| Mobile idle | 15.6 MB |

No growth across switches, mic cycles, tier rebuilds, or 3/3 reloads.
Geometries, DataTexture, audio nodes, MediaStream tracks and listeners are
torn down on every transition (reviewed + heap-flat).

## 6. Accessibility

- **Reduced motion** (emulated): `.chrome-in` animation resolves to `none`,
  scene keeps rendering; camera punch/shake/bass-bounce, core morph/spin and
  particle burst are gated on the same media query in the frame loops.
- **Keyboard:** `O` panel, `1–3` tracks, `Space` toggle, `S` stop, arrows
  seek/volume, `M` mute, `H` zen + `Escape` restore — all verified. The global
  handler ignores `<textarea>`, contenteditable, `<select>` and every non-range
  `<input>` (text/number/date/file…), while range sliders keep their native
  arrow keys and Space still toggles playback.
- **Visible focus:** Tab lands on a BUTTON with `outline solid 1px`
  signal-coloured ring.
- **Mic explanation:** present before permission (§3).
- **WebGL fallback:** fallback copy reviewed; a context-loss panel is shown and
  the scene rebuilds (see §7 — verified live).

## 7. Graphics context loss / recovery

Simulated a GPU reset via `WEBGL_lose_context.loseContext()` against the
rendering page:

| Step | Result |
|---|---|
| Notice after loss | shown ("Graphics context lost") |
| Canvas after loss | torn down; remounted fresh after ~900 ms |
| Frame energy before → after | 0.0124 → **0.0133** (scene renders again) |
| Notice cleared | yes |
| Console errors during the whole sequence | none |

## 8. Errors / hygiene

Zero console errors, zero page errors, zero failed network requests across the
full run (transport, mic, upload, tiers, throttle, mobile, 375 px, reloads,
reduced-motion, context-loss). `npm run build`, `lint`, `typecheck` and
`test` (**36/36**) are green on HEAD.

## 9. Resolved defects (this pass)

- **Encoding:** `chromagrid.ogg` was an Opus stream in a broken Ogg container
  with no seekable duration (browser reported ~15 s vs a real 42.45 s), so the
  track ended mid-set and the transport landed PAUSED before the Space test —
  the two "failing checks". Root cause: `scripts/generate-tracks.mjs` ran two
  ffmpeg processes onto the same output (`.save()` already runs the command, and
  `.run()` ran it again). Fixed + regenerated; the generator now fails loudly on
  a duration-less Ogg.
- **Pause/resume UI:** the memoized api object went stale on emit-only
  transitions (`c849c08`); plus the verification harness now waits for the media
  element to actually start before keying Space (the transport UI is optimistic,
  so keying during load was a no-op).
- **Context loss:** the scene used to return a fallback *instead of* `<Canvas>`,
  unmounting the canvas and its restore listener so recovery could never fire.

## 10. Honest limits (not measured)

- True audio-output latency: not measurable with a headless null sink.
  Measured instead: 2–4 ms press→PLAYING (UI) and hue/frame response within
  the same musical passage.
- Real-GPU FPS and real-device mobile behaviour: emulation + software
  rendering only. The numbers above are floors.
- WebGL *failure* fallback (no WebGL at all): reviewed, not triggered — only
  the context-loss path is exercised live.
- Human judgement of look/feel remains a human check by design.
