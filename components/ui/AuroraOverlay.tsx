"use client";

import { motion } from "motion/react";
import { useAudio } from "@/lib/audio/provider";
import { useChrome } from "@/lib/chrome";

/**
 * Aurora + spotlight wash, layered *over* the canvas with a screen blend.
 *
 * This is the "Aceternity" style treatment, and here it is doing real work: it
 * is what makes the pre-play frame look like a poster instead of an
 * under-exposed version of the playing frame. Once a track is loaded it drops
 * back to a faint atmospheric cast and stops competing with the scene.
 *
 * Both blobs read `--signal-rgb`, which the render loop rewrites every few
 * frames from the treble-driven hue — so the wash behind the chrome drifts with
 * the music too, with no tweening library anywhere in the path.
 *
 * No `filter: blur()` anywhere: a radial gradient is already soft, and large
 * blurred layers are one of the easiest ways to tank a frame budget on a
 * mid-range laptop.
 */

const layer: React.CSSProperties = {
  mixBlendMode: "screen",
};

export function AuroraOverlay() {
  const { source } = useAudio();
  const { zen } = useChrome();

  const started = source !== null;

  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      <motion.div
        className="absolute inset-0"
        style={layer}
        initial={{ opacity: 0 }}
        animate={{ opacity: zen ? 0.5 : started ? 0.2 : 0.72 }}
        transition={{ duration: 2.2, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Primary bloom — tracks the live signal colour. */}
        <div
          className="animate-aurora absolute left-[-15%] top-[-30%] h-[95vh] w-[95vw] will-change-transform"
          style={{
            background:
              "radial-gradient(circle at 50% 50%, rgba(var(--signal-rgb) / 0.20) 0%, rgba(var(--signal-rgb) / 0.07) 38%, transparent 68%)",
          }}
        />
        {/* Counterweight in a fixed violet, so the wash never goes monochrome. */}
        <div
          className="animate-aurora absolute right-[-20%] top-[-18%] h-[80vh] w-[80vw] will-change-transform"
          style={{
            animationDelay: "-7s",
            background:
              "radial-gradient(circle at 50% 50%, rgba(150 130 255 / 0.15) 0%, rgba(120 110 240 / 0.05) 42%, transparent 70%)",
          }}
        />
        {/* Low warm anchor, keeps the bottom of the frame from going dead. */}
        <div
          className="animate-aurora absolute bottom-[-35%] left-[10%] h-[70vh] w-[70vw] will-change-transform"
          style={{
            animationDelay: "-14s",
            background:
              "radial-gradient(circle at 50% 50%, rgba(255 200 220 / 0.07) 0%, transparent 62%)",
          }}
        />
      </motion.div>

      {/* Spotlight. A single soft shaft from above — the hero's key light. */}
      <motion.div
        className="animate-sweep absolute left-1/2 top-0 h-[78vh] w-[140vw] -translate-x-1/2 will-change-transform"
        style={{
          ...layer,
          clipPath: "polygon(41% 0%, 59% 0%, 76% 100%, 24% 100%)",
          background:
            "linear-gradient(to bottom, rgba(255 255 255 / 0.09) 0%, rgba(255 255 255 / 0.028) 45%, transparent 78%)",
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: started ? 0.18 : 0.6 }}
        transition={{ duration: 2.2, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  );
}
