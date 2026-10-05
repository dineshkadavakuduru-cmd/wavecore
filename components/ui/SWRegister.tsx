"use client";

import { useEffect } from "react";

/**
 * Registers the service worker for PWA support.
 * Runs only in production (not development) to avoid interfering with hot reload.
 */
export function SWRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Only register in production
    if (process.env.NODE_ENV !== "production") return;

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        // Handle updates
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // New version available, show update prompt
              showUpdatePrompt(registration);
            }
          });
        });

        // Check for updates periodically
        setInterval(() => registration.update(), 60 * 60 * 1000); // every hour
      } catch (err) {
        // Intentionally silent: a failed SW registration must never surface
        // as console noise for real users.
        if (process.env.NODE_ENV !== "production") console.warn("[SW] Registration failed:", err);
      }
    };

    // Register after load to not block initial paint
    if (document.readyState === "complete") {
      registerSW();
    } else {
      window.addEventListener("load", registerSW, { once: true });
    }
  }, []);

  return null;
}

/** Show a subtle prompt to refresh for the new version */
function showUpdatePrompt(registration: ServiceWorkerRegistration) {
  // Create a subtle toast using the existing design system
  const toast = document.createElement("div");
  toast.className = `
    fixed bottom-6 left-1/2 -translate-x-1/2 z-50
    glass rounded-2xl px-5 py-3 flex items-center gap-3
    animate-in fade-in slide-in-from-bottom-4 duration-500
  `;
  toast.innerHTML = `
    <span className="font-mono text-2xs uppercase tracking-[0.14em] text-chalk">
      New version available
    </span>
    <button
      className="chrome-btn px-3 py-1.5 !rounded-full text-sm"
      id="sw-update-btn"
    >
      Refresh
    </button>
    <button
      className="text-chalk-faint hover:text-chalk text-sm"
      id="sw-dismiss-btn"
      aria-label="Dismiss"
    >
      ×
    </button>
  `;

  document.body.appendChild(toast);

  const updateBtn = toast.querySelector("#sw-update-btn");
  const dismissBtn = toast.querySelector("#sw-dismiss-btn");

  updateBtn?.addEventListener("click", () => {
    registration.waiting?.postMessage("skipWaiting");
    window.location.reload();
  });

  dismissBtn?.addEventListener("click", () => {
    toast.remove();
  });

  // Auto-dismiss after 30 seconds
  setTimeout(() => toast.remove(), 30000);
}