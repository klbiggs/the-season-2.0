// Typed Map-based pub/sub. Generic over an EventBase shape (events must be
// discriminated unions with a literal `kind` field). Subscribers register
// per-kind; cleanup is the returned unsubscribe function (must be called at
// component unmount — see CLAUDE.md non-negotiable §9 "every subscription
// pairs with a cleanup unsubscribe").
//
// CONTRACT (P3 convention; CLAUDE.md addition):
// - bus.publish fires from store-action wrappers AFTER `set` returns.
// - Orchestrator phase composition stays the pure reduce-over-PHASES form;
//   phases NEVER call bus.publish.
// - React subscribers register via useEffect + cleanup, or the
//   useBusEvent hook (src/runtime/events/useBusEvent.ts).

export interface EventBase {
  readonly kind: string;
}

type Subscriber<E> = (event: E) => void;

export class EventBus<E extends EventBase> {
  private readonly subscribers = new Map<E["kind"], Set<Subscriber<E>>>();

  publish(event: E): void {
    const subs = this.subscribers.get(event.kind as E["kind"]);
    if (subs === undefined) return;
    for (const sub of subs) sub(event);
  }

  subscribe<K extends E["kind"]>(
    kind: K,
    handler: Subscriber<Extract<E, { kind: K }>>,
  ): () => void {
    let subs = this.subscribers.get(kind);
    if (subs === undefined) {
      subs = new Set();
      this.subscribers.set(kind, subs);
    }
    // The Extract narrowing is safe because publish dispatches by kind.
    subs.add(handler as Subscriber<E>);
    return () => {
      const current = this.subscribers.get(kind);
      if (current !== undefined) {
        current.delete(handler as Subscriber<E>);
      }
    };
  }
}
