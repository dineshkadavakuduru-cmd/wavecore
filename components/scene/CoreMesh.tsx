"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { reducedMotion } from "@/lib/motion";
import { reactive } from "@/lib/audio/reactive";
import type { QualitySettings } from "@/lib/quality";
import { coreFragmentShader, coreVertexShader } from "./shaders/core";

/**
 * The breathing core.
 *
 * Band mapping, kept deliberately one-to-one so no single band drives
 * everything:
 *   bass   → pulse scale (whole form expands on hits)
 *   mid    → morph depth + rotation speed
 *   treble → hue + surface shimmer (in the fragment shader)
 *   level  → overall brightness
 *   punch  → white-hot flash
 */
/** Clamped ease-out cubic, 0→1. */
function easeOutCubic(x: number) {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return 1 - Math.pow(1 - t, 3);
}

export function CoreMesh({ quality }: { quality: QualitySettings }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uLevel: { value: 0 },
      uHue: { value: 0.12 },
      uPunch: { value: 0 },
      // Base radius is chosen against the camera's frustum (see the note in the
      // vertex shader): ~1.0 quiet, up to ~1.5 on a hard bass hit.
      uRadius: { value: 0.95 },
      uNoiseScale: { value: 1.85 },
      uMorph: { value: 0.16 },
      uWarp: { value: 0.55 },
      uFlow: { value: new THREE.Vector3(0, 0.06, 0.09) },
    }),
    [],
  );

  // Displacement is re-evaluated 3× per vertex (centre + two tangent samples)
  // for the normal rebuild, so vertex count is the real cost driver here.
  const geometry = useMemo(
    () => new THREE.IcosahedronGeometry(1, quality.coreDetail),
    [quality.coreDetail],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const spin = useRef(0);
  const tilt = useRef(0);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const material = materialRef.current;
    const mesh = meshRef.current;
    if (!material || !mesh) return;

    const u = material.uniforms;
    u.uTime.value = reactive.clock;
    u.uBass.value = reactive.bass;
    u.uMid.value = reactive.mid;
    u.uTreble.value = reactive.treble;
    u.uLevel.value = reactive.level;
    u.uHue.value = reactive.hue;
    u.uPunch.value = reactive.punch;

    // Mid drives how deep the noise is allowed to bite, so the silhouette
    // changes character between a pad-heavy and a drum-heavy section.
    // Reduced motion halves that bite range.
    u.uMorph.value = reducedMotion.value
      ? 0.12 + reactive.mid * 0.14
      : 0.12 + reactive.mid * 0.32;
    // Treble opens the noise field up slightly — busier surface detail.
    u.uNoiseScale.value = 1.7 + reactive.treble * (reducedMotion.value ? 0.3 : 0.9);
    // Bass enlarges the whole body a touch beyond the shader-side pulse, so the
    // mass reads as heavier rather than just spikier. The ease-out cubic is the
    // mount reveal — the core grows into place rather than popping in.
    // Reduced motion keeps that tiny breathing but drops the reactive swell.
    const reveal = easeOutCubic(reactive.clock / 2.4);
    u.uRadius.value = reducedMotion.value
      ? (0.95 + reactive.bass * 0.03) * (0.42 + reveal * 0.58)
      : (0.95 + reactive.bass * 0.14 + reactive.punch * 0.05) * (0.42 + reveal * 0.58);

    // Mid drives rotation speed — a fast passage visibly spins the core up.
    // Reduced motion holds rotation at its floor speed.
    spin.current += reducedMotion.value
      ? dt * 0.05
      : dt * (0.05 + reactive.mid * 0.42 + reactive.treble * 0.1);
    mesh.rotation.y = spin.current;
    // Slow independent tilt, so the axis is never static.
    tilt.current += reducedMotion.value ? dt * 0.012 : dt * (0.012 + reactive.mid * 0.06);
    mesh.rotation.x = Math.sin(tilt.current * 2.1) * 0.24 + (reducedMotion.value ? 0 : reactive.bass * 0.07);
    mesh.rotation.z = Math.cos(tilt.current * 1.4) * 0.1;

    const scale = reducedMotion.value ? 1 : 1 + reactive.punch * 0.035;
    mesh.scale.setScalar(scale);
  });

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={coreVertexShader}
        fragmentShader={coreFragmentShader}
        uniforms={uniforms}
        defines={{ OCTAVES: quality.noiseOctaves }}
      />
    </mesh>
  );
}
