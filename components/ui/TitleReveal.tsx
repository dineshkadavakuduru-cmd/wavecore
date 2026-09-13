"use client";

import anime from "animejs";
import { useEffect, useRef, useState } from "react";
import { useAudio } from "@/lib/audio/provider";

/**
 * Track-title reveal, on anime.js.
 *
 * This is exactly the kind of moment anime.js is here for: a discrete, one-shot,
 * per-character flourish that has nothing to do with audio data. It fires once
 * when the loaded source changes — never per frame — so it can afford a
 * stagger, a per-character easing curve and a hold, none of which would be
 * acceptable in the reactive path.
 *
 * The reveal is keyed on the source identity, not on play/pause, so scrubbing
 * around doesn't retrigger it.
 */

const HOLD_MS = 2200;

export function TitleReveal() {
  const { source } = useAudio();
  const [visible, setVisible] = useState<{ title: string; meta: string } | null>(
    null,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const lastId = useRef<string | null>(null);

  const sourceId = source?.id ?? null;
  useEffect(() => {
    if (!source || !sourceId || sourceId === lastId.current) return;
    lastId.current = sourceId;

    if (source.kind === "demo") {
      setVisible({
        title: source.track.title,
        meta: `${source.track.artist} · ${source.track.bpm} BPM · ${source.track.key}`,
      });
    } else {
      setVisible({
        title: source.name.replace(/\.[^.]+$/, ""),
        meta: `uploaded file · ${source.duration.toFixed(0)}s decoded`,
      });
    }
  }, [source, sourceId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!visible || !root) return;

    const chars = root.querySelectorAll<HTMLElement>("[data-char]");
    anime.remove(chars);

    const timeline = anime.timeline({
      easing: "easeOutExpo",
      complete: () => setVisible(null),
    });

    timeline
      .add({
        targets: chars,
        opacity: [0, 1],
        translateY: [34, 0],
        rotateZ: [5, 0],
        duration: 950,
        delay: anime.stagger(26),
      })
      .add(
        {
          targets: root.querySelectorAll("[data-meta]"),
          opacity: [0, 1],
          translateY: [10, 0],
          duration: 700,
        },
        "-=500",
      )
      .add(
        {
          targets: chars,
          opacity: [1, 0],
          translateY: [0, -18],
          duration: 620,
          delay: anime.stagger(9),
        },
        `+=${HOLD_MS}`,
      )
      .add(
        {
          targets: root.querySelectorAll("[data-meta]"),
          opacity: 0,
          duration: 400,
        },
        "-=500",
      );

    return () => {
      timeline.pause();
      anime.remove(chars);
    };
  }, [visible]);

  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center">
      {/* No AnimatePresence here on purpose: anime.js owns both the entrance and
          the exit of this block, including its own hold and teardown. */}
      {visible && (
        <div ref={rootRef} className="px-6 text-center">
          <h2 className="font-display text-5xl leading-none tracking-[-0.01em] sm:text-7xl lg:text-8xl">
            {splitChars(visible.title).map((char, i) => (
              <span
                key={`${char}-${i}`}
                data-char
                className="inline-block text-chalk opacity-0 will-change-transform"
              >
                {char === " " ? "\u00A0" : char}
              </span>
            ))}
          </h2>
          <p
            data-meta
            className="mt-4 font-mono text-2xs uppercase tracking-[0.22em] text-chalk-faint opacity-0"
          >
            {visible.meta}
          </p>
        </div>
      )}
    </div>
  );
}

/** Split into grapheme-ish units so combining marks stay attached. */
function splitChars(value: string) {
  return Array.from(value);
}
