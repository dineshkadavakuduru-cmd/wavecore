"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { useAudio } from "@/lib/audio/provider";
import { useChrome } from "@/lib/chrome";
import { ControlDock } from "./ControlDock";
import { IdleHero } from "./IdleHero";
import { LiveRegion } from "./LiveRegion";
import { SourcePanel } from "./SourcePanel";
import { Telemetry } from "./Telemetry";
import { TitleReveal } from "./TitleReveal";

export function ChromeLayer() {
  const { dimmed, zen, hasStarted, setZen } = useChrome();
  const reduceMotion = useReducedMotion();

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      {zen ? (
        <button
          type="button"
          aria-label="Restore controls"
          onClick={() => setZen(false)}
          className="touch-instructions pointer-events-auto absolute inset-0 w-full touch-manipulation"
        />
      ) : (
        <motion.div
          initial={false}
          animate={{ opacity: dimmed ? 0.78 : 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.25 }}
          className="absolute inset-0"
        >
          <a
            href="#control-dock"
            className="pointer-events-auto sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:glass focus:px-3 focus:py-2 focus:rounded-xl focus:text-sm focus:text-chalk focus:border focus:border-white/20"
          >
            Skip to controls
          </a>

          <LiveRegion />

          <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-6 p-5 sm:p-7">
            <BrandMark />
            <Telemetry />
          </div>

          {hasStarted ? (
            <TitleReveal />
          ) : (
            <>
              <div
                aria-hidden="true"
                className="absolute inset-x-0 bottom-0 h-[min(42rem,100%)] bg-gradient-to-t from-ink-950 via-ink-950/90 to-transparent sm:hidden"
              />
              <div className="absolute inset-x-5 bottom-32 sm:inset-x-auto sm:bottom-28 sm:left-7 sm:w-[min(42rem,60vw)]">
                <IdleHero />
              </div>
            </>
          )}

          <div className="absolute inset-x-0 bottom-5 flex justify-center px-4 sm:bottom-6" id="control-dock">
            <ControlDock />
          </div>

          <HintStack />
          <AudioUnlockHint />
          <SourcePanel />
        </motion.div>
      )}

      <ZenHint />
    </div>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <span className="relative grid h-6 w-6 place-items-center">
        <span className="absolute inset-0 rounded-full border border-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-signal/80" />
      </span>
      <span className="font-mono text-2xs uppercase tracking-[0.28em] text-chalk-muted">
        Wavecore
      </span>
    </div>
  );
}

/** Keyboard hints. Bottom-right, so they never cross the transport.
 *
 * Server-rendered visible like the rest of the chrome. The keys aren't wired
 * up until hydration, but the shortcuts are a convenience rather than a
 * requirement — and the only `source`-dependent part (the Space hint) simply
 * joins the stack once the audio context exists.
 */
function HintStack() {
  const { source } = useAudio();

  const hints: Array<[string, string]> = source
    ? [
        ["Space", "play"],
        ["O", "source"],
        ["H", "hide ui"],
      ]
    : [
        ["O", "source"],
        ["H", "hide ui"],
      ];

  return (
    <div className="absolute bottom-8 right-5 desktop-instructions hidden flex-col items-end gap-1.5 lg:flex">
      {hints.map(([key, label]) => (
        <span
          key={key}
          className="flex items-center gap-2 font-mono text-2xs uppercase text-chalk-ghost"
        >
          {label}
          <kbd className="rounded border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-chalk-faint">
            {key}
          </kbd>
        </span>
      ))}
    </div>
  );
}

/**
 * Visible escape hatch for a browser-suspended AudioContext.
 *
 * Autoplay policies can suspend the context after it was already running (a
 * backgrounded tab, an OS audio-route change). When that happens the scene
 * keeps drawing but the sound is gone, so this offers the one gesture that
 * resumes it. It only appears while a source is actually loaded.
 */
function AudioUnlockHint() {
  const { suspended, source, retry } = useAudio();
  if (!suspended || !source) return null;

  return (
    <button
      type="button"
      onClick={retry}
      className="glass pointer-events-auto absolute left-1/2 top-20 z-40 -translate-x-1/2 rounded-full px-4 py-2 font-mono text-2xs uppercase tracking-[0.14em] text-chalk-muted transition-colors hover:text-chalk"
    >
      Audio paused by the browser — click to resume
    </button>
  );
}

/**
 * A brief way out of zen mode.
 *
 * Recording mode intentionally has no chrome, but a state with no visible exit
 * is a state that feels broken. This appears for a few seconds after entering
 * zen and then gets out of the way for the capture.
 */
function ZenHint() {
  const { zen } = useChrome();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!zen) {
      setShow(false);
      return;
    }
    setShow(true);
    const timer = window.setTimeout(() => setShow(false), 4200);
    return () => window.clearTimeout(timer);
  }, [zen]);

  return (
    <AnimatePresence>
      {show && (
        <motion.p
          key="zen-hint"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 w-full px-4 text-center font-mono text-2xs uppercase tracking-[0.14em] text-chalk-muted"
        >
          <span className="touch-instructions">Recording mode · tap the scene to restore controls</span>
          <span className="desktop-instructions">
            Recording mode · press <kbd>H</kbd> or <kbd>Esc</kbd> to restore controls
          </span>
        </motion.p>
      )}
    </AnimatePresence>
  );
}
