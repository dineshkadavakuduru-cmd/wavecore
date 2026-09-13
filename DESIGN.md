# Wavecore — design notes

Two subjects are being designed here and they follow different rules. Keeping
them apart is most of the work.

| | The scene | The chrome |
|---|---|---|
| Palette | **audio data** — hue from treble, brightness from amplitude | a fixed neutral ramp |
| Motion | raw Web Audio in `useFrame`, frame-accurate | Motion + anime.js, discrete |
| Density | the entire product | designed to disappear |

The one-accent-colour rule that governs the rest of this project's builds is
**deliberately inverted** for the scene. A fixed accent would freeze the colour
while the music moved, which is the opposite of the point. Treble intensity
drives hue, so the palette is a readout, not a token. The *chrome* keeps the
fixed neutral ramp, which is what stops the UI from competing with it.

---

## 1 · Chrome tokens

Neutral, cool-tinted, never pure black or pure white. Deliberately low contrast
so the chrome reads as glass over the scene rather than as a layer on top of it.

| Token | Value | Use |
|---|---|---|
| `ink-950` | `#04050a` | page and canvas clear colour |
| `ink-900` | `#070810` | — |
| `chalk` | `#f2f4f8` | primary text, primary button fill |
| `chalk-muted` | `#9aa1b1` | secondary text, inactive control glyphs |
| `chalk-faint` | `#5d6474` | micro-labels, telemetry values |
| `chalk-ghost` | `#3a4050` | separators, keyboard hints, `dd` labels |
| `signal` | `rgb(var(--signal-rgb))` | live hue — the only colour that moves |

### The `--signal` mechanism

`--signal-rgb` is written by the render loop every third frame from the same
`reactive.hue` value the core shader uses, converted through HSL. Everything
that should inherit the music's colour reads it: the scrubber fill, the volume
fill, the input focus ring, the track-list play marker, the status dot, the
aurora wash.

This is a **raw `style.setProperty` call, not an animation.** No tweening library
is anywhere near it. Motion and anime.js must never touch anything that updates
per frame.

### Surfaces

```
.glass        border white/8 · bg white/4 · backdrop-blur-2xl · inset highlight + deep drop
.glass-soft   border white/6 · bg white/2.5 · backdrop-blur-xl
.chrome-btn   32px pill, white/4 fill, hover white/8
.label-micro  10px / 0.14em tracking / uppercase / chalk-faint
```

Radii are full pills for controls and `rounded-2xl` for panels — never
`rounded-lg` on both, which is what makes an interface read as a default kit.

### Type

| Role | Face | Why |
|---|---|---|
| Micro-labels, controls | Inter | tight, neutral, gets out of the way |
| One display moment | Instrument Serif *italic* | an editorial voice no dashboard has |
| Telemetry, timecodes | JetBrains Mono | numbers should look like measurements |

The serif/mono pairing is the whole typographic idea. A geometrical sans for the
wordmark would have made this look like every other WebGL demo.

### Motion

| Curve | Where |
|---|---|
| `cubic-bezier(0.16, 1, 0.3, 1)` | entrances, reveals, hovers |
| `cubic-bezier(0.7, 0, 0.84, 0)` | exits |
| spring `420 / 38 / 0.9` | dock and panel (physical, not timed) |

Durations: 0.9s entrances, 0.5s exits, 2.2s for the aurora crossfade. Nothing is
instant except the zen-mode chrome teardown, which should feel like a cut.

### Layout

Bottom-left hero, bottom-centre transport, top-right telemetry, top-left mark,
bottom-right key hints. The right and centre of the frame are left empty because
that is where the 3D goes. Nothing is centred by default — a centred title over a
gradient is the first thing a generator reaches for.

---

## 2 · Audio → visual mapping

Everything is measured in **spectrum slots**, not FFT bins. Slots are
log-uniform across 22 Hz – 15.4 kHz in 256 steps, so an equal number of slots is
an equal number of octaves and the bands are genuinely comparable. Linear bins
would give bass 8 usable bins against treble's 400.

A `f^0.4` spectral tilt (~+12 dB across the range) counters music's natural 1/f
falloff (~30 dB). Without it, bass pins near 0.86 and treble never clears 0.03 —
bass would drive everything and treble would visibly drive nothing.

| Band | Slots | Frequency | Drives |
|---|---|---|---|
| **bass** | 0–80 | 22 Hz – 172 Hz | core pulse scale · particle burst radius · **camera punch** |
| **mid** | 81–215 | 172 Hz – 5.5 kHz | core rotation speed · morph depth |
| **treble** | 216–255 | 5.5 kHz – 15.4 kHz | hue shift · surface shimmer · sparkle intensity |
| **level** | — | overall amplitude | bloom intensity · global brightness |
| **punch** | — | bass transient | dolly-in, shake, FOV kick, chromatic aberration, bloom flash |

Measured on the bundled tracks, mean/max over a 4 s window of a full mix:

```
bass   0.41 / 0.64
mid    0.45 / 0.69
treble 0.33 / 0.96
```

### The punch trigger

Bass is compared against an envelope that lags it by ~520 ms. A hard kick spikes
the difference; a cooldown of 340 ms means a sustained 808 fires once rather than
every frame. This is the only threshold in the system, and it is the difference
between "bass hits are felt" and "the camera jitters constantly".

### Easing

One stage, asymmetric: **22 ms attack / 120 ms release**, applied to the spectrum
that both the particle texture and the bands are read from. Bands are folded out
of the already-eased spectrum rather than smoothed again — a second stage would
double the latency on every kick for no benefit.

---

## 3 · Anti-slop rules

The failure mode for this brief is a 2003-era equaliser. Concretely, that means:

- **No bar-graph level meter anywhere**, not even as chrome decoration. Telemetry
  shows system facts (FFT size, particle count, tier) instead of pretending to be
  a readout of the music.
- **No uniform pulse.** Every particle carries its own frequency slot and reads
  its own column of the spectrum, so the field is a spatial map of the spectrum
  rather than one shape breathing.
- **No static accent colour** — see the inversion above.
- **No tweening in the reactive path.** Motion owns the chrome; anime.js owns
  one-shot flourishes; neither is allowed inside `useFrame`.
- **No default-kit chrome.** Custom inline icons, custom range styling, no
  component library's default button.
- **No centred-and-blurred hero.** Asymmetric, edge-aligned, filmic.
