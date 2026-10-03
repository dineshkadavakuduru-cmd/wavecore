#!/usr/bin/env node
/**
 * Wavecore demo-track generator.
 *
 * Renders the bundled demo tracks from scratch, offline, straight to 16-bit
 * PCM WAV in `public/tracks/`. Also generates OGG (Opus) compressed versions
 * for smaller bundle size. Nothing is sampled or downloaded, so the whole
 * pack is unambiguously royalty-free and reproducible from this file alone.
 *
 * The tracks are written specifically to exercise the visualiser: every one has
 * a deliberate intro with no kick drum (so the idle → playing reveal lands), a
 * hard sub-bass fundamental parked around 40-55 Hz (bass band), a busy
 * mid-register arp/pad layer (mid band), and dense hats/air (treble band).
 *
 *   node scripts/generate-tracks.mjs     # or: npm run gen:tracks
 */

import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";

if (ffmpegStatic) ffmpeg.setFfmpegPath(ffmpegStatic);

const SR = 44100;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "tracks");

const OGG_BITRATE = "128k"; // Opus ~128 kbps stereo — transparent for this material

const TWO_PI = Math.PI * 2;

/* ── deterministic noise ──────────────────────────────────────────────── */
let R = mulberry32(0x5eed);
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Bipolar white noise from the seeded generator. */
const nz = () => R() * 2 - 1;

/* ── music helpers ────────────────────────────────────────────────────── */
const hz = (midiNote) => 440 * Math.pow(2, (midiNote - 69) / 12);
const BAR = (bpm) => (4 * 60) / bpm;
const BEAT = (bpm) => 60 / bpm;

/** One-pole lowpass coefficient for a given cutoff. */
const lpCoef = (fc) => 1 - Math.exp((-TWO_PI * fc) / SR);

/**
 * Stereo render canvas: a dry stereo pair plus a mono reverb send bus.
 * Every voice writes into whichever buses it needs.
 */
class Canvas {
  constructor(seconds) {
    this.n = Math.ceil(seconds * SR);
    this.L = new Float32Array(this.n);
    this.R = new Float32Array(this.n);
    this.S = new Float32Array(this.n); // reverb send
  }
  add(i, l, r = l, send = 0) {
    if (i < 0 || i >= this.n) return;
    this.L[i] += l;
    this.R[i] += r;
    if (send) this.S[i] += send * (l + r) * 0.5;
  }
}

/** Evenly pans a mono sample across the dry pair. */
function pan(i, p) {
  const x = Math.max(-1, Math.min(1, p));
  return [Math.cos(((x + 1) * Math.PI) / 4), Math.sin(((x + 1) * Math.PI) / 4)];
}

/* ── voices ───────────────────────────────────────────────────────────── */

/**
 * Kick drum. Pitched sine with an exponential pitch envelope, plus a short
 * transient click. The `sub` term one octave down is what the analyser's bass
 * band actually latches onto, so it is deliberately not subtle.
 */
function kick(c, at, o = {}) {
  const {
    gain = 0.95,
    f0 = 155,
    f1 = 47,
    pitchTau = 0.038,
    ampTau = 0.3,
    len = 0.85,
    click = 0.32,
    sub = 0.42,
  } = o;
  const start = Math.floor(at * SR);
  const n = Math.floor(len * SR);
  let phase = 0;
  let lp = 0;
  const aClick = lpCoef(3200);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = f1 + (f0 - f1) * Math.exp(-t / pitchTau);
    phase += (TWO_PI * f) / SR;
    const amp = Math.exp(-t / ampTau) * (1 - Math.exp(-t / 0.0016));
    let s = Math.sin(phase) * amp + Math.sin(phase * 0.5) * amp * sub;
    if (click) {
      lp += aClick * (nz() - lp);
      s += lp * Math.exp(-t / 0.005) * click;
    }
    s = Math.tanh(s * 1.3) * 0.8 * gain;
    c.add(start + i, s, s);
  }
}

/** Sustained sub-bass note with optional pitch glide from another note. */
function subBass(c, at, dur, note, o = {}) {
  const {
    gain = 0.5,
    attack = 0.006,
    release = 0.14,
    glideFrom = null,
    saw = 0.2,
    send = 0,
  } = o;
  const start = Math.floor(at * SR);
  const n = Math.floor((dur + release) * SR);
  const f = hz(note);
  const f0 = glideFrom == null ? f : hz(glideFrom);
  let phase = 0;
  let lp = 0;
  const aLp = lpCoef(430);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const g = glideFrom == null ? f : f0 + (f - f0) * (1 - Math.exp(-t / 0.045));
    phase += (TWO_PI * g) / SR;
    const env =
      Math.min(1, t / attack) *
      (t > dur ? Math.max(0, 1 - (t - dur) / release) : 1);
    const sq = (2 * ((phase / TWO_PI) % 1) - 1) * saw;
    lp += aLp * (sq - lp);
    const s = (Math.sin(phase) * 0.88 + lp) * env * gain;
    c.add(start + i, s, s, send * env);
  }
}

/**
 * Detuned saw pad. `cutoff` is swept by a slow LFO so the pad keeps moving
 * and never sits on one static frequency — that movement is what gives the
 * scene's mid band something continuous to react to.
 */
function pad(c, at, dur, notes, o = {}) {
  const {
    gain = 0.16,
    attack = 1.4,
    release = 2.4,
    cutoff = 900,
    lfoRate = 0.06,
    lfoDepth = 0.45,
    detune = 0.0016,
    send = 0.5,
  } = o;
  const start = Math.floor(at * SR);
  const n = Math.floor((dur + release) * SR);
  const voices = [];
  for (const nn of notes) {
    for (let d = -1; d <= 1; d++) {
      voices.push({ f: hz(nn) * (1 + d * detune), p: R() * TWO_PI, pan: d * 0.55 });
    }
  }
  let lpL = 0;
  let lpR = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env =
      Math.min(1, t / attack) *
      (t > dur ? Math.max(0, 1 - (t - dur) / release) : 1);
    let l = 0;
    let r = 0;
    for (const v of voices) {
      v.p += (TWO_PI * v.f) / SR;
      const s = (2 * ((v.p / TWO_PI) % 1) - 1) * 0.5;
      l += s * (0.5 - v.pan * 0.5);
      r += s * (0.5 + v.pan * 0.5);
    }
    const norm = 0.6 / voices.length;
    l *= norm;
    r *= norm;
    const fc = cutoff * (1 - lfoDepth + lfoDepth * (1 + Math.sin(TWO_PI * lfoRate * t)));
    const a = lpCoef(fc);
    lpL += a * (l - lpL);
    lpR += a * (r - lpR);
    const g = env * gain;
    c.add(start + i, lpL * g, lpR * g, send * env);
  }
}

/** Filtered noise hit — hats, snares, claps, risers. */
function noiseHit(c, at, o = {}) {
  const {
    dur = 0.07,
    gain = 0.16,
    hp = 7500,
    lp = 16000,
    ampTau = 0.022,
    pan: p = 0,
    tone = 0,
    toneHz = 190,
    send = 0,
  } = o;
  const start = Math.floor(at * SR);
  const n = Math.floor(dur * SR);
  const [gl, gr] = pan(0, p);
  const aHp = lpCoef(hp);
  const aLp = lpCoef(lp);
  let lpState = 0;
  let bpState = 0;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t / ampTau) * (1 - Math.exp(-t / 0.0008));
    const x = nz();
    lpState += aHp * (x - lpState);
    const hpSig = x - lpState; // one-pole highpass
    bpState += aLp * (hpSig - bpState);
    let s = bpState * env * gain;
    if (tone) {
      phase += (TWO_PI * toneHz) / SR;
      s += Math.sin(phase) * env * gain * tone;
    }
    c.add(start + i, s * gl, s * gr, send * env);
  }
}

/**
 * Karplus-Strong pluck. Cheap, and it sounds like a real string rather than
 * a synth blip — which matters because these arps are the main mid-band
 * content the morphing core reacts to.
 */
function pluck(c, at, note, o = {}) {
  const { gain = 0.24, damp = 0.5, dur = 1.1, pan: p = 0, send = 0.35, bright = 0.55 } = o;
  const f = hz(note);
  const N = Math.max(2, Math.round(SR / f));
  const ring = new Float32Array(N);
  for (let i = 0; i < N; i++) ring[i] = nz();
  const start = Math.floor(at * SR);
  const n = Math.floor(dur * SR);
  const [gl, gr] = pan(0, p);
  let idx = 0;
  let prev = 0;
  let lp = 0;
  const aLp = lpCoef(1200 + 5200 * bright);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const cur = ring[idx];
    const avg = (cur + prev) * 0.5 * damp;
    ring[idx] = avg;
    prev = cur;
    idx = (idx + 1) % N;
    // gentle lowpass so the noise burst decays into a warm tone
    lp += aLp * (cur - lp);
    const env = Math.min(1, t / 0.002) * Math.exp(-t / (dur * 0.45));
    const s = lp * env * gain;
    c.add(start + i, s * gl, s * gr, send * env);
  }
}

/** Bandpass-noise riser / downlifter used on transitions. */
function sweep(c, at, dur, o = {}) {
  const { gain = 0.16, from = 300, to = 8000, up = true, send = 0.4 } = o;
  const start = Math.floor(at * SR);
  const n = Math.floor(dur * SR);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const k = t / dur;
    const fc = from * Math.pow(to / from, up ? k : 1 - k);
    const a = lpCoef(fc);
    lp += a * (nz() - lp);
    const env = up ? Math.pow(k, 1.6) : Math.pow(1 - k, 1.6);
    const s = lp * env * gain;
    c.add(start + i, s, s, send * env);
  }
}

/* ── reverb ───────────────────────────────────────────────────────────── */

/**
 * Schroeder reverb: four parallel combs into two series allpasses, run once
 * per channel with slightly different delay lengths for stereo width.
 */
function reverb(send, { decay = 0.82, mix = 0.4, damp = 0.35 } = {}) {
  const combs = [29.7, 37.1, 41.1, 43.7];
  const allpass = [
    { ms: 5.0, g: 0.7 },
    { ms: 1.7, g: 0.7 },
  ];
  const n = send.length;
  const outL = new Float32Array(n);
  const outR = new Float32Array(n);

  for (const [ch, out, skew] of [
    [0, outL, 1],
    [1, outR, 1.037],
  ]) {
    const lines = combs.map((ms) => ({
      buf: new Float32Array(Math.max(1, Math.round((ms * skew * SR) / 1000))),
      idx: 0,
      lp: 0,
    }));
    let wet = 0;
    for (let i = 0; i < n; i++) {
      const x = send[i];
      let acc = 0;
      for (const l of lines) {
        const y = l.buf[l.idx];
        l.lp += damp * (y - l.lp);
        l.buf[l.idx] = x + l.lp * decay;
        l.idx = (l.idx + 1) % l.buf.length;
        acc += y;
      }
      wet = acc / lines.length;
      for (const ap of allpass) {
        if (!ap._buf) {
          ap._buf = new Float32Array(Math.max(1, Math.round((ap.ms * skew * SR) / 1000)));
          ap._idx = 0;
        }
        const buf = ap._buf;
        const y = buf[ap._idx];
        const v = wet + y * ap.g * -1;
        buf[ap._idx] = v;
        ap._idx = (ap._idx + 1) % buf.length;
        wet = y + v * ap.g;
      }
      out[i] = wet * mix * (ch === 0 ? 1 : 0.94);
    }
    for (const ap of allpass) {
      delete ap._buf;
      delete ap._idx;
    }
  }
  return { outL, outR };
}

/* ── master ───────────────────────────────────────────────────────────── */

/** Mixes dry + wet, soft-clips, and normalises to a fixed peak. */
function master(c, o = {}) {
  const { reverbMix = 0.34, peak = 0.94, fadeOut = 2.0, trim = 1 } = o;
  const wet = reverb(c.S, { mix: 0.5, decay: 0.84 });
  const n = c.n;
  const fadeSamples = Math.floor(fadeOut * SR);
  let max = 1e-6;
  for (let i = 0; i < n; i++) {
    const fade = i > n - fadeSamples ? Math.max(0, (n - i) / fadeSamples) : 1;
    const l = Math.tanh((c.L[i] * trim + wet.outL[i] * reverbMix) * 1.05) * fade;
    const r = Math.tanh((c.R[i] * trim + wet.outR[i] * reverbMix) * 1.05) * fade;
    c.L[i] = l;
    c.R[i] = r;
    const a = Math.max(Math.abs(l), Math.abs(r));
    if (a > max) max = a;
  }
  const g = peak / max;
  for (let i = 0; i < n; i++) {
    c.L[i] *= g;
    c.R[i] *= g;
  }
  return { L: c.L, R: c.R, duration: n / SR };
}

/* ── arrangements ─────────────────────────────────────────────────────── */

/** 124 BPM F-minor techno. 20 bars ≈ 39 s. */
function renderSubsurface() {
  R = mulberry32(1013);
  const bpm = 124;
  const bar = BAR(bpm);
  const beat = BEAT(bpm);
  const bars = 20;
  const c = new Canvas(bars * bar + 3);

  const F1 = 29; // F1
  const roots = [F1, F1, F1, F1, 27 /*D#*/, 32 /*G#*/, 24 /*C*/, 29]; // 8-bar progression
  const CH = [
    [53, 56, 60, 63], // Fm
    [51, 55, 58, 62], // D#maj
    [56, 60, 63, 68], // G#maj
    [53, 56, 60, 63],
  ];

  // ── pads: run almost the whole track, quiet under the drums
  for (let b = 0; b < bars; b += 2) {
    const ch = CH[(b >> 1) % CH.length];
    pad(c, b * bar, bar * 2 * 0.98, ch, {
      gain: b < 4 ? 0.2 : 0.13,
      attack: b < 4 ? 2.2 : 1.1,
      release: 1.6,
      cutoff: 750,
      send: 0.6,
    });
  }

  // ── drums
  for (let b = 4; b < bars; b++) {
    const isBreak = b === 14 || b === 15;
    if (!isBreak) {
      for (let k = 0; k < 4; k++) {
        kick(c, b * bar + k * beat, {
          gain: b < 8 ? 0.85 : 1.0,
          f1: 46,
          ampTau: b < 8 ? 0.26 : 0.32,
        });
      }
      // off-beat open hat from the main section onward
      if (b >= 8) {
        noiseHit(c, b * bar + beat * 2.5, { dur: 0.24, gain: 0.1, hp: 6500, ampTau: 0.09, pan: 0.35 });
      }
    }
    // closed hats — 8ths in the build, 16ths in the main sections
    const div = b < 8 ? 2 : 4;
    for (let k = 0; k < 4 * div; k++) {
      const t = b * bar + (k * beat) / div;
      noiseHit(c, t, {
        dur: 0.045,
        gain: k % div === 0 ? 0.085 : 0.05,
        hp: 8200,
        ampTau: 0.014,
        pan: k % 2 ? 0.22 : -0.22,
        send: 0.25,
      });
    }
    // clap on 2 and 4 once the track is full
    if (b >= 8 && !isBreak) {
      for (const k of [1, 3]) {
        noiseHit(c, b * bar + k * beat, { dur: 0.2, gain: 0.2, hp: 1400, lp: 5200, ampTau: 0.055, tone: 0.35, toneHz: 195 });
      }
    }
    if (isBreak) {
      noiseHit(c, b * bar, { dur: 0.35, gain: 0.16, hp: 1200, lp: 6000, ampTau: 0.1 });
    }
  }

  // ── bass
  for (let b = 4; b < bars; b++) {
    if (b === 14 || b === 15) continue;
    const root = roots[(b - 4) % roots.length];
    for (let k = 0; k < 4; k++) {
      const off = k % 2 === 1 ? 7 : 0;
      subBass(c, b * bar + k * beat, beat * 0.62, root + off, {
        gain: 0.5,
        glideFrom: root + off - 5,
        saw: b >= 8 ? 0.26 : 0.16,
      });
    }
  }

  // ── arp: 16ths from bar 8, sparse in the break
  for (let b = 8; b < bars; b++) {
    const ch = CH[(b >> 1) % CH.length];
    const steps = b === 14 || b === 15 ? 4 : 8;
    for (let k = 0; k < steps; k++) {
      const t = b * bar + (k * (bar / steps));
      const note = ch[(k * 3 + b) % ch.length] + 12;
      pluck(c, t, note, {
        gain: 0.2,
        damp: 0.55,
        dur: 0.7,
        pan: Math.sin(k * 1.7 + b) * 0.7,
        send: 0.5,
      });
    }
  }

  // ── transitions
  sweep(c, 6 * bar + beat * 2, bar * 2, { gain: 0.14, from: 400, to: 7000, up: true });
  sweep(c, 14 * bar, bar, { gain: 0.12, from: 6000, to: 400, up: false });
  sweep(c, 15 * bar, bar, { gain: 0.15, from: 300, to: 9000, up: true });
  // accent hit into the drop
  kick(c, 16 * bar, { gain: 1.1, ampTau: 0.42, f1: 44 });

  return master(c, { trim: 0.95, fadeOut: 2.2 });
}

/** 84 BPM D-dorian downtempo. 14 bars ≈ 40 s. */
function renderIonDrift() {
  R = mulberry32(2027);
  const bpm = 84;
  const bar = BAR(bpm);
  const beat = BEAT(bpm);
  const bars = 14;
  const c = new Canvas(bars * bar + 4);

  const D1 = 26;
  const CH = [
    [50, 53, 57, 60], // Dm
    [55, 58, 62, 65], // Gm
    [52, 55, 59, 62], // Em
    [48, 52, 55, 59], // C
  ];
  const roots = [D1, 31 /*G1*/, 28 /*E1*/, 24 /*C1*/];

  for (let b = 0; b < bars; b += 1) {
    const ch = CH[Math.floor(b / 3.5) % CH.length];
    pad(c, b * bar, bar * 1.6, ch, {
      gain: b < 3 ? 0.22 : 0.15,
      attack: b < 3 ? 3.0 : 1.6,
      release: 2.6,
      cutoff: 620,
      lfoRate: 0.045,
      send: 0.75,
    });
  }

  // sparse kick from bar 4 — the intro is intentionally beatless
  for (let b = 4; b < bars; b++) {
    kick(c, b * bar, { gain: 0.9, f1: 43, ampTau: 0.4, pitchTau: 0.05 });
    if (b >= 8) kick(c, b * bar + beat * 2.5, { gain: 0.6, f1: 44, ampTau: 0.3 });
    if (b >= 8) {
      for (let k = 0; k < 8; k++) {
        noiseHit(c, b * bar + (k * beat) / 2, {
          dur: 0.06,
          gain: k % 2 ? 0.035 : 0.065,
          hp: 9000,
          ampTau: 0.02,
          pan: k % 2 ? -0.3 : 0.3,
          send: 0.4,
        });
      }
    }
    // rim/clap backbeat
    if (b >= 9) {
      noiseHit(c, b * bar + beat * 2, { dur: 0.28, gain: 0.14, hp: 1100, lp: 4200, ampTau: 0.07, tone: 0.4, toneHz: 170 });
    }
  }

  // sub swells
  for (let b = 4; b < bars; b++) {
    const root = roots[b % roots.length];
    subBass(c, b * bar, beat * 1.7, root, { gain: 0.46, attack: 0.09, release: 0.4, saw: 0.1, send: 0.2 });
    subBass(c, b * bar + beat * 2, beat * 1.5, root + 7, { gain: 0.34, attack: 0.05, release: 0.35, saw: 0.08 });
  }

  // melodic plucks — the mid-band interest
  const mel = [74, 72, 69, 72, 75, 74, 69, 67];
  for (let b = 3; b < bars - 1; b++) {
    const count = b < 6 ? 3 : 5;
    for (let k = 0; k < count; k++) {
      const t = b * bar + (k * bar) / count + (R() - 0.5) * 0.05;
      const note = mel[(b * 3 + k) % mel.length] - (b < 6 ? 12 : 0);
      pluck(c, t, note, {
        gain: 0.19,
        damp: 0.5,
        dur: 1.6,
        pan: (R() - 0.5) * 1.3,
        send: 0.65,
        bright: 0.4,
      });
    }
  }

  sweep(c, 11 * bar, bar * 2, { gain: 0.1, from: 500, to: 6000, up: true });
  return master(c, { trim: 0.95, fadeOut: 3.0, reverbMix: 0.42 });
}

/** 146 BPM A-minor breakbeat. 24 bars ≈ 39 s. */
function renderChromagrid() {
  R = mulberry32(3041);
  const bpm = 146;
  const bar = BAR(bpm);
  const beat = BEAT(bpm);
  const bars = 24;
  const c = new Canvas(bars * bar + 3);

  const A1 = 33;
  const CH = [
    [57, 60, 64, 67], // Am
    [55, 59, 62, 65], // G
    [53, 57, 60, 64], // F
    [52, 55, 59, 62], // Em
  ];
  const roots = [A1, 31 /*G1*/, 29 /*F1*/, 28 /*E1*/];

  for (let b = 0; b < bars; b += 2) {
    const ch = CH[(b >> 1) % CH.length];
    pad(c, b * bar, bar * 1.9, ch, {
      gain: b < 4 ? 0.1 : 0.14,
      attack: b < 4 ? 2.0 : 1.2,
      release: 1.8,
      cutoff: 950,
      send: 0.5,
    });
  }

  for (let b = 4; b < bars; b++) {
    const isBreak = b >= 16 && b < 20;
    if (!isBreak) {
      // 4-on-floor spine with a syncopated ghost kick
      for (let k = 0; k < 4; k++) {
        kick(c, b * bar + k * beat, { gain: 1.0, f1: 48, ampTau: 0.3 });
      }
      kick(c, b * bar + beat * 3.75, { gain: 0.5, f1: 50, ampTau: 0.16, sub: 0.3 });
      for (const k of [1, 3]) {
        noiseHit(c, b * bar + k * beat, { dur: 0.22, gain: 0.22, hp: 1300, lp: 5600, ampTau: 0.06, tone: 0.32, toneHz: 205 });
      }
    } else {
      kick(c, b * bar, { gain: 0.95, f1: 44, ampTau: 0.45 });
    }
    const div = b < 8 ? 2 : 4;
    for (let k = 0; k < 4 * div; k++) {
      const t = b * bar + (k * beat) / div;
      const accent = k % 4 === 2;
      noiseHit(c, t, {
        dur: accent && b >= 8 ? 0.16 : 0.04,
        gain: accent && b >= 8 ? 0.09 : k % div === 0 ? 0.075 : 0.045,
        hp: 8600,
        ampTau: accent && b >= 8 ? 0.06 : 0.013,
        pan: k % 2 ? -0.28 : 0.28,
        send: 0.3,
      });
    }
  }

  // driving 8th-note bass with octave jumps
  for (let b = 4; b < bars; b++) {
    const root = roots[b % roots.length];
    for (let k = 0; k < 8; k++) {
      const oct = k % 4 === 3 ? 12 : 0;
      subBass(c, b * bar + (k * beat) / 2, beat * 0.36, root + oct, {
        gain: 0.44,
        attack: 0.004,
        release: 0.09,
        saw: 0.3,
      });
    }
  }

  // dense arp — the main mid-band driver
  for (let b = 3; b < bars; b++) {
    const ch = CH[(b >> 1) % CH.length];
    const steps = b < 8 ? 4 : 8;
    for (let k = 0; k < steps; k++) {
      const t = b * bar + (k * bar) / steps;
      const note = ch[(k * 5 + (b % 3)) % ch.length] + (k % 2 ? 12 : 24);
      pluck(c, t, note, {
        gain: 0.16,
        damp: 0.58,
        dur: 0.45,
        pan: Math.sin(k * 2.1 + b * 0.6) * 0.8,
        send: 0.45,
        bright: 0.7,
      });
    }
  }

  sweep(c, 7 * bar, bar, { gain: 0.12, from: 500, to: 9000, up: true });
  sweep(c, 15 * bar, bar, { gain: 0.13, from: 400, to: 8000, up: true });
  sweep(c, 18 * bar, bar * 2, { gain: 0.14, from: 350, to: 9500, up: true });
  kick(c, 20 * bar, { gain: 1.15, ampTau: 0.5, f1: 42 });

  return master(c, { trim: 0.9, fadeOut: 2.0 });
}

/* ── wav writer ───────────────────────────────────────────────────────── */

const clamp16 = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));

function writeWav(file, L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(2, 22); // stereo
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); // byte rate
  buf.writeUInt16LE(4, 32); // block align
  buf.writeUInt16LE(16, 34); // bits
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(clamp16(L[i]), o);
    o += 2;
    buf.writeInt16LE(clamp16(R[i]), o);
    o += 2;
  }
  writeFileSync(file, buf);
  return buf.length;
}

/* ── ogg conversion ───────────────────────────────────────────────────── */

/** Convert a WAV file to OGG (Opus) using ffmpeg. Returns the output file size. */
function convertToOgg(wavFile, oggFile) {
  return new Promise((resolve, reject) => {
    const cmd = ffmpeg(wavFile)
      .outputOptions([
        "-c:a", "libopus",
        "-b:a", OGG_BITRATE,
        "-vbr", "on",
        "-compression_level", "10",
        "-application", "audio",
      ])
      .on("end", () => {
        const stats = existsSync(oggFile) ? statSync(oggFile) : null;
        resolve(stats?.size ?? 0);
      })
      .on("error", (err) => reject(err))
      .save(oggFile);
    // Ensure the command is actually started
    cmd.run();
  });
}

/* ── run ──────────────────────────────────────────────────────────────── */

const TRACKS = [
  {
    slug: "subsurface",
    title: "Subsurface",
    artist: "Wavecore System",
    bpm: 124,
    key: "F minor",
    mood: "Peak-time techno · tight 4/4 · sub-heavy",
    render: renderSubsurface,
  },
  {
    slug: "ion-drift",
    title: "Ion Drift",
    artist: "Wavecore System",
    bpm: 84,
    key: "D dorian",
    mood: "Beatless intro · downtempo · wide pads",
    render: renderIonDrift,
  },
  {
    slug: "chromagrid",
    title: "Chromagrid",
    artist: "Wavecore System",
    bpm: 146,
    key: "A minor",
    mood: "Breakbeat · dense arps · brightest highs",
    render: renderChromagrid,
  },
];

mkdirSync(OUT_DIR, { recursive: true });

const manifest = [];
for (const t of TRACKS) {
  const started = Date.now();
  const { L, R: right, duration } = t.render();
  const wavFile = join(OUT_DIR, `${t.slug}.wav`);
  const wavBytes = writeWav(wavFile, L, right);

  // Convert to OGG (Opus) for smaller delivery size
  const oggFile = join(OUT_DIR, `${t.slug}.ogg`);
  const oggBytes = await convertToOgg(wavFile, oggFile);

  manifest.push({
    slug: t.slug,
    title: t.title,
    artist: t.artist,
    bpm: t.bpm,
    key: t.key,
    mood: t.mood,
    src: `/tracks/${t.slug}.ogg`,       // primary: compressed
    srcFallback: `/tracks/${t.slug}.wav`, // fallback: uncompressed
    duration: Math.round(duration * 10) / 10,
  });
  console.log(
    `  ✓ ${t.slug}.wav  ${duration.toFixed(1)}s  ${(wavBytes / 1048576).toFixed(1)} MB  →  ${t.slug}.ogg  ${(oggBytes / 1048576).toFixed(1)} MB  (${Date.now() - started}ms)`,
  );
}

// Typed manifest consumed by the app — keeps the UI in sync with what was actually rendered.
const ts = `// AUTO-GENERATED by scripts/generate-tracks.mjs — do not edit by hand.
// Run \`npm run gen:tracks\` to regenerate the WAVs and this manifest together.

export type DemoTrack = {
  slug: string;
  title: string;
  artist: string;
  bpm: number;
  key: string;
  mood: string;
  src: string;         // primary (compressed OGG)
  srcFallback: string; // fallback (WAV)
  /** Seconds. */
  duration: number;
};

export const DEMO_TRACKS: DemoTrack[] = ${JSON.stringify(manifest, null, 2)};
`;
writeFileSync(join(ROOT, "lib", "demo-tracks.generated.ts"), ts);
console.log(`\nwrote ${manifest.length} tracks → public/tracks/ + lib/demo-tracks.generated.ts`);
