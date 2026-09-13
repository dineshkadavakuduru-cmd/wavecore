"use client";

import type { QualitySettings } from "@/lib/quality";
import { Backdrop } from "./Backdrop";
import { CameraRig } from "./CameraRig";
import { CoreMesh } from "./CoreMesh";
import { Effects } from "./Effects";
import { ParticleField } from "./ParticleField";
import { ReactiveBridge } from "./ReactiveBridge";
import { SparkleLayer } from "./SparkleLayer";

type Props = {
  quality: QualitySettings;
  onSlowFps: () => void;
};

/**
 * Scene contents.
 *
 * <ReactiveBridge/> is first on purpose: r3f runs useFrame subscribers in mount
 * order, so this is what guarantees the audio data is refreshed before anything
 * reads it in the same frame. See the note in ReactiveBridge.
 */
export function Scene({ quality, onSlowFps }: Props) {
  // No point watching for slow frames once we're already at the floor.
  const watchFps = quality.tier !== "low";

  return (
    <>
      <ReactiveBridge onSlowFps={onSlowFps} watchFps={watchFps} />
      <Backdrop />
      <CameraRig />

      {/* Keyed on tier so a quality step-down rebuilds the materials. Swapping
          a shader `defines` object in place would not trigger a recompile. */}
      <CoreMesh key={`core-${quality.tier}`} quality={quality} />
      <ParticleField key={`particles-${quality.tier}`} quality={quality} />
      {quality.sparkles > 0 ? <SparkleLayer count={quality.sparkles} /> : null}

      <Effects quality={quality} />
    </>
  );
}
