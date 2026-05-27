// Deterministic ElopementId factory. Format: `elopement:${schemeId}:${index}`
// where `index` counts existing sprints originating from the same Seduction
// scheme (normally 0 — one Discovered Seduction mints one sprint; the index
// keeps the id well-defined if that invariant ever widens).
//
// Why deterministic (not UUID): state.elopements participates in the hash
// projection; a non-deterministic id would break the 30-run replay NFR (§8).
// Per the *IdFactory.ts convention for state-walking id factories
// (cf. makeSchemeId, makeWhisperId, makeCourierPayloadId) — the brand +
// ElopementIdSchema live in rng.ts; only this state-walking factory lives here.

import type { GameState } from "../entities";
import type { ElopementId, SchemeId } from "../rng";

export function makeElopementId(state: GameState, schemeId: SchemeId): ElopementId {
  let index = 0;
  for (const e of state.elopements.values()) {
    if (e.schemeId === schemeId) {
      index += 1;
    }
  }
  return `elopement:${schemeId}:${index}` as ElopementId;
}
