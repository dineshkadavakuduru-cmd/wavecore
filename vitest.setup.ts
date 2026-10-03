/**
 * Vitest setup file.
 * Runs before each test file.
 */

import { beforeAll, afterAll, vi } from "vitest";

/** Mock window.matchMedia for prefers-reduced-motion tests */
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

/** Mock navigator for quality detection tests */
beforeAll(() => {
  Object.defineProperty(navigator, "hardwareConcurrency", {
    writable: true,
    value: 8,
  });
  Object.defineProperty(navigator, "deviceMemory", {
    writable: true,
    value: 8,
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});