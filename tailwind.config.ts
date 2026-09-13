import type { Config } from "tailwindcss";

/**
 * Tailwind theme.
 *
 * IMPORTANT — this project has an intentional split:
 *   • The 3D scene's palette is NOT in here. It is driven at runtime by the
 *     smoothed treble/amplitude bands straight off the AnalyserNode.
 *   • Everything in this file styles the *UI chrome* layer only: the upload /
 *     track panel, transport controls, labels. Chrome tokens are deliberately
 *     neutral and low-contrast so the scene stays the whole product.
 *
 * Chrome "signal" colour is exposed as a CSS custom property (`--signal`) that
 * the reactive loop writes to once per frame, so the scrubber/progress fill
 * inherits the music's current hue. That is a raw CSS var write, never a tween.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Neutral chrome ramp — cool-tinted greys, never pure #000/#fff.
        ink: {
          950: "#04050a",
          900: "#070810",
          800: "#0d0f18",
          700: "#151824",
        },
        chalk: {
          DEFAULT: "#f2f4f8",
          muted: "#9aa1b1",
          faint: "#5d6474",
          ghost: "#3a4050",
        },
        signal: "rgb(var(--signal-rgb) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        "2xs": ["0.625rem", { lineHeight: "0.875rem", letterSpacing: "0.14em" }],
      },
      backdropBlur: {
        xs: "2px",
      },
      boxShadow: {
        glass:
          "0 1px 0 0 rgb(255 255 255 / 0.05) inset, 0 24px 64px -24px rgb(0 0 0 / 0.9)",
        lift: "0 32px 80px -32px rgb(0 0 0 / 0.95)",
      },
      keyframes: {
        // Pre-play hero aurora. CSS-only so the idle state costs no JS.
        aurora: {
          "0%, 100%": { transform: "translate3d(-8%, -4%, 0) scale(1.1)" },
          "33%": { transform: "translate3d(6%, 5%, 0) scale(1.25)" },
          "66%": { transform: "translate3d(-4%, 8%, 0) scale(1.15)" },
        },
        // Slow spotlight sweep across the hero.
        sweep: {
          "0%, 100%": { opacity: "0.35", transform: "translateX(-12%) rotate(8deg)" },
          "50%": { opacity: "0.7", transform: "translateX(12%) rotate(8deg)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.9)", opacity: "0.5" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
      },
      animation: {
        aurora: "aurora 22s ease-in-out infinite",
        sweep: "sweep 14s ease-in-out infinite",
        shimmer: "shimmer 3.2s linear infinite",
        "pulse-ring": "pulse-ring 2.4s cubic-bezier(0.16, 1, 0.3, 1) infinite",
      },
    },
  },
  plugins: [],
};

export default config;
