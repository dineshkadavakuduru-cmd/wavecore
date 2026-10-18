"use client";

import { Canvas } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { useAudio } from "@/lib/audio/provider";
import { Scene } from "./Scene";

/**
 * The canvas itself.
 *
 * `alpha: false` and no DOM layer behind the scene — the backdrop lives inside
 * the 3D scene (see Backdrop.tsx) so postprocessing owns exactly one
 * framebuffer and there is no transparent-canvas compositing to go wrong.
 */
export function WavecoreCanvas() {
  const { quality, reportSlowFrameBudget } = useAudio();
  const [failed, setFailed] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  // Bumped to force a clean rebuild of the whole canvas (renderer + post-processing
  // composer) after a context loss. The composer holds render targets that
  // reference the dead context and cannot be reused in place, so the reliable
  // recovery is to tear the canvas down and mount a fresh one against a new
  // context. `rebuilds` bounds how many times we'll try before giving up, so a
  // permanently broken GPU can't loop forever.
  const [epoch, setEpoch] = useState(0);
  const rebuilds = useRef(0);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);

  const handleCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    // The postprocessing composer forces this anyway; setting it explicitly
    // documents that the chain is a straight passthrough of shader values.
    gl.toneMapping = THREE.NoToneMapping;
    gl.setClearColor(0x04050a, 1);
    glRef.current = gl;

    const canvas = gl.domElement;
    const onContextLost = (event: Event) => {
      // preventDefault keeps the browser willing to hand back a context at all,
      // but recovery here is a fresh mount, not a restore-in-place.
      event.preventDefault();
      if (process.env.NODE_ENV !== "production") {
        console.warn("[Wavecore] WebGL context lost");
      }
      setContextLost(true);
    };

    canvas.addEventListener("webglcontextlost", onContextLost);
    return () => canvas.removeEventListener("webglcontextlost", onContextLost);
  }, []);

  // After a loss, wait a beat (a real GPU reset needs a moment) then mount a
  // brand-new canvas. If it loses context again we come straight back here; two
  // tries is enough before declaring WebGL unusable.
  useEffect(() => {
    if (!contextLost) return;
    if (rebuilds.current >= 2) {
      setFailed(true);
      return;
    }
    rebuilds.current += 1;
    const id = window.setTimeout(() => {
      setContextLost(false);
      setEpoch((n) => n + 1);
    }, 900);
    return () => window.clearTimeout(id);
  }, [contextLost]);

  if (failed) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-ink-950">
        <p className="max-w-sm text-center text-sm text-chalk-faint">
          This browser can&apos;t start WebGL2, which the visualiser needs. Try a
          recent Chrome, Edge, Firefox or Safari with hardware acceleration on.
        </p>
      </div>
    );
  }

  return (
    <>
      {/* The canvas is torn down while the context is dead rather than left
          mounted: keeping it would run the frame loop (and the composer) against
          a null context, which throws. It is remounted above once we're ready. */}
      {!contextLost && (
        <Canvas
          key={epoch}
          className="absolute inset-0"
          style={{ touchAction: "none" }}
          dpr={quality.dpr}
          camera={{ fov: 42, near: 0.1, far: 120, position: [0, 3, 14] }}
          gl={{
            antialias: false, // MSAA is handled by the composer's render target
            alpha: false,
            stencil: false,
            depth: true,
            powerPreference: "high-performance",
            failIfMajorPerformanceCaveat: false,
          }}
          onCreated={handleCreated}
          onError={() => setFailed(true)}
          // The scene animates continuously; there is no idle state worth saving
          // frames for, and a paused loop would freeze the visuals.
          frameloop="always"
          role="img"
          aria-label="Audio-reactive 3D visualizer responding to music"
        >
          <Scene quality={quality} onSlowFps={reportSlowFrameBudget} />
        </Canvas>
      )}

      {contextLost && <ContextLostOverlay />}
    </>
  );
}

function ContextLostOverlay() {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-ink-950">
      <div className="glass mx-6 w-full max-w-md rounded-2xl p-8 text-center">
        <div
          className="mx-auto mb-5 h-14 w-14 rounded-full border border-white/10 bg-white/[0.04]"
          style={{
            boxShadow:
              "0 1px 0 0 rgb(255 255 255 / 0.06) inset, 0 24px 64px -28px rgb(0 0 0 / 0.9)",
          }}
        >
          <svg
            className="mx-auto mt-3.5 h-7 w-7 text-signal"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
        </div>
        <h2 className="mb-2 text-lg font-medium text-chalk">
          Graphics context lost
        </h2>
        <p className="mx-auto mb-6 max-w-sm text-sm text-chalk-faint">
          The GPU device was reset (driver update, sleep/wake, or memory
          pressure). The scene will attempt to recover automatically.
        </p>
        <p className="font-mono text-2xs uppercase text-chalk-ghost">
          Waiting for context restore&hellip;
        </p>
      </div>
    </div>
  );
}
