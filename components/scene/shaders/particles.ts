import { COSINE_PALETTE } from "./noise";

/**
 * Spectral bloom particle shaders.
 *
 * Each point carries an `aFreq` slot in 0–1 and reads its own column out of the
 * eased spectrum texture. That is the whole trick behind the field reading as a
 * spectrum rather than one uniform pulse: bass particles sit in the inner shell
 * and shove outward on kicks, treble particles live in the outer halo and only
 * shimmer. Nothing pumps in unison.
 *
 * The spectrum texture arrives already eased (see lib/audio/reactive.ts), so
 * there is no smoothing stage here — the shader is a pure read.
 */

export const particleVertexShader = /* glsl */ `
uniform sampler2D uSpectrum;
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uPunch;
uniform float uBurst;
uniform float uSizeScale;
uniform float uDrift;
uniform float uReveal;

attribute float aFreq;
attribute float aSeed;
attribute float aRadius;
attribute float aSize;
attribute float aSpin;

varying float vEnergy;
varying float vFreq;
varying float vSeed;
varying float vRadius;

void main() {
  // This particle's own slice of the eased spectrum.
  float energy = texture2D(uSpectrum, vec2(aFreq, 0.5)).r;

  // Radial displacement: a global bass push, plus a per-band bloom so the
  // spectrum is legible as a shape rather than just a brightness change.
  // uReveal drives the mount animation — the field expands out of the core.
  float radius = aRadius * mix(0.18, 1.0, uReveal) * (1.0 + uBass * 0.42 + uPunch * 0.20);
  radius += energy * uBurst * (0.22 + aFreq * 0.95);

  vec3 p = position * radius;

  // Orbital drift. Speed varies per particle so the shell never looks rigid.
  float angle = uTime * (0.05 + aSpin * 0.24) * uDrift + aSeed * 6.28318530718;
  float s = sin(angle);
  float c = cos(angle);
  p.xz = mat2(c, -s, s, c) * p.xz;

  // Vertical breathing, driven by mid — a slow inhale that keeps the silhouette
  // from sitting perfectly still between hits.
  p.y += sin(uTime * (0.35 + aSeed * 0.55) + aSeed * 12.0) * (0.05 + uMid * 0.16);

  // Kick response: a brief outward shove that decays with the punch uniform.
  p += normalize(p + 0.0001) * uPunch * 0.16 * (0.35 + energy);

  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  // Energy scales the sprite, so a loud band reads as both brighter and larger —
  // that double-coding is what makes the bloom legible in a compressed video.
  gl_PointSize = uSizeScale * aSize * (1.0 + energy * 2.4) * (1.0 / max(0.001, -mvPosition.z));

  vEnergy = energy;
  vFreq = aFreq;
  vSeed = aSeed;
  vRadius = aRadius;
}
`;

export const particleFragmentShader = /* glsl */ `
uniform float uTime;
uniform float uHue;
uniform float uTreble;
uniform float uLevel;

varying float vEnergy;
varying float vFreq;
varying float vSeed;
varying float vRadius;

${COSINE_PALETTE}

void main() {
  // Round soft sprite with a tight core — cheaper and better-looking than a
  // textured quad, and it needs no asset.
  vec2 uv = gl_PointCoord - 0.5;
  float dist = length(uv);
  if (dist > 0.5) discard;

  float falloff = smoothstep(0.5, 0.0, dist);
  float glow = pow(falloff, 2.4);

  // Hue shared with the core, offset outward along the spectrum so the halo is
  // slightly cooler than the body.
  float hue = fract(0.58 + uHue * 0.30 + vFreq * 0.17);
  vec3 tint = 0.5 + 0.5 * cos(6.28318530718 * (hue + vec3(0.0, 0.33, 0.67)));

  // Loud bands blow out toward white, which is what makes peaks punch through
  // the bloom instead of just getting more saturated.
  vec3 color = mix(tint * 0.5, vec3(1.0, 0.97, 0.92), pow(vEnergy, 1.7) * 0.5);

  // Treble shimmer: per-particle phase so the sparkle never sweeps in unison.
  float twinkle = 0.82 + 0.18 * sin(uTime * 7.5 + vSeed * 43.0);
  color *= twinkle * (0.8 + uTreble * 0.7);

  // Per-mote alpha is modest on purpose — the field relies on additive overlap
  // (and bloom on top of that) to build its highlights. Cranking this up just
  // saturates the whole frame instead of making the peaks brighter.
  float alpha = glow * (0.035 + vEnergy * 0.38) * (0.3 + uLevel * 0.6);
  // Fade only the very outermost shell so the field has no hard edge. The
  // thresholds track the generator's radius range in ParticleField.tsx — fading
  // from 0.75 was wiping out most of the field before this was aligned.
  alpha *= 1.0 - smoothstep(2.15, 2.75, vRadius);

  if (alpha < 0.002) discard;

  gl_FragColor = vec4(color, alpha);
}
`;
