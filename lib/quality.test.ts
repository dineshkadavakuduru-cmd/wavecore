import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  detectTier,
  nextTierDown,
  QUALITY,
  TIER_ORDER,
  type QualityTier,
  type QualitySettings,
} from "@/lib/quality";

describe("lib/quality.ts", () => {
  describe("QUALITY tiers", () => {
    it("has three tiers", () => {
      expect(Object.keys(QUALITY)).toEqual(["high", "mid", "low"]);
    });

    it("high tier has highest settings", () => {
      const high = QUALITY.high;
      const mid = QUALITY.mid;
      const low = QUALITY.low;

      expect(high.particleCount).toBeGreaterThan(mid.particleCount);
      expect(mid.particleCount).toBeGreaterThan(low.particleCount);

      expect(high.coreDetail).toBeGreaterThan(mid.coreDetail);
      expect(mid.coreDetail).toBeGreaterThan(low.coreDetail);

      expect(high.noiseOctaves).toBeGreaterThanOrEqual(mid.noiseOctaves);
      expect(mid.noiseOctaves).toBeGreaterThanOrEqual(low.noiseOctaves);

      expect(high.bloomMips).toBeGreaterThan(mid.bloomMips);
      expect(mid.bloomMips).toBeGreaterThan(low.bloomMips);

      expect(high.sparkles).toBeGreaterThan(mid.sparkles);
      expect(mid.sparkles).toBeGreaterThan(low.sparkles);

      expect(high.chromaticAberration).toBe(true);
      expect(mid.chromaticAberration).toBe(false);
      expect(low.chromaticAberration).toBe(false);
    });

    it("each tier has all required properties", () => {
      const requiredKeys: (keyof QualitySettings)[] = [
        "tier",
        "particleCount",
        "coreDetail",
        "noiseOctaves",
        "dpr",
        "bloomMips",
        "chromaticAberration",
        "sparkles",
      ];

      for (const tier of ["high", "mid", "low"] as QualityTier[]) {
        const settings = QUALITY[tier];
        for (const key of requiredKeys) {
          expect(settings).toHaveProperty(key);
        }
        expect(settings.tier).toBe(tier);
      }
    });
  });

  describe("TIER_ORDER", () => {
    it("is ordered high -> mid -> low", () => {
      expect(TIER_ORDER).toEqual(["high", "mid", "low"]);
    });
  });

  describe("nextTierDown", () => {
    it("returns mid for high", () => {
      expect(nextTierDown("high")).toBe("mid");
    });

    it("returns low for mid", () => {
      expect(nextTierDown("mid")).toBe("low");
    });

    it("returns null for low", () => {
      expect(nextTierDown("low")).toBeNull();
    });

    it("returns null for unknown tier", () => {
      expect(nextTierDown("unknown" as QualityTier)).toBeNull();
    });
  });

  describe("detectTier", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it("returns high on server (no window)", () => {
      // Simulate server environment
      const originalWindow = global.window;
      // @ts-ignore
      delete global.window;
      try {
        expect(detectTier()).toBe("high");
      } finally {
        global.window = originalWindow;
      }
    });

    it("uses defaults when navigator properties are unavailable", () => {
      vi.stubGlobal("window", {
        matchMedia: vi.fn(() => ({ matches: false })),
        devicePixelRatio: 1,
      });

      // In jsdom, navigator.hardwareConcurrency and deviceMemory may not be configurable
      // Test that the function doesn't throw and returns a valid tier
      const tier = detectTier();
      expect(["high", "mid", "low"]).toContain(tier);
    });
  });
});