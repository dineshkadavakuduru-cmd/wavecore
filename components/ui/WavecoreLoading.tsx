"use client";

/**
 * Loading indicator shown while the WavecoreCanvas dynamic import resolves.
 * Centered, minimal, uses the design system tokens.
 */
export function WavecoreLoading() {
  return (
    <div
      className="absolute inset-0 grid place-items-center bg-ink-950"
      aria-busy="true"
      aria-label="Initializing 3D scene"
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className="relative w-16 h-16"
          style={{
            animation: "pulse-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite",
          }}
        >
          <svg
            className="w-full h-full text-signal"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <circle
              cx="32"
              cy="32"
              r="28"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeDasharray="175.93"
              strokeDashoffset="0"
              style={{
                animation: "shimmer 3.2s linear infinite",
                transformOrigin: "center",
              }}
            />
          </svg>
          <div
            className="absolute inset-0 rounded-full border-2 border-signal/20"
            style={{
              animation: "pulse-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite",
              animationDelay: "0.6s",
            }}
          />
        </div>
        <p className="font-mono text-2xs uppercase tracking-[0.14em] text-chalk-ghost">
          Initializing&hellip;
        </p>
      </div>
    </div>
  );
}