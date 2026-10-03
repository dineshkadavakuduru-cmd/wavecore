"use client";

import { useEffect } from "react";
import { useAudio } from "@/lib/audio/provider";
import { useChrome } from "@/lib/chrome";

/**
 * Visually hidden live region for screen readers.
 * Announces track changes, upload completion, and playback state.
 */
export function LiveRegion() {
  const { source, isPlaying, isLoaded } = useAudio();
  const { zen } = useChrome();

  const announce = (message: string) => {
    const region = document.getElementById("wavecore-live-region");
    if (region) {
      // Clear first to ensure re-announcement if same message
      region.textContent = "";
      // Small delay to ensure the clear is processed
      requestAnimationFrame(() => {
        region.textContent = message;
      });
    }
  };

  useEffect(() => {
    if (!source) return;
    if (source.kind === "demo") {
      announce(`Now playing: ${source.track.title}`);
    } else {
      announce(`Now playing uploaded track: ${source.name}`);
    }
  }, [source]);

  useEffect(() => {
    if (isLoaded && isPlaying) {
      announce("Playback started");
    } else if (isLoaded && !isPlaying) {
      announce("Playback paused");
    }
  }, [isPlaying, isLoaded]);

  if (zen) return null; // No announcements in zen mode

  return (
    <div
      id="wavecore-live-region"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      aria-hidden="false"
    />
  );
}

/** Utility: visually hidden but accessible to screen readers. */
const srOnly = `
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`;