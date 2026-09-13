"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { reactive } from "@/lib/audio/reactive";

/**
 * The backdrop, rendered inside the scene rather than as a DOM layer behind a
 * transparent canvas.
 *
 * That choice matters: postprocessing's composer owns the framebuffer, and
 * compositing a transparent WebGL canvas on top of page content through it is
 * fragile (alpha gets clobbered by the copy pass). An inside-out sphere has none
 * of those problems and — the point — its tint can read the same hue uniform as
 * the core, so the wall behind the scene moves with the music too.
 *
 * Kept far below the bloom threshold on purpose; it is a wash, not a light.
 */

const vertexShader = /* glsl */ `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uCameraDir;
uniform float uHue;
uniform float uLevel;
uniform float uBass;
uniform float uAmbient;
varying vec3 vPos;

void main() {
  vec3 dir = normalize(vPos);
  // Screen-radial falloff: 1 where the camera is aimed, ~0 at the frame edges.
  float radial = clamp(dot(dir, normalize(uCameraDir)), 0.0, 1.0);
  float glow = pow(radial, 2.6);

  float hue = fract(0.58 + uHue * 0.3);
  vec3 tint = 0.5 + 0.5 * cos(6.28318530718 * (hue + vec3(0.0, 0.33, 0.67)));

  vec3 base = vec3(0.006, 0.008, 0.019);
  // Idle gets a slightly warmer, more even wash so the pre-play frame reads as
  // deliberate rather than as an underexposed version of the playing frame.
  base += tint * 0.008 * uAmbient;

  // Kept deliberately low. This is the wall the scene sits against, and the
  // measured target for the whole frame is "mostly dark with a hot core" — a
  // backdrop that reads as mid-grey here is what makes the render look washed
  // out once bloom has been added on top of it.
  vec3 color = base + tint * glow * (0.028 + uLevel * 0.07 + uBass * 0.045);
  // Slight vertical falloff keeps the horizon from being perfectly flat.
  color += tint * 0.008 * smoothstep(0.65, -0.25, dir.y);

  gl_FragColor = vec4(color, 1.0);
}
`;

export function Backdrop() {
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => ({
      uCameraDir: { value: new THREE.Vector3(0, 0, 1) },
      uHue: { value: 0.12 },
      uLevel: { value: 0 },
      uBass: { value: 0 },
      uAmbient: { value: 1 },
    }),
    [],
  );

  useFrame((state) => {
    const material = materialRef.current;
    if (!material) return;
    material.uniforms.uCameraDir.value.copy(state.camera.position).normalize();
    material.uniforms.uHue.value = reactive.hue;
    material.uniforms.uLevel.value = reactive.level;
    material.uniforms.uBass.value = reactive.bass;
    material.uniforms.uAmbient.value = reactive.ambient;
  });

  return (
    <mesh scale={40} frustumCulled={false} renderOrder={-1}>
      <sphereGeometry args={[1, 32, 24]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}
