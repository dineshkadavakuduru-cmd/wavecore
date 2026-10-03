/**
 * The reactive bus.
 *
 * This is the one piece of state the visualiser reads every frame, and it is
 * deliberately NOT React state. Writing audio data into React state would
 * re-render the tree 60×/second; instead this is a plain mutable singleton that
 * the Web Audio analyser fills in and that r3f's `useFrame` reads straight out
 * of, via <ReactiveBridge/>.
 *
 * Pipeline per frame:
 *
 *   getByteFrequencyData(1024 bins)          ← raw Web Audio data, once per frame
 *     → five band averages over fixed bin ranges
 *         → asymmetric easing per band       (fast attack / slow release)
 *     → log-frequency remap into 256 slots
 *         → asymmetric easing per slot       (fast attack / slow release)
 *     → bass transient → throttled camera punch
 *     → everything crossfaded with the procedural idle bed when not playing
 *
 * The eased spectrum is uploaded to the particle shader as a texture and the
 * eased bands are uploaded as uniforms. Raw analyser bytes never reach the GPU
 * — raw reads as jitter, eased reads as musical.
 */

import { clamp01, lerp, smoothing } from "@/lib/utils";

/** AnalyserNode fftSize. 2048 → 1024 usable bins. */
export const FFT_SIZE = 2048;
export const BIN_COUNT = FFT_SIZE / 2;

/** Width of the eased spectrum texture handed to the particle shader. */
export const SPECTRUM_SIZE = 256;

export type ReactiveMode = "idle" | "playing" | "paused";

/**
 * Band definitions, in *spectrum-slot* space (0–255) rather than raw FFT bins.
 *
 * Using slots instead of bins is the whole trick. FFT bins are linear in
 * frequency, so a bin-range band gives bass 3 usable bins and treble 400 — and
 * the averages aren't comparable to each other. The slots are log-uniform
 * (22 Hz → 15.4 kHz across 256), so an equal number of slots is an equal
 * number of octaves, and every band gets a genuinely comparable measurement.
 *
 *   bass       0– 80    ≈  22 Hz – 172 Hz    kick fundamental, sub
 *   lowMid    81–120    ≈ 172 Hz – 480 Hz    bass body, low toms
 *   mid      121–175    ≈ 480 Hz – 1.97 kHz   pads, vocals, arps
 *   highMid  176–215    ≈ 2.0 kHz – 5.5 kHz   pluck attack, presence
 *   treble   216–255    ≈ 5.5 kHz – 15.4 kHz  hats, air, shimmer
 *
 * Five bands rather than three, then folded down — otherwise "mid" ends up
 * dominated by whichever narrow region happens to be loudest.
 */
export const BAND_RANGES = {
  bass: [0, 80],
  lowMid: [81, 120],
  mid: [121, 175],
  highMid: [176, 215],
  treble: [216, 255],
} as const;

/** Portable scratch-buffer type — avoids depending on typed-array generics. */
export type FrequencyScratch = Parameters<AnalyserNode["getByteFrequencyData"]>[0];

/** Log-frequency → linear bin lookup, so the spectrum texture reads evenly. */
const MIN_BIN = 1;
const MAX_BIN = 700; // ≈ 15 kHz — above this is mostly noise floor
const SPECTRUM_BIN_MAP = (() => {
  const map = new Uint16Array(SPECTRUM_SIZE);
  for (let i = 0; i < SPECTRUM_SIZE; i++) {
    const t = i / (SPECTRUM_SIZE - 1);
    map[i] = Math.round(MIN_BIN * Math.pow(MAX_BIN / MIN_BIN, t));
  }
  return map;
})();

/**
 * Spectral tilt.
 *
 * Music falls off roughly 1/f, so measured on a log frequency axis the top of
 * the spectrum sits around 30 dB below the bottom. Level-mapped straight to
 * 0–1 (as it comes out of the analyser) that means bass pins at ~0.86 while
 * treble never clears ~0.03 — the bass would drive everything and the treble
 * would visibly drive nothing.
 *
 * A `f^0.4` lift is close to the inverse of that slope: about +12 dB across
 * 22 Hz → 15 kHz, against ~30 dB of natural falloff. It narrows the gap to
 * something the eye reads as balanced without flattening the track's own
 * character. The 0.5 trim keeps the low end off the ceiling once lifted.
 *
 * Measured effect on the bundled tracks, mean per quarter of the spectrum:
 * 0.86 / 0.49 / 0.17 / 0.03  →  0.43 / 0.31 / 0.27 / 0.21
 */
const SPECTRUM_TILT = (() => {
  const map = new Float32Array(SPECTRUM_SIZE);
  for (let i = 0; i < SPECTRUM_SIZE; i++) {
    map[i] = Math.pow(SPECTRUM_BIN_MAP[i] / MIN_BIN, 0.4) * 0.5;
  }
  return map;
})();

export type ReactiveState = {
  mode: ReactiveMode;
  /** Smoothed bass energy, 0–1. Drives core pulse, burst radius, camera punch. */
  bass: number;
  /** Smoothed mid energy, 0–1. Drives core rotation and morph depth. */
  mid: number;
  /** Smoothed treble energy, 0–1. Drives hue and sparkle. */
  treble: number;
  /** Overall amplitude, 0–1. Drives brightness. */
  level: number;
  /** Rising-edge detector output for bass — spikes on hits, then decays. */
  bassTransient: number;
  /** Decaying camera punch, 0–1. Throttled so sustained bass can't spam it. */
  punch: number;
  /** Normalised hue offset, 0–1, from treble. */
  hue: number;
  /** 0 = fully reactive, 1 = fully idle bed. Eased, never snaps. */
  ambient: number;
  /** Free-running clock in seconds, advanced by the frame loop. */
  clock: number;
};

export const reactive: ReactiveState = {
  mode: "idle",
  bass: 0,
  mid: 0,
  treble: 0,
  level: 0,
  bassTransient: 0,
  punch: 0,
  hue: 0.12,
  ambient: 1,
  clock: 0,
};

/** Eased spectrum, 0–1. Uploaded to the particle shader as a texture. */
export const smoothedSpectrum = new Float32Array(SPECTRUM_SIZE);
/** 8-bit view of `smoothedSpectrum`, written to the DataTexture each frame. */
export const spectrumBytes = new Uint8Array(SPECTRUM_SIZE);

const rawSpectrum = new Float32Array(SPECTRUM_SIZE);

/** Folded band values read off the eased spectrum. */
const easedBands = { bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 };

/* ── idle bed ─────────────────────────────────────────────────────────────
   Before anything is playing there is no signal to analyse, so synthesise a
   slow breath instead. Three decorrelated noise channels at different rates so
   bass/mid/treble never move in lockstep — lockstep is exactly what makes an
   idle scene look like a looping screensaver rather than something alive. */

/** Deterministic 1-D value noise, smooth-stepped, returned in -1..1. */
function valueNoise1D(x: number) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const hash = (n: number) => {
    const s = Math.sin(n * 127.1) * 43758.5453123;
    return s - Math.floor(s);
  };
  return lerp(hash(i), hash(i + 1), u) * 2 - 1;
}

/* ── transient detection ──────────────────────────────────────────────── */
let bassEnvelope = 0;
let lastPunchAt = -10;

/** Minimum gap between camera punches, in seconds. */
export const PUNCH_COOLDOWN = 0.34;
/** Bass must exceed the slow envelope by this much to count as a hit. */
export const PUNCH_THRESHOLD = 0.12;

/** Time constants (ms). Attack is fast, release is slow. */
export const T_SPECTRUM_ATTACK = 22;
export const T_SPECTRUM_RELEASE = 120;
export const T_AMBIENT = 1100;
export const T_HUE = 620;
export const T_ENVELOPE = 520;
export const T_PUNCH_DECAY = 150;
export const T_TRANSIENT_DECAY = 90;

/** Mean of the eased, tilted spectrum across a slot range. */
function bandAverage(from: number, to: number) {
  let sum = 0;
  for (let i = from; i <= to; i++) sum += smoothedSpectrum[i];
  return sum / (to - from + 1);
}

/**
 * Advance the reactive bus by one frame.
 *
 * @param analyser live analyser, or null when the audio graph doesn't exist yet
 * @param bytes    reusable scratch buffer for `getByteFrequencyData`
 * @param dt       seconds since the previous frame
 */
export function updateReactive(
  analyser: AnalyserNode | null,
  bytes: FrequencyScratch | null,
  dt: number,
) {
  const s = reactive;
  s.clock += dt;
  const playing = s.mode === "playing" && analyser !== null && bytes !== null;

  /* 1. raw frequency bytes → log-mapped raw spectrum */
  if (playing) {
    analyser.getByteFrequencyData(bytes!);
    for (let i = 0; i < SPECTRUM_SIZE; i++) {
      const bin = SPECTRUM_BIN_MAP[i];
      // Take the max of the mapped bin and its neighbour: at low frequencies
      // the log map lands several slots on the same bin, which would otherwise
      // show up as visible banding in the particle field.
      const next = bin + 1 < BIN_COUNT ? bytes![bin + 1] : bytes![bin];
      rawSpectrum[i] = Math.min(1, (Math.max(bytes![bin], next) / 255) * SPECTRUM_TILT[i]);
    }
  } else {
    rawSpectrum.fill(0);
  }

  /* 2. ease the spectrum — this is what makes the field read as music */
  const aAttack = smoothing(T_SPECTRUM_ATTACK, dt);
  const aRelease = smoothing(T_SPECTRUM_RELEASE, dt);
  for (let i = 0; i < SPECTRUM_SIZE; i++) {
    const target = rawSpectrum[i];
    const cur = smoothedSpectrum[i];
    const next = cur + (target - cur) * (target > cur ? aAttack : aRelease);
    smoothedSpectrum[i] = next;
    spectrumBytes[i] = (next * 255) | 0;
  }

  /* 3. Bands are folded straight out of the spectrum that was just eased, with
        no second smoothing pass.

        That is deliberate: the bands and the texture the particle shader
        samples are then guaranteed to be the same data, and the attack/release
        asymmetry above (22 ms / 120 ms) is the only easing in the chain. Adding
        another stage here would double the lag on every kick. */
  easedBands.bass = bandAverage(0, 80);
  easedBands.lowMid = bandAverage(81, 120);
  easedBands.mid = bandAverage(121, 175);
  easedBands.highMid = bandAverage(176, 215);
  easedBands.treble = bandAverage(216, 255);

  /* 4. idle bed, crossfaded against the measured signal. Ambient motion is
        deliberately offset so the three bands never peak together. */
  s.ambient += (playing ? 0 - s.ambient : 1 - s.ambient) * smoothing(T_AMBIENT, dt);
  const t = s.clock;
  const idleBass = 0.145 + 0.075 * valueNoise1D(t * 0.23);
  const idleMid = 0.115 + 0.065 * valueNoise1D(t * 0.39 + 11.3);
  const idleTreble = 0.085 + 0.05 * valueNoise1D(t * 0.55 + 23.7);

  const midMeasured = (easedBands.lowMid + easedBands.mid + easedBands.highMid) / 3;
  s.bass = lerp(easedBands.bass, idleBass, s.ambient);
  s.mid = lerp(midMeasured, idleMid, s.ambient);
  s.treble = lerp(easedBands.treble, idleTreble, s.ambient);

  /* 5. overall amplitude → brightness, and treble intensity → hue.
        Hue is eased slowly on purpose: colour should drift with the track, not
        strobe with it. */
  s.level = lerp(s.bass * 0.5 + s.mid * 0.33 + s.treble * 0.17, 0.12, s.ambient);
  const targetHue = clamp01(0.5 + s.treble * 0.42 + s.level * 0.16);
  s.hue += (targetHue - s.hue) * smoothing(T_HUE, dt);

  /* 6. bass transient → throttled camera punch.
        The envelope lags well behind the signal, so a hard kick spikes the
        difference; the cooldown keeps a sustained 808 from firing every frame. */
  bassEnvelope += (easedBands.bass - bassEnvelope) * smoothing(T_ENVELOPE, dt);
  const excess = easedBands.bass - bassEnvelope;
  s.bassTransient *= Math.exp(-dt / (T_TRANSIENT_DECAY / 1000));
  if (playing && excess > PUNCH_THRESHOLD) {
    s.bassTransient = Math.min(1, excess / 0.3);
    if (t - lastPunchAt > PUNCH_COOLDOWN) {
      lastPunchAt = t;
      s.punch = Math.min(1, 0.5 + excess * 1.5);
    }
  }
  s.punch *= Math.exp(-dt / (T_PUNCH_DECAY / 1000));
}

/** Snap the bus back to a clean idle state. */
export function resetReactive() {
  reactive.mode = "idle";
  reactive.bass = 0;
  reactive.mid = 0;
  reactive.treble = 0;
  reactive.level = 0;
  reactive.bassTransient = 0;
  reactive.punch = 0;
  reactive.hue = 0.12;
  reactive.ambient = 1;
  smoothedSpectrum.fill(0);
  spectrumBytes.fill(0);
  easedBands.bass = 0;
  easedBands.lowMid = 0;
  easedBands.mid = 0;
  easedBands.highMid = 0;
  easedBands.treble = 0;
  bassEnvelope = 0;
  lastPunchAt = -10;
}
