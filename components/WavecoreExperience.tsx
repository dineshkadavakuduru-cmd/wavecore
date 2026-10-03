"use client";

import dynamic from "next/dynamic";
import { AudioProvider } from "@/lib/audio/provider";
import { ChromeProvider } from "@/lib/chrome";
import { ChromeLayer } from "./ui/ChromeLayer";
import { AuroraOverlay } from "./ui/AuroraOverlay";
import { DecodeOverlay } from "./ui/DecodeOverlay";
import { DropOverlay } from "./ui/DropOverlay";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { InstallPrompt } from "./ui/InstallPrompt";
import { SWRegister } from "./ui/SWRegister";
import { TouchGestures } from "./ui/TouchGestures";
import { WavecoreLoading } from "./ui/WavecoreLoading";

/**
 * The whole experience, and the boundary between the two halves of this
 * project's animation split:
 *
 *   <WavecoreCanvas/>   the reactive core. Web Audio → eased bands → shaders,
 *                       driven entirely inside r3f's useFrame. No tweening
 *                       library is in this path, by design.
 *   <ChromeLayer/>      the UI. Motion owns the show/hide, the panel and the
 *                       dock; anime.js owns the one-shot flourishes. None of
 *                       it reads audio data.
 *
 * The canvas is loaded with `ssr: false` so three.js stays out of the server
 * bundle and the scene never tries to build a WebGL context during
 * pre-rendering.
 */
const WavecoreCanvas = dynamic(
  () => import("./scene/WavecoreCanvas").then((m) => m.WavecoreCanvas),
  { ssr: false, loading: () => <WavecoreLoading /> },
);

export function WavecoreExperience() {
  return (
    <AudioProvider>
      <ChromeProvider>
        <main className="relative h-[100dvh] w-screen overflow-hidden bg-ink-950">
          <ErrorBoundary>
            <WavecoreCanvas />
          </ErrorBoundary>
          <TouchGestures />
          <AuroraOverlay />
          <ChromeLayer />
          <DropOverlay />
          <DecodeOverlay />
          <SWRegister />
          <InstallPrompt />
        </main>
      </ChromeProvider>
    </AudioProvider>
  );
}
