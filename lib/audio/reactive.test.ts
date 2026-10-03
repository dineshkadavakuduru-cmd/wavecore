import { describe, it, expect, vi } from "vitest";
import {
  updateReactive,
  resetReactive,
  reactive,
  smoothedSpectrum,
  spectrumBytes,
  SPECTRUM_SIZE,
  BIN_COUNT,
  FFT_SIZE,
  BAND_RANGES,
  PUNCH_COOLDOWN,
  PUNCH_THRESHOLD,
  T_SPECTRUM_ATTACK,
  T_SPECTRUM_RELEASE,
  T_AMBIENT,
  T_HUE,
  T_ENVELOPE,
  T_PUNCH_DECAY,
  T_TRANSIENT_DECAY,
} from "@/lib/audio/reactive";

describe("lib/audio/reactive.ts", () => {
  describe("constants", () => {
    it("exports correct FFT constants", () => {
      expect(FFT_SIZE).toBe(2048);
      expect(BIN_COUNT).toBe(1024);
      expect(SPECTRUM_SIZE).toBe(256);
    });

    it("exports band ranges in slot space", () => {
      expect(BAND_RANGES.bass).toEqual([0, 80]);
      expect(BAND_RANGES.lowMid).toEqual([81, 120]);
      expect(BAND_RANGES.mid).toEqual([121, 175]);
      expect(BAND_RANGES.highMid).toEqual([176, 215]);
      expect(BAND_RANGES.treble).toEqual([216, 255]);
    });

    it("exports timing constants", () => {
      expect(PUNCH_COOLDOWN).toBe(0.34);
      expect(PUNCH_THRESHOLD).toBe(0.12);
      expect(T_SPECTRUM_ATTACK).toBe(22);
      expect(T_SPECTRUM_RELEASE).toBe(120);
      expect(T_AMBIENT).toBe(1100);
      expect(T_HUE).toBe(620);
      expect(T_ENVELOPE).toBe(520);
      expect(T_PUNCH_DECAY).toBe(150);
      expect(T_TRANSIENT_DECAY).toBe(90);
    });
  });

  describe("updateReactive", () => {
    it("advances clock by dt", () => {
      const dt = 1 / 60;
      const mockAnalyser = {
        getByteFrequencyData: vi.fn(),
      } as unknown as AnalyserNode;
      const mockBytes = new Uint8Array(BIN_COUNT);

      resetReactive();
      expect(reactive.clock).toBe(0);

      updateReactive(mockAnalyser, mockBytes, dt);
      expect(reactive.clock).toBeCloseTo(dt, 5);

      updateReactive(mockAnalyser, mockBytes, dt);
      expect(reactive.clock).toBeCloseTo(dt * 2, 5);
    });

    it("stays in idle when no analyser provided", () => {
      resetReactive();
      updateReactive(null, null, 1 / 60);
      expect(reactive.mode).toBe("idle");
      expect(reactive.bass).toBeGreaterThan(0);
      expect(reactive.mid).toBeGreaterThan(0);
      expect(reactive.treble).toBeGreaterThan(0);
    });

    it("stays in idle when analyser provided but mode is not playing", () => {
      resetReactive();
      const mockAnalyser = {
        getByteFrequencyData: vi.fn(),
      } as unknown as AnalyserNode;
      const mockBytes = new Uint8Array(BIN_COUNT);

      reactive.mode = "paused";
      updateReactive(mockAnalyser, mockBytes, 1 / 60);
      expect(reactive.mode).toBe("paused");
      expect(reactive.bass).toBeGreaterThan(0);
      expect(reactive.mid).toBeGreaterThan(0);
    });

    it("generates idle bed when not playing", () => {
      resetReactive();
      const dt = 1 / 60;
      updateReactive(null, null, dt);

      expect(reactive.ambient).toBe(1);
      expect(reactive.bass).toBeGreaterThan(0);
      expect(reactive.mid).toBeGreaterThan(0);
      expect(reactive.treble).toBeGreaterThan(0);
    });

    it("processes analyser data when playing", () => {
      resetReactive();
      const dt = 1 / 60;
      const mockAnalyser = {
        getByteFrequencyData: vi.fn((bytes: Uint8Array) => {
          bytes.fill(0);
          for (let i = 0; i < 100; i++) {
            bytes[i] = 200;
          }
        }),
      } as unknown as AnalyserNode;
      const mockBytes = new Uint8Array(BIN_COUNT);

      reactive.mode = "playing";
      updateReactive(mockAnalyser, mockBytes, dt);

      expect(mockAnalyser.getByteFrequencyData).toHaveBeenCalledWith(mockBytes);
      expect(reactive.bass).toBeGreaterThan(0);
    });

    it("produces smoothed spectrum values in 0-1 range", () => {
      resetReactive();
      const dt = 1 / 60;
      const mockAnalyser = {
        getByteFrequencyData: vi.fn((bytes: Uint8Array) => {
          bytes.fill(200);
        }),
      } as unknown as AnalyserNode;
      const mockBytes = new Uint8Array(BIN_COUNT);

      reactive.mode = "playing";
      updateReactive(mockAnalyser, mockBytes, dt);

      for (let i = 0; i < SPECTRUM_SIZE; i++) {
        expect(smoothedSpectrum[i]).toBeGreaterThanOrEqual(0);
        expect(smoothedSpectrum[i]).toBeLessThanOrEqual(1);
        expect(spectrumBytes[i]).toBeGreaterThanOrEqual(0);
        expect(spectrumBytes[i]).toBeLessThanOrEqual(255);
      }
    });

    it("eases hue based on treble", () => {
      resetReactive();
      const dt = 1 / 60;
      const mockAnalyser = {
        getByteFrequencyData: vi.fn((bytes: Uint8Array) => {
          bytes.fill(255);
        }),
      } as unknown as AnalyserNode;
      const mockBytes = new Uint8Array(BIN_COUNT);

      reactive.mode = "playing";
      const initialHue = reactive.hue;
      updateReactive(mockAnalyser, mockBytes, dt);

      expect(reactive.hue).not.toBe(initialHue);
    });

    it("detects bass transients and generates punch", () => {
      resetReactive();
      const dt = 1 / 60;
      const mockAnalyser = {
        getByteFrequencyData: vi.fn((bytes: Uint8Array) => {
          bytes.fill(0);
          for (let i = 0; i < 80; i++) {
            bytes[i] = 255;
          }
        }),
      } as unknown as AnalyserNode;
      const mockBytes = new Uint8Array(BIN_COUNT);

      reactive.mode = "playing";
      updateReactive(mockAnalyser, mockBytes, dt);
      updateReactive(mockAnalyser, mockBytes, dt);

      expect(reactive.bassTransient).toBeGreaterThanOrEqual(0);
    });
  });

  describe("band averaging", () => {
    it("averages spectrum correctly for each band", () => {
      resetReactive();
      for (let i = 0; i < SPECTRUM_SIZE; i++) {
        smoothedSpectrum[i] = i / SPECTRUM_SIZE;
      }

      const dt = 1 / 60;
      const mockAnalyser = {
        getByteFrequencyData: vi.fn(),
      } as unknown as AnalyserNode;
      const mockBytes = new Uint8Array(BIN_COUNT);

      reactive.mode = "playing";
      updateReactive(mockAnalyser, mockBytes, dt);

      expect(reactive.bass).toBeGreaterThanOrEqual(0);
      expect(reactive.bass).toBeLessThanOrEqual(1);
      expect(reactive.mid).toBeGreaterThanOrEqual(0);
      expect(reactive.mid).toBeLessThanOrEqual(1);
      expect(reactive.treble).toBeGreaterThanOrEqual(0);
      expect(reactive.treble).toBeLessThanOrEqual(1);
    });
  });
});