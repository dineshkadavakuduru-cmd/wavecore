"use client";

import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";
import { useAudio } from "@/lib/audio/provider";
import { useChrome } from "@/lib/chrome";
import { cn, formatTime } from "@/lib/utils";
import { CloseIcon, PlayIcon, UploadIcon } from "./icons";

/**
 * Source drawer: bundled tracks on top, upload underneath.
 *
 * Slides in from the right rather than the bottom — the bottom of the frame is
 * where the dock and the hero already live, and a right-hand sheet keeps the
 * centre of the composition (where the 3D actually is) clear.
 */

export function SourcePanel() {
  const {
    tracks,
    source,
    isPlaying,
    selectDemo,
    selectUpload,
    error,
    clearError,
    decode,
  } = useAudio();
  const { panelOpen, setPanelOpen, zen } = useChrome();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const open = panelOpen && !zen;
  const busy = decode.phase !== "idle";

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    void selectUpload(file).catch(() => {
      /* error state is surfaced by the provider */
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Scrim: click-away close, and it dims the scene without hiding it. */}
          <motion.button
            key="scrim"
            type="button"
            aria-label="Close panel"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={() => setPanelOpen(false)}
            className="absolute inset-0 z-10 cursor-default bg-ink-950/35"
          />

          <motion.aside
            key="panel"
            initial={{ opacity: 0, x: 40, filter: "blur(10px)" }}
            animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, x: 40, filter: "blur(10px)" }}
            transition={{ type: "spring", stiffness: 360, damping: 36, mass: 0.9 }}
            className="glass pointer-events-auto absolute bottom-4 right-4 top-4 z-20 flex w-[min(24rem,92vw)] flex-col overflow-hidden rounded-2xl"
            aria-label="Source panel"
          >
            <header className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
              <div>
                <h2 className="label-micro text-chalk-muted">Source</h2>
                <p className="mt-1 text-2xs uppercase tracking-[0.12em] text-chalk-ghost">
                  Bundled demo or your own file
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                aria-label="Close"
                className="chrome-btn h-8 w-8 !rounded-full"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </header>

            <div className="scroll-thin flex-1 overflow-y-auto px-3 py-3">
              <ul className="space-y-1">
                {tracks.map((track, index) => {
                  const active = source?.kind === "demo" && source.track.slug === track.slug;
                  return (
                    <li key={track.slug}>
                      <button
                        type="button"
                        onClick={() => selectDemo(track)}
                        className={cn(
                          "group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-200",
                          active
                            ? "bg-white/[0.08]"
                            : "hover:bg-white/[0.05]",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-8 w-8 shrink-0 place-items-center rounded-full border font-mono text-2xs transition-colors",
                            active
                              ? "border-transparent bg-signal text-ink-950"
                              : "border-white/10 text-chalk-ghost group-hover:border-white/20",
                          )}
                        >
                          {active && isPlaying ? (
                            <PauseBars />
                          ) : (
                            String(index + 1).padStart(2, "0")
                          )}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span
                              className={cn(
                                "truncate text-sm",
                                active ? "text-chalk" : "text-chalk-muted group-hover:text-chalk",
                              )}
                            >
                              {track.title}
                            </span>
                            <span className="shrink-0 font-mono text-2xs text-chalk-ghost">
                              {formatTime(track.duration)}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-2xs uppercase tracking-[0.08em] text-chalk-ghost">
                            {track.bpm} bpm · {track.key} · {track.mood}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              {/* ── upload ─────────────────────────────────────────── */}
              <div className="mt-5 px-2">
                <div className="label-micro mb-2 text-chalk-ghost">Your file</div>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleFiles(e.dataTransfer.files);
                  }}
                  className={cn(
                    "group flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-white/12 px-4 py-7",
                    "transition-colors duration-300 hover:border-white/25 hover:bg-white/[0.03]",
                    "disabled:cursor-progress disabled:opacity-50",
                  )}
                >
                  <UploadIcon className="h-5 w-5 text-chalk-faint transition-colors group-hover:text-chalk" />
                  <span className="text-sm text-chalk-muted group-hover:text-chalk">
                    {busy ? "Working…" : "Choose a file"}
                  </span>
                  <span className="text-2xs uppercase tracking-[0.1em] text-chalk-ghost">
                    or drop it anywhere on the page
                  </span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.opus,.flac,.aif,.aiff"
                  className="hidden"
                  onChange={(e) => {
                    handleFiles(e.target.files);
                    // Allow re-selecting the same file.
                    e.target.value = "";
                  }}
                />

                {source?.kind === "upload" && (
                  <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-xs text-chalk-muted" title={source.name}>
                        {source.name}
                      </span>
                      <span className="shrink-0 font-mono text-2xs text-chalk-ghost">
                        {formatTime(source.duration)}
                      </span>
                    </div>
                    <Waveform peaks={source.peaks} />
                  </div>
                )}

                {error && (
                  <div className="mt-4 rounded-xl border border-red-400/25 bg-red-500/[0.07] p-3">
                    <p className="text-xs leading-relaxed text-red-200/90">{error}</p>
                    <button
                      type="button"
                      onClick={clearError}
                      className="mt-2 font-mono text-2xs uppercase tracking-[0.12em] text-red-200/70 underline-offset-4 hover:underline"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                <p className="mt-4 text-2xs leading-relaxed uppercase tracking-[0.1em] text-chalk-ghost">
                  Decoded fully in the browser. Nothing is uploaded anywhere — there
                  is no server in this project.
                </p>
              </div>
            </div>

            <footer className="border-t border-white/[0.07] px-5 py-3.5">
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 font-mono text-2xs uppercase text-chalk-ghost">
                <Shortcut k="Space" label="play" />
                <Shortcut k="← →" label="seek" />
                <Shortcut k="1–3" label="tracks" />
                <Shortcut k="H" label="hide ui" />
              </div>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/** Downsampled peak envelope for an uploaded track. */
function Waveform({ peaks }: { peaks: Float32Array }) {
  const bars = 64;
  const step = Math.max(1, Math.floor(peaks.length / bars));
  const values: number[] = [];
  for (let i = 0; i < bars; i++) {
    let max = 0;
    for (let j = i * step; j < Math.min(peaks.length, (i + 1) * step); j++) {
      if (peaks[j] > max) max = peaks[j];
    }
    values.push(max);
  }

  return (
    <div className="mt-3 flex h-8 items-center gap-px" aria-hidden="true">
      {values.map((value, i) => (
        <span
          key={i}
          className="flex-1 rounded-full bg-white/20"
          style={{ height: `${Math.max(6, value * 100)}%` }}
        />
      ))}
    </div>
  );
}

/** Static marker for the row that is currently playing — status, deliberately
 *  not a level meter. */
function PauseBars() {
  return (
    <span className="flex items-end gap-[2px]" aria-hidden="true">
      <span className="h-2 w-[2px] rounded-full bg-ink-950" />
      <span className="h-3 w-[2px] rounded-full bg-ink-950" />
      <span className="h-2 w-[2px] rounded-full bg-ink-950" />
    </span>
  );
}

function Shortcut({ k, label }: { k: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <kbd className="rounded border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-chalk-faint">
        {k}
      </kbd>
      <span>{label}</span>
    </span>
  );
}
