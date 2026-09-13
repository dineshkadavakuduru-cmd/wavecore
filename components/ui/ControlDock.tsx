"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { useAudio } from "@/lib/audio/provider";
import { useChrome } from "@/lib/chrome";
import { cancelFrame, scheduleFrame } from "@/lib/raf";
import { cn, formatTime } from "@/lib/utils";
import {
  CollapseIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PrevIcon,
  SlidersIcon,
  VolumeIcon,
} from "./icons";

/**
 * The transport.
 *
 * Two things worth knowing about this file:
 *
 * 1. Playback position is written straight to the DOM from its own rAF loop —
 *    React state is never touched while a track plays. A scrubber updating
 *    through setState would re-render the whole dock 60×/s for a number that
 *    changes by 0.016.
 *
 * 2. It uses a shared rAF scheduler rather than its own bare rAF, so this and
 *    the transport readout don't each spin up separate animation frames.
 */

const SPRING = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;

export function ControlDock() {
  const {
    engine,
    isPlaying,
    isLoaded,
    duration,
    toggle,
    seek,
    volume,
    setVolume,
    step,
  } = useAudio();
  const { visible, zen, panelOpen, togglePanel, toggleZen } = useChrome();

  const progressRef = useRef<HTMLInputElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const durationRef = useRef<HTMLSpanElement>(null);
  const scrubbing = useRef(false);

  const syncDom = useCallback(() => {
    const input = progressRef.current;
    const time = engine.currentTime;
    const total = engine.duration || 0;
    const ratio = total > 0 ? time / total : 0;

    if (input) {
      // Don't fight the user while they're dragging the thumb.
      if (!scrubbing.current) input.value = String(time);
      input.style.setProperty("--range-progress", `${ratio * 100}%`);
    }
    if (elapsedRef.current) elapsedRef.current.textContent = formatTime(time);
    if (durationRef.current) durationRef.current.textContent = formatTime(total);
  }, [engine]);

  // Only spin a frame loop while something is actually moving.
  useEffect(() => {
    syncDom();
    if (!isPlaying) return;
    const id = scheduleFrame(function loop() {
      syncDom();
    });
    return () => cancelFrame(id);
  }, [isPlaying, syncDom]);

  useEffect(() => {
    syncDom();
  }, [duration, syncDom]);

  const shown = visible && !zen;

  return (
    <AnimatePresence>
      {shown && (
        <motion.div
          key="dock"
          initial={{ opacity: 0, y: 28, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: 22, filter: "blur(8px)" }}
          transition={SPRING}
          className="pointer-events-auto w-[min(50rem,94vw)]"
        >
          <div className="glass flex items-center gap-2 rounded-full px-2.5 py-2 sm:gap-3 sm:px-3.5">
            {/* ── transport buttons ─────────────────────────────────── */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous track"
                className="chrome-btn hidden h-8 w-8 !rounded-full sm:inline-flex"
              >
                <PrevIcon className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={toggle}
                disabled={!isLoaded}
                aria-label={isPlaying ? "Pause" : "Play"}
                className={cn(
                  "grid h-10 w-10 place-items-center rounded-full transition-all duration-200",
                  "bg-chalk text-ink-950 hover:scale-[1.06] active:scale-95",
                  "disabled:cursor-not-allowed disabled:bg-white/15 disabled:text-chalk-ghost disabled:hover:scale-100",
                )}
              >
                {isPlaying ? (
                  <PauseIcon className="h-[18px] w-[18px]" />
                ) : (
                  <PlayIcon className="ml-0.5 h-[18px] w-[18px]" />
                )}
              </button>

              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next track"
                className="chrome-btn hidden h-8 w-8 !rounded-full sm:inline-flex"
              >
                <NextIcon className="h-4 w-4" />
              </button>
            </div>

            {/* ── scrubber ──────────────────────────────────────────── */}
            <span
              ref={elapsedRef}
              className="hidden w-9 shrink-0 text-right font-mono text-2xs text-chalk-faint tabular-nums sm:block"
            >
              0:00
            </span>

            <input
              ref={progressRef}
              type="range"
              className="chrome-range min-w-0 flex-1"
              min={0}
              max={duration > 0 ? duration : 1}
              step={0.01}
              defaultValue={0}
              disabled={!isLoaded}
              aria-label="Seek"
              onPointerDown={() => {
                scrubbing.current = true;
              }}
              onPointerUp={() => {
                scrubbing.current = false;
              }}
              onKeyDown={() => {
                scrubbing.current = true;
              }}
              onKeyUp={() => {
                scrubbing.current = false;
              }}
              onChange={(event) => {
                seek(Number(event.target.value));
                syncDom();
              }}
            />

            <span
              ref={durationRef}
              className="hidden w-9 shrink-0 font-mono text-2xs text-chalk-faint tabular-nums sm:block"
            >
              0:00
            </span>

            {/* ── volume ────────────────────────────────────────────── */}
            <div className="hidden items-center gap-2 pl-1 lg:flex">
              <button
                type="button"
                onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
                aria-label={volume > 0 ? "Mute" : "Unmute"}
                className="text-chalk-faint transition-colors hover:text-chalk"
              >
                <VolumeIcon className="h-4 w-4" muted={volume === 0} />
              </button>
              <input
                type="range"
                className="chrome-range w-20"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                aria-label="Volume"
                style={{ "--range-progress": `${volume * 100}%` } as React.CSSProperties}
                onChange={(event) => setVolume(Number(event.target.value))}
              />
            </div>

            <span className="mx-0.5 hidden h-5 w-px bg-white/10 lg:block" />

            {/* ── chrome controls ───────────────────────────────────── */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={togglePanel}
                aria-label="Track and upload panel"
                aria-expanded={panelOpen}
                className={cn(
                  "chrome-btn h-8 w-8 !rounded-full",
                  panelOpen && "!border-white/25 !bg-white/[0.1] !text-chalk",
                )}
              >
                <SlidersIcon className="h-4 w-4" />
              </button>

              <button
                type="button"
                onClick={toggleZen}
                aria-label="Hide all controls (recording mode)"
                title="Hide everything · H"
                className="chrome-btn h-8 w-8 !rounded-full"
              >
                <CollapseIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
