# P27 — Platform: Ledger QoL, Tooling & Infra (v1.5)

> **Status: 📋 planned (skeleton).** Track: v1.5. Source: [MASTER.md §11.2-J/K](../MASTER.md#112-v15--deferred-backlog-aggregated-deduped) + the §11.2 OBSOLETE-after-P19 strike.
> Quality-of-life across the ledger plus dev/build/save tooling. Almost entirely non-gameplay — no new rules.

## Depends on
P0 (build/RNG/save scaffold), P2 (save/load), P14 (ledger).

## Goal
The ledger is pleasant to navigate and the project has the dev-tooling / save-management it deferred at v1.

## In scope
- **Ledger QoL (§11.2-J).** Cross-view global-events chip row; shadcn `Tabs` install (replace hand-rolled ARIA tabs); URL routing / deep-linking for tabs; Activity / Event-log tab + a persistent event-log subsystem; sortable / filterable tables; fast-forward-to-next-event / auto-tick-while-idle; "host an event at the rural estate" action (Patronage); per-family / per-location patronage tuning.
- **Infra / dev / build (§11.2-K).** CI workflow; hosting / static-SPA deploy target; `seedrandom.alea({state:true})` O(1) restore; `REPLAY_BASELINE.md` regression-anchor hash; save import/export; autosave; named multi-slot save-management UI; delete-corrupt-save consent affordance; Dexie object-store schema-migration tooling; centralize the duplicate local `clamp` across the 4 rule files; remove the empty `src/game/machines/` slot / unrealized XState dependency.
- **Strike OBSOLETE-after-P19 backlog items.** Verify `HousePreV4Schema` → `.omit()` refactor and the reverse `v3→v2` migration are dead (the ladder was deleted at P19), then remove them from §11.2-K.
- **Documented non-goals (no build):** proxy rate-limiting / auth / quotas; public deployment / Docker / systemd.

## Out of scope
Any gameplay rules. Society replenishment / portraits (P22). Streaming render path (P26).

## Cross-cutting impact
- **No save-format migration / version bump** (pre-release posture — see the §6 "Migration posture" note). The **event-log subsystem**, if it adds a top-level `GameState` field, is edited into the single live schema in place + full quad-sync + `hashable-state` wiring, with an explicit in-hash-vs-sidecar decision (likely in-hash like `conversationHistory`, or a P17-style sidecar if it's rebuildable). Dev saves reset on schema change.
- **Dexie object-store schema-migration tooling is a DISTINCT concept** from save-format version (per the P17 pin) — it covers IndexedDB store layout (`.version()` chaining) and IS in scope here regardless of the save-migration posture.
- The **`seedrandom.alea({state:true})` O(1) restore** touches the determinism core — it MUST preserve replay-hash parity across 30 runs (the whole point of the determinism contract).
- Autosave / multi-slot / import-export touch the `persist/` layer; save serialization must stay synchronous with no UI stall (NFR §8). Most other items are pure tooling/UI with no save impact.

## Verification (definition of done)
- Tabs / URL routing / sorting / fast-forward work; save import/export round-trips; autosave does not stall the UI.
- O(1) RNG restore produces identical 30-run replay hashes to the re-draw implementation.
- `pnpm test` / `lint` / `typecheck` / `knip` clean; CI runs them on PR.

## References
spec §8 (NFRs: save serialization, replay stability); MASTER §11.2-J/K + OBSOLETE strike, §11.3; P0, P2, P14; CLAUDE.md verification expectations + P19 knip/`machines/`-slot notes.
