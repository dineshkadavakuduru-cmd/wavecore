/**
 * Inline icons. Hand-rolled rather than pulled from a library: this chrome uses
 * seven glyphs, all on a shared 24px grid at 1.5px stroke, and a dependency
 * would only add weight and stylistic drift.
 */

type IconProps = {
  className?: string;
};

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function PlayIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M8 5.5v13l11-6.5-11-6.5Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PauseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <rect x="7" y="5.5" width="3.2" height="13" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.8" y="5.5" width="3.2" height="13" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function PrevIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M18 6v12L9.5 12 18 6Z" fill="currentColor" stroke="none" />
      <path d="M6.5 6v12" />
    </svg>
  );
}

export function NextIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M6 6v12l8.5-6L6 6Z" fill="currentColor" stroke="none" />
      <path d="M17.5 6v12" />
    </svg>
  );
}

export function VolumeIcon({ className, muted = false }: IconProps & { muted?: boolean }) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4 9.5h3L11 6v12L7 14.5H4v-5Z" fill="currentColor" stroke="none" />
      {muted ? (
        <path d="M15 9.5 20 14.5M20 9.5 15 14.5" />
      ) : (
        <>
          <path d="M14.5 9.2a4 4 0 0 1 0 5.6" />
          <path d="M17 6.7a7.6 7.6 0 0 1 0 10.6" />
        </>
      )}
    </svg>
  );
}

/** Sliders — opens the source panel (track picker + upload). */
export function SlidersIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M5 8h9M18 8h1M5 16h3M12 16h7" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </svg>
  );
}

/** Recording mode: collapse the chrome away entirely. */
export function CollapseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M4.5 9V5.5a1 1 0 0 1 1-1H9M15 4.5h3.5a1 1 0 0 1 1 1V9M19.5 15v3.5a1 1 0 0 1-1 1H15M9 19.5H5.5a1 1 0 0 1-1-1V15" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
    </svg>
  );
}

export function UploadIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <path d="M12 16V5m0 0L8 9m4-4 4 4" />
      <path d="M4.5 15v2.5a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V15" />
    </svg>
  );
}

export function MicIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} aria-hidden="true">
      <rect x="9.25" y="3.5" width="5.5" height="10" rx="2.75" />
      <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0" />
      <path d="M12 17v3.5" />
    </svg>
  );
}
