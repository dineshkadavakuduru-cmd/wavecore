"use client";

import { useAudio } from "@/lib/audio/provider";
import { BAND_RANGES, FFT_SIZE } from "@/lib/audio/reactive";
import { cn } from "@/lib/utils";

/**
 * Corner telemetry.
 *
 * Deliberately text, not a meter: a live three-bar level display would be the
 * exact Winamp cliché this project is defined against, and it would also be a
 * lie — the interesting mapping (bass→pulse, mid→morph, treble→hue) isn't three
 * bars, it's the whole scene. Numbers that describe the *system* say more.
 */
export function Telemetry() {
  const { source, isPlaying, quality } = useAudio();

  const mode = !source ? "IDLE" : isPlaying ? "PLAYING" : "PAUSED";
  const sourceName =
    source?.kind === "demo"
      ? source.track.title
      : source?.kind === "upload"
        ? source.name
        : "—";

  return (
    <div className="pointer-events-none select-none text-right font-mono">
      <div className="flex items-center justify-end gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full transition-colors duration-500",
            isPlaying
              ? "bg-signal shadow-[0_0_10px_2px_rgb(var(--signal-rgb)_/_0.55)]"
              : "bg-chalk-ghost",
          )}
        />
        <span className="text-2xs uppercase tracking-[0.2em] text-chalk-muted">
          {mode}
        </span>
      </div>

      {/* The system readout is a desktop flourish; the status dot above is what
          matters at a glance and it survives on every screen size. */}
      <dl className="mt-3 hidden space-y-1 text-2xs uppercase leading-relaxed text-chalk-faint sm:block">
        <Row label="src" value={truncate(sourceName, 26)} />
        <Row label="fft" value={`${FFT_SIZE} · ${bandCount()} bands`} />
        <Row
          label="render"
          value={`${quality.tier} · ${(quality.particleCount / 1000).toFixed(
            quality.particleCount >= 10000 ? 0 : 1,
          )}k pts`}
        />
        <Row
          label="core"
          value={`detail ${quality.coreDetail} · ${quality.noiseOctaves} oct`}
        />
      </dl>
    </div>
  );
}

function bandCount() {
  return Object.keys(BAND_RANGES).length;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-end gap-2">
      <dt className="text-chalk-ghost">{label}</dt>
      <dd className="text-chalk-muted">{value}</dd>
    </div>
  );
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
