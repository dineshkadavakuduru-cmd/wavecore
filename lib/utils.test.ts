import { describe, it, expect } from "vitest";
import { clamp, clamp01, lerp, smoothing, formatTime, formatBytes } from "@/lib/utils";

describe("lib/utils.ts", () => {
  describe("clamp", () => {
    it("returns value when within bounds", () => {
      expect(clamp(0.5, 0, 1)).toBe(0.5);
      expect(clamp(10, 5, 15)).toBe(10);
    });

    it("returns min when value is below min", () => {
      expect(clamp(-5, 0, 10)).toBe(0);
      expect(clamp(-1, 0, 1)).toBe(0);
    });

    it("returns max when value is above max", () => {
      expect(clamp(15, 0, 10)).toBe(10);
      expect(clamp(2, 0, 1)).toBe(1);
    });

    it("handles default bounds (0-1)", () => {
      expect(clamp(0.5)).toBe(0.5);
      expect(clamp(-0.5)).toBe(0);
      expect(clamp(1.5)).toBe(1);
    });
  });

  describe("clamp01", () => {
    it("clamps to 0-1 range", () => {
      expect(clamp01(0.5)).toBe(0.5);
      expect(clamp01(-1)).toBe(0);
      expect(clamp01(2)).toBe(1);
    });
  });

  describe("lerp", () => {
    it("interpolates correctly", () => {
      expect(lerp(0, 10, 0)).toBe(0);
      expect(lerp(0, 10, 0.5)).toBe(5);
      expect(lerp(0, 10, 1)).toBe(10);
      expect(lerp(5, 15, 0.5)).toBe(10);
    });

    it("handles extrapolation", () => {
      expect(lerp(0, 10, -1)).toBe(-10);
      expect(lerp(0, 10, 2)).toBe(20);
    });
  });

  describe("smoothing", () => {
    it("returns 0 for dt=0", () => {
      expect(smoothing(1000, 0)).toBe(0);
    });

    it("returns factor between 0 and 1", () => {
      expect(smoothing(1000, 16)).toBeGreaterThan(0);
      expect(smoothing(1000, 16)).toBeLessThan(1);
    });

    it("larger dt gives larger factor (approaches 1)", () => {
      const smallDt = smoothing(1000, 16);
      const largeDt = smoothing(1000, 100);
      expect(largeDt).toBeGreaterThan(smallDt);
    });

    it("smaller ms gives larger factor for same dt", () => {
      const slow = smoothing(2000, 16);
      const fast = smoothing(500, 16);
      expect(fast).toBeGreaterThan(slow);
    });
  });

  describe("formatTime", () => {
    it("formats seconds as M:SS", () => {
      expect(formatTime(0)).toBe("0:00");
      expect(formatTime(5)).toBe("0:05");
      expect(formatTime(30)).toBe("0:30");
      expect(formatTime(60)).toBe("1:00");
      expect(formatTime(65)).toBe("1:05");
      expect(formatTime(125)).toBe("2:05");
      expect(formatTime(3661)).toBe("61:01");
    });

    it("handles negative and non-finite values", () => {
      expect(formatTime(-5)).toBe("0:00");
      expect(formatTime(NaN)).toBe("0:00");
      expect(formatTime(Infinity)).toBe("0:00");
    });
  });

  describe("formatBytes", () => {
    it("formats bytes correctly", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(500)).toBe("500 B");
      expect(formatBytes(1023)).toBe("1023 B");
      expect(formatBytes(1024)).toBe("1.0 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
      // 1048575 bytes = 1023.999 KB, rounds to 1024.0 KB with toFixed(1)
      expect(formatBytes(1048575)).toBe("1024.0 KB");
      expect(formatBytes(1048576)).toBe("1.0 MB");
      expect(formatBytes(2097152)).toBe("2.0 MB");
    });
  });
});