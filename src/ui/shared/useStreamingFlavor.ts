// P26 (G1): subscribes a flavor surface to the orchestrator's transient
// streaming buffer so a generating passage renders progressively instead of
// popping in whole. Returns undefined when nothing is streaming for this id —
// the caller then falls back to the persisted entry or the designer stub.
//
// The buffer is UI-ephemeral: it is cleared when the request settles, at which
// point the persisted entry (or stub) takes over on the same render.

import { useSyncExternalStore } from "react";
import type { FlavorContentId } from "../../game/rng.seeds";
import { streamingFlavorTextFor, subscribeStreamingFlavor } from "../../runtime/flavorOrchestrator";

export function useStreamingFlavor(id: FlavorContentId): string | undefined {
  return useSyncExternalStore(
    subscribeStreamingFlavor,
    () => streamingFlavorTextFor(id),
    // Server snapshot: never streaming during SSR/hydration.
    () => undefined,
  );
}
