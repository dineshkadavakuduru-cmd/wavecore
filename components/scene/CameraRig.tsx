"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { reducedMotion } from "@/lib/motion";
import { reactive } from "@/lib/audio/reactive";
import { clamp, smoothing } from "@/lib/utils";

/**
 * Camera: slow continuous orbit with a short, throttled punch-zoom on bass hits.
 *
 * Not OrbitControls — the punch has to compose with the drift, the shake and the
 * FOV kick every frame, and that is far clearer done by hand than by fighting a
 * controller's internal state.
 *
 * Drag and scroll apply an *offset* on top of the automatic drift, and that
 * offset then decays back to zero over ~9 s. For a piece whose purpose is being
 * recorded, a camera that slowly returns itself to the hero angle is worth more
 * than one that stays wherever it was left.
 */

/** Where the drift settles. */
const BASE_PHI = 0.44;
const BASE_DISTANCE = 5.6;
const BASE_FOV = 42;

export function CameraRig() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const domElement = useThree((s) => s.gl.domElement);

  const orbit = useRef({ theta: 0 });
  const user = useRef({ yaw: 0, pitch: 0, zoom: 0 });
  const shaking = useRef({ x: 0, y: 0 });

  useEffect(() => {
    camera.fov = BASE_FOV;
    camera.updateProjectionMatrix();
  }, [camera]);

  /* ── pointer input ────────────────────────────────────────────────── */

  useEffect(() => {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pointerId = -1;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      pointerId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      domElement.setPointerCapture?.(e.pointerId);
    };

    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      user.current.yaw -= dx * 0.005;
      user.current.pitch = clamp(user.current.pitch + dy * 0.0035, -0.5, 0.7);
    };

    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (pointerId !== -1) domElement.releasePointerCapture?.(pointerId);
      pointerId = -1;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      user.current.zoom = clamp(user.current.zoom + e.deltaY * 0.0022, -3.2, 2.4);
    };

    domElement.addEventListener("pointerdown", onDown);
    domElement.addEventListener("pointermove", onMove);
    domElement.addEventListener("pointerup", onUp);
    domElement.addEventListener("pointercancel", onUp);
    domElement.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      domElement.removeEventListener("pointerdown", onDown);
      domElement.removeEventListener("pointermove", onMove);
      domElement.removeEventListener("pointerup", onUp);
      domElement.removeEventListener("pointercancel", onUp);
      domElement.removeEventListener("wheel", onWheel);
    };
  }, [domElement]);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    // prefers-reduced-motion: keep the slow orbit so the frame isn't static,
    // but drop every aggressive movement — the punch zoom, the per-frame
    // shake, the bass bounce and the reactive speed-up all go.
    const calm = reducedMotion.value;

    // Drift speeds up when the mid band is busy — a dense passage visibly
    // energises the camera, not just the geometry.
    orbit.current.theta += dt * (calm ? 0.058 : 0.058 + reactive.mid * 0.16);

    // User offsets bleed back to centre.
    const decay = smoothing(9000, dt);
    user.current.yaw += (0 - user.current.yaw) * decay;
    user.current.pitch += (0 - user.current.pitch) * decay;
    user.current.zoom += (0 - user.current.zoom) * decay;

    const punch = calm ? 0 : reactive.punch;
    const theta = orbit.current.theta + user.current.yaw;
    const phi =
      BASE_PHI + Math.sin(reactive.clock * 0.09) * 0.16 + user.current.pitch;
    // A slow breathing dolly keeps the distance from ever sitting still.
    const breathe = Math.sin(reactive.clock * 0.13) * 0.28;
    // Hero reveal: the camera dollies in from a long way out over ~3 s, so the
    // very first frames are already a shot rather than a static pose.
    const reveal = 1 - Math.pow(1 - Math.min(1, reactive.clock / 3.0), 3);
    const distance = clamp(
      (BASE_DISTANCE + breathe + user.current.zoom - punch * 0.85) *
        (1 + (1 - reveal) * 1.85),
      2.6,
      22,
    );

    // Shake is punch-only and random per frame — a decaying offset would read as
    // a wobble, whereas instantaneous jitter reads as an impact.
    if (punch > 0.01) {
      shaking.current.x = (Math.random() - 0.5) * punch * 0.045;
      shaking.current.y = (Math.random() - 0.5) * punch * 0.045;
    } else {
      shaking.current.x *= 0.85;
      shaking.current.y *= 0.85;
    }

    const sinPhi = Math.sin(phi);
    camera.position.set(
      Math.sin(theta) * sinPhi * distance + shaking.current.x,
      Math.cos(phi) * distance + shaking.current.y + (calm ? 0 : reactive.bass * 0.12),
      Math.cos(theta) * sinPhi * distance,
    );

    // Look slightly off-centre so the core drifts across the frame instead of
    // being pinned to the middle.
    camera.lookAt(
      Math.sin(reactive.clock * 0.07) * 0.18,
      Math.sin(reactive.clock * 0.05) * 0.12,
      0,
    );

    const targetFov = BASE_FOV + punch * 3.2 + (calm ? 0 : reactive.level * 1.6);
    if (Math.abs(camera.fov - targetFov) > 0.001) {
      camera.fov = targetFov;
      camera.updateProjectionMatrix();
    }
  });

  return null;
}
