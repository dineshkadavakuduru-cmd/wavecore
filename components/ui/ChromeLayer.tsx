"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { useAudio } from "@/lib/audio/provider";
import { useChrome } from "@/lib/chrome";
import { cn } from "@/lib/utils";
import { ControlDock } from "./ControlDock";
import { IdleHero } from "./IdleHero";
import { SourcePanel } from "./SourcePanel";
import { Telemetry } from "./Telemetry";
import { TitleReveal } from "./TitleReveal";

/**
 * The whole UI chrome, as one layer over the canvas.
 *
 * It fades rather than unmounting, so a closing panel can still play its own
 * exit animation. The catch with fading instead of unmounting is that invisible
 * controls stay clickable and tabbable, so while hidden the layer also gets
 * `inert` and a descendant-wide pointer-events override.
 */
export function ChromeLayer() {
  const { visible, zen } = useChrome();
  // `inert` landed properly in React 19's types; React 18 accepts the attribute
  // as a string, which is what this spreads in.
  const inert = !visible && !zen ? ({ inert: "" } as Record<string, string>) : {};

  return (
    <div
      {...inert}
      aria-hidden={!visible}
      className={cn(
        "absolute inset-0 z-30",
        !visible && "[&_*]:!pointer-events-none",
      )}
    >
      <AnimatePresence>
        {!zen && (
          <motion.div
            key="chrome"
            initial={{ opacity: 0 }}
            animate={{ opacity: visible ? 1 : 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-none absolute inset-0"
          >
            {/* ── top rail ───────────────────────────────────────────── */}
            <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-6 p-5 sm:p-7">
              <BrandMark />
              <Telemetry />
            </div>

            {/* ── bottom-left: hero, then the track-title reveal in the
                    same slot once something is playing ───────────────── */}
            <div className="absolute inset-x-5 bottom-24 sm:inset-x-auto sm:bottom-28 sm:left-7 sm:w-[min(42rem,60vw)]">
              <IdleHero />
            </div>

            <TitleReveal />

            {/* ── bottom-centre: transport ─────────────────────────── */}
            <div className="absolute inset-x-0 bottom-5 flex justify-center px-4 sm:bottom-6">
              <ControlDock />
            </div>

            <HintStack />
            <SourcePanel />
          </motion.div>
        )}
      </AnimatePresence>

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

/** Keyboard hints. Bottom-right, so they never cross the transport. */
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
    <div className="absolute bottom-8 right-5 hidden flex-col items-end gap-1.5 lg:flex">
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
          className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-2xs uppercase tracking-[0.2em] text-chalk-ghost"
        >
          recording mode · press <span className="text-chalk-muted">H</span> or{" "}
          <span className="text-chalk-muted">Esc</span> to bring the controls back
        </motion.p>
      )}
    </AnimatePresence>
  );
}
