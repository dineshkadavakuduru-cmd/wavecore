"use client";

import { Sparkles } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { reactive } from "@/lib/audio/reactive";

/**
 * A thin dusting of motes over the whole frame, brightest on treble.
 *
 * drei's <Sparkles/> exposes no opacity uniform — opacity is a per-particle
 * vertex attribute — so the array behind that attribute is allocated here and
 * rewritten each frame. That keeps it genuinely reactive (and it is 80 floats a
 * frame, which is nothing) instead of being a static decoration.
 */

/** Hoisted so the identity is stable across renders — drei re-seeds particle
 *  positions whenever `scale` changes reference. */
const SCALE: [number, number, number] = [11, 6, 11];

export function SparkleLayer({ count }: { count: number }) {
  const ref = useRef<THREE.Points>(null);
  const opacity = useMemo(() => new Float32Array(count), [count]);

  useFrame(() => {
    const geometry = ref.current?.geometry;
    if (!geometry) return;
    const attribute = geometry.getAttribute("opacity");
    if (!attribute) return;
    const array = attribute.array as Float32Array;
    // Never fully off: a faint dusting is part of the grade even in quiet parts.
    const target = 0.05 + reactive.treble * 0.8 + reactive.punch * 0.25;
    for (let i = 0; i < array.length; i++) array[i] = target;
    attribute.needsUpdate = true;
  });

  return (
    <Sparkles
      ref={ref}
      count={count}
      scale={SCALE}
      size={2.4}
      speed={0.3}
      noise={[0.7, 0.7, 0.7]}
      opacity={opacity}
      color="#cfe0ff"
    />
  );
}
