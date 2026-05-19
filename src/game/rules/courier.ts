// Pure transit-table lookup. Symmetric pair canonicalized via lex-key. The
// table itself lives in fixtures/locations.ts.
//
// Courier payload processing (scheduling, draining) is deferred to P6; P1
// ships only this lookup so the table has a stable canonical home.

import { type LocationId, TRANSIT_PAIRS } from "../fixtures/locations";
import { UnknownLocationPairError } from "../util/errors";

function canonicalKey(a: LocationId, b: LocationId): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

const TRANSIT_TABLE: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  for (const [a, b, ticks] of TRANSIT_PAIRS) {
    m.set(canonicalKey(a, b), ticks);
  }
  return m;
})();

export function transitTicks(from: LocationId, to: LocationId): number {
  if (from === to) return 0;
  const ticks = TRANSIT_TABLE.get(canonicalKey(from, to));
  if (ticks === undefined) throw new UnknownLocationPairError(from, to);
  return ticks;
}
