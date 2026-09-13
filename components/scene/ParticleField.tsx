"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { reactive, SPECTRUM_SIZE, spectrumBytes } from "@/lib/audio/reactive";
import type { QualitySettings } from "@/lib/quality";
import { particleFragmentShader, particleVertexShader } from "./shaders/particles";

/**
 * Spectral bloom field.
 *
 * Every point is assigned a frequency slot and reads its own column out of the
 * live spectrum texture, so the field is a spatial map of the spectrum: bass
 * lives in the inner shell and gets shoved outward on kicks, treble lives in the
 * outer halo and only shimmers. Nothing pumps in unison — which is exactly what
 * separates this from a bar-graph equaliser.
 *
 * The texture is written straight from the eased spectrum bytes; the smoothing
 * happened on the CPU in `updateReactive`, so this shader is a pure read.
 */

/** Clamped ease-out cubic, 0→1. Used for the mount reveal. */
function easeOutCubic(x: number) {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return 1 - Math.pow(1 - t, 3);
}

type ParticleGeometry = {
  geometry: THREE.BufferGeometry;
  dispose: () => void;
};

/** Deterministic PRNG so the field is identical across reloads. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildParticles(count: number): ParticleGeometry {
  const rand = mulberry32(90210);
  const position = new Float32Array(count * 3);
  const aFreq = new Float32Array(count);
  const aSeed = new Float32Array(count);
  const aRadius = new Float32Array(count);
  const aSize = new Float32Array(count);
  const aSpin = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Frequency slot, biased toward the low end — there is far more perceptual
    // content down there, and it keeps the inner shell densely populated.
    const freq = Math.pow(rand(), 0.78);
    aFreq[i] = freq;

    // Radius is monotonic in frequency: bass inside, treble outside. That is
    // what makes the bloom legible as a spectrum rather than as noise.
    //
    // The range is deliberately tight: with the camera at distance ~5.6 and a
    // 42° FOV, only points within ~2.15 of the view axis are on screen. Shells
    // out to ~2.7 keep the field mostly in frame while still letting the outer
    // halo run off the edges on loud hits — which reads as a field with no
    // boundary rather than a ball floating in space.
    const shell = 1.05 + Math.pow(freq, 0.85) * 1.3;
    const jitter = (rand() - 0.5) * (0.3 + freq * 0.45);
    aRadius[i] = shell + jitter;

    // Uniform direction on the sphere, then flattened into an oblate shell —
    // a disc-ish cloud reads far better under an orbiting camera than a ball.
    const u = rand() * 2 - 1;
    const theta = rand() * Math.PI * 2;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    position[i * 3] = r * Math.cos(theta);
    position[i * 3 + 1] = u * 0.62;
    position[i * 3 + 2] = r * Math.sin(theta);

    aSeed[i] = rand();
    // Bass particles are drawn larger so the low end dominates the silhouette.
    aSize[i] = (0.9 + rand() * 1.7) * (1.0 + (1 - freq) * 0.85);
    // Signed spin: some shells counter-rotate, which creates real parallax.
    aSpin[i] = rand() * 2 - 1;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("aFreq", new THREE.BufferAttribute(aFreq, 1));
  geometry.setAttribute("aSeed", new THREE.BufferAttribute(aSeed, 1));
  geometry.setAttribute("aRadius", new THREE.BufferAttribute(aRadius, 1));
  geometry.setAttribute("aSize", new THREE.BufferAttribute(aSize, 1));
  geometry.setAttribute("aSpin", new THREE.BufferAttribute(aSpin, 1));
  // The shader moves everything; the CPU-side bounds would be wrong and frustum
  // culling would pop the whole field out of view.
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 12);

  return { geometry, dispose: () => geometry.dispose() };
}

export function ParticleField({ quality }: { quality: QualitySettings }) {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { geometry, dispose } = useMemo(
    () => buildParticles(quality.particleCount),
    [quality.particleCount],
  );
  useEffect(() => dispose, [dispose]);

  /**
   * One row of eased spectrum. R8 keeps the upload at 256 bytes/frame — small
   * enough that the per-frame `needsUpdate` costs essentially nothing.
   */
  const texture = useMemo(() => {
    const t = new THREE.DataTexture(
      spectrumBytes,
      SPECTRUM_SIZE,
      1,
      THREE.RedFormat,
      THREE.UnsignedByteType,
    );
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = THREE.ClampToEdgeWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);

  const uniforms = useMemo(
    () => ({
      uSpectrum: { value: texture },
      uTime: { value: 0 },
      uBass: { value: 0 },
      uMid: { value: 0 },
      uTreble: { value: 0 },
      uLevel: { value: 0 },
      uHue: { value: 0.12 },
      uPunch: { value: 0 },
      uBurst: { value: 1.5 },
      uSizeScale: { value: 1 },
      uDrift: { value: 1 },
      uReveal: { value: 0 },
    }),
    [texture],
  );

  useFrame((state, delta) => {
    const material = materialRef.current;
    if (!material) return;
    const u = material.uniforms;

    // Push this frame's eased spectrum. The DataTexture wraps the very same
    // Uint8Array the reactive bus writes into, so this is just a dirty flag.
    texture.needsUpdate = true;

    u.uTime.value = reactive.clock;
    u.uBass.value = reactive.bass;
    u.uMid.value = reactive.mid;
    u.uTreble.value = reactive.treble;
    u.uLevel.value = reactive.level;
    u.uHue.value = reactive.hue;
    u.uPunch.value = reactive.punch;
    // Spectrum-driven expansion — the loudest part of the field pushes furthest.
    u.uBurst.value = 0.7 + reactive.bass * 0.8 + reactive.level * 0.35;

    // Point size must be in device pixels: size / -mvPosition.z means the scale
    // factor has to account for both viewport height and DPR, or the field
    // looks completely different at 1× and 2×.
    const height = state.size.height;
    const dpr = state.viewport.dpr;
    const fov = (state.camera as THREE.PerspectiveCamera).fov;
    u.uSizeScale.value =
      ((height * dpr) / (2 * Math.tan((fov * Math.PI) / 360))) * 0.011;

    // Idle drift is slower and calmer than the playing state.
    u.uDrift.value = 1 - reactive.ambient * 0.45;
    // Mount reveal: the field expands outward from the core over ~3 s.
    u.uReveal.value = easeOutCubic(reactive.clock / 3.0);
  });

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={materialRef}
        vertexShader={particleVertexShader}
        fragmentShader={particleFragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        // Additive: overlapping motes accumulate into the bloom threshold, which
        // is what turns a dense band into a glowing band.
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
