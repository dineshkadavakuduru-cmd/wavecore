# Changelog

All notable changes to Wavecore are recorded here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Hardening + verification pass. Every item below was reproduced and then
re-verified against a production build served locally from `out/`
(`npm run verify:live` → **40/40 checks**).

### Fixed

- **Corrupt `chromagrid.ogg` no longer ends the track early.** The track was an
  Opus stream in a broken Ogg container with no seekable duration, so the
  browser reported ~15 s against a real 42.45 s and stopped playback mid-set.
  All three demo tracks were re-encoded.
- **Track generator wrote each Ogg with two concurrent ffmpeg processes.**
  `convertToOgg()` called `.save()` (which already runs the command) *and then*
  `.run()`, racing two encoders onto the same file — the source of the corrupt
  asset above. The encoder now runs once and **fails the build** if the produced
  Ogg has no duration or is shorter than the render.
- **WebGL context loss no longer bricks the visualiser.** The scene used to
  return a fallback *instead of* `<Canvas>`, which unmounted the canvas and its
  `webglcontextrestored` listener — recovery could never fire. The canvas is now
  torn down while the context is dead and remounted fresh after a short delay
  (bounded to two attempts), cleared by a screenshot-diff verification that the
  scene renders again.
- **Keyboard shortcuts no longer hijack form controls.** The global handler used
  to only skip `<textarea>`/contenteditable; it now also ignores `<select>` and
  every non-range `<input>` (text, number, search, date, file…). Range sliders
  keep their native arrow keys, and Space still toggles playback globally.
- **Seeking updates the transport readout while paused.** The dock now syncs its
  DOM readout on engine emissions instead of waiting for a play-state change.
- **Microphone failures after startup are surfaced.** A device unplugged or a
  permission revoked mid-session ends the media track silently; the engine now
  listens for it, tears the graph down and reports it. `NotReadableError`
  (device busy / unplugged during acquisition) gets its own message.
- **A browser-suspended AudioContext is now visible and dismissable.** A prompt
  appears when the context is suspended while a source is loaded.

### Changed

- **`npm start` serves the static export.** `next start` refuses to run against
  `output: "export"`; `start`/`preview` now use a dependency-free
  `scripts/serve.mjs` that serves `out/`.
- **Fewer React re-renders on engine emissions.** The provider's api object is
  now shallow-compared and reused when an emission (a seek, a duplicate play
  emit, a metadata ping that doesn't move the duration) changes nothing the UI
  can observe.

### Added

- Context-loss recovery check and a 375 px mobile check (particle scaling +
  no horizontal overflow) in `scripts/verify-live.mjs`.
- `scripts/serve.mjs` — zero-dependency static preview server.
- First user gesture now resumes/creates the `AudioContext` at the window level.

## [0.1.0] — 2026-10-15

- Initial commit: audio-reactive 3D visualiser — Web Audio graph, FFT-driven
  reactive bus, drei/postprocessing scene, bundled demo tracks, upload + mic
  input, adaptive quality tiers, static export, and the runtime verification
  suite.
