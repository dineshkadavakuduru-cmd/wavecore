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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);

  const handleCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    // The postprocessing composer forces this anyway; setting it explicitly
    // documents that the chain is a straight passthrough of shader values.
    gl.toneMapping = THREE.NoToneMapping;
    gl.setClearColor(0x04050a, 1);
    glRef.current = gl;

    const canvas = gl.domElement;

    const onContextLost = (event: Event) => {
      event.preventDefault();
      console.warn("[Wavecore] WebGL context lost");
      setContextLost(true);
    };

    const onContextRestored = () => {
      console.log("[Wavecore] WebGL context restored");
      setContextLost(false);
      // The renderer will automatically attempt to restore; we just clear the
      // error state. The scene will re-initialize on the next frame.
    };

    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);

    return () => {
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
    };
  }, []);

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

  if (contextLost) {
    return (
      <div className="absolute inset-0 grid place-items-center bg-ink-950 z-40">
        <div className="glass max-w-md w-full mx-6 rounded-2xl p-8 text-center">
          <div
            className="w-14 h-14 mx-auto mb-5 rounded-full border border-white/10 bg-white/[0.04]"
            style={{
              boxShadow:
                "0 1px 0 0 rgb(255 255 255 / 0.06) inset, 0 24px 64px -28px rgb(0 0 0 / 0.9)",
            }}
          >
            <svg
              className="w-7 h-7 mx-auto mt-3.5 text-signal"
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
          <h2 className="text-lg font-medium text-chalk mb-2">
            Graphics context lost
          </h2>
          <p className="text-sm text-chalk-faint mb-6 max-w-sm mx-auto">
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

  return (
    <Canvas
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
  );
}
