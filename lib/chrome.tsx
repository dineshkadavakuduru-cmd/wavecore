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

/**
 * UI chrome visibility, plus keyboard shortcuts.
 *
 * Three states, in increasing order of "get out of the way":
 *
 *   visible   — pointer moved or a key was pressed recently
 *   hidden    — nothing has happened for a few seconds (auto-hide)
 *   zen       — the whole chrome layer is off and the cursor is gone, for
 *               screen recording. Only leaves zen on an explicit toggle.
 *
 * The panel cannot wedge itself open: even an explicitly-opened panel hides on
 * a longer timeout. "Disappears gracefully and never feels stuck" rules out any
 * state where chrome stays on screen because a flag was left set.
 */

const HIDE_DELAY_ACTIVE = 3600;
const HIDE_DELAY_PANEL_OPEN = 6500;
/** Pointer movement under this interval is ignored — avoids timer churn. */
const ACTIVITY_THROTTLE = 120;

export type ChromeApi = {
  /** Whether the chrome layer is currently drawn. */
  visible: boolean;
  /** Recording mode: no chrome at all, cursor hidden. */
  zen: boolean;
  panelOpen: boolean;
  /** Restart the auto-hide countdown and show chrome. */
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
  const { toggle, stop, seek, setVolume, volume, selectDemo, tracks, engine } = useAudio();

  const [visible, setVisible] = useState(true);
  const [zen, setZenState] = useState(false);
  const [panelOpen, setPanelOpenState] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const hideTimer = useRef<number | null>(null);
  const lastActivity = useRef(0);
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;

  const clearHideTimer = useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const scheduleHide = useCallback(
    (delay: number) => {
      clearHideTimer();
      hideTimer.current = window.setTimeout(() => setVisible(false), delay);
    },
    [clearHideTimer],
  );

  const reveal = useCallback(() => {
    if (zen) return;
    const now = performance.now();
    if (now - lastActivity.current < ACTIVITY_THROTTLE) return;
    lastActivity.current = now;
    setVisible(true);
    scheduleHide(panelOpenRef.current ? HIDE_DELAY_PANEL_OPEN : HIDE_DELAY_ACTIVE);
  }, [scheduleHide, zen]);

  const setPanelOpen = useCallback(
    (open: boolean) => {
      setPanelOpenState(open);
      if (open) {
        if (!zen) {
          setVisible(true);
          scheduleHide(HIDE_DELAY_PANEL_OPEN);
        }
      } else {
        scheduleHide(HIDE_DELAY_ACTIVE);
      }
    },
    [scheduleHide, zen],
  );

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
      if (value) {
        clearHideTimer();
        setVisible(false);
        setPanelOpenState(false);
        enterFullscreen();
      } else {
        setVisible(true);
        scheduleHide(HIDE_DELAY_ACTIVE);
        // Leaving recording mode should give the page back in one press rather
        // than leaving the user stuck in a fullscreen they can't see controls in.
        exitFullscreen();
      }
    },
    [clearHideTimer, enterFullscreen, exitFullscreen, scheduleHide],
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

  // Mirror visibility onto <html> so CSS can drop the cursor and pause the
  // decorative animations without React re-rendering anything.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.chrome = visible ? "visible" : "hidden";
    return () => {
      delete root.dataset.chrome;
    };
  }, [visible]);

  /* ── activity listeners ───────────────────────────────────────────── */

  useEffect(() => {
    const onPointerMove = () => reveal();
    const onPointerDown = () => {
      // A tap goes straight to "visible" — the throttle exists for mousemove
      // spam, not for discrete taps.
      lastActivity.current = 0;
      reveal();
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("touchstart", onPointerDown);
    };
  }, [reveal]);

  // Start the countdown on mount so the idle hero is unobstructed immediately.
  useEffect(() => {
    scheduleHide(HIDE_DELAY_ACTIVE);
    return clearHideTimer;
  }, [scheduleHide, clearHideTimer]);

  /* ── keyboard ─────────────────────────────────────────────────────── */

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      // Never hijack keys aimed at a slider, input or text field.
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

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
      visible,
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
      visible,
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
