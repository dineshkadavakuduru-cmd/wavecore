"use client";

import { useCallback, useEffect, useRef } from "react";
import { useAudio } from "@/lib/audio/provider";
import { useChrome } from "@/lib/chrome";

/**
 * Touch gestures for mobile control.
 *
 * Swipe left/right → previous/next track
 * Swipe up/down → volume up/down
 *
 * Designed to coexist with CameraRig's pointer-based orbit:
 * - Only triggers on quick swipes (velocity threshold), not slow drags
 * - Requires clear horizontal OR vertical direction (not diagonal)
 * - Ignores gestures that start on UI elements (buttons, sliders, panel)
 * - Does not call preventDefault on touchmove, so CameraRig still receives pointer events
 */
export function TouchGestures() {
  const { step, volume, setVolume } = useAudio();
  const { visible, zen, panelOpen, reveal } = useChrome();

  const touchStart = useRef<{ x: number; y: number; time: number } | null>(null);
  const touchMoved = useRef(false);
  const targetIsUI = useRef(false);

  // Minimum swipe velocity (px/ms) to trigger a gesture
  const MIN_VELOCITY = 0.4;
  // Maximum time for a swipe (ms)
  const MAX_DURATION = 350;
  // Minimum distance for a swipe (px)
  const MIN_DISTANCE = 36;
  // Maximum angle deviation from pure horizontal/vertical (degrees)
  const MAX_ANGLE_DEVIATION = 28;

  const isUIElement = useCallback((target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) return false;
    // Check if target or any parent is an interactive UI element
    const uiSelectors = [
      "button",
      "input",
      "select",
      "textarea",
      "[role='button']",
      "[role='slider']",
      ".chrome-btn",
      ".chrome-range",
      ".glass",
      "#source-panel",
      "[data-chrome]",
    ];
    return (
      target.closest(uiSelectors.join(", ")) !== null ||
      target.tagName === "BUTTON" ||
      target.tagName === "INPUT"
    );
  }, []);

  const handleTouchStart = useCallback(
    (event: TouchEvent) => {
      // Ignore if chrome is hidden, zen mode, or panel open
      if (!visible || zen || panelOpen) return;

      const touch = event.touches[0];
      if (!touch) return;

      // Ignore if the touch started on a UI element
      if (isUIElement(event.target)) {
        targetIsUI.current = true;
        return;
      }
      targetIsUI.current = false;

      touchStart.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: performance.now(),
      };
      touchMoved.current = false;
    },
    [visible, zen, panelOpen, isUIElement]
  );

  const handleTouchMove = useCallback(
    (event: TouchEvent) => {
      if (!touchStart.current || targetIsUI.current) return;
      if (event.touches.length !== 1) return;

      touchMoved.current = true;
      // Don't preventDefault — CameraRig needs pointer events for orbit
    },
    []
  );

  const handleTouchEnd = useCallback(
    (event: TouchEvent) => {
      if (!touchStart.current || targetIsUI.current || !touchMoved.current) {
        touchStart.current = null;
        touchMoved.current = false;
        return;
      }

      const touch = event.changedTouches[0];
      if (!touch) {
        touchStart.current = null;
        touchMoved.current = false;
        return;
      }

      const dx = touch.clientX - touchStart.current.x;
      const dy = touch.clientY - touchStart.current.y;
      const distance = Math.hypot(dx, dy);
      const duration = performance.now() - touchStart.current.time;
      const velocity = distance / duration;

      // Check if it's a quick swipe with sufficient distance
      if (velocity < MIN_VELOCITY || duration > MAX_DURATION || distance < MIN_DISTANCE) {
        touchStart.current = null;
        touchMoved.current = false;
        return;
      }

      const angle = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI);
      const isHorizontal = angle <= MAX_ANGLE_DEVIATION || angle >= 180 - MAX_ANGLE_DEVIATION;
      const isVertical = angle >= 90 - MAX_ANGLE_DEVIATION && angle <= 90 + MAX_ANGLE_DEVIATION;

      // Must be clearly horizontal OR vertical, not diagonal
      if (!isHorizontal && !isVertical) {
        touchStart.current = null;
        touchMoved.current = false;
        return;
      }

      reveal(); // Wake chrome on any successful gesture

      if (isHorizontal) {
        // Horizontal swipe: track switching
        if (dx > 0) {
          // Swipe right → previous track
          step(-1);
        } else {
          // Swipe left → next track
          step(1);
        }
      } else if (isVertical) {
        // Vertical swipe: volume control
        const volumeStep = 0.1;
        if (dy > 0) {
          // Swipe down → volume down
          setVolume(Math.max(0, volume - volumeStep));
        } else {
          // Swipe up → volume up
          setVolume(Math.min(1, volume + volumeStep));
        }
      }

      touchStart.current = null;
      touchMoved.current = false;
    },
    [reveal, step, volume, setVolume]
  );

  const handleTouchCancel = useCallback(() => {
    touchStart.current = null;
    touchMoved.current = false;
    targetIsUI.current = false;
  }, []);

  useEffect(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) return;

    // Use passive: true so we don't block scrolling/orbit
    canvas.addEventListener("touchstart", handleTouchStart, { passive: true });
    canvas.addEventListener("touchmove", handleTouchMove, { passive: true });
    canvas.addEventListener("touchend", handleTouchEnd, { passive: true });
    canvas.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      canvas.removeEventListener("touchstart", handleTouchStart);
      canvas.removeEventListener("touchmove", handleTouchMove);
      canvas.removeEventListener("touchend", handleTouchEnd);
      canvas.removeEventListener("touchcancel", handleTouchCancel);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel]);

  return null;
}