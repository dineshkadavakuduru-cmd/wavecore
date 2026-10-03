# Wavecore

![Vercel](https://img.shields.io/badge/Vercel-Deployed-black?logo=vercel&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Three.js](https://img.shields.io/badge/Three.js-r170-black?logo=three.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/TailwindCSS-3.4-06B6D4?logo=tailwindcss&logoColor=white)
![Web Audio API](https://img.shields.io/badge/Web%20Audio-API-orange?logo=webaudio&logoColor=white)

[![Live Demo](https://img.shields.io/badge/▶_Live_Demo-wavecore--gilt.vercel.app-000000?style=for-the-badge&logo=vercel)](https://wavecore-gilt.vercel.app/)

---

A full-screen 3D scene that reacts in real time to whatever is playing. Bass moves the mass and the camera, mid drives the morph, treble bends the colour. No backend, no login, no persistence — client-side only, one route.

```bash
npm install
npm run dev          # http://localhost:3000
```

Three royalty-free demo tracks are bundled, so it looks good immediately with no setup. You can also drop any audio file onto the page.

---

## ✨ Features

- **Audio-reactive 3D mesh** — Icosahedron with fbm simplex displacement along analytically rebuilt normals
- **14,000-point spectral particle field** — Each particle owns a frequency slot, inner shells = bass, outer = treble
- **Real-time frequency analysis** — Log-frequency remapping (22 Hz – 15.4 kHz), spectral tilt (`f^0.4`), asymmetric easing (22 ms attack / 120 ms release)
- **3 procedurally generated royalty-free demo tracks** — Synthesised from scratch: exponential pitch envelope kicks, Karplus-Strong plucks, detuned saw pads, Schroeder reverb
- **File upload with drag-and-drop** — Decoded fully in-browser (WAV, MP3, M4A, OGG, FLAC, AIFF); nothing leaves the client
- **Adaptive quality tiers with FPS-based auto-degradation** — High / Mid / Low, stepped down once if FPS < 42 over 2.5 s window
- **Recording mode (zen mode)** — One key hides all chrome, enters fullscreen, hides cursor; Esc restores
- **Comprehensive keyboard shortcuts** — Space (play/pause), arrows (seek/volume), 1–9 (tracks), O (panel), H (zen), F (fullscreen), M (mute)
- **Glassmorphic UI with auto-hiding chrome** — 3.6 s idle timeout (6.5 s with panel open), pointer/key wake, never wedges open
- **Post-processing pipeline** — Bloom (always on), bass-linked vignette, punch-only chromatic aberration, film grain
- **WCAG-aware** — `prefers-reduced-motion` respected, no pinch-zoom disable, semantic HTML, focus-visible outlines
- **SSR-safe architecture** — No WebGL on server, `useSyncExternalStore` for quality tier, dynamic import with `ssr: false`

---

## 🎬 Preview

<!-- TODO: Add screenshot of the visualizer in action -->

*Screenshots coming soon — run `npm run dev` to see it live.*

---

## 🛠 Tech Stack

| Technology | Purpose |
|---|---|
| Next.js 14 | Framework & static export (`output: 'export'`) |
| React Three Fiber | 3D scene graph & React integration |
| Three.js | WebGL renderer & geometry |
| postprocessing | Bloom, vignette, chromatic aberration, film grain |
| Web Audio API | Real-time frequency analysis (AnalyserNode) |
| Motion (Framer Motion) | Chrome UI animations (dock, panel, hero) |
| anime.js | One-shot flourishes (decode progress, title reveal) |
| TailwindCSS | Chrome styling with custom design tokens |
| TypeScript | Full type safety, zero `any` |

---

## The animation split

This is the most important architectural fact about the project.

**Motion and anime.js never touch the reactive visuals.** Audio reaction has to be frame-accurate and instant, and a spring or tween in that path adds exactly the smoothing lag that makes a visualiser feel disconnected from the music. So:

| Layer | Driver | Where |
|---|---|---|
| The scene (core, particles, camera, post) | **raw Web Audio → `useFrame`** | `components/scene/` |
| Chrome show/hide, panel, dock, hero | **Motion** | `components/ui/` |
| Decode progress, track-title reveal | **anime.js** | `components/ui/` |

The only crossing point is a CSS custom property: the render loop writes `--signal-rgb` every third frame and the chrome reads it. That is a raw `style.setProperty`, not an animation.

---

## Audio pipeline

```
HTMLAudioElement (bundled) ─┐
                            ├─► inputGain ─► analyser ─► volumeGain ─► out
decoded AudioBuffer (upload)┘
```

The analyser is tapped **before** the volume fader, so pulling the volume down doesn't calm the visuals and muting doesn't kill them. For a piece whose whole job is to be recorded, that is the behaviour you want.

Per frame, in `ReactiveBridge`:

```
getByteFrequencyData(1024 bins)           ← raw Web Audio, once per frame
  → log-frequency remap to 256 slots      (22 Hz – 15.4 kHz, perceptually even)
  → f^0.4 spectral tilt                   (counters music's natural 1/f falloff)
  → asymmetric easing per slot            (22 ms attack / 120 ms release)
  → five band averages → three            (read from the eased spectrum)
  → bass transient → throttled punch
  → crossfaded with a procedural idle bed when nothing is playing
```

The eased spectrum is uploaded to the particle shader as a 256×1 R8 texture; the eased bands go up as uniforms. **Raw analyser bytes never reach the GPU** — raw reads as jitter, eased reads as musical.

### Idle

Before anything plays there is no signal to analyse, so three decorrelated noise channels at different rates synthesise a slow breath. They are deliberately offset so bass/mid/treble never peak together — lockstep is what makes an idle scene look like a screensaver instead of something alive. The crossfade between the idle bed and real audio is eased over ~1.1 s, so pressing play doesn't snap.

---

## Scene

| Component | What it is |
|---|---|
| `CoreMesh` | Icosahedron with fbm simplex displacement along the normal. The normal is rebuilt analytically from two tangent-offset samples of the same displacement field — without that the lighting stays baked to the undisplaced sphere and every ridge reads flat. |
| `ParticleField` | ~14k points, each with its own frequency slot, reading its own column of the spectrum texture. Inner shells are bass, outer shells are treble. |
| `CameraRig` | Hand-rolled slow orbit. Drag/scroll apply an offset that decays back to centre over ~9 s, so a recording always returns to the hero angle. |
| `Backdrop` | Inside-out sphere carrying the gradient and the live hue. In-scene rather than a DOM layer behind a transparent canvas — postprocessing owns the framebuffer and compositing alpha through it is fragile. |
| `Effects` | Bloom (never dropped, it is the single biggest contributor to the look), bass-linked vignette, punch-only chromatic aberration, film grain. |
| `SparkleLayer` | drei `<Sparkles>`, with the per-particle opacity array rewritten each frame from treble. drei exposes no opacity uniform, so this is the only genuinely reactive hook it has. |

### A note on colour

three.js forces linear colour space for non-XR render targets, and postprocessing's final pass writes straight through without a conversion, so the chain is a **1:1 passthrough**: shader values land on screen exactly as authored. That is what makes the look predictable from the shader source alone. Adding a `ToneMapping` effect to the composer would break that contract and mean re-tuning every constant in both shaders.

---

## Performance

Three tiers, chosen from `hardwareConcurrency` / `deviceMemory` / pointer type / DPR, then stepped **down once** if average FPS stays under 42 across a 2.5 s window after a 3.5 s warm-up. Never stepped back up: oscillating between tiers looks far worse than being one tier too low.

| | particles | core detail | noise octaves | DPR | MSAA |
|---|---|---|---|---|---|
| high | 14 000 | 40 | 3 | ≤2 | 4× |
| mid | 6 500 | 26 | 2 | ≤1.6 | 2× |
| low | 2 800 | 12 | 2 | ≤1.25 | off |

Bloom stays on at every tier; only its mip level count drops.

---

## Keyboard

| Key | |
|---|---|
| `Space` | play / pause |
| `←` `→` | seek ∓5 s |
| `↑` `↓` | volume |
| `1`–`9` | jump to demo track |
| `O` | source panel (tracks + upload) |
| `H` | **hide everything** — recording mode, also goes fullscreen |
| `F` | fullscreen |
| `M` | mute |
| `Esc` | leave recording mode |

Chrome auto-hides after 3.6 s idle (6.5 s with the panel open), returns on pointer movement or any key. Even an explicitly-opened panel hides on a timeout — there is no state where the chrome can wedge itself on screen.

---

## Mobile

- **Volume control** — Tap the volume button to open a vertical slider popover (YouTube-style)
- **Track switching** — Prev/Next buttons visible on all screen sizes (smaller on mobile)
- **Touch gestures** — Swipe left/right on canvas for prev/next track, swipe up/down for volume; designed to not interfere with camera orbit drag
- **First-visit hint** — "Tap to show controls" overlay appears once per session after chrome auto-hides

---

## 📱 PWA Support

Wavecore is a fully installable Progressive Web App:

- **Offline playback** — Demo tracks cached via service worker for offline use
- **Install prompt** — Subtle native install dialog on supported browsers
- **Standalone mode** — Runs full-screen without browser chrome when installed
- **App manifest** — `/manifest.json` with proper icons and theme colors
- **Service worker** — Cache-first strategy for app shell, demo tracks cached for offline

To install: Open in Chrome/Edge on desktop or mobile, click the install icon in the address bar or use the browser menu → "Install Wavecore".

## Scripts

| Command | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run gen:tracks` | Re-render the bundled demo tracks (WAV + OGG) from `scripts/generate-tracks.mjs` |
| `npm run qa` | Headless browser pass (see below) |

### Demo tracks

`scripts/generate-tracks.mjs` synthesises all three tracks from scratch — kick with an exponential pitch envelope, Karplus-Strong plucks, detuned saw pads, Schroeder reverb, soft-clip limiter — and writes them to `public/tracks/` as **both WAV (uncompressed, ~7 MB each) and OGG/Opus (compressed, ~0.7 MB each)**. Nothing is sampled or downloaded, so the pack is unambiguously royalty-free and reproducible from one file. They are written specifically to exercise the visualiser: each opens beatless so the idle → playing reveal lands, then drops a sub-bass fundamental around 45 Hz, a busy mid arpeggio, and dense hats.

The app loads the OGG first (smaller, faster) and falls back to WAV if the browser can't decode Opus. Only the OGG files are committed to git; WAVs are regenerated locally via `npm run gen:tracks`.

---

## QA

`npm run qa` drives the Chrome already on the machine via `playwright-core` (no browser download) against a dev server on port 3117. 30 checks, covering:

- WebGL2 context, shader compilation, non-flat frames
- framing metrics decoded back out of the screenshot: luminance centroid, centre vs. edge contrast, bright-area fraction — so "cinematic dark backdrop" is a measured property rather than a claim
- band dynamic range for bass/mid/treble (catches a band too quiet to drive anything)
- idle bed before play, the idle → playing transition, ambient crossfade
- track selection, play/pause by keyboard, title reveal, upload + decode + waveform
- chrome auto-hide, return on movement, recording mode in and out
- zero console errors, zero failed requests, zero uncaught exceptions

**What it cannot check:** whether the scene actually looks good reacting to audio, and whether bass hits are *felt*. That is a human, eyes-and-ears check and it is the most important one for this project. Run `npm run dev` and watch it.

Dev builds also expose `window.__wavecore` (the live reactive bus) and `window.__wavecoreSpectrum` for inspection from the console. Both are stripped from production builds.

---

## Deploy

```bash
vercel
```

Nothing to configure — static export (`output: 'export'` in `next.config.mjs`), no server, no API routes, no environment variables. The build outputs a fully self-contained `out/` directory suitable for any static host (Vercel, Netlify, Cloudflare Pages, GitHub Pages, S3 + CloudFront, etc.).

Only the compressed OGG tracks (~2 MB total) are committed to git. The uncompressed WAVs (~21 MB total) are excluded via `.gitignore` and regenerated locally with `npm run gen:tracks` if needed.

---

## Where to tune

- **Palette range** — `hue` in `shaders/core.ts` and `shaders/particles.ts`. The band is intentionally narrow (`fract(0.58 + hue * 0.30)`); it should drift within blue → violet → magenta, not cycle the wheel.
- **How hard hits land** — `PUNCH_THRESHOLD` and `PUNCH_COOLDOWN` in `lib/audio/reactive.ts`.
- **Spectral balance** — the `0.4` exponent in `SPECTRUM_TILT`. Raise it and treble takes over; drop it and everything collapses into the bass.
- **Brightness / grade** — `color *= 0.26 + uLevel * 0.85` in `shaders/core.ts` and the bloom threshold in `Effects.tsx`. They trade against each other: bloom is applied after the core, so a core that already reaches white loses all of its own surface detail.

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Make your changes with type-safe TypeScript (`npm run typecheck` must pass)
4. Run lint: `npm run lint`
5. Test locally: `npm run dev` and verify the scene works
6. Submit a PR with a clear description

**Guidelines:**

- Keep the animation split intact: no Motion/anime.js in the reactive path (`components/scene/`)
- Follow the existing design system (see `DESIGN.md` and `tailwind.config.ts`)
- No external UI component libraries — inline icons, custom range styling, glass surfaces
- Preserve WCAG compliance: `prefers-reduced-motion`, focus-visible, semantic HTML
- Keep the build as a static export — no server-side features

---

## License

MIT License — see [LICENSE](LICENSE) for details.

Copyright (c) 2024 Dinesh Kadavakuduru