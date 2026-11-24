"use client";

import { useAudio } from "@/lib/audio/provider";
import { cn, formatTime } from "@/lib/utils";
import { AudioFilePicker } from "./AudioFilePicker";

export function IdleHero() {
  const { tracks, selectDemo, error } = useAudio();

  return (
    <section aria-label="Play something" className="w-full max-w-2xl">
      <div className="flex items-center gap-3">
        <span className="h-px w-8 bg-white/25" />
        <span className="label-micro text-chalk-muted">
          Audio-reactive system
        </span>
      </div>

      <h1 className="mt-5 font-display text-[16vw] leading-[0.82] tracking-[-0.02em] sm:text-[8rem] lg:text-[9.5rem]">
        <span className="text-aurora italic">Wave</span>
        <span className="text-chalk">core</span>
      </h1>

      <p className="mt-5 max-w-md text-xs leading-relaxed text-chalk-muted sm:mt-6 sm:text-sm">
        Not an equaliser. A living form built from the sound itself — bass
        moves the mass and the camera, mid drives the morph, treble bends the
        colour. Pick a track and watch it breathe.
      </p>

      <div className="mt-5 sm:mt-8">
        <div className="label-micro mb-3 text-chalk-muted">
          Play something
        </div>
        <div className="flex flex-wrap gap-2">
          {tracks.map((track, i) => (
            <button
              key={track.slug}
              type="button"
              onClick={() => selectDemo(track)}
              className={cn(
                "pointer-events-auto group relative overflow-hidden rounded-full border border-white/[0.09]",
                "bg-white/[0.03] min-h-11 px-4 py-2.5 text-left backdrop-blur-xl transition-all duration-300",
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
        <div className="mt-4">
          <AudioFilePicker />
        </div>
        <p className="touch-instructions mt-2 text-xs text-chalk-muted">
          Tap a track to play. Drag the seek bar to skip ahead.
        </p>
        <p className="desktop-instructions mt-2 text-xs text-chalk-muted">
          Drop audio anywhere or press <kbd>O</kbd> for sources.
        </p>
        {error && <p role="alert" className="mt-2 text-xs text-red-200">{error}</p>}
      </div>
    </section>
  );
}
