"use client";

import anime from "animejs";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { useAudio } from "@/lib/audio/provider";
import { formatBytes } from "@/lib/utils";

/**
 * Loading state for uploads.
 *
 * `decodeAudioData` reports nothing while it works, so rather than fake a bar
 * the two phases are surfaced honestly:
 *
 *   reading   determinate — FileReader gives real per-chunk progress, and the
 *             number/bar are eased with anime.js so they don't step
 *   decoding  indeterminate — a sweeping highlight, because there is genuinely
 *             no progress to report until it resolves
 *
 * Both phases are anime.js, not Motion: they are discrete choreography with a
 * defined start and end, not layout transitions, and this keeps Motion handling
 * only the mount/unmount of the overlay itself.
 */

export function DecodeOverlay() {
  const { decode } = useAudio();
  const show = decode.phase !== "idle";

  const railRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const pctRef = useRef<HTMLSpanElement>(null);
  const counter = useRef({ value: 0 });

  const fraction = decode.phase === "reading" ? decode.fraction : 0;

  // Eased determinate progress: reading is fast and bursty, so snapping the bar
  // to each event makes it look broken.
  useEffect(() => {
    if (decode.phase !== "reading") return;
    const animation = anime({
      targets: counter.current,
      value: Math.round(fraction * 100),
      duration: 340,
      easing: "easeOutQuad",
      round: 1,
      update: () => {
        const v = counter.current.value;
        if (fillRef.current) fillRef.current.style.transform = `scaleX(${v / 100})`;
        if (pctRef.current) pctRef.current.textContent = `${String(v).padStart(2, "0")}%`;
      },
    });
    return () => {
      animation.pause();
    };
  }, [decode.phase, fraction]);

  // Indeterminate sweep for the decode phase. Queried off the rail rather than
  // the fill, because the fill element only exists during the reading phase.
  useEffect(() => {
    if (decode.phase !== "decoding") return;
    const target = railRef.current?.querySelector("[data-sweep]");
    if (!target) return;
    const animation = anime({
      targets: target,
      translateX: ["-120%", "320%"],
      duration: 1250,
      easing: "easeInOutSine",
      loop: true,
    });
    return () => {
      animation.pause();
      anime.remove(target);
    };
  }, [decode.phase]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="decode"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="pointer-events-auto absolute inset-0 z-40 grid place-items-center bg-ink-950/72 backdrop-blur-md"
          role="status"
          aria-live="polite"
        >
          <div className="w-[min(22rem,88vw)] px-2">
            <div className="label-micro text-chalk-faint">
              {decode.phase === "reading" ? "Reading file" : "Decoding audio"}
            </div>

            <p className="mt-3 truncate text-sm text-chalk" title={decode.name}>
              {decode.name}
            </p>

            {/* Progress rail */}
            <div
              ref={railRef}
              className="relative mt-5 h-px w-full overflow-hidden bg-white/12"
            >
              {decode.phase === "reading" ? (
                <span
                  ref={fillRef}
                  className="absolute inset-0 origin-left bg-signal"
                  style={{ transform: "scaleX(0)" }}
                />
              ) : (
                <span
                  data-sweep
                  className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent"
                />
              )}
            </div>

            <div className="mt-3 flex items-center justify-between font-mono text-2xs uppercase text-chalk-ghost">
              <span ref={pctRef}>
                {decode.phase === "reading" ? "00%" : "··"}
              </span>
              <span>
                {decode.phase === "reading"
                  ? `${formatBytes(decode.bytes)}`
                  : "analysing"}
              </span>
            </div>

            <p className="mt-6 text-2xs leading-relaxed uppercase tracking-[0.1em] text-chalk-ghost">
              Long files take a moment — the whole buffer is decoded up front so
              seeking is exact.
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
