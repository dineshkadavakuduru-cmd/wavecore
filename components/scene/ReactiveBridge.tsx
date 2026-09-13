"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useAudio } from "@/lib/audio/provider";
import { reactive, smoothedSpectrum, updateReactive } from "@/lib/audio/reactive";

/**
 * The single point where Web Audio data enters the render loop.
 *
 * This component must stay the *first* child inside <Canvas> so its useFrame
 * subscription runs before the ones that consume `reactive`. r3f runs
 * subscribers in mount order, and effects run child-first, so first child wins.
 * A frame of staleness would be invisible anyway — the values are already eased
 * over ~150 ms — but ordering it first makes the dataflow obvious.
 *
 * It also owns the FPS watchdog that drives the quality step-down.
 */

/** A frame delta above this is a stall (tab switch, GC), not real time passing. */
const MAX_DELTA = 1 / 20;

/** Write the CSS signal variables every N frames rather than every frame. */
const CSS_VAR_INTERVAL = 3;

/* ── fps watchdog ─────────────────────────────────────────────────────── */
const WARMUP_SECONDS = 3.5;
const WINDOW_SECONDS = 2.5;
/** Below this average over the window, drop a quality tier. */
const SLOW_FPS = 42;

type Props = {
  onSlowFps: () => void;
  /** When false, the watchdog is disabled (already at the lowest tier). */
  watchFps: boolean;
};

export function ReactiveBridge({ onSlowFps, watchFps }: Props) {
  const { engine } = useAudio();
  const frame = useRef(0);
  const stats = useRef({ elapsed: 0, frames: 0, warmed: 0 });

  // Development-only inspection seam. This is the same live object the whole
  // scene reads, so `__wavecore.bass` in the console is the actual number
  // driving the core — not a copy that could drift from it. Stripped from
  // production builds entirely.
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const seam = window as unknown as Record<string, unknown>;
    seam.__wavecore = reactive;
    // The eased spectrum the particle shader samples, exposed so the band
    // mapping can be inspected without instrumenting the shader.
    seam.__wavecoreSpectrum = smoothedSpectrum;
  }, []);

  useFrame((_, delta) => {
    // Clamp: a backgrounded tab produces a multi-second delta, which would push
    // every easing factor to ~1 and make the whole scene jump on return.
    const dt = Math.min(delta, MAX_DELTA);

    /* 1. the actual audio read — one analyser pass per frame */
    updateReactive(engine.analyser, engine.scratch, dt);

    /* 2. mirror the live hue onto the chrome as a CSS custom property.
          This is a raw style write, not a tween — Motion and anime.js have no
          business anywhere near the per-frame path. */
    frame.current += 1;
    if (frame.current % CSS_VAR_INTERVAL === 0) {
      const root = document.documentElement;
      const hue = (0.58 + reactive.hue * 0.3) % 1;
      const light = 0.52 + reactive.level * 0.22;
      const [r, g, b] = hslToRgb(hue, 0.62, Math.min(0.82, light));
      root.style.setProperty("--signal-rgb", `${r} ${g} ${b}`);
      root.style.setProperty("--signal-hue", String(Math.round(hue * 360)));
    }

    /* 3. fps watchdog — one-way street, one step-down per window */
    if (!watchFps) return;
    const s = stats.current;
    s.elapsed += dt;
    s.frames += 1;
    if (s.elapsed < WARMUP_SECONDS) return;
    if (s.elapsed - s.warmed < WINDOW_SECONDS) return;

    const fps = s.frames / (s.elapsed - s.warmed);
    s.warmed = s.elapsed;
    s.frames = 0;
    if (fps < SLOW_FPS) onSlowFps();
  });

  return null;
}

/** h in 0–1, s/l in 0–1 → 0–255 channels. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}
