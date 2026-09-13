import { WavecoreExperience } from "@/components/WavecoreExperience";

/**
 * The entire product lives on this one route: a full-screen canvas with a thin
 * chrome layer over it. There is no backend, no auth, no persistence.
 */
export default function Page() {
  return <WavecoreExperience />;
}
