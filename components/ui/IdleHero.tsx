"use client";

import { AnimatePresence, motion } from "motion/react";
import { useAudio } from "@/lib/audio/provider";
import { cn, formatTime } from "@/lib/utils";

/**
 * The pre-play hero.
 *
 * Composition is bottom-left and hard-aligned to the frame edge rather than
 * centred — a centred title over a gradient is the default any generator
 * reaches for, and this scene deserves better. The right and top of the frame
 * are left empty for the 3D to occupy.
 *
 * Every animation here is Motion's, which is correct: none of it is audio
 * data. It runs once on mount and once on exit, not 60 times a second.
 */

const container = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.09, delayChildren: 0.35 },
  },
  exit: {
    transition: { staggerChildren: 0.04, staggerDirection: -1 },
  },
};

const rise = {
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] as const },
  },
  exit: {
    opacity: 0,
    y: -14,
    transition: { duration: 0.5, ease: [0.7, 0, 0.84, 0] as const },
  },
};

export function IdleHero() {
  const { tracks, source, selectDemo } = useAudio();
  const started = source !== null;

  return (
    <AnimatePresence>
      {!started && (
        <motion.div
          key="hero"
          variants={container}
          initial="hidden"
          animate="show"
          exit="exit"
          className="pointer-events-auto w-full max-w-2xl"
        >
          <motion.div variants={rise} className="flex items-center gap-3">
            <span className="h-px w-8 bg-white/25" />
            <span className="label-micro text-chalk-muted">
              Audio-reactive system
            </span>
          </motion.div>

          <motion.h1
            variants={rise}
            className="mt-5 font-display text-[16vw] leading-[0.82] tracking-[-0.02em] sm:text-[8rem] lg:text-[9.5rem]"
          >
            <span className="text-aurora italic">Wave</span>
            <span className="text-chalk">core</span>
          </motion.h1>

          <motion.p
            variants={rise}
            className="mt-5 max-w-md text-xs leading-relaxed text-chalk-muted sm:mt-6 sm:text-sm"
          >
            Not an equaliser. A living form built from the sound itself — bass
            moves the mass and the camera, mid drives the morph, treble bends the
            colour. Pick a track and watch it breathe.
          </motion.p>

          <motion.div variants={rise} className="mt-8">
            <div className="label-micro mb-3 text-chalk-ghost">
              Play something
            </div>
            <div className="flex flex-wrap gap-2">
              {tracks.map((track, i) => (
                <button
                  key={track.slug}
                  type="button"
                  onClick={() => selectDemo(track)}
                  className={cn(
                    "group relative overflow-hidden rounded-full border border-white/[0.09]",
                    "bg-white/[0.03] px-4 py-2.5 text-left backdrop-blur-xl transition-all duration-300",
                    "hover:border-white/25 hover:bg-white/[0.08]",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-2xs text-chalk-ghost">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-sm text-chalk">{track.title}</span>
                    {/* Metadata is a desktop affordance — on a phone the chips
                        need to stay short enough to sit on one line each. */}
                    <span className="hidden font-mono text-2xs uppercase text-chalk-faint sm:inline">
                      {track.bpm} bpm
                    </span>
                    <span className="hidden font-mono text-2xs text-chalk-ghost sm:inline">
                      {formatTime(track.duration)}
                    </span>
                  </span>
                  {/* Hairline that wipes across on hover — Motion-free, pure CSS. */}
                  <span className="absolute inset-x-0 bottom-0 h-px scale-x-0 bg-signal/70 transition-transform duration-500 group-hover:scale-x-100" />
                </button>
              ))}
            </div>
            <p className="mt-4 text-2xs uppercase tracking-[0.12em] text-chalk-ghost">
              or drop an audio file anywhere ·{" "}
              <kbd className="font-mono text-chalk-faint">O</kbd> for the source
              panel
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
