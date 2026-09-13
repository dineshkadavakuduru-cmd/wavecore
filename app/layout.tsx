import type { Metadata, Viewport } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/**
 * Type stack for the chrome layer.
 *
 * Inter for the micro-labels and controls (tight, neutral), Instrument Serif
 * for the one large display moment, JetBrains Mono for telemetry readouts. The
 * serif/mono pairing is what keeps the chrome from reading like a default
 * dashboard.
 */
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Wavecore — audio-reactive 3D visualiser",
  description:
    "A full-screen 3D scene that reacts in real time to whatever is playing: bass drives the pulse and the camera, mid drives the morph, treble drives the colour.",
  applicationName: "Wavecore",
  authors: [{ name: "Wavecore" }],
  keywords: ["audio visualiser", "webgl", "three.js", "web audio api", "generative"],
};

export const viewport: Viewport = {
  themeColor: "#04050a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  // The whole app is a single full-bleed surface; pinch-zoom would only ever
  // fight the camera's own drag-to-orbit gesture.
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="bg-ink-950">
      <body
        className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} h-full overflow-hidden`}
      >
        {children}
      </body>
    </html>
  );
}
