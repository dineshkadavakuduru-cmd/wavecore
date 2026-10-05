"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { DEMO_TRACKS, type DemoTrack } from "@/lib/demo-tracks.generated";
import {
  nextTierDown,
  QUALITY,
  detectTier,
  type QualitySettings,
  type QualityTier,
} from "@/lib/quality";
import { getAudioEngine, type AudioEngine, type UploadResult } from "./engine";
import { reactive } from "./reactive";

/** What is currently loaded into the transport. */
export type Source =
  | { kind: "demo"; track: DemoTrack; id: string }
  | { kind: "upload"; id: string; name: string; peaks: Float32Array; duration: number };

export type DecodeState =
  | { phase: "idle" }
  | { phase: "reading"; name: string; fraction: number; bytes: number }
  | { phase: "decoding"; name: string; bytes: number };

export type AudioApi = {
  engine: AudioEngine;
  tracks: DemoTrack[];
  source: Source | null;
  isLoaded: boolean;
  isPlaying: boolean;
  duration: number;
  volume: number;
  decode: DecodeState;
  error: string | null;
  quality: QualitySettings;
  micActive: boolean;
  selectDemo: (track: DemoTrack, autoplay?: boolean) => void;
  selectUpload: (file: File) => Promise<void>;
  toggle: () => void;
  pause: () => void;
  stop: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  step: (direction: 1 | -1) => void;
  enableMic: () => Promise<void>;
  stopMic: () => void;
  retry: () => void;
  clearError: () => void;
  reportSlowFrameBudget: () => void;
};

const AudioApiContext = createContext<AudioApi | null>(null);

export function useAudio() {
  const ctx = useContext(AudioApiContext);
  if (!ctx) throw new Error("useAudio must be used inside <AudioProvider>");
  return ctx;
}

const subscribeToNothing = () => () => {};

let cachedClientTier: QualityTier | null = null;
/** Stable across calls — useSyncExternalStore re-renders on any identity change. */
function getClientTier(): QualityTier {
  if (!cachedClientTier) cachedClientTier = detectTier();
  return cachedClientTier;
}
function serverTier(): QualityTier {
  return "high";
}

export function AudioProvider({ children }: { children: ReactNode }) {
  const engine = useMemo(() => getAudioEngine(), []);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  const [source, setSource] = useState<Source | null>(null);
  const [volume, setVolumeState] = useState(0.8);
  const [decode, setDecode] = useState<DecodeState>({ phase: "idle" });
  const [error, setError] = useState<string | null>(null);

  // Device tier is genuinely unknown during prerender, and guessing wrong on the
  // server would produce a hydration mismatch. useSyncExternalStore exists for
  // exactly this: it renders the server snapshot through hydration, then commits
  // the real client value with no warning and no extra frame of low quality.
  const detectedTier = useSyncExternalStore(
    subscribeToNothing,
    getClientTier,
    serverTier,
  );
  const [degraded, setDegraded] = useState<QualityTier | null>(null);
  const tier = degraded ?? detectedTier;

  // One step-down is allowed per session. Two would mean the device is genuinely
  // far below the starting guess; more than that and the scene stops being the
  // thing we're building.
  const degradeBudget = useRef(1);

  // Re-render whenever the engine reports a state transition (play / pause /
  // load / seek / metadata / ended). Per-frame audio data never comes through
  // here — that lives in `reactive` and is read inside the render loop.
  useEffect(() => engine.subscribe(rerender), [engine]);

  // Keep the reactive bus's notion of "playing" honest when the tab is restored
  // or the browser suspends media on its own.
  useEffect(() => {
    const onVisible = () => engine.syncMode();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [engine]);

  const selectDemo = useCallback(
    (track: DemoTrack, autoplay = true) => {
      setError(null);
      engine.loadDemo(track);
      setSource({ kind: "demo", track, id: `demo:${track.slug}` });
      if (autoplay) {
        void engine.play().catch(() => {
          setError("Playback was blocked. Click play once to allow audio.");
        });
      }
    },
    [engine],
  );

  const selectUpload = useCallback(
    async (file: File) => {
      setError(null);
      setDecode({ phase: "reading", name: file.name, fraction: 0, bytes: 0 });
      try {
        const result: UploadResult = await engine.decodeUpload(file, {
          onReadProgress: (fraction) =>
            setDecode({
              phase: "reading",
              name: file.name,
              fraction,
              bytes: Math.round(fraction * file.size),
            }),
          onDecodeStart: () =>
            setDecode({ phase: "decoding", name: file.name, bytes: file.size }),
        });

        engine.loadUpload(result);
        setSource({
          kind: "upload",
          id: `upload:${file.name}:${file.size}`,
          name: file.name,
          peaks: result.peaks,
          duration: result.duration,
        });
        setDecode({ phase: "idle" });
        void engine.play().catch(() => {
          setError("Playback was blocked. Click play once to allow audio.");
        });
      } catch (err) {
        setDecode({ phase: "idle" });
        const message =
          err instanceof DOMException && err.name === "EncodingError"
            ? "That file couldn't be decoded. Try a WAV, MP3, M4A, OGG or FLAC."
            : err instanceof Error
              ? err.message
              : "Something went wrong reading that file.";
        setError(message);
        throw err;
      }
    },
    [engine],
  );

  const toggle = useCallback(() => {
    void engine.toggle().catch(() => {
      setError("Playback was blocked. Click play once to allow audio.");
    });
  }, [engine]);

  const pause = useCallback(() => engine.pause(), [engine]);
  const stop = useCallback(() => engine.stop(), [engine]);
  const seek = useCallback((time: number) => engine.seek(time), [engine]);
  const retry = useCallback(() => {
    setError(null);
    void engine.play().catch(() => setError("Playback was blocked."));
  }, [engine]);
  const clearError = useCallback(() => setError(null), []);

  const setVolume = useCallback(
    (v: number) => {
      engine.setVolume(v);
      setVolumeState(v);
    },
    [engine],
  );

  // Mic state mirrors the engine, which re-renders this provider through the
  // same subscription every transport state change lives on.
  const enableMic = useCallback(async () => {
    setError(null);
    try {
      await engine.enableMic();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The microphone could not be started.");
      throw err;
    }
  }, [engine]);
  const stopMic = useCallback(() => engine.stopMic(), [engine]);
  const micActive = engine.micActive;

  const step = useCallback(
    (direction: 1 | -1) => {
      const index =
        source?.kind === "demo"
          ? DEMO_TRACKS.findIndex((t) => t.slug === source.track.slug)
          : -1;
      // Stepping backwards from an upload (or from nothing) should land on the
      // last track rather than skipping past the list.
      const base = index >= 0 ? index : direction === 1 ? -1 : 0;
      const next = DEMO_TRACKS[(base + direction + DEMO_TRACKS.length) % DEMO_TRACKS.length];
      selectDemo(next, true);
    },
    [selectDemo, source],
  );

  const reportSlowFrameBudget = useCallback(() => {
    if (degradeBudget.current <= 0) return;
    setDegraded((current) => {
      const down = nextTierDown(current ?? getClientTier());
      if (!down) {
        degradeBudget.current = 0;
        return current;
      }
      degradeBudget.current -= 1;
      return down;
    });
  }, []);

  const api = useMemo<AudioApi>(
    () => ({
      engine,
      tracks: DEMO_TRACKS,
      source,
      isLoaded: engine.isLoaded,
      isPlaying: engine.isPlaying || reactive.mode === "playing",
      duration: engine.duration,
      volume,
      decode,
      error,
      quality: QUALITY[tier],
      micActive,
      selectDemo,
      selectUpload,
      toggle,
      pause,
      stop,
      seek,
      setVolume,
      step,
      enableMic,
      stopMic,
      retry,
      clearError,
      reportSlowFrameBudget,
    }),
    [
      engine,
      source,
      volume,
      decode,
      error,
      tier,
      micActive,
      selectDemo,
      selectUpload,
      toggle,
      pause,
      stop,
      seek,
      setVolume,
      step,
      enableMic,
      stopMic,
      retry,
      clearError,
      reportSlowFrameBudget,
    ],
  );

  return <AudioApiContext.Provider value={api}>{children}</AudioApiContext.Provider>;
}
