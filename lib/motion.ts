/**
 * User motion preference, shared by the scene's frame loops.
 *
 * A plain mutable singleton rather than React state, for the same reason the
 * reactive audio bus is: the render loop reads it 60×/s and re-rendering the
 * scene graph to change a boolean would be backwards.
 *
 * Written once on mount from a `matchMedia` listener (see <ReactiveBridge/>);
 * live-updates when the user flips the OS setting mid-session.
 */
export const reducedMotion = { value: false };

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
