/**
 * Quality tiers.
 *
 * Bloom is the single biggest contributor to this scene looking like anything at
 * all, so it stays on at every tier — what scales down instead is geometry,
 * particle count, shader octaves and the optional effects. The step-down is
 * deliberately crude: measure average FPS over a window, drop one tier, never
 * climb back up. Oscillating between tiers looks far worse than being one tier
 * too low.
 */

export type QualityTier = "low" | "mid" | "high";

export type QualitySettings = {
  tier: QualityTier;
  /** Points in the spectral bloom field. */
  particleCount: number;
  /** Icosahedron subdivision. Faces = 20 × (detail + 1)². */
  coreDetail: number;
  /** fbm octaves in the core's vertex shader. */
  noiseOctaves: number;
  /** Device pixel ratio clamp. */
  dpr: [number, number];
  /** Bloom mip levels — lower is cheaper. */
  bloomMips: number;
  chromaticAberration: boolean;
  /** Count of drei <Sparkles/> motes; 0 disables. */
  sparkles: number;
};

export const QUALITY: Record<QualityTier, QualitySettings> = {
  high: {
    tier: "high",
    particleCount: 14000,
    coreDetail: 40,
    noiseOctaves: 3,
    dpr: [1, 2],
    bloomMips: 7,
    chromaticAberration: true,
    sparkles: 80,
  },
  mid: {
    tier: "mid",
    particleCount: 6500,
    coreDetail: 26,
    noiseOctaves: 2,
    dpr: [1, 1.6],
    bloomMips: 5,
    chromaticAberration: false,
    sparkles: 40,
  },
  low: {
    tier: "low",
    particleCount: 2800,
    coreDetail: 12,
    noiseOctaves: 2,
    dpr: [1, 1.25],
    bloomMips: 4,
    chromaticAberration: false,
    sparkles: 0,
  },
};

/** Best guess at the starting tier. Over-cautious is worse than wrong here. */
export function detectTier(): QualityTier {
  if (typeof window === "undefined") return "high";

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
  const dpr = window.devicePixelRatio || 1;

  let score = 0;
  score += cores >= 8 ? 2 : cores >= 4 ? 1 : 0;
  score += memory >= 8 ? 2 : memory >= 4 ? 1 : 0;
  if (coarsePointer) score -= 1;
  if (dpr > 2.5) score -= 1;

  if (score >= 3) return "high";
  if (score >= 1) return "mid";
  return "low";
}

export const TIER_ORDER: QualityTier[] = ["high", "mid", "low"];

export function nextTierDown(tier: QualityTier): QualityTier | null {
  const i = TIER_ORDER.indexOf(tier);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}
