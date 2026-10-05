/**
 * The audio engine.
 *
 * Owns the entire Web Audio graph and exposes the raw AnalyserNode to the
 * render loop. Nothing in this file knows or cares about React.
 *
 *   ┌─ HTMLAudioElement ──┐
 *   │  (bundled tracks)   ├─► MediaElementSource ─┐
 *   └─────────────────────┘                       ├─► inputGain ─► analyser ─► volumeGain ─► out
 *   ┌─ AudioBufferSource ─┐                       │
 *   │  (uploads)          └──────────────────────-┘
 *   └─ decoded via decodeAudioData
 *
 * The analyser is tapped *before* the volume gain on purpose: pulling the
 * fader down shouldn't calm the visuals, and muting shouldn't kill them. For a
 * piece whose whole job is to be recorded, that is the behaviour you want.
 *
 * Two source types exist because they genuinely have different jobs:
 *   • bundled tracks stream through an <audio> element — no 7 MB decode on boot
 *   • uploads are fully decoded to an AudioBuffer, which gives an exact
 *     duration up front, a real waveform overview, and true sample-accurate
 *     seeking (respawn the source node at a new offset)
 */

import type { DemoTrack } from "@/lib/demo-tracks.generated";
import { clamp01 } from "@/lib/utils";
import {
  BIN_COUNT,
  FFT_SIZE,
  type FrequencyScratch,
  reactive,
} from "./reactive";

/** Shape both playable implementations satisfy. */
interface Playable {
  readonly duration: number;
  readonly currentTime: number;
  readonly isPlaying: boolean;
  play(): Promise<void>;
  pause(): void;
  seek(time: number): void;
  destroy(): void;
}

/* ── bundled tracks: streamed through a single reusable <audio> element ─── */

class ElementPlayable implements Playable {
  private loadedSrc: string | null = null;
  private fallbackDuration: number;
  private fallbackSrc: string | null = null;
  private fallbackAttempted = false;

  constructor(
    private el: HTMLAudioElement,
    private onEnded: () => void,
    private onMeta: () => void,
    fallbackDuration = 0,
  ) {
    this.fallbackDuration = fallbackDuration;
    this.el.addEventListener("ended", this.handleEnded);
    this.el.addEventListener("loadedmetadata", this.handleMeta);
    this.el.addEventListener("error", this.handleError);
  }

  private handleEnded = () => {
    if (this.el.currentTime > 0) this.onEnded();
  };

  private handleMeta = () => {
    if (Number.isFinite(this.el.duration) && this.el.duration > 0) {
      this.fallbackDuration = this.el.duration;
    }
    this.onMeta();
  };

  /** Handle load errors — if primary (compressed) fails, try fallback (WAV). */
  private handleError = () => {
    if (this.fallbackSrc && !this.fallbackAttempted) {
      this.fallbackAttempted = true;
      // Switch to fallback source
      this.el.src = this.fallbackSrc;
      this.el.load();
    }
  };

  /**
   * Load a track with optional fallback.
   * @param src Primary source (compressed format, e.g., OGG)
   * @param fallbackSrc Fallback source (uncompressed, e.g., WAV)
   * @param knownDuration Manifest duration for immediate scrubber
   */
  load(src: string, fallbackSrc: string | null = null, knownDuration = 0) {
    this.fallbackSrc = fallbackSrc;
    this.fallbackAttempted = false;
    if (src !== this.loadedSrc) {
      this.loadedSrc = src;
      this.el.src = src;
    }
    if (knownDuration > 0) this.fallbackDuration = knownDuration;
  }

  /**
   * Resolves once the element has enough data to start, or when it errors, or
   * after a timeout. Never rejects — a failure here is reported by `play()`
   * itself, so this only exists to avoid the abort race below.
   */
  private whenReady(timeoutMs = 5000): Promise<void> {
    if (this.el.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const cleanup = () => {
        this.el.removeEventListener("canplay", done);
        this.el.removeEventListener("error", done);
        window.clearTimeout(timer);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const timer = window.setTimeout(done, timeoutMs);
      this.el.addEventListener("canplay", done);
      this.el.addEventListener("error", done);
    });
  }

  get duration() {
    const d = this.el.duration;
    return Number.isFinite(d) && d > 0 ? d : this.fallbackDuration;
  }

  get currentTime() {
    return this.el.currentTime;
  }

  get isPlaying() {
    return !this.el.paused && !this.el.ended;
  }

  async play() {
    await this.whenReady();
    try {
      await this.el.play();
    } catch (err) {
      // If something interrupted the request (the element was still settling on
      // a new source), one patient retry is almost always enough. Anything else
      // — a real autoplay block, say — must surface to the caller.
      if (err instanceof DOMException && err.name === "AbortError") {
        await this.whenReady(1500);
        await this.el.play();
        return;
      }
      throw err;
    }
  }

  pause() {
    this.el.pause();
  }

  seek(time: number) {
    if (Number.isFinite(this.duration)) {
      this.el.currentTime = Math.max(0, Math.min(time, this.duration - 0.02));
    }
  }

  /**
   * Stops this playable without tearing down the shared element — the element
   * and its MediaElementAudioSourceNode outlive every track, and a
   * MediaElementSource can only ever be created once per element.
   */
  destroy() {
    this.loadedSrc = null;
    this.el.pause();
    this.el.removeAttribute("src");
    this.el.load();
  }

  /** Full teardown, only used when the engine itself is disposed. */
  dispose() {
    this.el.removeEventListener("ended", this.handleEnded);
    this.el.removeEventListener("loadedmetadata", this.handleMeta);
    this.destroy();
  }
}

/* ── uploads: fully decoded AudioBuffer, sample-accurate seek ────────────── */

class BufferPlayable implements Playable {
  private node: AudioBufferSourceNode | null = null;
  private offset = 0;
  private startedAtCtxTime = 0;
  /** Bumped on every manual stop so stale `onended` callbacks are ignored. */
  private generation = 0;

  constructor(
    private ctx: AudioContext,
    private buffer: AudioBuffer,
    private destination: AudioNode,
    private onEnded: () => void,
  ) {}

  get duration() {
    return this.buffer.duration;
  }

  get currentTime() {
    if (!this.isPlaying) return this.offset;
    const elapsed = this.ctx.currentTime - this.startedAtCtxTime;
    return Math.min(this.duration, this.offset + elapsed);
  }

  get isPlaying() {
    return this.node !== null;
  }

  private spawn() {
    const gen = this.generation;
    const node = this.ctx.createBufferSource();
    node.buffer = this.buffer;
    node.connect(this.destination);
    node.onended = () => {
      // A manual stop bumps `generation` before disconnecting, so if the
      // counters disagree this callback is stale and must be ignored.
      if (gen !== this.generation) return;
      this.node = null;
      this.offset = 0;
      this.onEnded();
    };
    node.start(0, this.offset);
    this.startedAtCtxTime = this.ctx.currentTime;
    this.node = node;
  }

  private stop() {
    if (!this.node) return;
    this.generation += 1;
    try {
      this.node.stop();
    } catch {
      /* already stopped */
    }
    this.node.disconnect();
    this.node = null;
  }

  async play() {
    if (this.node) return;
    if (this.offset >= this.duration - 0.01) this.offset = 0;
    this.spawn();
  }

  pause() {
    if (!this.node) return;
    this.offset = this.currentTime;
    this.stop();
  }

  seek(time: number) {
    const wasPlaying = this.isPlaying;
    this.offset = Math.max(0, Math.min(time, this.duration - 0.01));
    if (wasPlaying) {
      this.stop();
      this.spawn();
    }
  }

  destroy() {
    this.generation += 1;
    this.stop();
  }
}

/* ── upload decoding ──────────────────────────────────────────────────── */

export type UploadResult = {
  name: string;
  buffer: AudioBuffer;
  /** Normalised peak envelope for the scrubber, 0–1. */
  peaks: Float32Array;
  duration: number;
};

export type DecodeHandlers = {
  /** Bytes read off disk, 0–1. Real, driven by FileReader progress. */
  onReadProgress?: (fraction: number) => void;
  /** Decoding started — no progress events exist for decodeAudioData. */
  onDecodeStart?: () => void;
};

/**
 * Reads a file with genuine progress, then decodes it.
 *
 * `decodeAudioData` is opaque — it reports nothing while it works. Rather than
 * fake a progress bar, the read phase is measured for real (FileReader gives
 * per-chunk progress) and the decode phase is surfaced honestly as an
 * indeterminate step. For a 50 MB WAV the read is the slow part anyway.
 */
async function decodeFile(
  ctx: AudioContext,
  file: File,
  handlers: DecodeHandlers,
): Promise<UploadResult> {
  const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e.lengthComputable) handlers.onReadProgress?.(e.loaded / e.total);
    };
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsArrayBuffer(file);
  });

  handlers.onReadProgress?.(1);
  handlers.onDecodeStart?.();

  const buffer = await ctx.decodeAudioData(arrayBuffer);
  return {
    name: file.name,
    buffer,
    peaks: computePeaks(buffer),
    duration: buffer.duration,
  };
}

/** Peak envelope, mirrored from channel 0 (or the average of L/R when stereo). */
function computePeaks(buffer: AudioBuffer, buckets = 480): Float32Array {
  const peaks = new Float32Array(buckets);
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
  const step = Math.max(1, Math.floor(left.length / buckets));
  for (let b = 0; b < buckets; b++) {
    const from = b * step;
    const to = Math.min(left.length, from + step);
    let max = 0;
    for (let i = from; i < to; i++) {
      const v = right ? (Math.abs(left[i]) + Math.abs(right[i])) * 0.5 : Math.abs(left[i]);
      if (v > max) max = v;
    }
    peaks[b] = max;
  }
  // normalise so quiet uploads still render a legible waveform
  let peak = 0;
  for (let i = 0; i < buckets; i++) if (peaks[i] > peak) peak = peaks[i];
  if (peak > 0) for (let i = 0; i < buckets; i++) peaks[i] = clamp01(peaks[i] / peak);
  return peaks;
}

/* ── the engine ───────────────────────────────────────────────────────── */

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private inputGain: GainNode | null = null;
  private volumeGain: GainNode | null = null;

  private element: HTMLAudioElement | null = null;
  private elementSource: MediaElementAudioSourceNode | null = null;
  private elementPlayable: ElementPlayable | null = null;

  private playable: Playable | null = null;
  private volume = 0.8;

  /* ── microphone state ──────────────────────────────────────────────────
     The mic deliberately gets a different route from playback: its source
     connects straight into the analyser, and the analyser's own output link
     to the speakers is severed for as long as the mic is live. Routing the
     mic through inputGain would sum it with the music bus and, worse, feed
     it straight back out of the speakers — an instant feedback howl. */
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private micGain: GainNode | null = null;
  /** Whether the analyser is currently wired through to the speakers. */
  private analyserRouted = false;

  /** Scratch buffer for `getByteFrequencyData`, allocated once. */
  scratch: FrequencyScratch | null = null;

  /** True once the graph exists. False means no user gesture has happened yet. */
  get isReady() {
    return this.ctx !== null;
  }

  get analyser() {
    return this.analyserNode;
  }

  get context() {
    return this.ctx;
  }

  /**
   * Builds the graph. Safe to call repeatedly. Called from a user gesture the
   * first time (play / file select) so the AudioContext starts running rather
   * than suspended.
   */
  ensureGraph(): AudioContext {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return this.ctx;
    }

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: "interactive" });

    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    // Light built-in averaging; the real easing happens in updateReactive, and
    // keeping this low is what lets kick transients survive to the punch trigger.
    analyser.smoothingTimeConstant = 0.55;
    // Widen the dB window from the default −100..−30, which clamps loud music
    // to 255 across most of the spectrum and flattens the whole reading.
    analyser.minDecibels = -88;
    analyser.maxDecibels = -14;

    const inputGain = ctx.createGain();
    inputGain.gain.value = 1;

    const volumeGain = ctx.createGain();
    volumeGain.gain.value = this.volumeToGain(this.volume);

    inputGain.connect(analyser);
    analyser.connect(volumeGain);
    volumeGain.connect(ctx.destination);
    this.analyserRouted = true;

    this.ctx = ctx;
    this.analyserNode = analyser;
    this.inputGain = inputGain;
    this.volumeGain = volumeGain;
    this.scratch = new Uint8Array(BIN_COUNT) as FrequencyScratch;

    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  }

  /** Perceptual volume curve — a linear gain fader feels dead at the bottom. */
  private volumeToGain(v: number) {
    return Math.pow(clamp01(v), 1.7);
  }

  getVolume() {
    return this.volume;
  }

  setVolume(v: number) {
    this.volume = clamp01(v);
    if (this.volumeGain && this.ctx) {
      // short ramp instead of an instant jump, to avoid zipper noise
      this.volumeGain.gain.setTargetAtTime(
        this.volumeToGain(this.volume),
        this.ctx.currentTime,
        0.015,
      );
    }
  }

  /** The one reusable element used for every bundled track. */
  private ensureElement(ctx: AudioContext): ElementPlayable {
    if (this.elementPlayable && this.element && this.elementSource) {
      return this.elementPlayable;
    }
    const el = document.createElement("audio");
    el.preload = "auto";
    // No crossOrigin: every bundled track is same-origin from /public, and
    // forcing CORS mode on a same-origin fetch only adds a failure mode.
    const source = ctx.createMediaElementSource(el);
    source.connect(this.inputGain!);
    this.element = el;
    this.elementSource = source;
    this.elementPlayable = new ElementPlayable(
      el,
      () => this.handleEnded(),
      () => this.emit(),
    );
    return this.elementPlayable;
  }

  private handleEnded() {
    if (reactive.mode === "playing") reactive.mode = "paused";
    this.emit();
  }

  /* ── sources ──────────────────────────────────────────────────────── */

  /** Load and select a bundled demo track. Does not start playback. */
  loadDemo(track: DemoTrack) {
    const ctx = this.ensureGraph();
    this.stopMic();
    const playable = this.ensureElement(ctx);
    // Only tear down the outgoing playable if it isn't the shared element.
    if (this.playable && this.playable !== playable) this.playable.destroy();
    playable.load(track.src, track.srcFallback ?? null, track.duration);
    this.playable = playable;
    this.emit();
    return playable;
  }

  /** Select a freshly decoded upload. Does not start playback. */
  loadUpload(result: UploadResult) {
    const ctx = this.ensureGraph();
    this.stopMic();
    this.playable?.destroy();
    this.playable = new BufferPlayable(
      ctx,
      result.buffer,
      this.inputGain!,
      () => this.handleEnded(),
    );
    this.emit();
    return this.playable;
  }

  async decodeUpload(file: File, handlers: DecodeHandlers = {}) {
    const ctx = this.ensureGraph();
    return decodeFile(ctx, file, handlers);
  }

  /* ── microphone ────────────────────────────────────────────────────── */

  get micActive() {
    return this.micStream !== null;
  }

  /**
   * Route the microphone into the analyser. Playback is stopped first — the
   * two sources are mutually exclusive, and letting both run would also mean
   * the mic picking up the speakers. Resolves once live; rejects with the
   * original permission/ acquisition error so the UI can explain it.
   */
  async enableMic() {
    if (this.micActive) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Microphone input requires a secure connection (HTTPS) and a supported browser.");
    }
    const ctx = this.ensureGraph();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // The analyser wants the room as it is — browser DSP flattens the
          // frequency content the visualiser is trying to read.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "NotFoundError") {
        throw new Error("No microphone was found on this device.");
      }
      if (err instanceof DOMException && err.name === "NotAllowedError") {
        throw new Error("Microphone access was denied. Allow it in the browser's site settings to use this.");
      }
      throw err instanceof Error ? err : new Error("The microphone could not be started.");
    }

    // Permission granted — now it's safe to stop playback and re-route.
    this.playable?.pause();

    if (this.analyserRouted && this.analyserNode) {
      this.analyserNode.disconnect();
      this.analyserRouted = false;
    }

    this.micStream = stream;
    this.micSource = ctx.createMediaStreamSource(stream);
    // A gain stage between source and analyser keeps the gain structure
    // inspectable without changing level; 1 is neutral.
    this.micGain = ctx.createGain();
    this.micGain.gain.value = 1;
    this.micSource.connect(this.micGain);
    this.micGain.connect(this.analyserNode!);

    if (ctx.state === "suspended") void ctx.resume();
    reactive.mode = "playing";
    this.emit();
  }

  /** Tear the mic down: nodes disconnected, tracks released, speakers restored. */
  stopMic() {
    if (!this.micStream) return;
    this.micSource?.disconnect();
    this.micGain?.disconnect();
    this.micSource = null;
    this.micGain = null;
    for (const track of this.micStream.getTracks()) track.stop();
    this.micStream = null;

    if (!this.analyserRouted && this.analyserNode && this.volumeGain) {
      this.analyserNode.connect(this.volumeGain);
      this.analyserRouted = true;
    }

    reactive.mode = this.playable ? "paused" : "idle";
    this.emit();
  }

  /* ── transport ────────────────────────────────────────────────────── */

  get isLoaded() {
    return this.playable !== null;
  }

  get isPlaying() {
    return this.playable?.isPlaying ?? false;
  }

  get duration() {
    return this.playable?.duration ?? 0;
  }

  get currentTime() {
    return this.playable?.currentTime ?? 0;
  }

  async play() {
    if (!this.playable) return;
    const ctx = this.ensureGraph();
    if (ctx.state === "suspended") await ctx.resume();
    // Optimistically flip to playing so the UI and the reactive bed respond on
    // the same frame as the click, not whenever the media pipeline catches up.
    reactive.mode = "playing";
    this.emit();
    try {
      await this.playable.play();
    } catch (err) {
      // Autoplay rejection or a mid-flight track switch — reflect reality.
      reactive.mode = this.playable.isPlaying ? "playing" : "paused";
      this.emit();
      throw err;
    }
    this.emit();
  }

  pause() {
    this.playable?.pause();
    if (reactive.mode === "playing") reactive.mode = "paused";
    this.emit();
  }

  /** Full stop: pause and rewind to the start. The mic is unaffected. */
  stop() {
    if (this.micActive) return;
    this.playable?.pause();
    this.playable?.seek(0);
    if (reactive.mode !== "idle") reactive.mode = "paused";
    this.emit();
  }

  async toggle() {
    if (this.isPlaying) this.pause();
    else await this.play();
  }

  seek(time: number) {
    this.playable?.seek(time);
    this.emit();
  }

  /** Called when the tab regains focus — resync the mode with the real state. */
  syncMode() {
    if (this.micActive) {
      reactive.mode = "playing";
      return;
    }
    if (!this.playable) {
      reactive.mode = "idle";
      return;
    }
    reactive.mode = this.playable.isPlaying ? "playing" : "paused";
    this.emit();
  }

  /* ── change notification (for React) ──────────────────────────────── */

  private listeners = new Set<() => void>();

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  dispose() {
    this.stopMic();
    this.playable?.destroy();
    this.elementPlayable?.dispose();
    this.elementSource?.disconnect();
    this.inputGain?.disconnect();
    this.analyserNode?.disconnect();
    this.volumeGain?.disconnect();
    this.listeners.clear();
    void this.ctx?.close();
    this.ctx = null;
    this.analyserNode = null;
    this.inputGain = null;
    this.volumeGain = null;
    this.analyserRouted = false;
  }
}

let singleton: AudioEngine | null = null;

/**
 * Lazily-created process-wide engine.
 *
 * Deliberately safe to hand out during server rendering: the constructor only
 * allocates plain fields, and every DOM-touching step (creating the
 * AudioContext, the <audio> element, the MediaElementSource) is deferred until
 * `ensureGraph()` runs from a real user gesture on the client. Server-side
 * reads of `isLoaded` / `duration` / `isPlaying` just return the inert defaults,
 * which keeps the first paint and the hydration pass in agreement.
 */
export function getAudioEngine() {
  if (!singleton) singleton = new AudioEngine();
  return singleton;
}
