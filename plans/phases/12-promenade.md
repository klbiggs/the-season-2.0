# P12 — Hyde Park Promenade

> Part of [The Season Master Plan](../MASTER.md). Prior: [P11 — Sibling Rivals & Inherited Secrets](./11-sibling-rivals-secrets.md). Next: [P13 — Global Events & Era Progression](./13-global-events-era.md).

**Goal.** A daytime LLM-driven 1-on-1 conversation alternative to the ballroom at the Capital location. The player presses "Promenade in Hyde Park" at the Capital LocationDetailsPanel; the rule layer deterministically picks a single non-player non-rival partner via one draw on the player RNG; the orchestrator opens a parallel conversation session (multi-turn freeform messages routed through the same `/api/llm/conversation` proxy endpoint the ballroom uses, with a new `mode: "Promenade"` field); three tactic affordances are available (`WittyBanter` / `DeepEmpathy` / `ComplimentMount`); the faux-pas branch is suppressed across all three; composure damage is zero across all three; an owned-and-equipped mount-family artifact on the player head grants a per-action affection bonus; the session consumes one tick on exit (commit-on-leave). **No save format bump.** `SAVE_VERSION_CURRENT` stays at 12.

P12 is the first phase to **widen `TACTICS` from 4 → 5** and the first to add a parallel LLM-driven conversation surface alongside the ballroom. It is also the first phase to add a tick-advancing wrapper that consumes the wrapper-set publisher contract WITHOUT a save bump (existing 10-publisher set per CLAUDE.md "10/10/9 publisher set across store wrappers" — `exitPromenade` joins the existing five at 10).

**What does NOT change (load-bearing).** SAVE_VERSION_CURRENT stays 12; no migration, no chain-test addition, no strip-cascade extension, no quad-sync extension at `schema-projection-selector-extension.test.ts`, no `createInitialState` literal edit, no `overwriteFromGameState` edit. PHASES stays at 14 (no new tick-phase slot — promenade is a player-elected action that wraps `advanceTickPure`, not a per-tick scheduled action). Year-pass STEPS stays at 5. `PERSONA_CACHE_VERSION` stays at `"v4"` (the persona prompt's body is unchanged across modes; mode framing rides on the per-turn user message, NOT the cached persona — see "Persona prompt + mode framing" below). `RIVAL_HOUSE_IDS_SET` and `RIVAL_CHARACTER_IDS_SET` are read but not widened. The schema↔projection↔selector↔overwriteFromGameState quad-sync surface does NOT change.

**In scope.**

- **`TACTICS` widening (`src/game/constants.ts:140`).** Single-entry append:
  ```ts
  // BEFORE P12:
  //   export const TACTICS = ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"] as const;
  // AFTER P12:
  export const TACTICS = ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy", "ComplimentMount"] as const;
  ```
  Module-load assertion is added (paralleling the `SCHEME_KINDS` precedent at `src/game/constants.ts:294`):
  ```ts
  if (TACTICS.length !== 5) {
    throw new Error(
      `TACTICS length changed (${TACTICS.length} !== 5) without phase plan + (where needed) save-version bump`,
    );
  }
  ```
  `Tactic` (the inferred union type at `src/game/constants.ts:141`) auto-widens. Static-exhaustiveness consumers that must acknowledge the new value:
  - **`TACTIC_BONUS_MOOD: ReadonlyMap<Tactic, Mood>`** — Map intentionally does NOT include a `"ComplimentMount"` entry. `.get("ComplimentMount")` returns `undefined`, which matches the v1 design: ComplimentMount bypasses mood synergy entirely (it is a direct affection bonus gated only on target mount-ownership). The combat resolver branch for ComplimentMount never reads this Map.
  - **`CONVERSATION_TRAIT_BONUSES`** + **`CONVERSATION_TRAIT_PENALTIES`** — same pattern: no `Tactic`-keyed entry for `"ComplimentMount"`. The promenade resolver branch for ComplimentMount doesn't consult these Maps. The four existing `TraitId → ReadonlyArray<Tactic>` entries (per-trait bonus/penalty lists) are NOT widened to include "ComplimentMount"; per-trait bonus/penalty interactions with ComplimentMount are out of v1 scope (would re-introduce trait-driven variance that contradicts the "low-risk" spec framing).
  - **`combat.ts:resolveCombat`** — ballroom resolver is NEVER called with `tactic === "ComplimentMount"` in v1 (the UI only surfaces ComplimentMount inside the promenade session). Defense-in-depth: an exhaustive `switch` on `Tactic` inside `resolveCombat` doesn't exist (the function consults `TACTIC_BONUS_MOOD.get(...)` + the two trait Maps, all of which return `undefined` for ComplimentMount), so a stray ballroom-side ComplimentMount fires a `Normal` outcome with zero synergy and zero bonus (same as `Flattery` vs a no-trait neutral-mood target). A Vitest assertion in `combat.test.ts` pins this fallback behavior so a future widening of ballroom UI cannot silently regress.

- **`ExchangeSchema` widening (`src/game/conversation/types.ts:54-59`).** The hard-coded 4-element `z.enum([...])` widens to 5 — but the schema is shared by `ProxyConversationRequestSchema.history` (`src/llm/types.ts:96-103`) AND every legacy `SaveV1..V12Schema.conversationHistory` (`src/persist/schema.ts:915` and 14 more sites). Single edit:
  ```ts
  // src/game/conversation/types.ts (P12 EDIT):
  export const ExchangeSchema = z.object({
    speaker: z.enum(["house-head", "other"]),
    text: z.string(),
    classifiedTactic: z
      .enum(["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy", "ComplimentMount"])
      .nullable(),
    tick: z.number().int().nonnegative(),
  });
  ```
  Round-trip behavior: pre-P12 saves cannot contain `"ComplimentMount"` in `conversationHistory` (the value did not exist), so legacy parses are unaffected. Post-P12 saves CAN contain `"ComplimentMount"` exchanges from promenade sessions; these round-trip through every live and legacy emitter via the same shared `ExchangeSchema` value. No backwards-compat shim is needed; no save version bump per the user-resolved no-bump decision. Forward-compat caveat: a hypothetical pre-P12 build trying to load a post-P12 save would fail at `ExchangeSchema` parse — accepted v1 behavior (greenfield, no installed-base concern).

- **Inline `ProxyConversationRequestSchema.history` enum widening (`src/llm/types.ts:96-103`).** The duplicated enum literal at the schema definition (NOT imported from `ExchangeSchema` — it's a standalone z.enum inside the request schema) must widen in lockstep:
  ```ts
  // src/llm/types.ts (P12 EDIT):
  history: z.array(
    z.object({
      speaker: z.enum(["house-head", "other"]),
      text: z.string(),
      classifiedTactic: z
        .enum(["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy", "ComplimentMount"])
        .nullable(),
      tick: z.number().int().nonnegative(),
    }),
  ),
  ```
  This is the wire shape; both client (request build) and server (request parse) consume it. Server-side parse failures with the pre-widening shape would reject post-P12 client requests carrying ComplimentMount history entries — both halves widen at the same commit.

- **`TACTIC_SET` widening (`src/llm/types.ts:140`).** The client-side `resolveTactic` resolver consults a frozen `Set<string>` to accept-or-fall-back the model's classification. Single edit:
  ```ts
  // src/llm/types.ts (P12 EDIT):
  const TACTIC_SET = new Set<string>([
    "Flattery",
    "WittyBanter",
    "SlyGossip",
    "DeepEmpathy",
    "ComplimentMount",
  ]);
  ```
  Per CLAUDE.md "Pin-always-overrides" pin: this resolver still applies pin-priority. A promenade tactic pin (`pinnedIntent: "ComplimentMount"`) overrides the model's classification, regardless of whether the model returned a valid enum.

- **New constants (`src/game/constants.ts`).** Four entries grouped into a new `// ── Hyde Park Promenade (P12) ─────────────────────────────────────────────` section, mirroring the §-header style elsewhere. Per CLAUDE.md "Designer constants in one place" non-negotiable, NUMERIC tunings live in `constants.ts` but IDENTITIES (NPCs, houses, artifacts, traits) live in `fixtures/`. The mount-family identifier `"mount"` is therefore NOT redeclared here — `rules/promenade.ts` imports `ArtifactFamily` from `fixtures/artifacts.ts` directly (see "Rule module imports" below):
  ```ts
  // ── Hyde Park Promenade (P12) ─────────────────────────────────────────────
  // Spec §3 "Hyde Park Daytime Promenade" (lines 192-198) + "Hyde Park
  // Promenade" (lines 444-450). Pure designer constants; tune via playtest.
  // The three base-tactic affection values are deliberately mid-range —
  // promenade is the "low-risk" daytime alternative, so deltas are smaller
  // than the ballroom's typical +20-40 synergy outcome. The mount bonus
  // stacks per-action (not per-session) so a mount-owning player gets
  // consistent value across a multi-turn visit.
  export const PROMENADE_BASE_AFFECTION_WITTY_BANTER = 8;
  export const PROMENADE_BASE_AFFECTION_DEEP_EMPATHY = 8;
  export const PROMENADE_BASE_AFFECTION_COMPLIMENT_MOUNT = 12; // gated on target mount-family ownership
  export const PROMENADE_PLAYER_MOUNT_MINGLE_BONUS = 5; // per-action, applies when player head equips a mount-family artifact
  ```
  Quality multiplier still clamps to `[QUALITY_MULTIPLIER_FLOOR, QUALITY_MULTIPLIER_CEIL]` via the existing `narrowResponse` resolver — promenade reuses the same clamp envelope, so each promenade action's actual affection delta lies in `[base × 0.5, base × 1.5]` (e.g., WittyBanter: 4-12 affection per action).

- **New branded `PromenadeSessionId` (`src/game/rng.ts`).** Mirrors `BallSessionId` at `src/game/rng.ts:13-15` + factory at `:66-68`:
  ```ts
  // src/game/rng.ts — P12 ADDITIONS (alongside BallSessionId):
  export type PromenadeSessionId = string & { readonly __brand: "PromenadeSessionId" };
  export function makePromenadeSessionId(tick: number): PromenadeSessionId {
    return `promenade-${tick}` as PromenadeSessionId;
  }
  ```
  Session IDs live in the orchestrator (in-memory, not GameState — same as `BallSessionId`). No schema-side `Schema` companion needed; sessions never persist.

- **New rule module `src/game/rules/promenade.ts`.** Pure-rules layer; same import restrictions as other rules. Three exported entry points + two helper read-side projections:
  ```ts
  // src/game/rules/promenade.ts (NEW at P12):
  import {
    PROMENADE_BASE_AFFECTION_COMPLIMENT_MOUNT,
    PROMENADE_BASE_AFFECTION_DEEP_EMPATHY,
    PROMENADE_BASE_AFFECTION_WITTY_BANTER,
    PROMENADE_PLAYER_MOUNT_MINGLE_BONUS,
    QUALITY_MULTIPLIER_CEIL,
    QUALITY_MULTIPLIER_FLOOR,
  } from "../constants";
  import { makePairKey } from "../conversation/types";
  import type { GameState } from "../entities";
  // The mount-family identifier `"mount"` lives in the existing ArtifactFamily
  // union at fixtures/artifacts.ts:20-28 — single source of truth per
  // CLAUDE.md "Designer constants in one place" (identities in fixtures/).
  // We import the union type for the typed literal comparison below.
  import { ARTIFACT_REGISTRY, type ArtifactFamily } from "../fixtures/artifacts";
  import type { LocationId } from "../fixtures/locations";
  import { RIVAL_CHARACTER_IDS_SET } from "../fixtures/rivals";

  // Typed literal — narrows `"mount"` to ArtifactFamily for the comparison
  // sites below (resolves CLAUDE.md "identities in fixtures/" non-negotiable).
  // Exported so `bootstrap.ts:bootstrapNpcMountFamily` shares the single source
  // of truth (no parallel literal in the bootstrap helper). The cross-tree
  // edge bootstrap.ts → rules/promenade.ts is permitted by the boundaries
  // config — bootstrap is the store-layer composer, not a rules module, so
  // the pure-rule import restriction doesn't apply in this direction.
  export const MOUNT_FAMILY: ArtifactFamily = "mount";
  import {
    type ArtifactInstanceId,
    type CharacterId,
    PLAYER_HOUSE_ID,
    drawInt,
    getOrThrow,
  } from "../rng";
  import { clamp } from "../util/clamp";

  // ── Rejection unions ─────────────────────────────────────────────────────

  export type PromenadeEntryRejection =
    | { kind: "WrongLocation"; current: LocationId }
    | { kind: "NoEligiblePartner" } // empty partner pool (rare; e.g., every NPC dead)
    | { kind: "PlayerExiled" }
    | { kind: "ElopementInProgress" }
    | { kind: "SessionAlreadyOpen" }; // ballroom OR promenade already open

  // ── Deterministic partner picker ─────────────────────────────────────────

  // Returns the eligible partner pool in lex-sorted CharacterId order. Pool =
  // all living non-player non-rival characters. Rivals are excluded via
  // RIVAL_CHARACTER_IDS_SET (cycle-aware: future v1.5 rival widenings
  // automatically narrow the pool). Children (pre-adult) ARE included —
  // matches ballroom's otherCharactersInScene composition. No location gate
  // on individual characters (ballroom precedent at sendBallroomMessage:851).
  export function eligiblePromenadePartners(state: GameState): ReadonlyArray<CharacterId> {
    return [...state.characters.values()]
      .filter((c) => c.alive && c.houseId !== PLAYER_HOUSE_ID && !RIVAL_CHARACTER_IDS_SET.has(c.id))
      .map((c) => c.id)
      .sort((a, b) => a.localeCompare(b));
  }

  // Single-draw partner pick. ALWAYS advances state.rng[PLAYER_HOUSE_ID] by
  // exactly 1 callCount. Caller commits the new rng map. Returns the picked
  // partner OR null when the pool is empty (caller surfaces NoEligiblePartner).
  //
  // Determinism: per-house seeded draw via drawInt. Caller MUST commit the
  // returned rngMap update before any other player RNG consumer runs.
  export function pickPromenadePartner(
    state: GameState,
  ): { partnerId: CharacterId | null; nextState: GameState } {
    const pool = eligiblePromenadePartners(state);
    if (pool.length === 0) {
      // Empty-pool case: still surface as caller-handled rejection. RNG NOT
      // advanced (no draw is made when the pool is empty — the player gets
      // a rejection without paying a determinism cost).
      return { partnerId: null, nextState: state };
    }
    const playerRng = getOrThrow(state.rng, PLAYER_HOUSE_ID);
    const { next: idx, rngState: nextRng } = drawInt(playerRng, pool.length);
    const newRng = new Map(state.rng);
    newRng.set(PLAYER_HOUSE_ID, nextRng);
    const partnerId = pool[idx] ?? null; // ts noUncheckedIndexedAccess
    return { partnerId, nextState: { ...state, rng: newRng } };
  }

  // ── Entry gate (validation only — caller advances rng + opens session) ──

  // Pure validator. Caller (store action) composes:
  //   1. canEnterPromenade — returns ok | rejection
  //   2. pickPromenadePartner — single rng draw + state update
  //   3. orchestrator.beginPromenadeSession(tick, partnerId)
  // The single-draw is committed atomically with the entry — a rejected
  // entry burns NO rng (matches monarchsAudience.ts "denial paths cost
  // nothing" semantics at applyAudience).
  export function canEnterPromenade(
    state: GameState,
  ): { ok: true } | { ok: false; reason: PromenadeEntryRejection } {
    const player = state.houses.get(PLAYER_HOUSE_ID);
    if (player === undefined) {
      return { ok: false, reason: { kind: "PlayerExiled" } };
    }
    if (player.exiled) {
      return { ok: false, reason: { kind: "PlayerExiled" } };
    }
    if (state.elopement !== null) {
      return { ok: false, reason: { kind: "ElopementInProgress" } };
    }
    if (player.currentLocation !== "Capital") {
      return { ok: false, reason: { kind: "WrongLocation", current: player.currentLocation } };
    }
    return { ok: true };
  }

  // ── Combat resolver (pure) ──────────────────────────────────────────────

  export type PromenadeTactic = "WittyBanter" | "DeepEmpathy" | "ComplimentMount";

  const PROMENADE_TACTIC_SET: ReadonlySet<string> = new Set([
    "WittyBanter",
    "DeepEmpathy",
    "ComplimentMount",
  ]);

  // Narrowing helper consumed by sendPromenadeMessage store wrapper. Throws
  // on out-of-set values — defense-in-depth against future resolver-pin drift.
  // Production paths SHOULD NEVER hit the throw because the player UI pins
  // a PromenadeTactic and the client-side resolveTactic at
  // src/llm/types.ts:149-153 returns the pin verbatim when non-null.
  export function narrowToPromenadeTactic(tactic: string): PromenadeTactic {
    if (!PROMENADE_TACTIC_SET.has(tactic)) {
      throw new Error(
        `narrowToPromenadeTactic: expected one of [WittyBanter, DeepEmpathy, ComplimentMount], got "${tactic}"`,
      );
    }
    return tactic as PromenadeTactic;
  }

  export type PromenadeCombatInput = {
    tactic: PromenadeTactic;
    qualityMultiplier: number; // clamped to [0.5, 1.5] upstream
    targetHasMountFamilyEquipped: boolean; // gates ComplimentMount fixed bonus
    playerHasMountFamilyEquipped: boolean; // gates the +5 per-action Mingle stack
  };

  export type PromenadeCombatOutcome = {
    kind: "Normal"; // never InstantFail (no faux-pas) — single discriminant
    affectionDelta: number;
    composureDelta: 0; // ALWAYS 0 — spec "low-risk daytime alternative"
  };

  // The promenade resolver. PURE; no state reads; no PRNG draws. Distinct
  // from src/game/rules/combat.ts:resolveCombat because:
  //   - Faux-pas branch (Flattery-vs-Defensive InstantFail) is unreachable —
  //     Flattery isn't a PromenadeTactic. ZeroYield branch (WittyBanter-vs-
  //     Distracted) is also unreachable in v1: spec line 449 "faux-pas
  //     penalties do NOT apply during a promenade" reads as the WHOLE
  //     friction/penalty envelope. Mood synergy is also suppressed (a
  //     "Distracted" target is just a low-affection target via the base
  //     mechanic, not a special-case zero-yield).
  //   - Composure delta is ALWAYS 0 (user-resolved P12 design decision —
  //     "zero composure damage across all 3 actions").
  //   - ComplimentMount is target-gated, not trait/mood-modulated.
  //   - Mount+Mingle bonus stacks per-action (not per-session — see
  //     "Mount bonus stacking semantics" below).
  export function resolvePromenadeCombat(input: PromenadeCombatInput): PromenadeCombatOutcome {
    let baseAffection: number;
    switch (input.tactic) {
      case "WittyBanter":
        baseAffection = PROMENADE_BASE_AFFECTION_WITTY_BANTER;
        break;
      case "DeepEmpathy":
        baseAffection = PROMENADE_BASE_AFFECTION_DEEP_EMPATHY;
        break;
      case "ComplimentMount":
        // Gated bonus: returns 0 affection (and zero composure) if the
        // target does NOT actually own a mount-family equipped artifact.
        // The UI suppresses the button in this state, but defense-in-depth:
        // a stale classification (model classifies into ComplimentMount
        // when the target has since unequipped) silently degrades to a
        // no-op rather than fabricating affection.
        baseAffection = input.targetHasMountFamilyEquipped
          ? PROMENADE_BASE_AFFECTION_COMPLIMENT_MOUNT
          : 0;
        break;
    }
    // Mount+Mingle bonus is additive (NOT multiplicative). Applied BEFORE
    // quality modulation so the LLM phrasing-quality factor scales the
    // composed (base + bonus) affection. Rationale: a well-phrased
    // compliment that ALSO leverages the player's own mount talks the
    // bonus up; a poor phrasing dampens it.
    const composedBase =
      baseAffection + (input.playerHasMountFamilyEquipped ? PROMENADE_PLAYER_MOUNT_MINGLE_BONUS : 0);
    const quality = clamp(input.qualityMultiplier, QUALITY_MULTIPLIER_FLOOR, QUALITY_MULTIPLIER_CEIL);
    const affectionDelta = Math.round(composedBase * quality);
    return {
      kind: "Normal",
      affectionDelta,
      composureDelta: 0,
    };
  }

  // ── Read-side helpers (consumed by store wrapper + UI) ──────────────────

  // Returns true if the player house head has a mount-family ArtifactInstance
  // EQUIPPED. Spec uses "owned" / "on the player" — read as "equipped on the
  // player head" for v1. Future-phase widening to "any player-house character
  // equips a mount" requires a wider walk.
  export function playerHeadEquipsMountFamily(state: GameState): boolean {
    const player = state.houses.get(PLAYER_HOUSE_ID);
    if (player === undefined) return false;
    const head = state.characters.get(player.headOfHouseCharacterId);
    if (head === undefined) return false;
    return characterEquipsMountFamily(state, head.equippedArtifactIds);
  }

  // Returns true if the given character has a mount-family ArtifactInstance
  // EQUIPPED. Used both for the player head's "Mingle+mount bonus" gate AND
  // the partner's "ComplimentMount available" gate.
  //
  // equippedArtifactIds is the canonical branded `ArtifactInstanceId` array
  // (matches `Character.equippedArtifactIds` shape at `src/game/entities.ts:225`).
  // No `as never` workaround needed — the parameter type aligns with the
  // factory's Map key brand.
  export function characterEquipsMountFamily(
    state: GameState,
    equippedArtifactIds: ReadonlyArray<ArtifactInstanceId>,
  ): boolean {
    for (const instId of equippedArtifactIds) {
      const inst = state.artifactInstances.get(instId);
      if (inst === undefined) continue;
      const def = ARTIFACT_REGISTRY.get(inst.definitionId);
      if (def === undefined) continue;
      if (def.family === MOUNT_FAMILY) return true;
    }
    return false;
  }

  // ── Exchange-write helper (post-LLM-resolution) ─────────────────────────

  // Writes the resolved promenade exchange to state.conversationHistory AND
  // updates state.affectionMap[(playerHouseId, partnerId)]. Pure transform;
  // no PRNG draws; no tick advance. Caller composes this with
  // advanceTickPure ON EXIT (not per-turn). Per-turn calls only mutate
  // history + affectionMap; the tick advances once when the session closes.
  //
  // Affection is clamped to [0, 100] at this mutation site per CLAUDE.md
  // "Clamp at every mutation site" non-negotiable.
  export function appendPromenadeExchange(
    state: GameState,
    partnerCharId: CharacterId,
    playerExchange: { text: string; classifiedTactic: PromenadeTactic },
    npcExchange: { text: string },
    affectionDelta: number,
    tick: number,
  ): GameState {
    const pairKey = makePairKey(PLAYER_HOUSE_ID, partnerCharId);
    const newHistory = new Map(state.conversationHistory);
    const existing = newHistory.get(pairKey) ?? [];
    newHistory.set(pairKey, [
      ...existing,
      { speaker: "house-head", text: playerExchange.text, classifiedTactic: playerExchange.classifiedTactic, tick },
      { speaker: "other", text: npcExchange.text, classifiedTactic: null, tick },
    ]);
    const newAffection = new Map(state.affectionMap);
    const current = newAffection.get(pairKey) ?? 0;
    newAffection.set(pairKey, clamp(current + affectionDelta, 0, 100));
    return { ...state, conversationHistory: newHistory, affectionMap: newAffection };
  }
  ```

- **Wire-format `mode` field on `ProxyConversationRequest` (`src/llm/types.ts`).** Single optional-default field; defaults to `"Ballroom"` for backward-compat with pre-P12 client code:
  ```ts
  // src/llm/types.ts (P12 EDIT to ProxyConversationRequestSchema):
  export const ProxyConversationRequestSchema = z.object({
    targetCharacterId: CharacterIdSchema,
    playerHouseId: HouseIdSchema,
    freeformMessage: z.string(),
    history: z.array(/* widened ExchangeSchema-shape — see above */),
    otherCharactersInScene: z.array(CharacterSchema),
    characterStateSnapshot: CharacterStateSnapshotSchema,
    mode: z.enum(["Ballroom", "Promenade"]).default("Ballroom"), // NEW at P12
  });
  ```
  `.default("Ballroom")` is the P8/P9 backward-compat shortcut (matches `House.hostility: 0` / `MarriageRecord.viaElopement: false` precedent). Pre-P12 servers reading post-P12 client requests parse cleanly via the default; post-P12 servers reading pre-P12 client requests do the same. Same-commit edit avoids the cross-fly transient mismatch.

- **Server-side: mode-aware tool config (`server/conversation.ts` + `server/tools.ts` + `server/routing.ts`).** Three concrete deltas:
  1. **Widen the `respond` tool's `classifiedTactic` enum** in `server/tools.ts:RESPOND_TOOL` from 4 entries → 5. Same widening as `ExchangeSchema`. The Gemini SDK's function-declarations consume the enum; the model can now classify into `"ComplimentMount"` when prompted.
  2. **Mode-aware per-turn contents prefix (NOT systemInstruction).** Mode framing MUST ride on the per-turn `contents` payload, NOT the system instruction. Verified at `server/conversation.ts:45-51`: `cachedContent` and `systemInstruction` are mutually exclusive per the Gemini SDK contract (live comment confirms this). Once `getOrCreatePersonaCache` populates a cache for a target, EVERY subsequent call uses `cachedContent: cacheName` and the system instruction is NEVER sent again. A mode-framing prefix on `systemInstruction` would silently drop on every cache hit (which is the steady-state path after the first turn against any partner).

     Concrete edit lands inside `buildContents` at `server/conversation.ts:92-100`, which currently composes only the transcript + freeformMessage:
     ```ts
     // server/conversation.ts (P12 EDIT to buildContents):
     function buildContents(req: {
       history: ReadonlyArray<{ speaker: "house-head" | "other"; text: string }>;
       freeformMessage: string;
       mode: "Ballroom" | "Promenade"; // NEW at P12 — read from ProxyConversationRequest
     }): string {
       const modeFramingPrefix =
         req.mode === "Promenade"
           ? "[Setting: A casual daytime promenade in Hyde Park. The conversation is low-stakes; the partner is at ease. Faux-pas penalties do NOT apply; structural composure damage is not in play. Available tactics: WittyBanter, DeepEmpathy, ComplimentMount (the last is meaningful only when the partner owns a horse).]\n\n"
           : ""; // ballroom mode = no prefix; existing behavior unchanged
       const transcript = req.history
         .map((ex) => (ex.speaker === "house-head" ? `Player: ${ex.text}` : `NPC: ${ex.text}`))
         .join("\n");
       const body = transcript === "" ? req.freeformMessage : `${transcript}\n${req.freeformMessage}`;
       return modeFramingPrefix + body;
     }
     ```
     The call site at `server/conversation.ts:52` (`const contents = buildContents(request);`) automatically picks up `request.mode` because the ProxyConversationRequest schema (widened above) now carries it. Persona prompt body itself stays universal across modes — `buildPersonaPrompt(snapshot)` is mode-agnostic. This preserves cache hits AND lands the mode framing every turn, avoiding the silent-drop regression. `PERSONA_CACHE_VERSION` stays at `"v4"` (the cached resource is the persona, which doesn't carry mode framing).

     **Defensive Vitest assertion (server/conversation.test.ts EXTENSION):** with a populated persona cache, a `mode: "Promenade"` request's `contents` payload still includes the mode-framing prefix. Pins the cache-hit + mode-framing combination so a future refactor can't silently regress.
  3. **Tactic-allowed-set gating.** The `respond` tool's enum widens to 5 globally, but the server enforces the mode-specific subset:
     - Ballroom mode: classifier reads its result; promenade tactics (`"ComplimentMount"`) coerced down to `"Flattery"` fallback via the existing `resolveTactic` resolver (which runs CLIENT-SIDE on the response). The mode-framing prefix already discourages the model from picking ComplimentMount in ballroom mode.
     - Promenade mode: classifier reads its result; ballroom tactics (`"Flattery"` / `"SlyGossip"`) coerced down via the same resolver to the pinned promenade tactic (`pinnedIntent` defaults to whichever tactic button the player clicked on the promenade UI). Pin-always-overrides handles the coercion automatically — promenade UI ALWAYS pins one of `{WittyBanter, DeepEmpathy, ComplimentMount}`, so out-of-set classifications collapse to the pin.

  No new endpoint; no `/api/llm/promenade-conversation` route. Single endpoint `/api/llm/conversation` services both modes.

- **`conversationOrchestrator` extension (`src/runtime/conversationOrchestrator.ts`).** The orchestrator gains a `currentSession.mode: "Ballroom" | "Promenade"` field on the in-memory session state. Concrete edits:
  ```ts
  // src/runtime/conversationOrchestrator.ts (P12 EDITS):
  import { type BallSessionId, makeBallSessionId, type PromenadeSessionId, makePromenadeSessionId } from "../game/rng";

  type SessionState =
    | { mode: "Ballroom"; sessionId: BallSessionId; tickAtEntry: number }
    | { mode: "Promenade"; sessionId: PromenadeSessionId; tickAtEntry: number; partnerCharacterId: CharacterId };

  class ConversationOrchestrator {
    // ... existing fields ...
    private currentSession: SessionState | null = null;

    beginSession(tick: number): BallSessionId {
      // Ballroom path — unchanged signature. Disallow a promenade session
      // from coexisting with a ballroom session (and vice versa).
      if (this.currentSession !== null && this.currentSession.mode === "Promenade") {
        // Defensive: store wrapper gates via SessionAlreadyOpen rejection;
        // this branch should be unreachable from production paths.
        throw new Error("conversationOrchestrator.beginSession: a Promenade session is already open");
      }
      if (this.currentSession !== null && this.currentSession.mode === "Ballroom" && this.currentSession.tickAtEntry === tick) {
        return this.currentSession.sessionId;
      }
      const sessionId = makeBallSessionId(tick);
      this.currentSession = { mode: "Ballroom", sessionId, tickAtEntry: tick };
      return sessionId;
    }

    beginPromenadeSession(tick: number, partnerCharacterId: CharacterId): PromenadeSessionId {
      if (this.currentSession !== null && this.currentSession.mode === "Ballroom") {
        throw new Error("conversationOrchestrator.beginPromenadeSession: a Ballroom session is already open");
      }
      if (
        this.currentSession !== null &&
        this.currentSession.mode === "Promenade" &&
        this.currentSession.tickAtEntry === tick &&
        this.currentSession.partnerCharacterId === partnerCharacterId
      ) {
        // Idempotent re-entry (same tick, same partner). Returns the existing
        // sessionId so the UI's mount-on-Promenade-view effect doesn't create
        // a parallel session.
        return this.currentSession.sessionId;
      }
      const sessionId = makePromenadeSessionId(tick);
      this.currentSession = { mode: "Promenade", sessionId, tickAtEntry: tick, partnerCharacterId };
      return sessionId;
    }

    endSession(): { id: BallSessionId | PromenadeSessionId; mode: "Ballroom" | "Promenade" } | null {
      if (this.currentSession === null) return null;
      const out = { id: this.currentSession.sessionId, mode: this.currentSession.mode };
      this.currentSession = null;
      return out;
    }

    currentSessionId(): BallSessionId | PromenadeSessionId | null {
      return this.currentSession?.sessionId ?? null;
    }

    currentMode(): "Ballroom" | "Promenade" | null {
      return this.currentSession?.mode ?? null;
    }

    currentPromenadePartner(): CharacterId | null {
      return this.currentSession?.mode === "Promenade"
        ? this.currentSession.partnerCharacterId
        : null;
    }
    // ... existing send(), abortCurrent() unchanged ...
  }
  ```
  **Cross-mode mutual exclusion** is enforced at TWO layers:
  - Store-action level: `enterPromenade` returns `SessionAlreadyOpen` rejection when `currentSessionId() !== null`. Same for `enterBallroom` (existing) — the modal-state gate widens to also reject when a Promenade session is open.
  - Orchestrator level: the `beginSession` / `beginPromenadeSession` throws are defense-in-depth (the store-level gate should always catch first). The throw fires only on misuse from test code or future internal refactors.

  Per-request abort + timeout (15s) + `requestId` stale-check semantics are **shared across modes** — the same `send()` method services both ballroom and promenade per-turn requests. The `request: ProxyConversationRequest` carries the `mode` field; the orchestrator does NOT branch on mode at the `send()` level.

- **Store actions (`src/game/store.ts`).** Four new actions, all gated on the modal-state union (`PlayerExiled` + `ElopementInProgress`) per CLAUDE.md "Modal-state rule-layer gate principle":
  ```ts
  // src/game/store.ts (StoreActions interface — P12 ADDITIONS):
  // P12 promenade actions. enterPromenade/exitPromenade manage session
  // state on the orchestrator (in-memory). sendPromenadeMessage POSTs
  // through the same proxy at /api/llm/conversation with mode="Promenade".
  // exitPromenade ADVANCES THE TICK (commit-on-leave) and fires the full
  // 10-publisher set per CLAUDE.md "10/10/9 publisher set across store
  // wrappers". The other three are session-management; they do NOT tick.
  enterPromenade: () =>
    | { ok: true; sessionId: PromenadeSessionId; partnerCharacterId: CharacterId }
    | { ok: false; reason: PromenadeEntryRejection };
  exitPromenade: () => void;
  sendPromenadeMessage: (
    input: PromenadeMessageInput,
  ) => Promise<
    { ok: true; outcome: ConversationResponse } | { ok: false; reason: ConversationFailure }
  >;
  abortPromenadeRequest: () => void;
  ```

  Concrete wrapper bodies (mirroring `enterBallroom`/`exitBallroom`/`sendBallroomMessage`/`abortBallroomRequest`):
  ```ts
  // src/game/store.ts (P12 ADDITIONS to the create-store body):
  enterPromenade: () => {
    const stateBefore = get();
    // Modal-state gates — top of body per CLAUDE.md "exile gate is per-action
    // at the rule layer" pin (P6) + P9 elopement extension.
    const check = canEnterPromenade(stateBefore);
    if (!check.ok) {
      locationBus.publish({
        kind: "PromenadeEntryRejected",
        tick: stateBefore.tick,
        houseId: PLAYER_HOUSE_ID,
        reason: check.reason,
      });
      return { ok: false, reason: check.reason };
    }
    // Cross-mode mutual exclusion — explicit at the store level (orchestrator
    // throws are defense-in-depth, not user-facing).
    if (conversationOrchestrator.currentSessionId() !== null) {
      const reason = { kind: "SessionAlreadyOpen" as const };
      locationBus.publish({
        kind: "PromenadeEntryRejected",
        tick: stateBefore.tick,
        houseId: PLAYER_HOUSE_ID,
        reason,
      });
      return { ok: false, reason };
    }
    // Pick the partner — commits 1 player-RNG draw to state.
    const picked = pickPromenadePartner(stateBefore);
    if (picked.partnerId === null) {
      const reason = { kind: "NoEligiblePartner" as const };
      locationBus.publish({
        kind: "PromenadeEntryRejected",
        tick: stateBefore.tick,
        houseId: PLAYER_HOUSE_ID,
        reason,
      });
      return { ok: false, reason };
    }
    // Commit the new RNG map BEFORE opening the session (so a later
    // sendPromenadeMessage reads a consistent state.rng).
    set((draft) => {
      overwriteFromGameState(draft, picked.nextState);
    });
    const sessionId = conversationOrchestrator.beginPromenadeSession(
      get().tick,
      picked.partnerId,
    );
    conversationBus.publish({
      kind: "PromenadeEntered",
      tick: stateBefore.tick,
      houseId: PLAYER_HOUSE_ID,
      sessionId,
      partnerCharacterId: picked.partnerId,
    });
    return { ok: true, sessionId, partnerCharacterId: picked.partnerId };
  },
  exitPromenade: () => {
    const sessionId = conversationOrchestrator.currentSessionId();
    if (sessionId === null || conversationOrchestrator.currentMode() !== "Promenade") {
      return; // no-op if not in a promenade session
    }
    // Abort any in-flight per-turn request BEFORE advancing the tick.
    conversationOrchestrator.abortCurrent();
    const stateBefore = get();
    const partnerCharacterId = conversationOrchestrator.currentPromenadePartner();
    // Tick-advance ALWAYS — the 1-tick cost is the contract per spec line 446.
    // No additional state mutation: history + affection were written per-turn
    // by sendPromenadeMessage. The tick advance is the only commit on exit.
    const afterTick = advanceTickPure(stateBefore);
    set((draft) => {
      overwriteFromGameState(draft, afterTick);
    });
    conversationOrchestrator.endSession();
    conversationBus.publish({
      kind: "PromenadeExited",
      tick: afterTick.tick,
      houseId: PLAYER_HOUSE_ID,
      sessionId,
      partnerCharacterId, // null only if endSession-after-cleared edge case
    });
    // 10-publisher set per CLAUDE.md (matches travel / requestAudience / ...):
    publishCharacterDeaths(stateBefore, afterTick);
    publishSchemeTransitions(stateBefore, afterTick);
    publishWhisperTransitions(stateBefore, afterTick);
    publishMarriageTransitions(stateBefore, afterTick);
    publishTemptationLatchTransitions(stateBefore, afterTick);
    publishElopementTransitions(stateBefore, afterTick);
    publishArtifactTransitions(stateBefore, afterTick);
    publishSiblingRivalTransitions(stateBefore, afterTick);
    publishInheritedSecretTransitions(stateBefore, afterTick);
    publishBloodFeudTransitions(stateBefore, afterTick);
  },
  sendPromenadeMessage: async (input) => {
    const stateBefore = get();
    if (
      conversationOrchestrator.currentSessionId() === null ||
      conversationOrchestrator.currentMode() !== "Promenade"
    ) {
      return { ok: false, reason: { reason: "cancelled" } };
    }
    const partnerId = conversationOrchestrator.currentPromenadePartner();
    if (partnerId === null) {
      return { ok: false, reason: { reason: "cancelled" } };
    }
    const target = stateBefore.characters.get(partnerId);
    const playerHead = stateBefore.houses.get(PLAYER_HOUSE_ID);
    if (target === undefined || !target.alive || playerHead === undefined) {
      return { ok: false, reason: { reason: "cancelled" } };
    }
    const pairKey = makePairKey(PLAYER_HOUSE_ID, target.id);
    const history = stateBefore.conversationHistory.get(pairKey) ?? [];

    // 1-on-1 scene: otherCharactersInScene is empty (user-resolved). The
    // persona prompt sees only the partner.
    const otherCharactersInScene: ReadonlyArray<Character> = [];

    // Marriage state snapshot — same shape as sendBallroomMessage:859.
    let targetMarriage: MarriageRecord | null = null;
    let spouse: Character | null = null;
    if (target.marriageId !== null) {
      const m = stateBefore.marriages.get(target.marriageId);
      if (m !== undefined) {
        targetMarriage = m;
        if (!m.dissolved) {
          const spouseId = m.spouseAId === target.id ? m.spouseBId : m.spouseAId;
          spouse = stateBefore.characters.get(spouseId) ?? null;
        }
      }
    }

    const request: ProxyConversationRequest = {
      targetCharacterId: target.id,
      playerHouseId: PLAYER_HOUSE_ID,
      freeformMessage: input.freeformMessage,
      history,
      otherCharactersInScene: [],
      characterStateSnapshot: {
        target: {
          ...target,
          traits: getEffectiveTraits(stateBefore, target.id),
          equippedArtifactIds: [...target.equippedArtifactIds],
        },
        otherCharactersInScene,
        targetMarriage,
        spouse,
      },
      mode: "Promenade",
    };

    // Pin-priority resolver. UI ALWAYS pins one of {WittyBanter, DeepEmpathy,
    // ComplimentMount} via input.pinnedTactic — promenade has no "let the
    // model classify freely" mode (no Flattery / SlyGossip affordances).
    const outcome = await conversationOrchestrator.send(request, input.pinnedTactic);
    if (outcome.kind === "Failed") {
      return { ok: false, reason: outcome.failure };
    }
    // Resolve combat: read player + target mount-family-equipped predicates
    // at decision time (defense-in-depth — predicates can shift between
    // request build and response if a parallel store action lands; the
    // promenade is single-player so this is theoretical, but consistent
    // with the ballroom's read-at-resolve discipline).
    const stateAtResolve = get();
    const playerMount = playerHeadEquipsMountFamily(stateAtResolve);
    const partnerAtResolve = stateAtResolve.characters.get(target.id);
    const targetMount =
      partnerAtResolve !== undefined &&
      characterEquipsMountFamily(stateAtResolve, partnerAtResolve.equippedArtifactIds);

    // Narrow the resolved tactic from the full Tactic union to PromenadeTactic.
    // `resolveTactic` (src/llm/types.ts:149-153) returns the pinned value when
    // pinnedIntent !== null — and `input.pinnedTactic` is non-null by type at
    // the PromenadeMessageInput layer — so the resolved classifiedTactic is
    // ALWAYS one of {WittyBanter, DeepEmpathy, ComplimentMount} in promenade
    // mode. The narrowing helper makes this contract visible AND throws on
    // out-of-set values (defense-in-depth against a future refactor that
    // loosens the pin-priority resolver).
    const promenadeTactic = narrowToPromenadeTactic(outcome.response.classifiedTactic);
    const promenadeOutcome = resolvePromenadeCombat({
      tactic: promenadeTactic,
      qualityMultiplier: outcome.response.qualityMultiplier,
      targetHasMountFamilyEquipped: targetMount,
      playerHasMountFamilyEquipped: playerMount,
    });

    // Commit the exchange to state. Tick is NOT advanced here — only on
    // exitPromenade. Repeated sendPromenadeMessage calls accumulate history
    // + affection within the single tick the session occupies.
    //
    // Uses the narrowed `promenadeTactic` (computed via narrowToPromenadeTactic
    // above), NOT a fresh `as PromenadeTactic` cast on outcome.response. The
    // narrowed local is the SINGLE source of truth for tactic identity — both
    // the resolvePromenadeCombat input AND the history-write payload read it.
    // A future refactor that loosens the pin-priority resolver would throw at
    // the narrow site rather than silently writing a ballroom-only tactic
    // ("Flattery"/"SlyGossip") into a Promenade Exchange.
    set((draft) => {
      overwriteFromGameState(
        draft,
        appendPromenadeExchange(
          stateAtResolve,
          target.id,
          { text: input.freeformMessage, classifiedTactic: promenadeTactic },
          { text: outcome.response.dialogue },
          promenadeOutcome.affectionDelta,
          stateAtResolve.tick,
        ),
      );
    });

    return { ok: true, outcome: outcome.response };
  },
  abortPromenadeRequest: () => {
    if (conversationOrchestrator.currentMode() !== "Promenade") return;
    conversationOrchestrator.abortCurrent();
  },
  ```

- **`replaceState` defensive session-clear (`src/game/store.ts:554`).** Verified live: `replaceState` is a bare `set((draft) => overwriteFromGameState(draft, next))` with no orchestrator interaction. Pre-P12 this is benign — `exitBallroom` doesn't tick, so an orphaned `currentSession` after a load is harmless (`enterBallroom`'s same-tick idempotence absorbed the case at `conversationOrchestrator.ts:49-51`). P12 changes the calculus: the new cross-mode `SessionAlreadyOpen` rejection on `enterBallroom` AND `enterPromenade` means an orphaned post-load `currentSession.mode === "Promenade"` blocks both entries with a false rejection until the player clicks "Conclude Promenade" against an invisible session. The fix is a one-line defensive `conversationOrchestrator.endSession()` call inside `replaceState` BEFORE the `set` body:
  ```ts
  // src/game/store.ts (P12 EDIT — replaceState):
  replaceState: (next: GameState) => {
    // P12 defensive: clear any in-memory orchestrator session before
    // hydrating GameState. Sessions are not persisted, so the loaded
    // state never carries one; an orphaned currentSession after load
    // would falsely reject every subsequent enterBallroom / enterPromenade
    // via the cross-mode SessionAlreadyOpen gate. End-session aborts any
    // in-flight LLM round-trip too (defense against load-mid-fetch).
    conversationOrchestrator.abortCurrent();
    conversationOrchestrator.endSession();
    set((draft) => {
      overwriteFromGameState(draft, next);
    });
  },
  ```
  Test coverage: `src/game/store.replace-state.test.ts` (EXTENSION) — call `enterPromenade`, assert `currentMode() === "Promenade"`, call `replaceState(syntheticState)`, assert `currentMode() === null` AND `enterBallroom()` returns `{ ok: true }` post-replace (no false `SessionAlreadyOpen`).

- **Modal-state gate extensions.** The cross-mode mutual-exclusion check (`SessionAlreadyOpen`) is the new entry per CLAUDE.md "Modal-state rule-layer gate principle." Concrete:
  - `enterBallroom`'s rejection union widens with `{ kind: "SessionAlreadyOpen" }` — fires when `conversationOrchestrator.currentMode() === "Promenade"`. Existing exiled + elopement gates unchanged.
  - `enterPromenade` carries the same `SessionAlreadyOpen` rejection — fires when a ballroom session is open.
  - Every other tick-advancing wrapper (travel, requestAudience, escapeBankruptcy, refreshWardrobe, reconcileSibling, proposeMarriage, advanceTick) does NOT need a Promenade-in-progress gate. Promenade is a non-persistent in-memory session (lives in the orchestrator), NOT a `GameState`-tracked modal state like `state.elopement`. The UI prevents these mid-promenade actions by routing the view to the PromenadeView; the rule-layer gate is NOT needed (NOR would it work — `GameState` carries no `inPromenade` field).

  This is the deliberate divergence from the P9 elopement modal-state pattern: elopement persists across save/load (state.elopement !== null survives reload), so it needs a rule-layer gate. Promenade does NOT persist (closes session = nothing left in state); a reload mid-promenade silently discards the session. The 1-tick cost is paid on `exitPromenade`, NOT on `enterPromenade` (user-resolved tick-on-exit decision), so an aborted-via-reload promenade costs nothing. This asymmetry is acceptable for v1 (matches the ballroom — reloading mid-ball also discards the session).

- **`PromenadeMessageInput` (`src/game/store.ts` companion type).** Mirrors `BallroomMessageInput` shape but with promenade-restricted pin:
  ```ts
  // src/game/store.ts (P12 ADDITION):
  export type PromenadeMessageInput = {
    freeformMessage: string;
    // ALWAYS non-null — promenade UI has 3 tactic buttons and one is always
    // chosen before the message is sent. No "freely classify" affordance.
    pinnedTactic: "WittyBanter" | "DeepEmpathy" | "ComplimentMount";
  };
  ```

- **Event types + bus extensions** — three discriminated-union widenings, all enumerated as concrete edits:

  1. **`BallEntryRejection` widening (`src/runtime/events/conversation.ts:33-36`).** Verified live shape has 3 variants (`WrongLocation` / `PlayerExiled` / `ElopementInProgress`). P12 adds a 4th:
     ```ts
     // src/runtime/events/conversation.ts (P12 EDIT — append variant to BallEntryRejection):
     export type BallEntryRejection =
       | { kind: "WrongLocation"; current: LocationId }
       | { kind: "PlayerExiled" }
       | { kind: "ElopementInProgress" }
       | { kind: "SessionAlreadyOpen" }; // NEW at P12 — fires when conversationOrchestrator.currentMode() === "Promenade"
     ```
     The `enterBallroom` store wrapper at `src/game/store.ts:775-810` gains a defense-in-depth check returning this variant when a Promenade session is already open. UI banner prose mapping in `ConversationFailureBanner.tsx` (or the new equivalent at `BallroomView.tsx`) renders: "A promenade is already in progress."

  2. **`ConversationEvent` widening (`src/runtime/events/conversation.ts:38-86`).** Verified live shape has 7 variants. P12 adds two `Promenade*` variants alongside the existing `BallroomEntered` / `BallroomExited`:
     ```ts
     // src/runtime/events/conversation.ts (P12 EDIT — append variants to ConversationEvent):
     export type ConversationEvent =
       | /* ... existing 7 variants unchanged ... */
       | {
           kind: "PromenadeEntered";
           tick: number;
           houseId: HouseId;
           sessionId: PromenadeSessionId;
           partnerCharacterId: CharacterId;
         }
       | {
           kind: "PromenadeExited";
           tick: number;
           houseId: HouseId;
           sessionId: PromenadeSessionId;
           partnerCharacterId: CharacterId | null; // null only on the orchestrator-cleared edge case
         };
     ```
     Plus an import of `PromenadeSessionId` from `src/game/rng.ts`. The existing `TargetCharacterDied` subscription (orchestrator's `personaCacheInvalidate` POST hook at `conversationOrchestrator.ts:141`) STAYS — partner deaths during a promenade still invalidate the server-side persona cache.

  3. **`LocationEvent` widening (`src/runtime/events/location.ts:14-27`).** P12 adds one rejection variant for the upstream gate path:
     ```ts
     // src/runtime/events/location.ts (P12 EDIT — append variant to LocationEvent):
     export type LocationEvent =
       | /* ... existing variants unchanged ... */
       | {
           kind: "PromenadeEntryRejected";
           tick: number;
           houseId: HouseId;
           reason: PromenadeEntryRejection;
         };
     ```
     Plus an import of `PromenadeEntryRejection` from `src/game/rules/promenade.ts`. Fires from the `enterPromenade` store wrapper on every non-`ok` branch.

  No new dedicated `promenadeBus` — events share `conversationBus` / `locationBus` (matching the ballroom precedent at `BallroomEntered` / `BallroomExited` etc.).

- **UI: PromenadeView + Capital button.** Three new components + one LocationDetailsPanel widening:
  1. **`src/ui/promenade/PromenadeView.tsx`** (NEW at P12). Top-level promenade surface — mirrors `BallroomView.tsx` shape but:
     - 1 portrait card (the deterministic partner), NOT the ballroom's 5-portrait ring
     - 3 tactic buttons (WittyBanter / DeepEmpathy / ComplimentMount), NOT the ballroom's 4
     - ComplimentMount button is disabled (gated) when `characterEquipsMountFamily(state, partner.equippedArtifactIds) === false`
     - No StanceToggle component (user-resolved: always implicitly Mingle)
     - No ComposureBar (zero composure damage means the bar is uninformative)
     - No SchemeButtons (promenade is conversation-only; scheme commitments stay at the ballroom)
     - "Exit Promenade" button explicitly commits the 1 tick — UI text reads "Conclude Promenade (advances 1 tick)" to make the cost visible
  2. **`src/ui/promenade/PromenadeTacticButtons.tsx`** (NEW at P12). Subset of `TacticButtons.tsx`'s implementation; 3 buttons; ComplimentMount disabled-with-tooltip when the partner doesn't equip a mount-family artifact. Tooltip prose: "The partner is not currently riding."
  3. **`src/ui/promenade/PromenadePortraitCard.tsx`** (NEW at P12). Single-partner card; reuses the existing ballroom `PortraitCard.tsx` for the inner content, wrapped in a centered-not-ring layout.
  4. **`src/ui/map/LocationDetailsPanel.tsx` (EDIT)** — adds a "Take a Promenade in Hyde Park" button alongside "Enter Ballroom" / "Request Audience" / "Refresh Wardrobe" at Capital. Disabled-with-tooltip when:
     - `state.elopement !== null` (tooltip: "An elopement is in progress.")
     - `state.houses.get(PLAYER_HOUSE_ID).exiled === true` (tooltip: "Your house is exiled.")
     - `conversationOrchestrator.currentMode() !== null` (tooltip: "A conversation is already in progress.")
     - Empty partner pool (tooltip: "No one of consequence is in Hyde Park today.") — read-time check via `eligiblePromenadePartners(state).length === 0`

- **App-shell view routing extension (`src/App.tsx`).** Verified live at `src/App.tsx:23-63`: the current routing is NOT a discriminated `view` enum. It is a pair of `useState<boolean>(inBallroom)` + a derived `elopement !== null` check, with the precedence ternary at `:54-60`:
  ```tsx
  {elopement !== null ? <ElopementOverlay/> :
   inBallroom ? <BallroomView/> :
   <MapView onEnterBallroom={...}/>}
  ```
  There is no `Ledger` view at the App level (ledger UI is mounted inline as panels inside MapView). P12 adds a third boolean alongside the existing pair — minimum-delta, matches the established pattern, defers any "discriminated `view` state" refactor to a future polish phase. Concrete edits:
  ```tsx
  // src/App.tsx (P12 EDITS):
  import { PromenadeView } from "./ui/promenade/PromenadeView";
  
  export function App({ store, seed }: Props) {
    // ... existing state ...
    const [inBallroom, setInBallroom] = useState(false);
    const [inPromenade, setInPromenade] = useState(false); // NEW at P12
    const elopement = store((s) => s.elopement);
    // ... existing useEffect ...
    return (
      <main className="min-h-screen flex flex-col bg-stone-50">
        {/* ... existing chrome ... */}
        {elopement !== null ? (
          <ElopementOverlay store={store} />
        ) : inBallroom ? (
          <BallroomView store={store} onExit={() => setInBallroom(false)} />
        ) : inPromenade ? (
          <PromenadeView store={store} onExit={() => setInPromenade(false)} />
        ) : (
          <MapView
            store={store}
            onEnterBallroom={() => setInBallroom(true)}
            onEnterPromenade={() => setInPromenade(true)}  // NEW at P12
          />
        )}
      </main>
    );
  }
  ```
  **Precedence (load-bearing):** `elopement !== null` > `inBallroom` > `inPromenade` > `MapView`. Elopement overrides both conversation modes (same precedent as elopement-suspends-ballroom from P9). The `inBallroom + inPromenade` simultaneous-true case is unreachable by construction (cross-mode mutual-exclusion at the store-action layer + the orchestrator's single `currentSession` field), but the explicit `inBallroom` first ordering is defense-in-depth — should both flags somehow get set, the ballroom view wins, NOT promenade. Both `setInBallroom(false)` and `setInPromenade(false)` are called as the `onExit` props for their respective views.
  
  **`MapView` prop widening (`src/ui/map/MapView.tsx`):** `MapView`'s props gain `onEnterPromenade?: (() => void) | undefined`. `MapView` threads this prop down to `LocationDetailsPanel`'s "Take a Promenade in Hyde Park" button onClick. Same shape as the existing `onEnterBallroom` prop pattern.
  
  **`MapView`'s onEnterBallroom + onEnterPromenade handlers** call the store action (`enterBallroom` / `enterPromenade`) FIRST, then on `{ ok: true }` invoke the `App`-passed setState to flip the view. The store-action `ok: false` rejection paths (PlayerExiled, ElopementInProgress, SessionAlreadyOpen, NoEligiblePartner, WrongLocation) keep the view at MapView and surface the rejection toast via `locationBus`.

**NPC mount-family bootstrap (resolves B3 — would otherwise leave ComplimentMount permanently dormant).** Verified live at `src/game/fixtures/npcs.ts:107` and `src/game/bootstrap.ts:104`: every baseline NPC ships with `equippedArtifactIds: []`. P10's `PLAYER_STARTING_ARTIFACTS` (`src/game/fixtures/artifacts.ts:175-183`) seeds three instances on the PLAYER head only; no NPC mount-equip path was wired at P10. Without P12 adding such a path, `targetHasMountFamilyEquipped` is permanently `false` for every promenade partner — the ComplimentMount affordance ships as a UI button that never enables, contradicting spec lines 197 / 448 ("compliment mount" tactic).

P12 ADDS A NEW IDEMPOTENT NPC SEEDING HELPER. Concrete shape:

```ts
// src/game/fixtures/artifacts.ts (P12 ADDITION alongside PLAYER_STARTING_ARTIFACTS):
// NPC mount-family bootstrap. Two named baseline NPCs ship with an equipped
// mount-family instance so the ComplimentMount tactic has at least two
// promenade partners against whom it is meaningful from tick 0. Picks: Lord
// Blackwood (baseline NPC head — cultural fit for an equestrian portrayal)
// and Miss Carrington (Romantic+Frivolous traits — fashionable mount
// ownership consistent with the trait gestalt).
//
// Why exactly two: matches the 2-of-5 ratio that PLAYER_STARTING_ARTIFACTS
// uses for the player head (2 equipped of 3 starting instances). Gives the
// player a non-zero but non-trivial chance of the deterministic partner
// picker landing on a mount-equipped NPC (~40% on a fresh campaign with all
// 5 baseline NPCs alive).
export const NPC_STARTING_MOUNT_FAMILY: ReadonlyArray<{ characterId: CharacterId; definitionId: string }> = [
  { characterId: "npc-blackwood" as CharacterId, definitionId: "mount" },
  { characterId: "npc-carrington" as CharacterId, definitionId: "mount" },
];
```

```ts
// src/game/bootstrap.ts (P12 ADDITION):
// Idempotent NPC mount bootstrap. Mutates `characters` IN PLACE (appends to
// each named NPC's equippedArtifactIds) AND mutates `artifactInstances` IN
// PLACE (adds new ArtifactInstance entries). Returns void — the Map mutations
// are the contract. A future maintainer treating either map as immutable will
// silently break determinism; this in-place semantics matches
// `bootstrapPlayerArtifactsForInit` at `src/game/bootstrap.ts:226` (mutates
// `characters` in place; returns the seeded `artifactInstances` Map for the
// createInitialState return literal).
//
// IDEMPOTENT: a second call checks whether any NPC named in
// NPC_STARTING_MOUNT_FAMILY already has a mount-family equipped instance
// AND a corresponding artifactInstances entry. If both hold for ALL named
// NPCs, returns immediately without mutation. Partial-state cases (one NPC
// equipped, one not — should not happen but defensively guarded) re-seed
// only the missing entries.
//
// Called from TWO sites:
//   1. createInitialState (fresh state) — runs alongside bootstrapPlayerArtifactsForInit.
//   2. fromSaveV12 wrapper (live load path) — idempotency makes the
//      reload-after-load-after-save chain a no-op past the first call.
//
// Pre-P12-shipped v12 saves do NOT carry NPC mounts. Loading such a save
// under P12 ship code RE-SEEDS via this helper — the loaded state hash
// changes by one mount-family instance per named NPC vs the pre-P12-shipped
// hash. Acceptable v1 (greenfield; no installed base).
export function bootstrapNpcMountFamily(
  characters: Map<CharacterId, Character>,
  artifactInstances: Map<ArtifactInstanceId, ArtifactInstance>,
  tick: number,
): void {
  for (const { characterId, definitionId } of NPC_STARTING_MOUNT_FAMILY) {
    const npc = characters.get(characterId);
    if (npc === undefined) continue; // legacy/migrated save missing this NPC
    // Idempotence: skip if this NPC already equips ANY mount-family instance.
    const alreadyEquipped = npc.equippedArtifactIds.some((instId) => {
      const inst = artifactInstances.get(instId);
      if (inst === undefined) return false;
      const def = ARTIFACT_REGISTRY.get(inst.definitionId);
      // Use the typed `MOUNT_FAMILY` constant from rules/promenade.ts for
      // consistency with the rules-layer comparison sites. Imported as
      // `import { MOUNT_FAMILY } from "./rules/promenade"` — boundaries allows
      // bootstrap.ts → rules/promenade.ts (bootstrap is store-layer, not rules).
      return def?.family === MOUNT_FAMILY;
    });
    if (alreadyEquipped) continue;
    // Mint a fresh ArtifactInstance owned by this NPC + this NPC's house.
    // Uses the SAME synthState-cast pattern as `computeStartingArtifactInstances`
    // at `src/game/bootstrap.ts:197-208` — no new ID-factory helper introduced.
    // makeArtifactInstanceId takes a full GameState; we wrap a partial that
    // exposes only the artifactInstances field (the only field the factory
    // reads for its index-counter walk).
    const synthState = { artifactInstances: new Map(artifactInstances) } as unknown as GameState;
    const instId = makeArtifactInstanceId(synthState, definitionId);
    const newInst: ArtifactInstance = {
      id: instId,
      definitionId,
      ownerHouseId: npc.houseId,
      ownerCharacterId: npc.id,
      lastRefreshTick: tick,
      forgedFlag: false,
    };
    artifactInstances.set(instId, newInst);
    characters.set(npc.id, { ...npc, equippedArtifactIds: [...npc.equippedArtifactIds, instId] });
  }
}
```

**Per-iteration ID-collision guard (resolves B7).** The factory `makeArtifactInstanceId(state, definitionId)` walks `state.artifactInstances.values()` to count existing instances with the given `definitionId` — it returns `{definitionId}-{count}` as the next ID. If `bootstrapNpcMountFamily` were to build `synthState` ONCE before the for-loop and only land minted instances in the LIVE `artifactInstances` Map after each iteration, the factory would return colliding IDs for consecutive NPC seeds (both NPCs would compute `mount-N` against the same starting count). The snippet above avoids this by declaring `synthState` INSIDE the for-loop body (line 887 within the `for (...)` block at line 870), so each iteration freshly clones the LIVE `artifactInstances` Map. Because line 897 (`artifactInstances.set(instId, newInst)`) writes the just-minted instance to the LIVE Map BEFORE the next iteration starts, the next iteration's `new Map(artifactInstances)` clone sees it, and `makeArtifactInstanceId`'s count walks one position higher. Single `.set` per iteration + per-iteration synthState rebuild = collision-free IDs across N NPC seeds.

This deviates from the existing `computeStartingArtifactInstances` pattern at `src/game/bootstrap.ts:197-217` (which writes `synthState.artifactInstances.set(id, inst)` per-iteration AND uses a single outside-the-loop synthState). Both approaches work; the per-iteration-rebuild form is slightly more allocation-heavy but eliminates the synthState-mutation discipline (one fewer thing for a future maintainer to get wrong). A Vitest assertion in `bootstrap.test.ts` ("bootstrapNpcMountFamily produces unique IDs for two mount-family NPCs") pins this contract; if the snippet ever regresses to a single-outside-the-loop synthState without the post-mint `synthState.artifactInstances.set` call, the test fails.

**Call-site edits:**
1. **`src/game/store.ts:createInitialState`** — verified live at `src/game/store.ts:134` (`bootstrapPlayerArtifactsForInit` import) and `:152-186` (the function body). The `bootstrapPlayerArtifactsForInit(characters, houses, 0)` call lands at `src/game/store.ts:173` (after `seedStartingFamily`, before the return literal). P12 inserts `bootstrapNpcMountFamily(characters, artifactInstances, 0)` IMMEDIATELY AFTER that call, BEFORE the `return { ... }` literal closes. Concrete sketch:
   ```ts
   // src/game/store.ts (P12 EDIT — insert in createInitialState between
   // bootstrapPlayerArtifactsForInit and the return literal):
   const artifactInstances = bootstrapPlayerArtifactsForInit(characters, houses, 0);
   bootstrapNpcMountFamily(characters, artifactInstances, 0);  // NEW at P12
   return {
     // ... existing fields ...
     artifactInstances,
     // ... existing fields ...
   };
   ```
   Order: player mounts first (3 instances), then NPC mounts (2 instances). Final fresh-state `state.artifactInstances.size === 5` (was 3 pre-P12). Pin the ordering with an inline Vitest assertion in `src/game/bootstrap.test.ts` that calls `bootstrapPlayerArtifactsForInit` then asserts `artifactInstances.size === 3`, then calls `bootstrapNpcMountFamily` and asserts `artifactInstances.size === 5` (test-side observation; production code does not assert). This pins the call-order contract — a future reorder that swaps them would produce `mount-0` on Blackwood and `mount-1` on the player head, breaking the hash baseline.
2. **`src/persist/schema.ts:fromSaveV12` (the LIVE wrap at `src/persist/schema.ts:1758-1794`).** Verified: V12 is the live format and has NO Bare/wrap split (only V1-V11 have Bare variants — see `fromSaveV9Bare` precedent at `src/persist/schema.ts:1219-1248`). The live `fromSaveV12` is a single-function direct-return that builds a `GameState` literal from `deserializeRegistry` calls — there is no intermediate Maps to thread into a void-returning helper. Concrete restructure: extract `characters` and `artifactInstances` to local `const`s BEFORE the return literal, call `bootstrapNpcMountFamily(characters, artifactInstances, save.tick)` on those locals (the Map-mutating call lands in place), then reference the now-mutated locals from the return literal. All other deserialized Maps stay inline in the return literal:
   ```ts
   // src/persist/schema.ts (P12 EDIT — restructure fromSaveV12):
   export function fromSaveV12(save: SaveV12): GameState {
     // Extract the two Maps that bootstrapNpcMountFamily mutates to local
     // consts BEFORE building the return literal. Other Maps stay inline.
     // The bootstrap helper is idempotent (skips when the named NPCs already
     // equip a mount-family instance), so resave-reload chains are stable.
     const characters = deserializeRegistry(save.characters) as GameState["characters"];
     const artifactInstances = deserializeRegistry(
       save.artifactInstances,
     ) as GameState["artifactInstances"];
     bootstrapNpcMountFamily(characters, artifactInstances, save.tick);
     return {
       tick: save.tick,
       rng: deserializeRegistry(save.rng) as GameState["rng"],
       houses: deserializeRegistry(save.houses) as GameState["houses"],
       characters,                                                   // mutated by bootstrapNpcMountFamily
       marriages: deserializeRegistry(save.marriages) as GameState["marriages"],
       campaignName: save.campaignName,
       era: save.era,
       conversationHistory: deserializeRegistry(
         save.conversationHistory,
       ) as GameState["conversationHistory"],
       affectionMap: deserializeRegistry(save.affectionMap) as GameState["affectionMap"],
       schemes: deserializeRegistry(save.schemes) as GameState["schemes"],
       whispers: deserializeRegistry(save.whispers) as GameState["whispers"],
       couriers: deserializeRegistry(save.couriers) as GameState["couriers"],
       staff: deserializeRegistry(save.staff) as GameState["staff"],
       proposalsLog: deserializeRegistry(save.proposalsLog) as GameState["proposalsLog"],
       tutorAssignmentsLog: deserializeRegistry(
         save.tutorAssignmentsLog,
       ) as GameState["tutorAssignmentsLog"],
       pendingTutorTraitChoices: deserializeRegistry(
         save.pendingTutorTraitChoices,
       ) as GameState["pendingTutorTraitChoices"],
       patronesses: deserializeRegistry(save.patronesses) as GameState["patronesses"],
       rivalActors: deserializeRegistry(save.rivalActors) as GameState["rivalActors"],
       factionTensions: deserializeRegistry(save.factionTensions) as GameState["factionTensions"],
       duels: deserializeRegistry(save.duels) as GameState["duels"],
       elopement: save.elopement,
       artifactInstances,                                            // mutated by bootstrapNpcMountFamily
       forgeries: deserializeRegistry(save.forgeries) as GameState["forgeries"],
       thiefAttempts: deserializeRegistry(save.thiefAttempts) as GameState["thiefAttempts"],
     };
   }
   ```
   No `fromSaveV12Bare` is introduced at P12 — the Bare/wrap split is reserved for the demotion-to-legacy that happens when a FUTURE phase ships a new save version (matching the P9 → P10 V9-demotion pattern at `src/persist/schema.ts:1219-1248`). Idempotency makes the load-resave-reload chain stable: first load seeds; second load is a no-op.
3. Legacy lifts (`fromSaveV1..V11`) reuse the V12 path via the existing chain — once a legacy save reaches v12 via the migration ladder, the live `fromSaveV12` wrap fires the seeding. No per-legacy-lift edits needed.

**Hash impact:** Pre-P12-shipped v12 saves (none exist outside the developer's local Dexie DB) gain 2 NPC mount instances + 2 equippedArtifactIds entries on first reload under P12 ship code. The hash diverges by this delta from the pre-shutdown hash. Subsequent saves are stable.

**Determinism contract:** The NPC mount IDs are derived deterministically from the existing `makeArtifactInstanceId(synthState, definitionId)` factory (state-walk index counter; same pattern as `makeWhisperId` / `makeCourierPayloadId`). Verified format at `src/game/fixtures/artifacts.ts:193-199`: `artifact-${definitionId}-${index}` where `index` counts existing instances of the same definitionId. No PRNG draws. The five fresh-state instances on a tick-0 init are minted in this order, producing these IDs:
- `artifact-sapphires-0` (player head, from PLAYER_STARTING_ARTIFACTS[0])
- `artifact-snuffbox-0` (player head, from PLAYER_STARTING_ARTIFACTS[1])
- `artifact-mount-0` (player head, from PLAYER_STARTING_ARTIFACTS[2])
- `artifact-mount-1` (Lord Blackwood, from NPC_STARTING_MOUNT_FAMILY[0])
- `artifact-mount-2` (Miss Carrington, from NPC_STARTING_MOUNT_FAMILY[1])

The PLAYER_STARTING_ARTIFACTS order (sapphires/snuffbox/mount per `src/game/fixtures/artifacts.ts:175-183`) determines the player-side IDs; the NPC_STARTING_MOUNT_FAMILY array order (Blackwood/Carrington) determines the NPC-side IDs. The per-definitionId counter (e.g., `mount` has its own counter independent of `sapphires`) is preserved by the factory's index walk, NOT by the bootstrap-call sequence — `artifact-mount-1` lands at the second mount instance regardless of whether sapphires or snuffbox minted in between.

**Migration vs runtime-backfill (rationale).** Bumping save version v12→v13 with a "seed NPC mounts" migration was considered and rejected: P12 already adds no other persisted state (per the user-resolved no-save-bump decision), so a version bump strictly to backfill an NPC fixture would be the only persisted-shape change in the phase. Runtime-backfill via the idempotent helper achieves the same end-state without the migration-ladder + chain-test surface area. The bare+wrap precedent from P4 (Independent-house seeding via legacy lifters) applies directly: idempotent seeding can run on the load path without a save-version bump when the persisted shape is unchanged.

**Mount bonus stacking semantics (load-bearing design decision).** Spec line 198/450: "An owned mount-family artifact on the player grants a per-promenade affection bonus while the player is in the Mingle stance." The phrasing "per-promenade" admits two readings:
- **(A)** Once per visit (session-level constant — fixed bonus added to the FIRST action's affection, then exhausted)
- **(B)** Once per action (per-turn additive — applied to every action's affection delta)

P12 v1 SHIPS **interpretation (B): per-action**. Rationale:
- Symmetric with the ComplimentMount per-action gating (which also applies on every turn the partner equips a mount-family). One per-action bonus + one per-action gate is consistent.
- "Per-promenade" in spec context reads as "during a promenade session" rather than "once per session" — the latter would conventionally be written "per-visit" or "once per visit."
- Session-level latching (A) requires an in-orchestrator `bonusConsumed: boolean` flag that doesn't persist across saves; (B) is stateless.
- Playtest signal: if (B) feels too generous, the constant `PROMENADE_PLAYER_MOUNT_MINGLE_BONUS = 5` is a 1-line tune. (A) would require code restructure.

The spec's "while the player is in the Mingle stance" clause is satisfied vacuously in v1 — promenade has no stance toggle and implicitly always-Mingle. A future v1.5 stance toggle inside promenade would re-introduce the gate at `resolvePromenadeCombat`'s input layer (input.stance: Stance). Implementation note: no stance field is plumbed at v1 (the `playerHasMountFamilyEquipped` boolean already encodes the "owns AND is in Mingle" composite — `true` when both hold, `false` when either doesn't).

**Out of scope.**

- Carriage-driver staff bribery — P6 already shipped the staff-espionage subsystem; the carriage-driver assignment is independent of the promenade affordance.
- Stance toggle inside promenade. The mount-Mingle clause is satisfied via always-implicit Mingle (user-resolved). A future v1.5 stance-aware promenade would re-introduce `StanceToggle` rendering inside `PromenadeView` AND gate the mount bonus on `stance === "Mingle"`.
- Mood-driven synergy on the WittyBanter / DeepEmpathy promenade tactics. The combat resolver in `src/game/rules/promenade.ts:resolvePromenadeCombat` does NOT consult `TACTIC_BONUS_MOOD` or `CONVERSATION_TRAIT_BONUSES`. v1 promenade affection is purely `(base + mount-bonus) × qualityMultiplier`, no synergy bonus. Spec line 446-450 lists exactly three affordances; trait/mood synergy isn't mentioned; the "low-risk" framing argues against adding undocumented variance.
- Multi-NPC scene at promenade. 1-on-1 (user-resolved). The persona prompt sees `otherCharactersInScene: []`.
- ComplimentMount as a ballroom tactic. UI surfaces ComplimentMount ONLY in `PromenadeView` / `PromenadeTacticButtons`. The ballroom's `TacticButtons.tsx` still renders the 4 original tactics. The Tactic union widening to 5 is a typesystem fact, not a UX fact.
- Per-promenade cooldown beyond the tick consumption. The player may promenade every tick if they choose to (and stay at Capital); each visit picks a fresh deterministic partner. Spec is silent on cooldown; tick consumption is the cost surface.
- Whisper-generation tool calls during promenade. The `generateWhisper` tool stays wired (server registers BOTH `respond` and `generateWhisper` per `server/tools.ts`), and an unsolicited whisper-generation call during promenade is processed normally. The system instruction's mode-framing prefix does NOT discourage whisper generation — Hyde Park gossip is in-fiction.

**Spec refs.**
- §3 "Hyde Park Daytime Promenade" (lines 192-198): capability description.
- §3 "Hyde Park Promenade" (lines 444-450): business-logic detail (Capital gating, 1-tick cost, 3-action affordance set, faux-pas suppression, mount+Mingle bonus).
- §3 "Conversation Combat Math" + "Stance Modifiers": the parent affection-delta math the promenade resolver simplifies from.
- §4 "Artifact Definition" + `family` enum: the mount-family value the gate reads.

**Machines.** None new. The Conversation round-trip machine (Idle → Sending → Resolving → Done | Failed at MASTER.md §5.2 line 177) is REUSED across both modes — its state graph applies identically to a promenade session as to a ballroom session.

**Edge cases.**

- **Partner dies mid-session** (via aging/year-pass-driven death — promenade is in-tick, but the player can `runYearPass` from elsewhere ONLY by exiting the promenade first, so this is rare). Resolution: `sendPromenadeMessage` re-reads `partnerAtResolve = stateAtResolve.characters.get(target.id)`; if `!partnerAtResolve.alive`, the function returns `{ ok: false, reason: { reason: "cancelled" } }` and the UI surfaces a "Your partner has fallen ill and departed" message. `exitPromenade` ticks normally; the session terminates without further affection writes. The `TargetCharacterDied` event still fires (existing subscription) so the server-side persona cache evicts.
- **Player house exiled by `Scandal Sheet` attribution during a promenade.** Mid-session exile is rare (exile triggers from weaponizeWhisper's Scandal Sheet branch, a free action). If the player weaponizes mid-promenade via the ledger or whisper-UI (the affordances live OUTSIDE PromenadeView, so this requires a UI re-route), the next `sendPromenadeMessage` reads `stateAtResolve.houses.get(PLAYER_HOUSE_ID).exiled === true`. No explicit gate is added to `sendPromenadeMessage` for this — the existing `target === undefined || !target.alive || playerHead === undefined` defensive check covers a "house lookup failed" branch, but exile keeps the house entity intact. Acceptable v1 behavior: the message goes through normally (affection still writes). v1.5 candidate: add an `exiled === true` short-circuit to `sendPromenadeMessage` parallel to the gate in `applyAudience`.
- **Elopement triggered mid-promenade** (race condition between an in-flight `sendPromenadeMessage` LLM round-trip and a parallel store action that mounts `state.elopement`). The view-routing precedence at `App.tsx` puts `Elopement` first, so once `state.elopement !== null` the view re-renders to `ElopementOverlay` and the player loses access to the PromenadeView's send button — but if a parallel store action lands DURING an in-flight `send()` (15s LLM round-trip + theoretical mid-fetch player click on a ledger affordance that resolves a Seduction scheme), the post-await `appendPromenadeExchange` writes affection AGAINST `state.elopement !== null`. **Acceptable v1 behavior**: `sendPromenadeMessage` does NOT short-circuit on `state.elopement !== null` at the post-await mutation site. Rationale:
  (a) The parallel-action surface is narrow — the ledger panel affordances that could mount elopement are scheme-resolutions which require player click + 1+ tick advance + a Seduction completion. The 15s in-flight window is too tight for this sequence in practice.
  (b) Adding a defensive check at the post-await site introduces another stale-state branch in an already-complex orchestration. The simpler alternative (gating at the request-build site) doesn't help — `state.elopement` could mount between request-build and post-await.
  (c) The affection write itself is a non-blocking mutation; it doesn't corrupt elopement state. The next render shows the ElopementOverlay (overlay precedence wins), and the promenade history entry persists harmlessly.
  
  v1.5 candidate: add a post-await `state.elopement !== null` short-circuit alongside the existing `target === undefined || !target.alive` defensive check. The CLAUDE.md additions list pins this divergence so a future reviewer doesn't "fix" it as a P9 generalized-modal-state-principle violation. `exitPromenade` also doesn't check `state.elopement !== null` — the only way to mount elopement mid-promenade is via a parallel store action (see above); the `exitPromenade` tick advance itself cannot mount elopement because the year-pass STEPS chain doesn't run during a tick-advance (only scheme resolution runs; and a scheme has to be Active with cancellation/resolution criteria met). v1.5 may add an explicit gate.
- **Save/load mid-promenade.** Loading a save while a promenade session is open via the orchestrator: the orchestrator's `currentSession` is in-memory and gets DROPPED on full reload (Dexie load → store hydrate via `replaceState`). The player lands back on `MapView` with `Capital` location (saved value); the promenade session is silently discarded. No tick was paid (commit-on-leave), so no state regression. The `conversationHistory` written per-turn DOES persist to the save (it lives in `GameState`), so any in-progress affection deltas + history entries from the abandoned session survive the reload. Acceptable v1 — matches the ballroom precedent.
- **Same-tick travel + promenade** (player travels to Capital, then promenades, in two distinct tick-advancing actions). Each consumes 1 tick → 2 ticks total. Within the second tick (the promenade tick), `currentLocation === "Capital"` (just-traveled), so the canEnterPromenade gate passes. After exit, tick has advanced by 1 (the promenade's commit-on-leave). Total tick cost = 2.
- **Empty partner pool** (every NPC dead, or all remaining NPCs are rivals — extremely late-game edge). Caught by `canEnterPromenade` + `pickPromenadePartner`. Surfaces as `NoEligiblePartner` rejection; UI tooltip on the Capital button. NO RNG consumed on this rejection path.
- **Quality-multiplier extremes via prompt-injection.** Promenade resolver clamps `qualityMultiplier` to `[0.5, 1.5]` defensively inside `resolvePromenadeCombat` (separate clamp from `narrowResponse`'s clamp). Even if an upstream resolver drift permits an out-of-range value, the resolver clamps; affection delta stays bounded.
- **Pin override on out-of-set classification.** If the model returns `classifiedTactic: "Flattery"` (out-of-set for promenade) and the player pinned `"WittyBanter"`, the existing `resolveTactic` resolver returns the pinned value (pin-always-overrides per spec §3 line 70). Promenade tactic resolution therefore stays in-set even on adversarial model output.

**Verification.**

`pnpm test` Vitest suites (NEW at P12):
- `src/game/rules/promenade.test.ts`:
  - `eligiblePromenadePartners` excludes the player house, dead characters, and `RIVAL_CHARACTER_IDS_SET`; includes children + non-rival adults.
  - `pickPromenadePartner` is deterministic across 30 replay-harness seeds (same `state.rng[player].callCount` → same partner).
  - `pickPromenadePartner` advances player RNG by EXACTLY 1 callCount.
  - `pickPromenadePartner` returns `partnerId: null` + RNG unchanged when the pool is empty.
  - `canEnterPromenade` rejects with `WrongLocation` when not at Capital, `PlayerExiled` when exiled, `ElopementInProgress` when elopement-mounted.
  - `resolvePromenadeCombat` returns the documented affection deltas for each tactic + each mount-equipped permutation (4 × 2 × 2 = 16 cases).
  - `resolvePromenadeCombat` clamps `qualityMultiplier` defensively (input 0.0 → effective 0.5; input 2.0 → effective 1.5).
  - `resolvePromenadeCombat` returns `composureDelta: 0` across every input combination (parametric assertion).
  - `resolvePromenadeCombat` returns `affectionDelta: 0` on ComplimentMount when `targetHasMountFamilyEquipped === false`.
  - `appendPromenadeExchange` clamps affection map to `[0, 100]` at the mutation site.
  - `appendPromenadeExchange` writes both speaker exchanges (house-head + other) to history with the player's pinned tactic on the house-head entry.
  - `playerHeadEquipsMountFamily` returns true when ANY mount-family equipped instance is on the player head; false otherwise.
- `src/game/rules/combat.test.ts` (EXTENSION):
  - `resolveCombat` fallback assertion: when invoked with `tactic: "ComplimentMount"` (defensive path — ballroom UI does NOT surface this), the resolver returns `{ kind: "Normal", affectionDelta: <base + 0 synergy>, composureDelta: 0, synergy: false }`. Pins the no-synergy degenerate behavior so a future ballroom-UI widening can't silently regress.

- `src/persist/migrations/v1-to-v12-chain.test.ts` (EXTENSION — re-baseline at P12). Verified live: the chain test asserts `expect(v12.artifactInstances).toHaveLength(3)` (the migration-ladder-produced count) AND `hashState(fromSaveV12(v12)) === hashState(createInitialState(seed, ...))` (the path-parity assertion). P12 changes both sides:
  - The on-disk SaveV12 emitted by the migration ladder STAYS at 3 instances (the v10→v11 migration's `bootstrapPlayerArtifactsForMigration` seeds player-only; no migration step seeds NPC mounts). The `.toHaveLength(3)` assertion stays valid as-is.
  - The LIFTED side (`fromSaveV12(v12)`) gains +2 NPC mounts via `bootstrapNpcMountFamily(characters, artifactInstances, save.tick)`. The FRESH side (`createInitialState`) gains the SAME +2 via the same helper. Parity holds iff both paths feed identical inputs to the helper — the chain test's fixture uses `tick: 0` and the same baseline NPCs, so the IDs and lastRefreshTick match across both paths.
  - Add an explicit P12 assertion at the chain test: `expect(fromSaveV12(v12).artifactInstances.size).toBe(5)` (3 player + 2 NPC mounts post-lift). Failure here means either (a) `bootstrapNpcMountFamily` is missing from the `fromSaveV12` wrap, or (b) the helper is non-idempotent in a way that double-seeds. Both regressions are caught here.
  - Reference: existing chain-test pattern at `src/persist/migrations/v1-to-v11-chain.test.ts` (P10 precedent — same shape).

`src/game/store.promenade.test.ts` (NEW at P12):
- `enterPromenade` returns `ok:true` at Capital with a non-empty partner pool; commits 1 player-RNG draw; opens a Promenade session in the orchestrator.
- `enterPromenade` returns `WrongLocation` at every non-Capital location; RNG NOT advanced.
- `enterPromenade` returns `SessionAlreadyOpen` when a Ballroom session is already open.
- `enterBallroom` returns `SessionAlreadyOpen` when a Promenade session is already open (reciprocal gate).
- `enterPromenade` returns `PlayerExiled` when `state.houses[player].exiled === true`; RNG NOT advanced.
- `enterPromenade` returns `ElopementInProgress` when `state.elopement !== null`; RNG NOT advanced.
- `exitPromenade` advances `state.tick` by 1.
- `exitPromenade` fires ALL 10 publishers (proven by spying on each diff helper).
- `exitPromenade` is a no-op when no Promenade session is open (defensive; the dispatch path should never reach this branch).
- `sendPromenadeMessage` writes the two-exchange pair to `state.conversationHistory[(player, partner)]`.
- `sendPromenadeMessage` writes the clamped affection delta to `state.affectionMap[(player, partner)]`.
- `sendPromenadeMessage` does NOT advance `state.tick` (per-turn calls only mutate history + affection).
- `sendPromenadeMessage` returns `{ reason: "cancelled" }` when the orchestrator is in Ballroom mode (defensive).
- `abortPromenadeRequest` no-op when in Ballroom mode (defensive).

`src/runtime/conversationOrchestrator.promenade.test.ts` (NEW at P12):
- `beginPromenadeSession` mounts a Promenade-mode session with the supplied partner.
- `beginPromenadeSession` throws when a Ballroom session is already open (defense-in-depth).
- `beginPromenadeSession` is idempotent at same (tick, partner).
- `currentMode` returns `"Promenade"` after `beginPromenadeSession`, `null` after `endSession`.
- `currentPromenadePartner` returns the partner during a Promenade session, `null` in Ballroom mode.
- `send` services Promenade-mode requests through the same code path (no mode branch in `send`).

`server/conversation.test.ts` (EXTENSION):
- The respond-tool enum includes `"ComplimentMount"`; the SDK function-declaration matches the widened shape.
- Mode-framing system instruction prefix appears for `mode: "Promenade"` requests; absent for `mode: "Ballroom"` (default).
- `ProxyConversationRequestSchema.parse` accepts requests without `mode` field (defaults to `"Ballroom"`).
- Server normalizes `mode: "ballroom"` (lowercase variant — adversarial) via Zod enum strict-parse (rejects). Defensive coverage; pre-P12 clients never send the field; post-P12 clients always send the exact case.

**Replay-harness extension (concrete file paths).** The live 30-run identical-seed determinism harness lives at `src/game/replay-harness.test.ts` (NOT `src/test/replayHarness.test.ts` — earlier draft mistakenly named the file). The existing harness exercises `advanceTick` + `runYearPass` only; it has NO LLM mocking infrastructure (verified at `src/game/replay-harness.test.ts:1-50` — no `vi.mock` calls). Adding a promenade leg requires standing up the mock infrastructure for the first time. P12 ships TWO new files + ONE edit:

1. **`src/runtime/__test-utils__/promenadeLlmMock.ts`** (NEW at P12). A Vitest `vi.mock` test utility that swaps `conversationOrchestrator.send` to return a fixed-shape response, bypassing the network entirely:
   ```ts
   // src/runtime/__test-utils__/promenadeLlmMock.ts (NEW at P12):
   import { vi } from "vitest";
   import type { ConversationResponse, ProxyConversationRequest, Tactic } from "../../llm/types";

   // Fixed-quality, fixed-classification response. The classifiedTactic is the
   // PINNED tactic from the request (pin-always-overrides path) so the test
   // can simulate WittyBanter / DeepEmpathy / ComplimentMount independently.
   export function buildFixedPromenadeResponse(
     classifiedTactic: Tactic,
   ): ConversationResponse {
     return {
       dialogue: "[mocked NPC dialogue]",
       classifiedTactic,
       qualityMultiplier: 1.0, // dead-center; no quality-floor/ceil clamp effects
       moodHint: null,
       toolCalls: [],
     };
   }

   // Module-level vi.mock that swaps the orchestrator's send() for a stub
   // that returns { kind: "Resolved", response: buildFixedPromenadeResponse(pinnedTactic) }.
   // The mock reads the pinnedTactic from the second argument to send().
   //
   // Call this from the test file's top-level setup BEFORE importing the
   // store module. Vitest's vi.mock is hoisted, so this works as a
   // dual-side-effect import.
   export function mockPromenadeOrchestrator(): void {
     vi.mock("../conversationOrchestrator", async (importOriginal) => {
       const actual = await importOriginal<typeof import("../conversationOrchestrator")>();
       return {
         ...actual,
         conversationOrchestrator: {
           ...actual.conversationOrchestrator,
           send: vi.fn(async (
             _req: ProxyConversationRequest,
             pinnedIntent: Tactic | null,
           ) => ({
             kind: "Resolved" as const,
             response: buildFixedPromenadeResponse(pinnedIntent ?? "WittyBanter"),
           })),
         },
       };
     });
   }
   ```
   The mock leaves session-management methods (`beginSession`, `beginPromenadeSession`, `endSession`, `currentMode`, `currentPromenadePartner`, `currentSessionId`, `abortCurrent`) on the real orchestrator instance — only `send` is stubbed. This preserves the cross-mode mutual-exclusion semantics that the production store wrappers depend on.

2. **`src/game/replay-harness.promenade.test.ts`** (NEW at P12). A sibling file to `replay-harness.test.ts` that adds the promenade leg without touching the live 30-run harness file. Why a sibling: keeps the live harness boot-only (no mocking) so the determinism-of-pure-state assertion stays clean. The new file:
   ```ts
   // src/game/replay-harness.promenade.test.ts (NEW at P12 — sketch):
   import { describe, expect, it } from "vitest";
   import { mockPromenadeOrchestrator } from "../runtime/__test-utils__/promenadeLlmMock";
   import { hashState } from "./hash";
   import { REPLAY_SEEDS } from "./rng.seeds";
   import { createStore, selectGameState } from "./store";

   mockPromenadeOrchestrator(); // hoisted by Vitest — runs before store import resolves

   const RUNS = 30;

   async function runOnceWithPromenade(seed: string): Promise<string> {
     const store = createStore({ seed });
     // No travel needed — verified live at `src/game/bootstrap.ts:118`:
     // `currentLocation: "Capital"` is the initial value. The promenade
     // enters directly without a prior travel tick. (Earlier draft mistakenly
     // claimed initial location was "Country" and emitted a no-op travel
     // call; corrected here.)
     // Enter promenade (1 player-RNG draw — partner pick)
     const entry = store.getState().enterPromenade();
     if (!entry.ok) throw new Error("enterPromenade rejected: " + JSON.stringify(entry.reason));
     // Send one message (mocked LLM response — pinned tactic = WittyBanter)
     const send = await store.getState().sendPromenadeMessage({
       freeformMessage: "[mocked player message]",
       pinnedTactic: "WittyBanter",
     });
     if (!send.ok) throw new Error("sendPromenadeMessage failed: " + JSON.stringify(send.reason));
     // Exit (1 tick advance + 10-publisher fan-out)
     store.getState().exitPromenade();
     return hashState(selectGameState(store.getState()));
   }

   describe(`30-run promenade replay (seed = "${REPLAY_SEEDS[0]}", scripted enter→send→exit)`, () => {
     // Compute baseline inside beforeAll so the awaited Promise resolves before
     // any `it` block runs. Avoids the "describe-scope awaits a Promise"
     // anti-pattern that the existing sync `runOnce` harness sidesteps.
     let baseline = "";
     beforeAll(async () => {
       baseline = await runOnceWithPromenade(REPLAY_SEEDS[0]);
     });
     it.each(Array.from({ length: RUNS }, (_, i) => i + 1))(
       "run %i matches baseline hash",
       async (_runNumber) => {
         expect(await runOnceWithPromenade(REPLAY_SEEDS[0])).toBe(baseline);
       },
     );
   });
   ```
   The 30-run loop asserts identical post-promenade hashes — proving the partner pick (1 player-RNG draw), the affection-map write, the conversation-history append, and the tick advance are all deterministic functions of `state.rng` + the mocked LLM response. The mocked response is byte-stable across runs (it's a fixed string), so the LLM-output non-determinism is excluded from the determinism contract per CLAUDE.md §5.4.

3. **NO edit to the live `src/game/replay-harness.test.ts`.** The pre-P12 30-run harness stays mock-free and continues to assert advanceTick + runYearPass determinism over its own schedule. The promenade leg lives in the sibling file. This split avoids the "introduce vi.mock to a file that doesn't need it" trap that would otherwise leak `conversationOrchestrator.send` stubs into the pre-P12 harness.

Hash stability verified across 30 runs in the new sibling file.

`pnpm lint` — Biome clean; boundary-rule clean (verified the new `src/game/rules/promenade.ts` only imports from constants / conversation/types / entities / fixtures / rng / util; no UI / persistence / LLM / runtime / events imports).

`pnpm typecheck` — strict TS clean across the constants widening, the schema enum widenings, the orchestrator session-state union, and the store-action interface extension.

UI verification: dev server (`pnpm dev`) running Vite + the Node proxy concurrently; manual exercise of the golden path:
1. Travel to Capital → press "Take a Promenade in Hyde Park" → verify a single portrait appears with a deterministic partner.
2. Click WittyBanter → type a message → send → verify the LLM response, affection bump, and history append.
3. Click ComplimentMount when the partner has a mount artifact equipped — verify the higher affection delta; click when the partner doesn't — verify the button is disabled with the tooltip.
4. Press "Conclude Promenade" → verify the tick advances by 1 and the view returns to Map.
5. Attempt to enter the promenade from a non-Capital location — verify the button is disabled with the tooltip.

LLM failure-path coverage (per CLAUDE.md "For LLM-touching changes: exercise the failure paths"):
- Timeout (15s expired) → orchestrator returns Failed.timeout → UI banner; no tick advance until exit.
- Network failure (proxy down) → orchestrator returns Failed.network → UI banner.
- Schema failure (server-side Zod parse fails on classifiedTactic) → orchestrator returns Failed.schema → UI banner.
- Cancelled (user clicks "Conclude Promenade" mid-fetch) → orchestrator returns Failed.cancelled → no banner; the exit flow proceeds normally and advances the tick.

**MASTER.md updates.**

- **§6 Phase Index**: P12 row's `Status` column flips from `—` to `🚧 in progress` during P12 work, then to `✅ done` after `/close-phase 12`. No `Depends on` change (P3 + P4 + P10 remain).
- **§5.2 State Machines Catalog**: No new machine row. The existing `Conversation round-trip` row's `Machine` cell remains unchanged (reused across both modes).
- **§7 Capability Map**: `Hyde Park Daytime Promenade` row stays at `P12` (no change; was pre-allocated at master plan ship).
- **§9 Non-Functional Requirements**: No new NFR row. The existing `15-second conversation timeout` row's `Where enforced` cell remains `P4` (the orchestrator-level timeout is shared across modes; promenade does not need its own NFR entry).
- **§10 Open Questions**: No new Q-row needed. The four design decisions resolved during P12 planning (multi-turn LLM, no save bump, modal panel UI, 1-on-1 scene + tick-on-exit + zero composure + always-Mingle) are scoped to the phase plan; they do NOT rise to the §10 spec-ambiguity level (they are implementation choices within a fully-specced feature). The phase plan itself documents the resolutions inline.

**CLAUDE.md additions (apply at `/close-phase 12`).**

Two new pins, both load-bearing for future phases that touch the conversation surface:

1. **"TACTICS widening discipline (P12)."** The 5th tactic (`"ComplimentMount"`) is intentionally absent from `TACTIC_BONUS_MOOD`, `CONVERSATION_TRAIT_BONUSES`, and `CONVERSATION_TRAIT_PENALTIES`. The ballroom-side `resolveCombat` returns a no-synergy `Normal` outcome when called with this tactic (defense-in-depth pinned by `combat.test.ts`). Future TACTICS widenings (a 6th tactic in v1.5) must EITHER extend all three Maps OR ship a parallel `combat.test.ts` assertion pinning the no-synergy fallback. The `if (TACTICS.length !== 5) throw` module-load guard at `src/game/constants.ts` requires bumping when shipping the 6th.

2. **"Cross-mode session mutual exclusion (P12)."** `conversationOrchestrator` holds a single `currentSession: SessionState | null` field. `enterBallroom` and `enterPromenade` are mutually exclusive at the store-action layer (rejection union includes `{ kind: "SessionAlreadyOpen" }`); the orchestrator's `beginSession` / `beginPromenadeSession` throws on mode-conflict as defense-in-depth. Future conversation modes (e.g., a v1.5 Court Audience Conversation) follow the same pattern: extend `SessionState`'s discriminated union, add a parallel `begin{Mode}Session` method, widen the `SessionAlreadyOpen` gate at every entry. **No `GameState` field tracks the active mode** — sessions are in-memory only; saves discard sessions on reload. The 1-tick cost for promenade is paid on exit (commit-on-leave), so an aborted-via-reload session costs nothing. This asymmetry with the elopement modal-state pattern (which DOES persist) is deliberate.

3. **"Promenade modal-state gate divergence (P12)."** `sendPromenadeMessage` deliberately does NOT short-circuit on `state.elopement !== null` or `state.houses.get(PLAYER_HOUSE_ID).exiled === true` at the post-await mutation site. This is a deliberate divergence from the P9 "Modal-state rule-layer gate principle" pin (which says every free-action wrapper gates on `state.elopement !== null`). Rationale: (a) `enterPromenade` already gates upstream on both modal states, so the race window is the in-flight LLM round-trip (≤15s); (b) a parallel store action that mounts elopement OR triggers exile during an in-flight `send()` is a narrow surface; (c) the post-await `appendPromenadeExchange` is a non-blocking mutation that doesn't corrupt elopement/exile state. View-routing precedence (Elopement > Promenade) handles the visible-state recovery on the next render. v1.5 candidate: add the post-await gates if playtest surfaces the race as a real concern. **Future modal-state-gate widenings (a 5th modal state in v1.5+) MUST explicitly review `sendPromenadeMessage` for inclusion.**

4. **"Tick-on-exit modal pattern (P12)."** `exitPromenade` advances the tick + fires the 10-publisher set on session close (`commit-on-leave`). `exitBallroom` does NOT advance the tick (composure-only). The divergence is load-bearing for the spec line 446 "consumes one tick per visit" contract — ballroom doesn't carry a per-session tick contract, promenade does. Future conversation modes that carry a per-session tick contract follow the `exitPromenade` shape: `advanceTickPure(stateBefore)` + 10-publisher fan-out. Modes that DON'T carry a per-session tick contract follow the `exitBallroom` shape (session-management only, no tick advance, no publishers).

5. **"Per-mode framing rides on per-turn `contents` (P12)."** Any future per-mode framing (e.g., a v1.5 Court Audience mode) MUST ride on the per-turn `contents` payload, NOT on `systemInstruction`. Verified at `server/conversation.ts:45-51`: `cachedContent` and `systemInstruction` are mutually exclusive per the Gemini SDK contract. Once `getOrCreatePersonaCache` populates a cache for a target, EVERY subsequent call uses `cachedContent: cacheName` and the system instruction is NEVER sent again. A mode-framing prefix on `systemInstruction` silently drops on every cache hit. The mode-framing prefix lives in `buildContents` so it lands on every turn regardless of cache state.

**Close out.** When the gates and verification items above are green, run `/close-phase 12` to update phase status in `plans/MASTER.md` §6, append to `plans/SESSION-NOTES.md`, resolve any open questions answered during the work, apply the CLAUDE.md additions above, and commit the changes (no push).

## Accumulated Risks & Suggestions

*Passively collected from review cycles. Not blockers. Triaged at convergence.*

- [C1] PERSONA_CACHE_VERSION bump may be needed (downstream of mode-framing placement); current resolution moves framing to per-turn contents so version stays at v4. `[likely addressed]`
- [C1] Unsafe cast `outcome.response.classifiedTactic as PromenadeTactic` hides pin-priority contract; consider runtime assertion or narrowing helper. `[likely addressed]`
- [C1] `characterEquipsMountFamily` parameter is typed `ReadonlyArray<string>`; canonical type is `ReadonlyArray<ArtifactInstanceId>` — drop the `as never` workaround. `[applied]`
- [C1] Citation "PLAYER_HOUSE_ID precedent at constants.ts:58" is wrong — PLAYER_HOUSE_ID lives at `src/game/rng.ts:58`. Re-justify the constants.ts vs fixtures/artifacts.ts placement of MOUNT_ARTIFACT_FAMILY. `[likely addressed]`
- [C1] `BallEntryRejection` widening with `{ kind: "SessionAlreadyOpen" }` is not enumerated as an edit — add explicit edit entry. `[likely addressed]`
- [C1] `ConversationEvent` union widening (PromenadeEntered/PromenadeExited) and `LocationEvent` widening (PromenadeEntryRejected) are not enumerated as edits — add explicit edit entries. `[likely addressed]`
- [C1] Replay-harness LLM mock fixture wiring is underspecified — pin which fixture file owns the deterministic LLM stub and how it composes with `conversationOrchestrator.send()`. `[likely addressed]`
- [C1] Constants block JSDoc could cite spec §3 lines 444-450 to match the §-reference comment style elsewhere in `src/game/constants.ts`. `[applied]`
- [C1] Add a Vitest assertion to `store.promenade.test.ts` that post-reload `conversationHistory.get(makePairKey(player, partner))` matches pre-reload history (verifies the documented save/load semantics). `[noted for implementer]`
- [C1] Verify `buildPersonaPrompt` at `server/prompts/persona.ts` gracefully handles an empty `otherCharactersInScene` array; add a server-side assertion if the prompt becomes syntactically degenerate. `[skipped: requires codebase verification]`
- [C1] `resolvePromenadeCombat`'s switch over `PromenadeTactic` would benefit from an `assertNever` exhaustive default to catch a future 4th promenade tactic at TS-compile time. `[noted for implementer]`
- [C1] Spec §3 line 447 is silent on age — the "children included in partner pool" decision is a designer choice; add a Vitest assertion ("ageMinor characters appear in the eligible pool") so the contract is captured. `[noted for implementer]`
- [C1] `fromSaveV12` line citation at plan body says `:~1730`; actual is `schema.ts:1759` — minor citation drift. `[likely addressed]`
- [C1] `MOUNT_ARTIFACT_FAMILY` in constants.ts duplicates the existing `ArtifactFamily` literal at `src/game/fixtures/artifacts.ts:20-28`; consider importing the typed literal instead of declaring a fresh constants.ts symbol. `[likely addressed]`
- [C1] Determinism claim about `mount-0`/`mount-1`/`mount-2` ID order depends on `bootstrapNpcMountFamily` running strictly AFTER `bootstrapPlayerArtifactsForInit`; pin via Vitest assertion (`expect(artifactInstances.size).toBe(3)` before NPC seeding). `[likely addressed]`
- [C1] Pin a Vitest assertion that pre-adult characters appear in `eligiblePromenadePartners` so a future tightening to adult-only doesn't regress silently. `[noted for implementer]`
- [C1] Asymmetry rationale missing: P12 introduces a pure `canEnterPromenade` validator separate from the store action while existing `enterBallroom` inlines its gates. Likely answer: rejection-path testability — worth pinning so future phases don't randomly pick one or the other. `[noted for implementer]`
- [C1] `sendPromenadeMessage` exile-bypass divergence should land in the CLAUDE.md additions list — otherwise the deliberately-permissive behavior silently contradicts the P9 generalized modal-state principle in that pin. `[likely addressed]`
- [C1] `exitPromenade` lacks a defensive elopement gate while every other tick-advancing wrapper has one; add an inline `// elopement gate unnecessary because ...` comment in the wrapper body. `[likely addressed]`
- [C2] Steady-state mount-equipped partner ratio dilutes as children mature and join the pool (P7 maturation); fresh-state 40% claim is correct but tuning may want more named mount-equip seeds. `[noted for implementer — playtest tuning concern]`
- [C2] `runOnceWithPromenade` is async (Promise<string>) but the describe-scope `const baseline = runOnceWithPromenade(...)` is not awaited; works per-iteration but inconsistent with the existing sync `runOnce` harness pattern. First introduction of `vi.mock` at the harness layer. `[applied]`
- [C2] `mode: z.enum(...).default("Ballroom")` works correctly on both client emit and server parse; flag the asymmetry (pre-P12 servers reading post-P12 client requests vs vice versa) for forward-compat documentation. `[noted for implementer]`
- [C2] ComplimentMount silent +0 affection when target unequips mid-session — consider surfacing in ChatLog or a toast for UX feedback. `[noted for implementer — UX polish]`
- [C2] `eligiblePromenadePartners` does not gate on partner currentLocation; "Hyde Park" framing is incongruous when the picked partner's house is at Country. Cites ballroom precedent for the omitted per-character location gate. `[noted for implementer — design intent acknowledged]`
- [C2] Hash-divergence note assumes no installed base, but v12 shipped at P11 days ago — if the developer has a live v12 campaign in Dexie, the first-load divergence affects them. Not a true greenfield concern. `[noted for implementer — developer-side hash divergence on first P12 load]`
- [C2] `inBallroom + inPromenade` simultaneous-true is "unreachable by construction" — but two `useState` booleans + async store actions can transiently coexist. Defensive precedence ordering works; collapsing to a discriminated `view` enum is the more invariant-preserving refactor. `[noted for implementer — v1.5 refactor candidate]`
- [C2] `replaceState` exemption from the modal-state gate is not enumerated in the plan body for the new `SessionAlreadyOpen` rejection (vs PlayerExiled/ElopementInProgress, which ARE addressed). Load path silently discards orchestrator session (in-memory) regardless of view-side state. `[likely addressed]`
- [C2] `ExchangeSchema` is the canonical site; the duplicate inline enum in `ProxyConversationRequestSchema.history` could be replaced with `history: z.array(ExchangeSchema)` to eliminate the lockstep-edit obligation. `[noted for implementer — out-of-scope cleanup]`
- [C2] SaveVN site count: actual is 12 (V1-V12), not "15+" — all share the imported `ExchangeSchema` so no per-emitter edit is needed. The parenthetical count is misleading. `[safe to ignore — cosmetic]`
- [C2] `SCHEME_KINDS` module-load assertion citation `constants.ts:294` — actual line is 293 (minor drift). `[safe to ignore — cosmetic]`
- [C2] `bootstrapNpcMountFamily` is `void`-returning + Map-mutating while `bootstrapPlayerArtifactsForMigration` is GameState-in/GameState-out — inconsistent API shape for parallel concerns. `[noted for implementer — API consistency tradeoff documented]`
- [C2] Verification list lacks an explicit `v1-to-v12-chain.test.ts` re-baseline note (now that `fromSaveV12` wraps the NPC mount seeder, the chain-hash assertion needs both paths to call the helper for parity). `[likely addressed]`
- [C2] `exitPromenade` advances the tick on exit, unlike `exitBallroom` (which does NOT). NEW pattern — pin in CLAUDE.md additions as "tick-on-exit modal pattern" so future modes (Court Audience, etc.) follow one discipline. `[likely addressed]`
- [C2] Add a CLAUDE.md pin: "any future per-mode framing rides on per-turn `contents`; never on `systemInstruction` post-cache-create" — formalizes the cache-mutual-exclusion lesson from B1. `[likely addressed]`
- [C2] `pickPromenadePartner` returns `pool[idx] ?? null`; `idx < pool.length` is guaranteed by `drawInt`'s range, so `?? null` is unreachable but required by `noUncheckedIndexedAccess`. Consider explicit assertion + comment for clarity. `[safe to ignore — TS strict-mode required]`
- [C2] Orchestrator SessionState union snippet references `CharacterId` but the snippet's import line imports only `BallSessionId`/`makeBallSessionId`/`PromenadeSessionId`/`makePromenadeSessionId`. Implementer must add `CharacterId` to the import (already in scope elsewhere in the file but absent from the snippet-as-shown). `[noted for implementer]`
- [C2] 300+ char mode-framing prefix is a single inline string literal; consider extracting to a `PROMENADE_MODE_FRAMING_PREFIX` const in `server/prompts/` for testability. `[noted for implementer — testability polish]`
- [C3] `enterBallroom`'s SessionAlreadyOpen body snippet not enumerated alongside the union-widening — add the concrete `if (conversationOrchestrator.currentMode() === "Promenade") return { ok: false, reason: { kind: "SessionAlreadyOpen" } };` at the top of `enterBallroom` (verified at `src/game/store.ts:775-810`). `[noted for implementer]`
- [C3] `replaceState` modal-state behavior for promenade not pinned: the load path doesn't call `conversationOrchestrator.endSession()` defensively. After a mid-promenade load, `currentMode()` still returns "Promenade" until exitPromenade is called, which would reject `enterBallroom` with SessionAlreadyOpen even though no real session is live. `[likely addressed]`
- [C3] `bootstrapNpcMountFamily` only fires via `fromSaveV12` and `createInitialState`. Pin an inline comment in both sites + in the migration runner: "any V12-emitting path must also call `bootstrapNpcMountFamily` if NPC mounts aren't already seeded." `[noted for implementer]`
- [C3] Children/infants in eligible partner pool — UI tooltip / portrait card render needs at least an age label ("Lady Aldridge (12)") so the player isn't surprised. Or add an age floor (e.g., 14+) as a follow-up. `[noted for implementer — UX polish]`
- [C3] Mode-framing prefix exact-substring test: pin assertions on the load-bearing phrases "faux-pas penalties do NOT apply" and "Available tactics: WittyBanter, DeepEmpathy, ComplimentMount" so a future copy-edit can't silently drop the framing. `[noted for implementer]`
- [C3] Per-iteration `synthState` rebuild in `bootstrapNpcMountFamily` diverges from `computeStartingArtifactInstances`; pin an inline comment in the helper body explaining the per-iteration rationale, OR refactor `computeStartingArtifactInstances` to also use per-iteration rebuild (out of P12 scope). `[noted for implementer — inline comment is the in-scope fix]`
- [C3] Consider exporting `MOUNT_FAMILY` or a `partnerEquipsMount(state, partnerId): boolean` predicate from `rules/promenade.ts` so the UI's "ComplimentMount disabled" tooltip reads from a single source of truth. `[applied]`
- [C3] The 10-publisher snippet in `exitPromenade` duplicates code from 5+ other wrappers. Consider extracting `publishAllTickTransitions(before, after)` (out of P12 scope; duplication compounds with each new tick-advancing wrapper). `[safe to ignore — out of P12 scope]`
- [C3] Drop the `as unknown as GameState` cast in `bootstrapNpcMountFamily` and `computeStartingArtifactInstances` — widen `makeArtifactInstanceId`'s parameter to `{ artifactInstances: ReadonlyMap<ArtifactInstanceId, ArtifactInstance> }` (the only field it reads). `[noted for implementer — touches a P10 helper signature]`
- [C3] Pin a Vitest assertion that `pickPromenadePartner` returns RNG unchanged on empty pool (the rejection-path-cost-nothing semantics). `[noted for implementer]`
- [C3] `exitPromenade`'s elopement rationale at the edge-case section should tighten: `applySchemeResolutionPhase` IS where elopement mounts (a Seduction with discovery roll true). The prose currently says "cannot mount elopement" via the year-pass STEPS chain, but should say "CAN mount elopement if a pre-existing Seduction is configured to resolve at this exact tick." Plan accepts this v1; prose just needs to acknowledge it directly. `[noted for implementer — prose tighten on implementation]`
- [C3] Chain-test re-baseline: pin BOTH sides as explicit edit-diffs — the existing `expect(v12.artifactInstances).toHaveLength(3)` on the disk-side STAYS, while the new `expect(fromSaveV12(v12).artifactInstances.size).toBe(5)` adds at the lift-side. Two separate assertions in the same test file. `[likely addressed]`
- [C3] New file `src/runtime/__test-utils__/promenadeLlmMock.ts` needs an ESLint boundaries positive-control assertion enumerated alongside the existing boundary tests (the `runtime → llm` edge it imports across needs explicit verification per the recurring new-file boundary check pattern). `[noted for implementer]`
- [C4] `bootstrapNpcMountFamily` body uses the bare string literal `"mount"` for the family comparison; the rest of `rules/promenade.ts` uses the typed `MOUNT_FAMILY: ArtifactFamily = "mount"` constant. Either import `ArtifactFamily` into `bootstrap.ts` and use the typed literal, or reuse the `characterEquipsMountFamily` helper. `[applied]`
- [C4] `NPC_STARTING_MOUNT_FAMILY` shape (`{ characterId, definitionId }`) lacks `equippedFromStart` and `lastRefreshTick` fields that `PLAYER_STARTING_ARTIFACTS` carries. Parallel-array divergence. Either align shapes OR add an inline comment ("NPC mounts always equip; flag elided because there's no NPC unequipped-starting-artifact use case"). `[noted for implementer — inline comment is the in-scope fix]`
- [C4] `bootstrapPlayerArtifactsForInit` mutates `characters` in place AND returns `artifactInstances`. `bootstrapNpcMountFamily` mutates BOTH `characters` AND `artifactInstances` in place and returns void. Plan does NOT pin the in-place semantics in an inline comment — a future reorderer treating either function as immutable will silently break determinism. `[applied]`
- [C4] Pin a Vitest fixture that re-loads a save TWICE through `fromSaveV12` and asserts `bootstrapNpcMountFamily` is a no-op the second time (idempotency belt-and-braces beyond the same-call check). `[noted for implementer]`
- [C4] `getEffectiveReputation(state, INDEPENDENT_HOUSE_ID)` now reads +3 per equipped NPC mount (Mount artifact has `reputationBonusWhileEquipped: 3`). Single live consumer at `src/game/rules/artifacts.ts:442` is `PLAYER_HOUSE_ID`-gated, but a future phase that calls `getEffectiveReputation` on non-player houses needs to be aware of the +3 NPC-mount ripple. `[noted for implementer — future-phase ripple watch]`
- [C4] CLAUDE.md pin candidate: "NPC-side `equippedArtifactIds` are now populated at bootstrap; future fixture-seeded artifacts on NPCs must reuse `bootstrapNpcMountFamily`'s idempotency-guard pattern (registry-walk `alreadyEquipped` check + skip on match)." `[noted for implementer — CLAUDE.md additions candidate]`
- [C4] `BallEntryRejection`'s `SessionAlreadyOpen` widening needs user-facing copy at the banner site — enumerate the edit at whichever component renders `BallEntryRejection.kind === "SessionAlreadyOpen"`. `[noted for implementer — UX prose pass]`
- [C4] `Capital` literal in `MapView` / LocationDetailsPanel button-disable check should reference the `LocationId` union value, not a bare string compare. `[noted for implementer — type discipline]`
