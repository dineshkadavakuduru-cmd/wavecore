"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useChrome } from "@/lib/chrome";

/**
 * PWA Install Prompt
 *
 * Detects when the browser offers a PWA install (beforeinstallprompt event)
 * and shows a subtle prompt using the existing glass/chrome design system.
 * Only shows once per session, dismissible.
 */
export function InstallPrompt() {
  const { visible, reveal } = useChrome();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent the default mini-infobar (we'll show our own)
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);

      // Check if we've shown the prompt this session
      const hasSeenPrompt = sessionStorage.getItem("wavecore-install-prompt-shown");
      if (!hasSeenPrompt) {
        // Show after a delay so the user has time to experience the app
        setTimeout(() => setShow(true), 15000);
      }
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setShow(false);
      sessionStorage.setItem("wavecore-install-prompt-shown", "true");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    // Show the browser's install dialog
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === "accepted") {
      console.log("[PWA] User accepted install");
    } else {
      console.log("[PWA] User dismissed install");
    }

    // Clear the prompt either way
    setDeferredPrompt(null);
    setShow(false);
    sessionStorage.setItem("wavecore-install-prompt-shown", "true");
  };

  const handleDismiss = () => {
    setShow(false);
    sessionStorage.setItem("wavecore-install-prompt-shown", "true");
  };

  if (!mounted || !show || !deferredPrompt || !visible) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="install-prompt"
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 380, damping: 36 }}
        className="pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 z-40 lg:bottom-24"
        role="dialog"
        aria-label="Install Wavecore"
      >
        <div className="glass rounded-2xl px-5 py-4 flex flex-col sm:flex-row items-center gap-3 w-[min(90vw,36rem)]">
          <div className="flex items-center gap-3 flex-shrink-0">
            <span className="relative grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
              <svg
                className="h-5 w-5 text-signal"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            </span>
            <div>
              <p className="font-medium text-chalk text-sm">Install Wavecore</p>
              <p className="font-mono text-2xs uppercase tracking-[0.1em] text-chalk-faint">
                Add to home screen for offline access
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 ml-auto sm:ml-0">
            <button
              onClick={handleDismiss}
              className="text-chalk-faint hover:text-chalk p-1"
              aria-label="Dismiss"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
            <button
              onClick={handleInstall}
              className="chrome-btn px-4 py-1.5 !rounded-full text-sm"
            >
              Install
            </button>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Type for the beforeinstallprompt event (not in standard lib.dom.d.ts) */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}