"use client";

"use client";

import { useEffect, useState } from "react";

/** Loading indicator shown while the WavecoreCanvas dynamic import resolves. */
export function WavecoreLoading() {
  const [takingLong, setTakingLong] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => setTakingLong(true), 12_000);
    return () => window.clearTimeout(timeout);
  }, []);

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
        {takingLong ? (
          <div className="max-w-xs text-center">
            <p className="font-mono text-2xs uppercase tracking-[0.14em] text-chalk-ghost">
              The 3D scene is taking longer than expected.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-chalk-faint">
              WebGL may be unavailable or the scene bundle may have failed to load.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="chrome-btn mt-4 px-4 py-2 text-xs"
            >
              Retry
            </button>
          </div>
        ) : (
          <p className="font-mono text-2xs uppercase tracking-[0.14em] text-chalk-ghost">
            Initializing&hellip;
          </p>
        )}
      </div>
    </div>
  );
}
