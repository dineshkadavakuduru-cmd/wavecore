"use client";

import {
  Bloom,
  ChromaticAberration,
  EffectComposer,
  Noise,
  Vignette,
} from "@react-three/postprocessing";
import { useFrame } from "@react-three/fiber";
import { useRef, type Ref, type RefObject } from "react";
import { Vector2 } from "three";
import {
  BlendFunction,
  type BloomEffect,
  type ChromaticAberrationEffect,
  type VignetteEffect,
} from "postprocessing";
import { reactive } from "@/lib/audio/reactive";
import type { QualitySettings } from "@/lib/quality";

/**
 * Post-processing chain. Bloom is the single biggest contributor to this scene
 * looking like anything at all, so it is the one effect that never gets dropped
 * — lower tiers just pay for fewer mip levels.
 *
 * Note on colour: three.js forces linear color space for non-XR render targets,
 * and postprocessing's final pass writes straight through with no conversion, so
 * the whole chain is a 1:1 passthrough. Custom shader values therefore land on
 * screen exactly as authored, which is what makes the look predictable from the
 * shader source alone. Adding a ToneMapping effect would change that contract
 * and mean re-tuning every constant in both shaders.
 */

/**
 * @react-three/postprocessing declares each effect component's ref against the
 * effect *class* rather than an instance, so an instance ref never matches.
 * Widening here keeps the instance typing where it matters (the useFrame loop
 * below) while satisfying the JSX site.
 */
function instanceRef<T>(ref: RefObject<T>) {
  return ref as unknown as Ref<never>;
}

/** Base chromatic aberration. Held at module scope so the effect and the frame
 *  loop mutate the same Vector2 rather than fighting over it. */
const ABERRATION_BASE = new Vector2(0.0004, 0.00025);

type Props = {
  quality: QualitySettings;
};

export function Effects({ quality }: Props) {
  const bloom = useRef<BloomEffect>(null);
  const vignette = useRef<VignetteEffect>(null);
  const aberration = useRef<ChromaticAberrationEffect>(null);

  const hasAberration = quality.chromaticAberration;

  useFrame(() => {
    // Bloom breathes with overall amplitude, plus a hard shove on punch so a
    // kick produces a visible flash rather than just a colour shift.
    if (bloom.current) {
      bloom.current.intensity = 0.4 + reactive.level * 0.7 + reactive.punch * 0.5;
    }

    // Bass-linked vignette — the frame closes in on the hit and opens back up.
    if (vignette.current) {
      vignette.current.darkness = 0.52 + reactive.bass * 0.4;
    }

    // Punch-only, so it stays invisible until something actually lands.
    if (hasAberration && aberration.current) {
      const p = reactive.punch;
      aberration.current.offset.set(0.00035 + p * 0.0032, 0.00022 + p * 0.002);
    }
  });

  return (
    <EffectComposer
      // MSAA on the composer's own render target — the context-level antialias
      // flag does nothing once rendering goes through a framebuffer.
      multisampling={quality.tier === "high" ? 4 : quality.tier === "mid" ? 2 : 0}
    >
      <Bloom
        ref={instanceRef(bloom)}
        intensity={0.8}
        // Higher than a typical bloom setup: only the core crests and the
        // densest particle bands should bloom. Lowering this is the fastest way
        // to wash the whole frame out to grey.
        luminanceThreshold={0.34}
        luminanceSmoothing={0.3}
        mipmapBlur
        radius={0.62}
        levels={quality.bloomMips}
      />
      <Vignette ref={instanceRef(vignette)} offset={0.26} darkness={0.58} eskil={false} />
      <Noise premultiply blendFunction={BlendFunction.SCREEN} opacity={0.028} />
      {/* Wrapped in a fragment so the composer's children prop still sees an
          element when aberration is disabled for lower tiers. */}
      <>
        {hasAberration ? (
          <ChromaticAberration
            ref={instanceRef(aberration)}
            offset={ABERRATION_BASE}
            radialModulation
            modulationOffset={0.42}
          />
        ) : null}
      </>
    </EffectComposer>
  );
}
