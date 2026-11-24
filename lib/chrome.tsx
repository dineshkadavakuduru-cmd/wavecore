"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAudio } from "./audio/provider";

const DIM_DELAY = 3600;
/** Pointer movement under this interval is ignored — avoids timer churn. */
const ACTIVITY_THROTTLE = 120;

export type ChromeApi = {
  dimmed: boolean;
  hasStarted: boolean;
  /** Recording mode: no chrome at all, cursor hidden. */
  zen: boolean;
  panelOpen: boolean;
  /** Restore full brightness and restart the idle countdown. */
  reveal: () => void;
  setPanelOpen: (open: boolean) => void;
  togglePanel: () => void;
  setZen: (value: boolean) => void;
  toggleZen: () => void;
  toggleFullscreen: () => void;
  isFullscreen: boolean;
};

const ChromeContext = createContext<ChromeApi | null>(null);

export function useChrome() {
  const ctx = useContext(ChromeContext);
  if (!ctx) throw new Error("useChrome must be used inside <ChromeProvider>");
  return ctx;
}

export function ChromeProvider({ children }: { children: ReactNode }) {
  const { toggle, stop, seek, setVolume, volume, selectDemo, tracks, engine, isPlaying, micActive } =
    useAudio();

  const [dimmed, setDimmed] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [zen, setZenState] = useState(false);
  const [panelOpen, setPanelOpenState] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const dimTimer = useRef<number | null>(null);
  const lastActivity = useRef(-Infinity);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;

  const clearDimTimer = useCallback(() => {
    if (dimTimer.current !== null) {
      window.clearTimeout(dimTimer.current);
      dimTimer.current = null;
    }
  }, []);

  const reveal = useCallback(() => {
    if (zen) return;
    setDimmed(false);
    clearDimTimer();
    if (hasStarted && !panelOpenRef.current) {
      dimTimer.current = window.setTimeout(() => setDimmed(true), DIM_DELAY);
    }
  }, [clearDimTimer, hasStarted, zen]);

  const setPanelOpen = useCallback((open: boolean) => {
    if (!zen) setPanelOpenState(open);
  }, [zen]);

  const togglePanel = useCallback(
    () => setPanelOpen(!panelOpenRef.current),
    [setPanelOpen],
  );

  /* ── zen / fullscreen ─────────────────────────────────────────────── */

  const enterFullscreen = useCallback(() => {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      // Rejections are normal (iOS Safari, or a non-gesture-triggered call) and
      // must not take zen mode down with them.
      void el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    }
  }, []);

  const exitFullscreen = useCallback(() => {
    if (document.fullscreenElement && document.exitFullscreen) {
      void document.exitFullscreen().catch(() => {});
    }
  }, []);

  const setZen = useCallback(
    (value: boolean) => {
      setZenState(value);
      setDimmed(false);
      if (value) {
        clearDimTimer();
        setPanelOpenState(false);
        enterFullscreen();
      } else {
        // Leaving recording mode should give the page back in one press rather
        // than leaving the user stuck in a fullscreen they can't see controls in.
        exitFullscreen();
      }
    },
    [clearDimTimer, enterFullscreen, exitFullscreen],
  );

  const toggleZen = useCallback(() => setZen(!zen), [setZen, zen]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) exitFullscreen();
    else enterFullscreen();
  }, [enterFullscreen, exitFullscreen]);

  // Keep zen in sync with the browser's own fullscreen state, since Esc exits
  // fullscreen without going through our toggle.
  useEffect(() => {
    const onChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (!active) setZenState((wasZen) => (wasZen ? false : wasZen));
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Keep the recording state available to the existing browser checks.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.chrome = zen ? "hidden" : dimmed ? "dimmed" : "visible";
    return () => {
      delete root.dataset.chrome;
    };
  }, [dimmed, zen]);

  /* ── activity listeners ───────────────────────────────────────────── */

  useEffect(() => {
    const onPointerMove = () => {
      const now = performance.now();
      if (now - lastActivity.current < ACTIVITY_THROTTLE) return;
      lastActivity.current = now;
      reveal();
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", reveal, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", reveal);
    };
  }, [reveal]);

  useEffect(() => {
    if (isPlaying && !micActive) setHasStarted(true);
  }, [isPlaying, micActive]);

  useEffect(() => {
    reveal();
    return clearDimTimer;
  }, [panelOpen, reveal, clearDimTimer]);

  /* ── keyboard ─────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isRange = tag === "INPUT" && (target as HTMLInputElement)?.type === "range";

      // Anything that natively consumes keystrokes owns its keys completely:
      // textareas, contenteditable, <select> (letters do type-ahead) and every
      // <input> except a range slider — text, search, number, date, file, the
      // lot. Hijacking a digit or a letter there would corrupt the field or fire
      // a track change from inside a form control. Range sliders are the one
      // exception: they only get their arrow/home/end keys (moved natively) and
      // still let Space fall through to the global transport toggle below.
      const ownsKeys =
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable === true ||
        (tag === "INPUT" && !isRange);
      if (ownsKeys) return;

      const keysRangeHandles = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"];
      if (isRange && keysRangeHandles.includes(e.key)) return;

      // Enter activates whatever control has focus. Preventing that here would
      // break the control. Without this guard, pressing Enter right after
      // clicking Play would fire the button's own click *and* fall through to
      // any Enter-mapped shortcut, doing the action twice.
      //
      // Space is deliberately NOT guarded: e.preventDefault() on the keydown
      // already suppresses the button's click activation, so Space always toggles
      // playback no matter which button holds focus. This is what makes the
      // transport work as a media surface — Space must be global.
      const isFocusedControl =
        tag === "BUTTON" || tag === "A" || target?.getAttribute("role") === "button";
      if (isFocusedControl && e.key === "Enter") return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          // Blur so a focused button doesn't also fire its click — Space always
          // means "toggle playback" for this app, never "click whatever has focus".
          target?.blur?.();
          toggle();
          reveal();
          return;
        case "ArrowLeft":
          e.preventDefault();
          seek(Math.max(0, engine.currentTime - 5));
          reveal();
          return;
        case "ArrowRight":
          e.preventDefault();
          seek(engine.currentTime + 5);
          reveal();
          return;
        case "ArrowUp":
          e.preventDefault();
          setVolume(Math.min(1, volume + 0.05));
          reveal();
          return;
        case "ArrowDown":
          e.preventDefault();
          setVolume(Math.max(0, volume - 0.05));
          reveal();
          return;
        case "h":
        case "H":
          e.preventDefault();
          setZen(!zen);
          return;
        case "f":
        case "F":
          e.preventDefault();
          toggleFullscreen();
          return;
        case "o":
        case "O":
          e.preventDefault();
          setPanelOpen(!panelOpenRef.current);
          reveal();
          return;
        case "m":
        case "M":
          e.preventDefault();
          setVolume(volume > 0 ? 0 : 0.8);
          reveal();
          return;
        case "s":
        case "S":
          e.preventDefault();
          stop();
          reveal();
          return;
        case "Escape":
          if (zen) {
            e.preventDefault();
            setZen(false);
          }
          return;
      }

      // 1..9 jump straight to a bundled track.
      const digit = Number.parseInt(e.key, 10);
      if (!Number.isNaN(digit) && digit >= 1 && digit <= 9 && tracks[digit - 1]) {
        e.preventDefault();
        selectDemo(tracks[digit - 1], true);
        reveal();
        return;
      }

      reveal();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    engine,
    reveal,
    seek,
    selectDemo,
    setVolume,
    setZen,
    stop,
    toggle,
    toggleFullscreen,
    tracks,
    volume,
    zen,
    setPanelOpen,
  ]);

  const api = useMemo<ChromeApi>(
    () => ({
      dimmed,
      hasStarted,
      zen,
      panelOpen,
      reveal,
      setPanelOpen,
      togglePanel,
      setZen,
      toggleZen,
      toggleFullscreen,
      isFullscreen,
    }),
    [
      dimmed,
      hasStarted,
      zen,
      panelOpen,
      reveal,
      setPanelOpen,
      togglePanel,
      setZen,
      toggleZen,
      toggleFullscreen,
      isFullscreen,
    ],
  );

  return <ChromeContext.Provider value={api}>{children}</ChromeContext.Provider>;
}
