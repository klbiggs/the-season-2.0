# P2 — Save/Load & Migrations

> Part of [The Season Master Plan](../MASTER.md). Prior: [P1 — Tick Engine & Pure Rules](./01-tick-engine.md). Next: [P3 — Strategy Map](./03-strategy-map.md).

**Goal.** Harden the save/load infrastructure into the discipline backbone every future phase will plug into. P1 shipped SaveV2 as the live format plus `migrate_v1_to_v2` registered in production, and proved single-step migration works on the happy path. P2 proves the discipline holds for a *chain* of migrations (v1 → v2 → v3), formalizes the typed-error taxonomy, adds per-step post-migration Zod validation, and lands the corrupt-save UX P1 deferred. Nothing playable is added beyond a banner and a button on `<DevApp />`; the value is structural.

This phase is the third spine vertebra: P0 proved determinism plumbing, P1 proved per-tick draws produce identical hashes across 30 runs, P2 proves the save format can evolve without breaking either guarantee or silently corrupting player data.

**In scope.**

- **Save format bump to v3.** SaveV3 extends SaveV2 with one new top-level field — `campaignName: string` — defaulting to `"Unnamed Campaign"`. P2's purpose for the bump is **discipline validation**, not gameplay: shipping a second real migration in the chain is the only way to prove the runner correctly walks v1 → v2 → v3 in sequence (the existing v1 → v2 only-step is structurally indistinguishable from "no chain"). `campaignName` is intentionally cheap, narratively forward-compatible (a campaign-list UI will want it anyway), and replay-relevant in the strict sense that renaming the campaign should advance the hash (`canonicalJSON` includes it via `hashableState` projection).

  - **Field placement: `GameState.campaignName`, not a sidecar.** The field lives on `GameState` directly (extends `GameStateSchema` in `src/game/entities.ts`), not in a separate `CampaignMetadata` object. **Why on `GameState`:** it's simpler, treats the field like `tick`, and avoids inventing a new metadata tier that nothing else needs at this phase. The hashable-state-extension test (P0) enforces schema-keys ↔ projection-keys equality, so adding it to the schema forces an extension to `hashableState` in the same commit — exactly the discipline we want.
  - **Hash inclusion is deliberate, not accidental.** The CLAUDE.md projection enforcement means `campaignName` MUST be in `hashableState`. Two saves with different names produce different hashes — restore-from-rename produces the same hash as the original-with-the-new-name. **Why this is correct:** the alternative ("excluded fields" mechanism in the extension test) would create a precedent where future fields ("save timestamp," "play-time-counter") quietly evade the projection invariant. Keeping every `GameState` field hash-relevant is the simpler rule. **Tradeoff acknowledged:** a campaign rename advances the canonical hash; the 30-run replay harness must seed the same `campaignName` across all 30 runs (P0's `createInitialState` accepts a default; the harness uses that default — no test change needed).

- **`createInitialState(seed, campaignName?)` signature extension (B2 pin).** Currently `createInitialState(seed: string): GameState` at `src/game/store.ts:39`. P2 extends to:
  ```ts
  export const DEFAULT_CAMPAIGN_NAME = "Unnamed Campaign";

  export function createInitialState(
    seed: string,
    campaignName: string = DEFAULT_CAMPAIGN_NAME,
  ): GameState {
    // ... existing body, plus campaignName field on return value
  }
  ```
  - **Optional second arg with default** preserves existing call sites (`<SeedPrompt />`, the migration's `seedStartingFamily` consumer, `hash.test.ts`, `hashable-state-extension.test.ts`). No call site is forced to update; new call sites can opt in.
  - **`DEFAULT_CAMPAIGN_NAME` constant** is exported from `src/game/store.ts` alongside `createInitialState`. The migration `migrate_v2_to_v3` imports it so the upgrade path and the fresh-state path share one source of truth for the default. **Why not `src/game/constants.ts`:** `constants.ts` is for *gameplay tunings* (probabilities, thresholds, durations) — designer-edited values. `DEFAULT_CAMPAIGN_NAME` is a string used at initialization and not subject to designer tuning; it belongs with the function that consumes it. Document inline so the next reader doesn't move it.

- **`src/persist/errors.ts`** — NEW file. Typed `SaveLoadError` taxonomy. The existing `MissingMigrationError` (currently in `runner.ts:12-17`) is migrated here and made a sibling of the new variants. All variants extend a single abstract base so `<LoadButton />` catches once.
  ```ts
  // NOTE: MigrationFailedError.cause carries an Error instance and is NOT
  // structured-clone-safe. Do not serialize SaveLoadError instances to
  // IndexedDB or postMessage them across worker boundaries — the cause
  // chain will degrade to {}. The banner UX only renders userMessage, so
  // this is fine for P2; flag for any future "send error report" feature.
  export abstract class SaveLoadError extends Error {
    abstract readonly userMessage: string;  // banner-safe; no internal jargon
  }

  export class InvalidSaveSchemaError extends SaveLoadError {
    readonly userMessage = "This save file is corrupted and cannot be loaded.";
    constructor(public readonly zodIssues: ReadonlyArray<{ path: string; message: string }>) {
      super(`Save fails schema validation: ${zodIssues.length} issue(s)`);
      this.name = "InvalidSaveSchemaError";
    }
  }

  export class UnknownSaveVersionError extends SaveLoadError {
    readonly userMessage = "This save file is corrupted and cannot be loaded.";
    constructor(public readonly observedVersion: unknown) {
      super(`Unknown save version: ${JSON.stringify(observedVersion)}`);
      this.name = "UnknownSaveVersionError";
    }
  }

  export class SaveVersionTooNewError extends SaveLoadError {
    readonly userMessage = "This save was made by a newer version of the game. Please update before loading.";
    constructor(public readonly saveVersion: number, public readonly clientVersion: number) {
      super(`Save version v${saveVersion} is newer than client v${clientVersion}`);
      this.name = "SaveVersionTooNewError";
    }
  }

  export class MigrationFailedError extends SaveLoadError {
    readonly userMessage = "This save file is corrupted and cannot be loaded.";
    constructor(
      public readonly stepFrom: number,
      public readonly stepTo: number,
      public readonly cause: unknown,
    ) {
      super(`Migration v${stepFrom} → v${stepTo} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      this.name = "MigrationFailedError";
      if (cause instanceof Error && "stack" in cause) {
        this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
      }
    }
  }

  export class MissingMigrationError extends SaveLoadError {
    readonly userMessage = "This save file is corrupted and cannot be loaded.";
    constructor(public readonly from: number, public readonly to: number) {
      super(`No migration registered from v${from} to v${to}`);
      this.name = "MissingMigrationError";
    }
  }
  ```
  - **Why a single abstract base with `userMessage`:** every load surface (P2's `<LoadButton />`, P3's player-facing menu) catches `SaveLoadError` and renders `err.userMessage`. The technical `message` is reserved for the console / structured log; the user never sees internal jargon ("Zod validation failed at path houses[0][1].reputation"). The two-channel split (technical vs. user-facing) is the §8 NFR ("Conversation failure logging without credential leak" generalized to "all error logging without internal jargon leak").
  - **`MigrationFailedError` carries `cause`** so structured logging preserves the underlying Zod issues or runtime error from the migration step. The user-facing banner stays generic; the console gets the trail.
  - **Why merge `MissingMigrationError` here, not keep it in `runner.ts`:** consolidating all save-load errors at one import path makes `<LoadButton />`'s catch block a single import. `runner.ts` imports `MissingMigrationError` from `errors.ts` after the move. Existing call sites of `MissingMigrationError` in tests update their import path; the class identity (`instanceof MissingMigrationError`) is preserved.

- **`src/persist/migrations/runner.ts` — refactor (B3 pin).** The runner picks up four responsibilities at P2:
  1. **Per-step Zod validation against the next version's schema** so a migration that returns malformed output surfaces as `MigrationFailedError` immediately, not as a confusing schema error two steps later.
  2. **Future-version detection** — `fromVersion > toVersion` was a generic `Error` at P1; now it throws `SaveVersionTooNewError`. The downward-migration ban is unchanged; only the error type changes.
  3. **Step-monotonicity assertion** — every registered migration entry must satisfy `to === from + 1`. Skipping versions is forbidden. Asserted at registry-construction time (export-time check in `index.ts` via a small helper), not at runtime, so a misconfigured registry fails the unit-test boot rather than after the player tries to load.
  4. **Defensive `from === currentVersion` per-step assertion** at runtime — defense-in-depth against a future refactor where someone re-sorts the registry.

  Updated shape:
  ```ts
  import { z } from "zod";
  import {
    MigrationFailedError,
    MissingMigrationError,
    SaveVersionTooNewError,
  } from "../errors";

  export type Migration = {
    readonly from: number;
    readonly to: number;
    // Pure function: returns a new value, does not mutate input. The runner
    // wraps `migrate` in a try/catch that re-throws as MigrationFailedError so
    // every step's failure path is uniform.
    readonly migrate: (state: unknown) => unknown;
    // Schema for the migration's OUTPUT (i.e., SaveV{to} schema). The runner
    // parses the output against this schema; failure is MigrationFailedError.
    readonly outputSchema: z.ZodTypeAny;
  };

  export function runMigrations(
    state: unknown,
    fromVersion: number,
    toVersion: number,
    registry: readonly Migration[],
  ): unknown {
    if (fromVersion === toVersion) return state;
    if (fromVersion > toVersion) {
      throw new SaveVersionTooNewError(fromVersion, toVersion);
    }
    let current = state;
    let version = fromVersion;
    while (version < toVersion) {
      const next = registry.find((m) => m.from === version);
      if (next === undefined) throw new MissingMigrationError(version, version + 1);
      if (next.to !== version + 1) {
        // Defense-in-depth — registry-construction asserts this, but guard at
        // runtime too in case a future refactor inserts a "skip" migration.
        throw new MigrationFailedError(next.from, next.to, new Error(`Non-monotonic step: v${next.from} → v${next.to}`));
      }
      try {
        const output = next.migrate(current);
        // Per-step Zod validation against the next version's schema. A bad
        // migration that returns malformed output surfaces here as a typed
        // MigrationFailedError, not as a downstream "step N+1 can't parse"
        // mystery.
        current = next.outputSchema.parse(output);
      } catch (cause) {
        if (cause instanceof MigrationFailedError) throw cause;  // don't re-wrap
        throw new MigrationFailedError(next.from, next.to, cause);
      }
      version = next.to;
    }
    return current;
  }
  ```
  - **Registry-construction monotonicity check** lives in `src/persist/migrations/index.ts`:
    ```ts
    function assertMonotonic(migrations: readonly Migration[]): void {
      for (let i = 0; i < migrations.length; i++) {
        const m = migrations[i]!;  // index in bounds by loop condition
        if (m.to !== m.from + 1) {
          throw new Error(`Migration #${i} skips: v${m.from} → v${m.to}`);
        }
        if (i > 0 && m.from !== migrations[i - 1]!.to) {
          throw new Error(`Migration #${i} gap: previous ended at v${migrations[i - 1]!.to}, this starts at v${m.from}`);
        }
      }
    }
    ```
    Called once at module load: `assertMonotonic(MIGRATIONS);`. **Why throw at module load, not at runtime:** a misconfigured registry is a programmer error caught at test-suite boot (Vitest imports the module → `assertMonotonic` runs → test fails). The player never sees this path.
  - **Per-step Zod validation is the lynchpin** of the discipline. Without it, `migrate_v1_to_v2` could return a malformed shape that `migrate_v2_to_v3` happens to coerce into a valid-looking SaveV3 — the player ends up with silently-corrupted state. With it, every intermediate shape must pass its corresponding SaveV{N}Schema. **Why output-schema not input-schema:** validating output means the chain's invariant ("each step produces a valid SaveV{to}") is enforced at every step boundary. Input validation is the *previous* step's output validation by induction, so validating both is redundant.
  - **The initial `state` parameter is NOT input-validated by the runner.** Callers are responsible for narrowing `state` (or accepting the InvalidSaveSchemaError that flows from the first step's output failure, which catches degenerate inputs anyway). `load()` is the only caller; it dispatches via the version-discriminator and routes to `runMigrations` from a known version.
  - **Production-cost note for the existing v1→v2 path.** P1's `migrate_v1_to_v2` (at `src/persist/migrations/v1-to-v2.ts:29-37`) returns a SaveV2 literal **without** an internal `SaveV2Schema.parse` — its output is currently unvalidated until reaching `load()`'s final `SaveV3Schema.parse` (which, in the v1-loaded path, runs only after the full chain). P2's runner adds a per-step `outputSchema.parse(output)` call that now runs on every v1→v2 load in production — an extra Zod parse the existing v1-loaded path does not pay. **This is acceptable cost** (Zod parsing a SaveV2-sized object is microseconds; saves are loaded once per session) and is the price of the discipline guarantee. The implementer should know `migrate_v1_to_v2`'s body does NOT need a defensive internal `SaveV2Schema.parse` — the registry-entry wrap handles input validation (SaveV1Schema.parse) and the runner handles output validation (SaveV2Schema.parse). Adding a third internal parse is redundant.

- **`src/persist/migrations/v2-to-v3.ts`** — NEW. Pure idempotent migration adding `campaignName`. Trivial body, but ships with the full discipline scaffolding so it's the template for every subsequent migration:
  ```ts
  // Pure idempotent v2 → v3 migration. Adds the campaignName field to
  // GameState. Default value is DEFAULT_CAMPAIGN_NAME so the migrated save
  // matches a fresh save's hash for the same seed (verified by
  // v2-to-v3.parity.test.ts).
  //
  // Draw-budget: ZERO. campaignName is a literal default, never randomized.
  // A future "procedurally generated default campaign name" change MUST bump
  // the save format past v3 — adding draws to a deployed migration silently
  // breaks the B7 parity invariant for every legacy save.
  //
  // Idempotence: the function is a pure (Save) → Save mapping with no
  // module-level mutation, no time-dependent reads, no RNG. v2-to-v3.test.ts
  // asserts `deepEqual(migrate(s), migrate(s))` over a fixture.

  import { DEFAULT_CAMPAIGN_NAME } from "../../game/store";
  import type { SaveV2, SaveV3 } from "../schema";

  export function migrate_v2_to_v3(save: SaveV2): SaveV3 {
    return {
      version: 3,
      tick: save.tick,
      rng: save.rng,
      houses: save.houses,
      characters: save.characters,
      marriages: save.marriages,
      campaignName: DEFAULT_CAMPAIGN_NAME,
    };
  }
  ```
  - **No deep clone.** The function returns a new top-level object; nested arrays (`rng`, `houses`, etc.) are passed by reference from the input. **Why this is safe:** the runner immediately Zod-parses the output via `SaveV3Schema.parse`, which deep-clones-on-success (Zod's standard `parse` behavior with the `.transform` calls in our ID schemas). The migration's output is never observable as a reference-sharing artifact. Spelled out here because reviewers will reflexively flag the lack of `structuredClone`.
  - **Zero RNG draws** is binding for v2→v3 specifically. Documented inline so a future-implementer "improvement" (procedural name generation) trips the comment and the parity test before it ships.

- **`src/persist/schema.ts` extension at P2.**
  - **`SAVE_VERSION_CURRENT` bumps from `2` to `3`.** All call sites that read this constant (currently `dexie.ts:5` in `import { SAVE_VERSION_CURRENT, ... }` and `dexie.ts:59` in the version-discriminator check) update automatically.
  - **NEW: `SaveV3Schema`** — extends SaveV2's shape with `version: z.literal(3)` and `campaignName: z.string()`. Field type is plain `z.string()` (no min-length, no trim) at P2 because P2 has no validation requirements for the field beyond "must be a string." P3+ may tighten when the campaign-list UI ships.
  - **NEW: `toSaveV3(state: GameState): SaveV3`** — mirrors `toSaveV2`'s shape, writes `version: SAVE_VERSION_CURRENT`, adds `campaignName: state.campaignName`. Validates via `SaveV3Schema.parse()` before returning.
  - **NEW: `fromSaveV3(save: SaveV3): GameState`** — mirrors `fromSaveV2`, adds `campaignName: save.campaignName`.
  - **`SaveRecord.data` type widens to `SaveV1 | SaveV2 | SaveV3`** in `dexie.ts`. Same discriminated-union mechanic P1 introduced for `SaveV1 | SaveV2`.
  - **`fromSaveV2` stays.** The legacy bridge is unused by the live save path post-P2 (since `save()` writes v3), but the migration runner consumes it indirectly through `migrate_v2_to_v3`'s reliance on `toSaveV2`'s output shape — and tests still exercise it. **Don't delete it at P2**; the legacy bridges (`toSaveV1`/`fromSaveV1`/`fromSaveV2`) are the migration runner's safety net.
  - **`toSaveV2` stays.** Same reasoning — it's the production path's previous incarnation, and the migration tests use it to construct realistic SaveV2 fixtures.

- **`src/persist/migrations/index.ts` extension at P2.**
  ```ts
  import { SaveV1Schema, SaveV2Schema, SaveV3Schema } from "../schema";
  import type { Migration } from "./runner";
  import { migrate_v1_to_v2 } from "./v1-to-v2";
  import { migrate_v2_to_v3 } from "./v2-to-v3";

  export const MIGRATIONS: readonly Migration[] = [
    {
      from: 1,
      to: 2,
      migrate: (s) => migrate_v1_to_v2(SaveV1Schema.parse(s)),
      outputSchema: SaveV2Schema,
    },
    {
      from: 2,
      to: 3,
      migrate: (s) => migrate_v2_to_v3(SaveV2Schema.parse(s)),
      outputSchema: SaveV3Schema,
    },
  ] as const;

  assertMonotonic(MIGRATIONS);  // module-load check; throws if registry is misconfigured
  ```
  - **`SaveV1Schema.parse(s)` and `SaveV2Schema.parse(s)` inside each `migrate` wrap** are the input-shape bridges from the `unknown` parameter to the typed migration function. These are intentionally redundant with the runner's per-step output validation: each `migrate` wrap validates its INPUT (the previous step's output, or for step 1 the raw load), and the runner validates its OUTPUT. Both must pass for the step to count as successful. **Why double validation:** the input parse catches a malformed `state` passed at the entry of `runMigrations` (the only caller is `load()`, but defense-in-depth is cheap given Zod's amortized cost). The output parse catches migration-logic bugs. Skipping either reduces the safety net asymmetrically.

- **`src/persist/dexie.ts` extension at P2.**
  - `save(slot, state)` switches `toSaveV2(state)` → `toSaveV3(state)`. One-line edit.
  - `load(slot)` updates the version-discriminator and the post-migration return type:
    ```ts
    export async function load(slot: string): Promise<SaveV3 | undefined> {
      const record = await db().saves.get(slot);
      if (record === undefined) return undefined;
      const raw = record.data;
      if (typeof raw !== "object" || raw === null || !("version" in raw)) {
        throw new InvalidSaveSchemaError([
          { path: "(root)", message: "Save record has no version field" },
        ]);
      }
      const observedVersion = (raw as { version: unknown }).version;
      if (typeof observedVersion !== "number" || !Number.isInteger(observedVersion) || observedVersion < 1) {
        throw new UnknownSaveVersionError(observedVersion);
      }
      if (observedVersion > SAVE_VERSION_CURRENT) {
        throw new SaveVersionTooNewError(observedVersion, SAVE_VERSION_CURRENT);
      }
      if (observedVersion === SAVE_VERSION_CURRENT) {
        try {
          return SaveV3Schema.parse(raw);
        } catch (cause) {
          throw asInvalidSaveSchemaError(cause);
        }
      }
      // Legacy version path — route through migrations.
      const migrated = runMigrations(raw, observedVersion, SAVE_VERSION_CURRENT, MIGRATIONS);
      try {
        return SaveV3Schema.parse(migrated);
      } catch (cause) {
        throw asInvalidSaveSchemaError(cause);
      }
    }

    // Local helper, NOT exported. Converts a Zod error to InvalidSaveSchemaError;
    // re-throws non-Zod errors unchanged so we don't accidentally swallow
    // unrelated exceptions (e.g., Dexie internal errors).
    function asInvalidSaveSchemaError(cause: unknown): InvalidSaveSchemaError {
      if (cause instanceof z.ZodError) {
        return new InvalidSaveSchemaError(
          cause.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        );
      }
      throw cause;
    }
    ```
  - **Why pre-check `version` shape before routing.** The raw record from Dexie is `unknown` at the type level (we widened the type, but structured-clone can return anything). Pre-checking `typeof observedVersion === "number"` gives `UnknownSaveVersionError` the chance to fire with the actual observed value (a string, `null`, `undefined`) for diagnostic logging. Without it, `runMigrations` would fail with the less-helpful `MissingMigrationError(NaN, ...)` and the stack trace would point at the runner, not at the parsing boundary.
  - **`SaveV3Schema.parse` failures are wrapped as `InvalidSaveSchemaError`** so `<LoadButton />`'s catch sees a single uniform error type. Non-Zod errors (Dexie database errors, structured-clone failures) bubble unchanged — those are environment failures, not save-format failures, and the banner messaging differs accordingly. **Tradeoff acknowledged:** a Dexie failure currently surfaces as the raw error message in the banner; P2 doesn't taxonomize environment failures (out of scope; the spec's "corrupt save" focus is on the format, not the storage layer).

- **`src/ui/dev/DevApp.tsx` — corrupt-save banner.** P2 adds error-banner state and renders it conditionally above the existing flex container:
  - **State shape:** `const [loadError, setLoadError] = useState<SaveLoadError | null>(null);` — typed via the abstract base so any variant can populate it.
  - **`<LoadButton />` is extended to accept `onLoadError: (err: SaveLoadError | null) => void`.** On a typed catch, it calls `onLoadError(err)` (the existing `onStatus` channel remains for non-error status like `"Loaded."` or `"No save in slot 'dev'."`).
  - **Banner component:** `<CorruptSaveBanner error={loadError} onStartNewGame={...} onDismiss={() => setLoadError(null)} />` at `src/ui/dev/CorruptSaveBanner.tsx`. Renders only when `error !== null`. Shows `error.userMessage`, a "Start New Game" button, and a dismiss "X". Banner is `role="alert"` with `aria-live="assertive"` so screen readers announce. **Styling: plain Tailwind utility classes**, NOT shadcn's `<Alert>` primitive. The shadcn primitive would require `pnpm dlx shadcn@latest add alert` as a sub-step (P0's `shadcn init` only set up `components.json` + theme tokens, no individual components were added). Plain Tailwind matches the existing dev-UI styling pattern (`<TickButton />`, `<LoadButton />`) and is consistent with the dev-only surface lifespan. P3+'s real-shell banner successor may use shadcn's `<Alert>`.
  - **"Start New Game" handler — seed source pinned via prop-threading.** The store doesn't currently track the seed-of-record (P0 `createStore({seed})` captures it as a closure variable, not as store state), so the handler reads the seed from a prop chain: `<main.tsx>` already references `DEFAULT_SEED` at construction time → passes `seed={DEFAULT_SEED}` to `<DevApp />` → `<DevApp />` forwards `seed={seed}` to `<CorruptSaveBanner />`. **Three pinned edits required in step 15** (in addition to the existing banner-mount edit):
    1. `src/main.tsx` — pass `seed={DEFAULT_SEED}` to `<DevApp store={store} />`. The literal `DEFAULT_SEED` constant is already imported (verified `main.tsx:12-19`).
    2. `src/ui/dev/DevApp.tsx` — widen props from `{ store }` to `{ store, seed }`; forward `seed` to `<CorruptSaveBanner />`.
    3. `src/ui/dev/CorruptSaveBanner.tsx` — accept `seed: string` prop; the handler body is `store.getState().replaceState(createInitialState(seed)); setLoadError(null);`.

    **Why prop-threading, not a `restartWithSeed` store action:** the store's current seed-of-record dies the moment `replaceState(fromSaveV3(saved))` overwrites state — the loaded save's RNG state has its own `seed` per-house but there's no top-level "campaign seed" field. Adding such a field to `GameState` would force a new save-format bump (v4) just for the bookkeeping, which is out of proportion to the need. Prop-threading the original seed from `main.tsx` is a one-source-of-truth solution that lives entirely above the store.

    **Tradeoff: "Start New Game" always restarts with the original launch-time seed**, not whatever seed the user may have entered via `<SeedPrompt />` after launch. The user can re-customize via `<SeedPrompt />` afterward. **Why this is acceptable at P2:** the dev surface is the only consumer; the player-facing menu (P3+) will redesign the new-game flow anyway. Documented inline in `CorruptSaveBanner.tsx`'s prop comment so a future "remember last custom seed" feature has a clear extension point.

    After the swap, `setLoadError(null)` clears the banner. **Why `replaceState` not `window.location.reload()`:** `reload()` would re-initialize the store from scratch (which works) but also discards any in-progress dev state and re-runs Vite's module graph; `replaceState` is the documented atomic-swap mechanism (P0 binding) and matches the existing load-path semantics for consistency. **Tradeoff acknowledged:** the IndexedDB record stays on disk; "Start new game" doesn't delete the corrupt save. P2 explicitly does NOT delete corrupt saves automatically — destructive side effects on a player-facing action need explicit consent and P2 has no consent UI. The implication: a user who hits "Start new game" can hit "Load" again and get the same banner. **This is acceptable at P2** (dev-only surface, no real player at risk); P3+ may add a "Delete corrupt save and start new" affordance with explicit consent.
  - **Banner lives under `src/ui/dev/`** like the rest of the P0/P1 dev UI. **It is deleted alongside the rest of `src/ui/dev/` at P3.** The typed errors and the corrupt-save handling discipline in `<LoadButton />`'s catch survive the deletion — the next-phase implementer reads the P2 plan + the typed-error taxonomy to wire a player-facing banner in the real shell.
  - **`<LoadButton />` retains its existing `onStatus` callback** for non-error messaging ("Loaded.", "No save in slot 'dev'."). The split between `onStatus` (transient OK messages) and `onLoadError` (sticky error banner) keeps the two UX channels separate. **Why two callbacks not one:** "Loaded." is informational and auto-dismisses (existing 2-second timer in `<DevApp />`); the corrupt-save banner is sticky until the user acts. Merging into one callback would either lose the sticky semantics or invent a tag system.

- **CLAUDE.md additions.** Four conventions land before P2 ships. **Literal text to append under the "Coding conventions" section of the project root `CLAUDE.md`** (no paraphrase — implementer copies verbatim):

  > - **Save migrations declare an `outputSchema`** matching their target version's `SaveV{to}Schema`. The migration runner Zod-parses each step's output against this schema before the next step runs. A migration that ships without an `outputSchema` is incomplete.

  > - **Every save migration ships an idempotence Vitest assertion** of the form `expect(migrate(fixture)).toEqual(migrate(fixture))` over a representative fixture (via the `assertMigrationIdempotent` helper in `src/persist/migrations/__test-utils__/idempotence.ts`). Catches non-deterministic migrations (Math.random, time reads, module-level mutation) before they ship.

  > - **`SaveLoadError` is the load-path error contract.** All errors thrown by `load()` during a load attempt are instances of `SaveLoadError` and carry a `userMessage: string` field. UI surfaces rendering these errors display `err.userMessage`; the technical `message` is for logging. Programmer-error throws at module-load time (e.g., `assertMonotonic`) are NOT part of this contract — they throw plain `Error` and surface only at test-suite boot.

  > - **`GameState` fields default to "in schema, in projection, in hash" unless there is a documented reason otherwise.** The `hashable-state-extension.test.ts` enforces schema-keys ↔ projection-keys equality. P2's `campaignName` follows this default (renaming a campaign advances the hash). Excluded-from-hash fields are an exception that requires its own ledger entry in the projection and a `// excluded-from-hash: <reason>` inline comment.

  These additions stand independent of the existing CLAUDE.md non-negotiables.

- **Test surface at P2.**
  - `src/persist/migrations/v2-to-v3.test.ts` — NEW. Asserts: (a) the migration adds `campaignName: DEFAULT_CAMPAIGN_NAME`; (b) the migration is structurally pure (input is not mutated); (c) idempotence (`deepEqual(migrate(s), migrate(s))`); (d) the output passes `SaveV3Schema.parse`; (e) draw-count: zero draws consumed (the input's RNG state is identical to the output's RNG state).
  - `src/persist/migrations/v2-to-v3.parity.test.ts` — NEW. Asserts `hashState(fromSaveV3(migrate_v2_to_v3(toSaveV2(createInitialState(seed)))))` equals `hashState(createInitialState(seed))`. **Seed count: 6 total** — uses the same `PARITY_SEEDS = [...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED]` pattern as `v1-to-v2.parity.test.ts:18`. Pattern consistency: every parity test in the project iterates `PARITY_SEEDS`, not bare `REPLAY_SEEDS`. **Why parity matters:** it's the discipline check that a migration doesn't accidentally introduce hash drift between fresh-state and migrated-state for the same seed. Failing this test means the migration changed something it shouldn't (or `createInitialState` is reading something the migration doesn't write — both are bugs).
  - `src/persist/migrations/v1-to-v3-chain.test.ts` — NEW. Asserts: (a) a valid SaveV1 fed through `runMigrations(save, 1, 3, MIGRATIONS)` produces a valid SaveV3; (b) the intermediate v2 state is schema-valid (proved by the runner not throwing); (c) the final state has `campaignName: DEFAULT_CAMPAIGN_NAME`; (d) for **`callCount: 0`** the final hash matches `createInitialState(seed, DEFAULT_CAMPAIGN_NAME)`. **Fixture construction pinned (mirrors `v1-to-v2.parity.test.ts:21-30`):** for each seed in `REPLAY_SEEDS`, build `const v1 = SaveV1Schema.parse({version: 1, tick: 0, rng: [["player", {seed, callCount: 0}]]});` then `expect(hashState(fromSaveV3(runMigrations(v1, 1, 3, MIGRATIONS) as SaveV3))).toBe(hashState(createInitialState(seed, DEFAULT_CAMPAIGN_NAME)))`. The parity holds **only at `callCount: 0`** because `seedStartingFamily` consumes 1 draw for the head's `deathAge` — a non-zero starting callCount produces a different campaign trajectory with no parity expectation against fresh state (matches the existing v1→v2 parity contract). This is the multi-step chain test — the actual reason for shipping a second migration at P2.
  - `src/persist/migrations/runner.test.ts` — NEW. Failure-mode coverage. Each case constructs a minimal registry inline (NOT the production `MIGRATIONS` array — tests use synthetic fixtures so failures isolate cleanly):
    - **Identity pass (`from === to`)**: registry can be empty; input is returned unchanged.
    - **`MissingMigrationError`**: registry has v1→v2 only; request v1→v3; assert the typed error fires at the v2→v3 boundary.
    - **`SaveVersionTooNewError`**: request `runMigrations(state, 5, 2, [])`; assert the typed error.
    - **`MigrationFailedError` from a throwing migration**: registry contains a single entry whose `migrate` throws; assert the typed error wraps the cause and reports the step number.
    - **`MigrationFailedError` from a migration that returns invalid output**: registry's `migrate` returns `{}`; the output fails `outputSchema.parse`; assert the typed error reports the offending step.
    - **Non-monotonic registry (skip)**: a fixture registry with `{from: 1, to: 3}` triggers `assertMonotonic` at construction. Asserted via a separate `runner.assertMonotonic.test.ts` that imports `assertMonotonic` directly (not the production MIGRATIONS).
    - **Re-wrap suppression**: when a step's `migrate` itself throws `MigrationFailedError(1, 2, ...)`, the runner does NOT re-wrap as `MigrationFailedError(2, 3, MigrationFailedError(...))`. The original error bubbles. Asserted by stack-trace inspection.
    - **"v3 save doesn't re-run v2 migrations" (spec §7 edge case)**: feed a SaveV3 to `runMigrations(save, 3, 3, MIGRATIONS)`; assert via **`expect(runMigrations(save, 3, 3, MIGRATIONS)).toBe(save)`** (reference equality — `.toBe`, NOT `.toEqual`, because the runner's `if (fromVersion === toVersion) return state;` short-circuit preserves reference identity, which `.toEqual` would silently downgrade to structural). Also assert no migration function was invoked via Vitest spy on `MIGRATIONS[*].migrate`. This is the spec edge case made executable.
  - `src/persist/dexie.test.ts` (NEW) — load-path corruption coverage. Each case writes a hand-crafted record into Dexie via `db().saves.put({slot, data: ...})` (bypassing `save()`), then `await load(slot)` and asserts the typed error type. Cases:
    - `data: { version: 99, ... }` → `SaveVersionTooNewError`.
    - `data: { version: 0, ... }` → `UnknownSaveVersionError`.
    - `data: { version: "two" }` → `UnknownSaveVersionError` with `observedVersion === "two"`.
    - `data: {}` (no version field) → `InvalidSaveSchemaError`.
    - `data: { version: 3, tick: "not-a-number", rng: [], houses: [], characters: [], marriages: [], campaignName: "x" }` → `InvalidSaveSchemaError` with a path indicating `tick`.
    - `data: { version: 1, tick: 0, rng: [["badly-typed", { seed: 42, callCount: 0 }]] }` (numeric seed) → after migration attempt, `MigrationFailedError` from the v1→v2 step (the SaveV1Schema.parse inside the registry entry throws on a non-string seed).
    - Each case calls `await _resetForTests()` in `afterEach` to keep the IndexedDB clean.
  - `src/persist/errors.test.ts` — NEW. Trivial coverage that each error class: (a) extends `SaveLoadError`; (b) extends `Error`; (c) has a stable `userMessage`; (d) preserves its `name` field; **(e) narrows through `throw`/`catch`** — for each variant, `try { throw new VariantError(...); } catch (err) { expect(err instanceof SaveLoadError).toBe(true); expect(err instanceof VariantError).toBe(true); }`. Sub-case (e) catches a `MigrationFailedError.stack` augmentation that accidentally breaks the prototype chain (e.g., `Object.setPrototypeOf` mishap during error wrapping).
  - `src/persist/migrations/v2-to-v3.idempotence.test.ts` — NEW. Standalone idempotence assertion separate from the main test file so the discipline pattern is replicable for future migrations. Imports a `assertMigrationIdempotent(migrate, fixture)` helper from `src/persist/migrations/__test-utils__/idempotence.ts` (new helper file). **Helper body uses Vitest's standard form** — `expect(migrate(fixture)).toEqual(migrate(fixture))` — NOT a custom `deepEqual` (no such helper exists in the repo). Every future `migrate_vN_to_vN+1.idempotence.test.ts` file reuses this helper, so the convention is enforceable by file existence.
  - **Existing tests that must update:**
    - `src/game/hash.test.ts` — the assertion `expect(Object.keys(projected).sort()).toEqual(["characters", "houses", "marriages", "rng", "tick"])` becomes `expect(Object.keys(projected).sort()).toEqual(["campaignName", "characters", "houses", "marriages", "rng", "tick"])`. **Also** add `campaignName: DEFAULT_CAMPAIGN_NAME` to the two inline `hashState({...})` literal calls in this file (lines 86 and 94).
    - `src/persist/migrations/v1-to-v2.parity.test.ts` — **no assertion changes required**, but the test now depends on the step-6 fix (`fromSaveV2` defaults `campaignName` on lift). Implementer reads the test post-step-6 to confirm green; if `fromSaveV2` is mis-edited and skips the default, this test goes red with a hash-mismatch diagnostic. **Why no test change:** the parity invariant (`hashState(fresh) === hashState(fromSaveV2(migrate_v1_to_v2(saveV1)))` for `callCount: 0`) is preserved by defaulting `campaignName` symmetrically on both sides of the comparison (fresh-state has it from `createInitialState`; lifted state has it from `fromSaveV2`'s defaulting). Adding the default in `fromSaveV2` is the LESS invasive of the two options the cycle-3 reviewer offered; option (b) would have required rewriting the test's RHS to chain through v3, splitting the test's intent.
    - `src/game/hashable-state-extension.test.ts` — the schema-keys ↔ projection-keys equality test passes once both sides are extended in the same commit. The test itself doesn't change.
    - `src/persist/save-roundtrip.test.ts` — extends the round-trip check to cover `campaignName` in the round-trip. **Two pinned edits:** (1) swap the `fromSaveV2` import + call site to `fromSaveV3` (existing imports at `save-roundtrip.test.ts:12,37` break typecheck the moment `load()`'s return type widens to `Promise<SaveV3 | undefined>`); (2) any literal `SaveV1` construction in the test stays as-is — the migration runner upgrades it to v3 via the chain on load. The existing hash-equality assertion still holds because both branches now produce `campaignName` consistently via `createInitialState`'s default. **No `GameState` literals in this test file need `campaignName` added** — all GameState constructions go through `createInitialState`. Implementer audits in the same commit as the schema extension.

- **Commit sequencing (single coordinated commit, "Commit P2").** The schema extension, hash projection, store changes, migration code, and the UI banner are all coupled by the hashable-state-extension test. A partial commit breaks CI. Order within the single commit:
  1. **Add `DEFAULT_CAMPAIGN_NAME`** constant export to `src/game/store.ts` (additive, no test failures).
  2. **Add `campaignName` field to `GameStateSchema`** in `src/game/entities.ts`. The hashable-state-extension test goes red until step 3.
  3. **Extend `hashableState` projection** in `src/game/hash.ts` to include `campaignName`. Extension test passes again.
  4. **Extend `createInitialState` signature** in `src/game/store.ts` with the optional `campaignName` parameter and the field in the returned object.
  5. **Update `hash.test.ts`** keyset assertion (the `.toEqual([...])` line). Add `campaignName: DEFAULT_CAMPAIGN_NAME` to every literal `GameState` construction site that does NOT go through `createInitialState`. **Explicit enumerated list (9 sites — verified by cycles 2–3):**
     - `src/runtime/tickOrchestrator.test.ts` — `makeState` helper
     - `src/runtime/yearPass.test.ts` — `makeState` helper
     - `src/game/rules/aging.test.ts` — `makeState` helper
     - `src/game/rules/conception.test.ts` — `makeState` helper
     - `src/game/rules/economy.test.ts` — `makeState` helper
     - `src/game/rules/moods.test.ts` — `makeState` helper
     - `src/game/rules/succession.test.ts` — `makeState` helper
     - `src/game/hash.test.ts` — **two `hashState({...})` inline-literal call sites at lines 86 and 94**; both need `campaignName: DEFAULT_CAMPAIGN_NAME` added to the literal alongside the existing `tick`/`rng`/`houses`/`characters`/`marriages` keys
     - `src/persist/schema.ts` — `fromSaveV1`'s return-value literal AND `fromSaveV2`'s return-value literal (the GameState shapes returned for legacy v1 and v2 loads — see step 6 for the exact change required)

     Implementer touches each file once and confirms the typecheck is clean across the full repo before proceeding to step 6. **Why an explicit list, not grep:** the previous grep target (`houses: new Map()`) is not a reliable anchor (verified — the reviewer found it doesn't exist in `entities.ts:54`); enumeration removes the audit-by-pattern fragility.
  6. **Add `SaveV3Schema`, `toSaveV3`, `fromSaveV3`** to `src/persist/schema.ts`. Bump `SAVE_VERSION_CURRENT` from 2 to 3. **Also update the legacy bridges `fromSaveV1` and `fromSaveV2` to write `campaignName: DEFAULT_CAMPAIGN_NAME` on their returned GameState** — these functions now lift older-shape saves to the current GameState type, which after step 2 requires the `campaignName` field. **Why default on lift:** SaveV1 and SaveV2 have no `campaignName` field by construction; the lift is the natural place to default it (analogous to `migrate_v2_to_v3` defaulting it during the migration step). Without this, the existing `src/persist/migrations/v1-to-v2.parity.test.ts` goes red (`hashState(fresh) !== hashState(fromSaveV2(migrate_v1_to_v2(saveV1)))` because `fresh` has `campaignName` and `migrated` doesn't). With this, the existing parity test passes unchanged — `fromSaveV2` returns a GameState whose `campaignName` matches `createInitialState(seed)`'s default.
  7. **Widen `SaveRecord.data`** in `src/persist/dexie.ts` to `SaveV1 | SaveV2 | SaveV3`. Update `save()` to call `toSaveV3`. Update `load()`'s implementation per the new shape above. **Pinned sub-edits:** (a) add `import { z } from "zod"` at the top of `dexie.ts` — `dexie.ts` has no zod import today, but the new `asInvalidSaveSchemaError` helper references `z.ZodError`; (b) add an inline comment on the `SaveRecord.data` type widening: `// Type widening is documentation-only — structured-clone returns raw shapes at runtime. Narrow via .version (load() is the only sanctioned narrowing site).`
  8. **Add `src/persist/errors.ts`** with the typed taxonomy. Migrate `MissingMigrationError` from `runner.ts`; update `runner.ts`'s import to reference the new location.
  9. **Refactor `runner.ts`** to add per-step Zod validation, the `outputSchema` field on `Migration`, the future-version check (now throwing `SaveVersionTooNewError`), and the runtime monotonicity guard.
  10. **Add `src/persist/migrations/v2-to-v3.ts`** with `migrate_v2_to_v3`.
  11. **Update `src/persist/migrations/index.ts`** — extend `MIGRATIONS` with the v2→v3 entry, add `outputSchema` to the existing v1→v2 entry, call `assertMonotonic(MIGRATIONS)` at module load.
  12. **Add `src/persist/migrations/__test-utils__/idempotence.ts`** helper.
  13. **Add `src/ui/dev/CorruptSaveBanner.tsx`** component.
  14. **Extend `src/ui/dev/LoadButton.tsx`** — three pinned sub-edits: (a) swap the existing `fromSaveV2` import (`LoadButton.tsx:4`) and call site (`LoadButton.tsx:21`) to `fromSaveV3`; (b) widen the component's `Props` type to add `onLoadError: (err: SaveLoadError | null) => void`; (c) add a typed-catch branch: `catch (err) { if (err instanceof SaveLoadError) onLoadError(err); else onStatus(\`Load failed: ${err instanceof Error ? err.message : String(err)}\`); }`. Without sub-edit (a), the moment `load()`'s return type widens to `Promise<SaveV3 | undefined>` in step 7, `LoadButton.tsx` fails typecheck — `fromSaveV2` accepts `SaveV2`, not `SaveV3`. **Ordering note: this step lands immediately after step 7** so the typecheck-red window between steps 7 and 14 is collapsed (the single-commit framing makes mid-window typecheck failures invisible to CI, but a future split-commit refactor benefits from the shorter window).
  15. **Extend `src/ui/dev/DevApp.tsx`** with the `loadError` state, `<CorruptSaveBanner />` mount, and wiring of `onLoadError` to `<LoadButton />`.
  16. **Add the new test files** listed under "Test surface at P2."
  17. **Append the four CLAUDE.md additions** before declaring done.

  **Why a single commit, not Commit A / Commit B like P1.** P1's split was forced by interlocking state-shape vs. test changes that crossed multiple subsystems (state machines, year-pass, draw budgets). P2's surface is narrower — one new field, one new migration, one new error file, one new banner. The hashable-state-extension test forces an atomic schema-and-projection extension (steps 2–3); everything else is additive. A single coordinated commit keeps the change reviewable.

**Out of scope.**

- **Sidecar binary vector index** (deferred to P17, semantic memory).
- **File import/export (player-facing save export / import via the OS file picker).** P2's persistence layer is IndexedDB-only; the spec mentions "human-readable structured-data file" but P2 doesn't ship file IO. JSON parse failure isn't a P2 concern because the load path doesn't `JSON.parse` anything — Dexie's structured-clone round-trip is the storage primitive. File IO lands when there's a player-facing reason to need it (export-save-to-share, import-into-different-browser).
- **Autosave-on-tick or autosave-on-year-pass.** Slot model stays single-slot (`DEV_SLOT`). Spec's "single file" wording doesn't require autosave at this stage. Manual `<SaveButton />` continues to be the only save trigger. Autosave lands when there's an in-game reason to need it (probably when ballroom conversations make tick-level loss meaningful, P4+).
- **Named multi-slot UI.** Player-facing save-management UI lands with the real shell (P3+). P2's `DEV_SLOT` constant remains the single slot reference.
- **Absolute-tick scheduled-event invariant tests.** Spec §4 and §7 mandate that all scheduled future events (courier payloads, scheme completions, global-event expirations) store absolute end-ticks. P2 has no scheduled-event subsystem to test against (couriers ship P6, schemes P5, global events P13). The invariant is documented in CLAUDE.md (non-negotiable §2 "Every scheduled event stores an absolute end-tick") but a test landed at P2 would be a no-op against zero scheduled events. **Each phase that introduces a scheduled-event class ships its own absolute-tick test** alongside the new field — P2's job is to document the discipline, not pre-write tests for fields that don't exist.
- **Delete-corrupt-save affordance.** The "Start New Game" button creates fresh state but does not delete the corrupt IndexedDB record. A user who re-loads will hit the same banner. Destructive auto-delete needs explicit consent UI; P2 surfaces neither. P3+ may add a "Delete corrupt save" button alongside the banner.
- **Dexie schema migrations.** Dexie's object-store layout (`saves` keyed by `slot`) stays at Dexie schema version 1. This is a separate concept from save-format version — Dexie versions the storage layout, save-format versions the JSON shape. P2 changes save-format version (2 → 3) but does NOT change Dexie schema version. The distinction is documented inline in `dexie.ts` and reiterated in the P2 CLAUDE.md addition.
- **`Character.composure` / `Character.affection`** (deferred to P4 with the conversation system).
- **`Character.happiness`** (deferred to P7 with the happiness-drain subsystem).
- **`MarriageRecord.viaElopement`** (deferred to P9 with elopement).

**Spec refs.** §3 "Save & Load" (versioned format, sequential additive migrations); §4 "Data Lifecycle" / "Consistency Requirements" (absolute-tick events, per-house seed+callCount round-trip); §5 "Filesystem Persistence" (corrupt-file readable error, new-game alternative, missing-file → new-game default); §7 edge cases ("Save-data migration ordering" — version-13 must NOT re-run version-12); §8 NFR ("Save serialization synchronous", "Save data must be forward-migratable", "Behavioral changes that break determinism gated by a new save version"); §9 reliability requirements ("Express each save-data migration as a named, idempotent, pure-function transformation"; "unit-test each transformation in isolation").

**Key rules / constants.**

- `SAVE_VERSION_CURRENT = 3 as const` after P2.
- `DEFAULT_CAMPAIGN_NAME = "Unnamed Campaign"` exported from `src/game/store.ts`.
- All errors thrown by `load()` are instances of `SaveLoadError` and carry `userMessage: string` for user-facing rendering and `message: string` for logging. The two channels never cross.
- Every registered `Migration` declares an `outputSchema` matching its target version's `SaveV{to}Schema`. The runner Zod-parses the migration output against this schema before the next step runs.
- Migration registry is strictly monotonic (every entry `to === from + 1`), asserted at module load via `assertMonotonic(MIGRATIONS)`.
- A `runMigrations(state, N, N, registry)` call returns `state` unchanged WITHOUT invoking any registered migration (spec §7 edge case "v13 save must NOT re-run v12 migrations").
- **Valid live save-format version range: `[1, SAVE_VERSION_CURRENT]`.** `load()`'s pre-check rejects `observedVersion < 1` as `UnknownSaveVersionError` and `observedVersion > SAVE_VERSION_CURRENT` as `SaveVersionTooNewError`. A future "support v0 sentinel for new-game-default" idea must update both the range and the test cases in `dexie.test.ts`.
- The Dexie schema version stays at `DEXIE_SCHEMA_VERSION = 1`. The save-format version evolves independently.

**Machines.** None new. Save/load is a transactional surface, not a state machine — the load path is a one-shot routing through version-discrimination → migration chain → schema validation → state swap. P0's view-routing state machine (catalog §5.2) is not affected.

**Edge cases (§7).**

- **"Save-data migration ordering"** — covered by the runner's natural one-step-at-a-time walk plus the `runMigrations(state, N, N, ...)` short-circuit. Tested via `runner.test.ts`'s "v3 save doesn't re-run v2 migrations" case.
- **Missing save file** — already handled at P0 (`load()` returns `undefined`). P2 doesn't change this path.
- **Corrupt save file (all four taxonomy variants)** — covered by the typed error taxonomy and `dexie.test.ts`'s corruption cases. Banner UX in `<CorruptSaveBanner />` satisfies spec §5's "surface a readable error without crashing; the player retains the option to start a new game."
- **Future-version save** — handled by `SaveVersionTooNewError` with a distinct user message ("This save was made by a newer version of the game. Please update before loading.") vs. the generic corruption message. Spec §8 compatibility requires forward migration but says nothing about backward-compatibility of newer saves; P2's choice is to refuse cleanly with a distinct message rather than try to load.

**Verification.**

- `pnpm test` — all Vitest suites green; the 30-run replay still produces identical hashes (extended with `campaignName` in the projection); the save round-trip continues to match its no-detour control; the migration chain v1 → v2 → v3 produces a SaveV3 whose `hashState` matches a fresh `createInitialState` for the same seed (parity); all failure-mode tests in `runner.test.ts` and `dexie.test.ts` pass; the idempotence assertion on `migrate_v2_to_v3` passes.
- `pnpm lint` — Biome clean.
- `pnpm lint:boundaries` — ESLint boundaries clean. **No new boundary rules at P2.** `src/persist/errors.ts` is part of the existing `persist` element; `src/ui/dev/CorruptSaveBanner.tsx` is part of `ui`; no cross-element imports are introduced beyond the existing pattern (`ui → persist` for `load()`, already allowed). **`persist → game-store` import (for `migrate_v2_to_v3`'s `DEFAULT_CAMPAIGN_NAME` reference) is verified permitted** — `eslint.config.js` declares `default: "allow"` for cross-element imports; only `game-rules` is `from`-restricted. No positive-control test addition required, but adding one to `eslint/boundaries.test.ts` would future-proof against a tightening of `default: "deny"`.
- `pnpm typecheck` — strict TS clean with the widened `SaveV1 | SaveV2 | SaveV3` discriminated union narrowing correctly via the `version` discriminator throughout `dexie.ts`.
- **Playwright extension (`tests/e2e/dev-smoke.spec.ts`).** P0's smoke spec covers tick → save → reload → restore. P2 extends with a corrupt-save flow:
  - **Setup writes the hand-crafted `{version: 99, ...}` record via a new test-only `_putRawForTests(slot, data: unknown)` export in `dexie.ts`** (added in step 7 alongside the existing `_resetForTests`). The helper is one line — `await db().saves.put({slot, data: data as never})` — and is the cleanest of the two options (vs. `page.evaluate(...)` against a `window`-exposed Dexie handle, which would require wiring the DB to `window` solely for tests).
  - **Timing:** `page.goto("/")` returns → `await page.evaluate(() => window.__putRawForTests("dev", {version: 99}))` (the helper is exposed on `window` via a dev-mode import in `main.tsx` — gated behind `import.meta.env.DEV`) → click `<LoadButton />`. Pinning the order prevents a race where the corruption write loses to React's initial mount.
  - **Banner assertions:** `await expect(page.getByRole("alert")).toBeVisible(); await expect(page.getByRole("alert")).toHaveAttribute("aria-live", "assertive"); await expect(page.getByRole("alert")).toContainText("newer version of the game");` — the aria-contract from the banner's plan body (line ~292) becomes executable here.
  - **Recovery flow:** click "Start New Game" → assert the banner disappears (`await expect(page.getByRole("alert")).not.toBeVisible()`) and the tick readout shows `0`.
  - **Why Playwright not just Vitest:** the banner is UI; the catch-renders-banner wiring is end-to-end behavior that a unit test can't validate.
- **Forbidden-randomness walker test continues to pass.** No new files import `Math.random` or `crypto.getRandomValues`. The migration is deterministic by construction (zero draws).
- **CLAUDE.md updates.** Four conventions appended (per "CLAUDE.md additions" bullet in In Scope). The four new entries are appended under the existing "Coding conventions" section in the project root `CLAUDE.md`, not inline in the phase plan.

**Rollback.** Trivial pre-merge: revert the branch. The save format goes back to v2; any v3 save written during testing becomes unloadable by the rolled-back client (which will then throw `SaveVersionTooNewError` — exactly the path P2 added to handle this case, which is reassuring). For a rollback post-merge with players-in-the-wild who have written v3 saves, a one-shot reverse migration `migrate_v3_to_v2` is required — but P2's pre-merge rollback assumes no such players exist (dev-only surface at P2; real player rollout is later phases).

**Close out.** When the gates and verification items above are green, run `/close-phase P2` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work (P2 doesn't answer any of the §10 open questions — it closes out P1's deferred "corrupt-save banner UX" callout), and surface proposed `CLAUDE.md` additions and a commit message for approval.

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] `SaveRecord.data` widening to `SaveV1 | SaveV2 | SaveV3` is documentation-only — runtime structured-clone returns raw shapes; future readers shouldn't trust `record.data.tick` outside `load()`. Pin this with an inline comment. [applied]
- [C1] Step 5's grep-based audit is fragile — enumerate the literal-GameState construction sites explicitly rather than instructing the implementer to grep. [likely addressed]
- [C1] No P3 pin saying "ships `<CorruptSaveBanner />`'s successor in the real shell" — risk that P3 ships UI without re-instating banner rendering. [skipped: requires edit to 03-strategy-map.md outside this plan; flag for P3 author]
- [C1] "Re-wrap suppression" test exercises a dead path for the production registry — neither `migrate_v1_to_v2` nor `migrate_v2_to_v3` throws `MigrationFailedError` directly. Either drop the test + the `if (cause instanceof MigrationFailedError) throw cause;` guard as YAGNI, or pin the synthetic-fixture construction for the test. [applied: keep guard; pin synthetic fixture inline — see below]
- [C1] **Re-wrap-suppression synthetic-fixture pin (applied).** The test in `runner.test.ts` constructs the fixture inline: `const registry: readonly Migration[] = [{from: 1, to: 2, migrate: () => { throw new MigrationFailedError(1, 2, new Error("synthetic inner")); }, outputSchema: SaveV2Schema}]; expect(() => runMigrations({version: 1, tick: 0, rng: []}, 1, 2, registry)).toThrow(MigrationFailedError);` then asserts the caught error's `cause.message === "synthetic inner"` AND `cause` is NOT another `MigrationFailedError`. This proves the guard works against a synthetic adversary; the production registry never triggers it. Keep the guard (one-line defensive cost) to insure against a future migration that does throw `MigrationFailedError` directly.
- [C1] `MigrationFailedError.cause` carries an Error instance that won't survive structured-clone — flag for the future error-logging surface. [applied: add inline comment to errors.ts noting `cause` is not structured-clone-safe; document at the class definition]
- [C1] Playwright test references a "direct Dexie write helper" that doesn't exist — pick one of `_putRawForTests(slot, data)` (new test-only export) or `page.evaluate(...)` via `window.dexie`. [applied: `_putRawForTests` chosen and pinned in Verification's Playwright section]
- [C1] `assertMonotonic` throws plain `Error`, not `SaveLoadError` — reword CLAUDE.md addition #3 to "errors thrown by `load()` during a load attempt" so module-load-time programmer errors are carved out. [applied: CLAUDE.md addition #3 reworded inline]
- [C1] Confirm `eslint-plugin-boundaries` permits `persist → game-store` for `migrate_v2_to_v3`'s `DEFAULT_CAMPAIGN_NAME` import (it should, given v1→v2 already imports `seedStartingFamily` from `game/bootstrap`). Restate in verification. [applied: restated in `pnpm lint:boundaries` verification bullet]
- [C1] "Start New Game" seed source ambiguity — pin either (a) thread seed through `DevApp` → `CorruptSaveBanner` explicitly, or (b) add a `restartWithSeed` store action that re-derives the prior seed. [likely addressed]
- [C2] Playwright extension's aria-attribute assertion: assert `role="alert"` / `aria-live="assertive"` on `<CorruptSaveBanner />`, not just visibility + post-click tick=0. [applied]
- [C1] Existing `v1-to-v2.test.ts` and `v1-to-v2.callcount-passthrough.test.ts` inherit `fromSaveV2`'s default-on-lift transparently — both sides of their hash comparisons gain `campaignName: DEFAULT_CAMPAIGN_NAME` symmetrically. Call this out in "Existing tests that must update" so a future implementer doesn't "defensively" add a literal `campaignName` field that isn't needed. [applied]
- [C1] `eslint-plugin-boundaries` confirmed to permit `persist → game-store` for `migrate_v2_to_v3`'s `DEFAULT_CAMPAIGN_NAME` import (default rule is `allow`; only `game-rules` is `from`-restricted). Restate the verified result in the verification section rather than leaving the question open. [applied]
- [C2] Step 7's edit list elides the new `import { z } from "zod"` in `dexie.ts` — the `cause instanceof z.ZodError` check in `asInvalidSaveSchemaError` requires it (no zod import exists today in `dexie.ts`). Pin in step 7. [applied]
- [C2] `assertMigrationIdempotent` helper body uses `deepEqual(...)` (no such helper in repo or imported). Pin Vitest's `expect(a).toEqual(b)` form. [applied]
- [C2] `load()`'s `observedVersion < 1` guard in the snippet (lines ~252) — pin the live valid range explicitly in "Key rules / constants" as `[1, SAVE_VERSION_CURRENT]` so a future "support v0 sentinel" idea has to confront the test. [applied]
- [C3] Atomic-commit ordering caveat: `<LoadButton />` is in a typecheck-red state between commit steps 7 (load() return widens to `Promise<SaveV3 | undefined>`) and 14 (LoadButton swaps to `fromSaveV3`). No green midpoint in the 17-step sequence. Either accept this (single-commit framing assumes atomic land) or reorder so step 14's LoadButton edit moves earlier (between step 7 and step 8). [applied: step 14's ordering note added — implementer can land step 14 immediately after step 7 if they want a green mid-window]
- [C3] Step 14 commit-sequence text could enumerate `onLoadError` prop widening as a distinct sub-edit (currently bundled with "catch-branch + import swap"). Splitting makes review easier. [applied: three sub-edits enumerated explicitly]
- [C3] Playwright corruption setup timing isn't pinned — `page.evaluate(...)` after `page.goto("/")` is implied but not stated. Pin: corruption write fires after `page.goto` returns and before the LoadButton click. [applied]
- [C3] Enumeration of 9 literal-GameState construction sites is sound, but the verification claim "no other literals" is unbacked — adding a Vitest sanity test (or one-time grep audit during implementation) catches a future test file that adds a 10th site. [skipped: fix unclear — a Vitest sanity test for "GameState literals" requires AST inspection or careful regex, both fragile; implementer can do a one-time `rg "tick:\s*\d|tick:\s*\w+\.tick"` audit during implementation but a permanent test isn't worth the maintenance cost]
- [C1] Inline the literal CLAUDE.md addition text in the plan body so reviewers can vet exact wording before commit step 17. [applied: literal text inlined as blockquotes]
- [C1] `errors.test.ts` should also verify `instanceof SaveLoadError` narrowing through `throw`/`catch`, not just class-extension. [applied: sub-case (e) added]
- [C1] `v2-to-v3.parity.test.ts` uses 5 seeds (REPLAY_SEEDS); v1→v2 parity uses 6 ([...REPLAY_SEEDS, NEGATIVE_CONTROL_SEED]). Match for pattern consistency. [applied: now 6 seeds]
- [C1] "v3 save doesn't re-run v2 migrations" test must use `.toBe(input)` (reference-equality), not `.toEqual(input)` (structural). Pin the exact assertion form. [applied]
- [C1] Banner could use shadcn's `<Alert>` primitive (project tech stack) rather than rolling banner styles, for P3+ consistency. [applied: plain Tailwind chosen explicitly with rationale]
