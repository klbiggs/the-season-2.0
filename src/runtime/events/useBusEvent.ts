// React hook for subscribing to an EventBus. Pairs subscribe with cleanup
// via useEffect (CLAUDE.md non-negotiable §9). Subscribers receive events
// AFTER the publishing store action's `set` returns — consumers reading
// store.getState() inside the handler observe the committed mutation.

import { useEffect } from "react";
import type { EventBase, EventBus } from "./bus";

export function useBusEvent<E extends EventBase, K extends E["kind"]>(
  bus: EventBus<E>,
  kind: K,
  handler: (event: Extract<E, { kind: K }>) => void,
): void {
  useEffect(() => {
    return bus.subscribe(kind, handler);
  }, [bus, kind, handler]);
}
