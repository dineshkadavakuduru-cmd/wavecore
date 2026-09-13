"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useAudio } from "@/lib/audio/provider";

/**
 * Window-wide drop target.
 *
 * "Drop an audio file anywhere" is worth the extra surface area — it is the
 * fastest possible path from a video-recording session to something playing, and
 * it means the dropzone inside the panel never has to be found first.
 *
 * The enter/leave counter is the standard fix for the flicker you get from
 * dragleave firing as the pointer crosses child elements.
 */

const AUDIO_HINT = /\.(wav|mp3|m4a|aac|ogg|oga|opus|flac|aif|aiff|webm)$/i;

export function DropOverlay() {
  const { selectUpload } = useAudio();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Required, or the drop event never fires.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };

    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);

      const file = Array.from(e.dataTransfer?.files ?? []).find(
        (f) => f.type.startsWith("audio/") || AUDIO_HINT.test(f.name),
      );
      if (!file) return;
      void selectUpload(file).catch(() => {
        /* the provider owns the error message */
      });
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [selectUpload]);

  return (
    <AnimatePresence>
      {dragging && (
        <motion.div
          key="drop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="pointer-events-none absolute inset-0 z-50 grid place-items-center bg-ink-950/70 backdrop-blur-sm"
          aria-hidden="true"
        >
          <div className="rounded-2xl border border-dashed border-white/25 px-12 py-10 text-center">
            <p className="font-display text-3xl italic text-chalk">Drop to play</p>
            <p className="mt-2 font-mono text-2xs uppercase tracking-[0.18em] text-chalk-faint">
              wav · mp3 · m4a · ogg · flac
            </p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
