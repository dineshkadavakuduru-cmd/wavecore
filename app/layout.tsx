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

const siteUrl = "https://wavecore-gilt.vercel.app/";
const ogImage = "/og-image.png";

export const metadata: Metadata = {
  title: "Wavecore — audio-reactive 3D visualiser",
  description:
    "A full-screen 3D scene that reacts in real time to whatever is playing: bass drives the pulse and the camera, mid drives the morph, treble drives the colour.",
  applicationName: "Wavecore",
  authors: [{ name: "Wavecore" }],
  keywords: ["audio visualiser", "webgl", "three.js", "web audio api", "generative"],
  metadataBase: new URL(siteUrl),
  openGraph: {
    type: "website",
    url: siteUrl,
    title: "Wavecore — audio-reactive 3D visualiser",
    description:
      "A full-screen 3D scene that reacts in real time to whatever is playing.",
    siteName: "Wavecore",
    images: [
      {
        url: ogImage,
        width: 1200,
        height: 630,
        alt: "Wavecore audio-reactive 3D visualiser preview",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Wavecore — audio-reactive 3D visualiser",
    description:
      "A full-screen 3D scene that reacts in real time to whatever is playing.",
    images: [ogImage],
  },
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/icons/icon-192.png",
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#04050a",
  width: "device-width",
  initialScale: 1,
  // No maximumScale / userScalable here: disabling pinch-zoom is a WCAG 1.4.4
  // failure, and zoom must stay available. The canvas keeps its drag-to-orbit
  // gesture via `touch-action: none` on the <canvas> element itself, which
  // handles the single-pointer case without taking zoom away from everyone.
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="bg-ink-950">
      <head>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body
        className={`${inter.variable} ${instrumentSerif.variable} ${jetbrainsMono.variable} h-full overflow-hidden`}
      >
        {children}
        <noscript>
          <div className="noscript-note" role="note">
            <p>
              Wavecore is a real-time WebGL audio visualiser, and it needs
              JavaScript to run.
            </p>
            <p>
              Enable JavaScript to load the scene and the demo tracks — or just
              enjoy the quiet: everything here is generated in your browser,
              and there is nothing to download.
            </p>
          </div>
        </noscript>
      </body>
    </html>
  );
}
