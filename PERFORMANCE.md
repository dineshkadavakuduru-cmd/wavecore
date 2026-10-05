# Wavecore — Performance & Audio-Pipeline Findings

Measured with `npm run perf` (`scripts/perf.mjs`): headless Chromium,
SwiftShader software rendering, 1280×800 unless noted. Software rendering
rasterises on the CPU, so every FPS number below is a **floor, not a target** —
any real GPU sits well above these. What the numbers prove is the *shape*:
idle vs playing vs mic stay in the same band, bands track real FFT data, and
the watchdog fires when it should.

## FPS (SwiftShader floor)

| State | FPS | Tier | Notes |
|---|---|---|---|
| Idle, no audio | ~36–51 | mid/high* | Procedural breath bed only |
| Demo track playing | ~31–48 | mid/high* | Full FFT → shaders, analyser + texture upload per frame |
| Microphone live | ~26–46 | mid | Fake-device tone through the same analyser path |
| 4× CPU throttle | 14.7 | **high→mid step-down observed** | Watchdog fires, one tier down, never oscillates |
| Mobile emulation (390×844 @2x, touch, 3× throttle) | 4.8 | mid | Still renders a live idle bed, zero errors |

\* `detectTier()` in headless reports mid or high run-to-run (core/memory
fingerprinting varies under virtualization); on real hardware the heuristic
uses `hardwareConcurrency` + `deviceMemory` + coarse-pointer + DPR.

Readout: playing costs roughly the analyser read + one 256-byte texture upload
+ uniform writes per frame — all flat, allocation-free work. The reactive bus
(`lib/audio/reactive.ts`) reuses preallocated buffers; the render loop performs
zero React state writes (scrubber via direct DOM writes, hue via CSS custom
properties every 3rd frame).

## FFT → visuals verification (real audio, not synthetic)

FFT 2048 → 1024 bins → log remap (22 Hz–15.4 kHz) → 5 slot-space bands with
`f^0.4` tilt compensation. Measured live on demo track 1:

- `bass=0.62 mid=0.41 treble=0.11–0.21 level=0.47–0.51`
- spectrum quarters `[0.59 0.65–0.70 0.33–0.44 0.14–0.25]` — all four quarters
  live, so treble/highs genuinely drive the top of the field, not just bass.
- Mic (fake device): `bass=0.27 mid=0.31 treble=0.16` on one run — balanced
  across bands, which is the tilt compensation doing its job.

Band mapping (one-to-one by design): bass → core pulse/burst radius/camera
punch · mids → morph depth + rotation speed · treble → hue + shimmer ·
level → brightness · punch → flash/FOV. Verified in code and observable in
`__wavecore` + `__wavecoreSpectrum` (dev seam, stripped from production).

## Adaptive quality

- Startup: `detectTier()` heuristic (cores / memory / coarse pointer / DPR).
- Runtime: FPS watchdog (3.5 s warmup, 2.5 s windows, <42 fps fires) steps
  **one tier down per session**, never back up.
- LOW: 2800 particles, DPR ≤1.25, 4 bloom mips, no multisampling, no
  chromatic aberration, no sparkles. MEDIUM: 6500 / 1.6 / 5 mips / MSAA 2.
  HIGH: 14000 / 2.0 / 7 mips / MSAA 4. Bloom stays on at every tier.
- Tier changes re-key `CoreMesh`/`ParticleField` so shader defines recompile;
  old geometries/textures are disposed on unmount.

## Transport checks (all passing in `perf.mjs`)

play (keyboard `1`, click) · pause · **stop** (`S` = pause + rewind to 0.00 s,
verified) · seek · volume curve · upload decode · **microphone** (permission
explained in-panel before `getUserMedia`; feedback-safe routing with the
analyser→speaker link severed while live; tracks stopped on teardown) ·
zero console errors · zero page errors across every transition.

## Reduced motion

`prefers-reduced-motion` is read once via `matchMedia` (live-updates) into a
mutable flag the frame loops read directly: camera drops punch-zoom, shake,
bass bounce and reactive FOV; core holds floor rotation with halved morph;
particles damp burst/punch and drift. UI animations already honour the media
query in CSS.

## Production hygiene

No `console.*` outside `NODE_ENV !== "production"` guards. Dev-only
`__wavecore` seam stripped from production builds. Geometries, DataTextures,
audio nodes, MediaStream tracks and every event listener are torn down on
unmount/track-switch/mic-stop; `AudioEngine.dispose()` disconnects the full
graph. `npm run build`, `lint`, `typecheck`, `test` (36/36) all green.
