import { COSINE_PALETTE, SIMPLEX_3D } from "./noise";

/**
 * Core mesh shaders.
 *
 * Vertex: radial displacement along the surface normal, from fbm simplex noise
 * combined with the smoothed bass uniform. The *normal* is rebuilt analytically
 * by re-evaluating the displacement field at two tangent offsets and crossing
 * the resulting edge vectors — otherwise the lighting would be baked to the
 * undisplaced sphere and every ridge would read flat.
 *
 * Fragment: hue comes from the smoothed treble uniform, brightness from overall
 * amplitude. Nothing in here is a fixed palette; this is the deliberate
 * exception to the project's one-accent-colour rule.
 */

export const coreVertexShader = /* glsl */ `
uniform float uTime;
uniform float uBass;
uniform float uMid;
uniform float uPunch;
uniform float uRadius;
uniform float uNoiseScale;
uniform float uMorph;
uniform float uWarp;
uniform vec3  uFlow;

varying vec3  vNormal;
varying vec3  vViewDir;
varying float vDisp;
varying vec3  vLocalPos;
varying float vBurst;

${SIMPLEX_3D}

float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < OCTAVES; i++) {
    value += amplitude * snoise(p);
    p *= 2.03;
    amplitude *= 0.5;
  }
  return value;
}

/** Displacement field. Pure function of direction + time, so it can be sampled
 *  repeatedly for the normal rebuild without drifting. */
float displacement(vec3 dir) {
  vec3 q = dir * uNoiseScale + uFlow * uTime;
  // A slow second warp keeps the surface from ever settling into a fixed shape.
  vec3 warp = vec3(
    snoise(q.yzx + uTime * 0.07),
    snoise(q.zxy + uTime * 0.09),
    snoise(q.xyz + uTime * 0.05)
  ) * uWarp;
  return fbm(q + warp);
}

/** Displaced position for a given direction. */
vec3 displacedAt(vec3 dir, float pulse, float morph) {
  float d = displacement(dir);
  return dir * uRadius * (1.0 + pulse + d * morph);
}

void main() {
  vec3 dir = normalize(position);

  // Bass expands the whole form; mid deepens the morph so it reads as a
  // breathing organism rather than a wobbling balloon.
  // Sized against the camera: at distance 5.6 and 42° FOV the visible radius is
  // ~2.15, and these constants put the quiet core at ~1.0 and a hard hit's
  // crests at ~1.5 — roughly 70% of frame height at its loudest, never clipped.
  float pulse = uBass * 0.30;
  float morph = uMorph + uMid * 0.30;

  float d = displacement(dir);
  vec3 displaced = dir * uRadius * (1.0 + pulse + d * morph);

  // ── analytic normal rebuild ───────────────────────────────────────────
  vec3 reference = abs(dir.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 tangent = normalize(cross(dir, reference));
  vec3 bitangent = cross(dir, tangent);

  const float EPS = 0.035;
  vec3 dirA = normalize(dir + tangent * EPS);
  vec3 dirB = normalize(dir + bitangent * EPS);
  vec3 posA = displacedAt(dirA, pulse, morph);
  vec3 posB = displacedAt(dirB, pulse, morph);

  vec3 normal = normalize(cross(posA - displaced, posB - displaced));

  vDisp = clamp(d * 0.5 + 0.5, 0.0, 1.0);
  vBurst = pulse;
  vLocalPos = displaced;
  vNormal = normalize(normalMatrix * normal);

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  vViewDir = normalize(-mvPosition.xyz);

  gl_Position = projectionMatrix * mvPosition;
}
`;

export const coreFragmentShader = /* glsl */ `
uniform float uTime;
uniform float uBass;
uniform float uTreble;
uniform float uLevel;
uniform float uHue;
uniform float uPunch;

varying vec3  vNormal;
varying vec3  vViewDir;
varying float vDisp;
varying vec3  vLocalPos;
varying float vBurst;

${COSINE_PALETTE}

${SIMPLEX_3D}

void main() {
  vec3 n = normalize(vNormal);
  vec3 viewDir = normalize(vViewDir);

  float facing = clamp(dot(n, viewDir), 0.0, 1.0);
  // Two fresnels: a broad sheen and a tight rim, which together sell "hot
  // membrane" far better than a single power term.
  float sheen = pow(1.0 - facing, 1.7);
  float rim = pow(1.0 - facing, 4.2);

  // Treble sets the hue. The band is narrow on purpose — this should drift
  // within a cinematic blue→violet→magenta range, not cycle the whole wheel.
  float hue = fract(0.58 + uHue * 0.30);

  // Ridges read hotter than troughs, so the noise structure stays legible even
  // when the fresnel is doing most of the work.
  float crest = vDisp;
  float t = hue + crest * 0.11 + rim * 0.14;

  vec3 deep = palette(
    t - 0.12,
    vec3(0.055, 0.065, 0.130),
    vec3(0.085, 0.075, 0.140),
    vec3(1.0),
    vec3(0.08, 0.24, 0.46)
  );
  vec3 hot = palette(
    t,
    vec3(0.50, 0.52, 0.66),
    vec3(0.44, 0.42, 0.54),
    vec3(1.0),
    vec3(0.00, 0.13, 0.28)
  );

  vec3 color = mix(deep, hot, crest * 0.72);
  color += hot * sheen * (0.42 + uBass * 0.85);
  color += hot * rim * (1.0 + uTreble * 1.5);

  // Crest glow, scaled by bass so kicks make the ridges flare.
  color += hot * smoothstep(0.42, 0.98, crest) * (0.25 + uBass * 0.7);

  // Interference shimmer: high-frequency noise gated by treble. This is what
  // makes hats and air read as sparkle on the surface itself.
  float grain = snoise(vLocalPos * 9.0 + vec3(0.0, uTime * 0.35, 0.0));
  color += vec3(0.75, 0.85, 1.0) * smoothstep(0.35, 1.0, grain) * uTreble * 0.55;

  // Overall amplitude → brightness, with a floor so idle isn't pitch black.
  //
  // Held well back on purpose. Bloom and the additive particle field both pile
  // on top of this, so a core that already reaches white here loses all of its
  // own surface detail by the time it hits the screen — and the surface morphing
  // is the entire subject. Measured target for the centre of the frame during
  // playback is a bright-but-structured ~0.5–0.7, not 1.0.
  color *= 0.26 + uLevel * 0.85;

  // Punch adds a brief white-hot flash across the whole core.
  color += (hot + vec3(0.25)) * uPunch * 0.16;

  gl_FragColor = vec4(color, 1.0);
}
`;
