"use client";

import { Canvas } from "@react-three/fiber";
import { useCallback, useState } from "react";
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

  const handleCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    // The postprocessing composer forces this anyway; setting it explicitly
    // documents that the chain is a straight passthrough of shader values.
    gl.toneMapping = THREE.NoToneMapping;
    gl.setClearColor(0x04050a, 1);
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
    >
      <Scene quality={quality} onSlowFps={reportSlowFrameBudget} />
    </Canvas>
  );
}
