/**
 * A single shared requestAnimationFrame loop for the chrome layer.
 *
 * The 3D scene already has its own frame loop (r3f's), and this must stay
 * separate from it — the scene's loop runs on the GPU's clock and must never be
 * blocked behind DOM writes. But the DOM side doesn't need *several* loops
 * either, so anything that wants per-frame updates in the chrome (the scrubber
 * position, the elapsed-time readout) registers here instead of calling
 * requestAnimationFrame directly.
 */

type FrameCallback = () => void;

const callbacks = new Map<number, FrameCallback>();
let handle: number | null = null;
let nextId = 1;

function tick() {
  handle = null;
  for (const [id, callback] of Array.from(callbacks)) {
    // A callback may have cancelled itself during this pass.
    if (callbacks.has(id)) callback();
  }
  if (callbacks.size > 0 && handle === null) {
    handle = requestAnimationFrame(tick);
  }
}

/**
 * Registers a callback to run every frame until cancelled.
 * @returns a handle for {@link cancelFrame}
 */
export function scheduleFrame(callback: FrameCallback): number {
  const id = nextId++;
  callbacks.set(id, callback);
  if (handle === null) handle = requestAnimationFrame(tick);
  return id;
}

export function cancelFrame(id: number) {
  callbacks.delete(id);
  if (callbacks.size === 0 && handle !== null) {
    cancelAnimationFrame(handle);
    handle = null;
  }
}
