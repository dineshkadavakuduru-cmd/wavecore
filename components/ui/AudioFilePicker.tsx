"use client";

import { useId, useRef } from "react";
import { useAudio } from "@/lib/audio/provider";
import { UploadIcon } from "./icons";

export function AudioFilePicker({ onSelected }: { onSelected?: () => void }) {
  const { decode, selectUpload } = useAudio();
  const inputRef = useRef<HTMLInputElement>(null);
  const formatsId = useId();
  const busy = decode.phase !== "idle";

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        aria-describedby={formatsId}
        onClick={() => inputRef.current?.click()}
        className="glass pointer-events-auto inline-flex min-h-11 items-center gap-2 rounded-xl px-4 text-sm text-chalk transition-colors hover:bg-white/10 disabled:opacity-50"
      >
        <UploadIcon className="h-4 w-4" />
        {busy ? "Loading audio…" : "Choose audio file"}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.aif,.aiff,.webm"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) {
            void selectUpload(file).then(onSelected).catch(() => {
              // The audio provider supplies the error message.
            });
          }
        }}
      />
      <p id={formatsId} className="mt-2 text-xs text-chalk-muted">
        WAV, MP3, M4A, AAC, Ogg, Opus, FLAC, AIFF, WebM. Support varies by browser.
      </p>
    </div>
  );
}
