// Single source of truth for starting-family construction. Called by both
// createInitialState (fresh-state path) and migrate_v1_to_v2 (legacy save
// upgrade path). The parity invariant — `hashState(createInitialState(seed))
// === hashState(fromSaveV2(migrate_v1_to_v2(saveV1WithSeed)))` when
// SaveV1.callCount = 0 — depends on this helper being the byte-identical
// shared bootstrap math.
//
// P4: returns PLURAL arrays { rngState, houses, characters } so both the
// player house AND the Independent house's 5 baseline NPCs can be seeded
// in one call. Both arrays are in deterministic order: houses[0] is the
// player house, houses[1] is Independent. characters[0] is the player
// head, characters[1..5] are the 5 NPCs in BASELINE_NPCS order.
// migrate_v1_to_v2 filters to player-only (V2 saves predate Independent);
// createInitialState includes both.
//
// NPC deathAges are CONSTANTS from the BASELINE_NPCS fixture — ZERO RNG
// draws for NPC construction. The bootstrap draw budget stays at 1
// (player head's deathAge only), unchanged from P3.

import { HAPPINESS_INITIAL, LIFESPAN_RANGE } from "./constants";
import type {
  ArtifactInstance,
  Character,
  GameState,
  House,
  RivalActorState,
  StaffMember,
} from "./entities";
import {
  ARTIFACT_REGISTRY,
  NPC_STARTING_MOUNT_FAMILY,
  PLAYER_STARTING_ARTIFACTS,
  makeArtifactInstanceId,
} from "./fixtures/artifacts";
import { hashCharIdToGender } from "./fixtures/hashCharIdToGender";
import { STARTING_HEAD_CHARACTER_ID, STARTING_HEAD_NAME } from "./fixtures/names";
import { BASELINE_NPCS, buildBaselineNpcCharacter, buildIndependentHouse } from "./fixtures/npcs";
import {
  RIVAL_HOUSES_FIXTURE,
  buildRivalActorState,
  buildRivalCharacter,
  buildRivalHouse,
  buildRivalRngState,
} from "./fixtures/rivals";
import { BASELINE_STAFF, buildBaselineStaffMember } from "./fixtures/staff";
import {
  type ArtifactInstanceId,
  type CharacterId,
  type FactionId,
  type HouseId,
  type RngState,
  drawInt,
} from "./rng";
import { PLAYER_HOUSE_ID } from "./rng";
import { MOUNT_FAMILY } from "./rules/promenade";

export function seedStartingFamily(
  rngState: RngState,
  campaignSeed: string,
): {
  rngState: RngState;
  houses: ReadonlyArray<House>;
  characters: ReadonlyArray<Character>;
  staff: ReadonlyArray<StaffMember>;
  // P8 additions — bootstrap also seeds rival actors + per-rival RNG entries.
  // The migration path produces byte-identical structures via the V8→V9 seeder.
  rivalActors: ReadonlyArray<RivalActorState>;
  rivalRngEntries: ReadonlyArray<[HouseId, RngState]>;
} {
  // Roll deathAge ∈ [70, 95] inclusive via drawInt(_, 26) + 70.
  // This is the ONLY draw consumed by this helper (NPC deathAges are
  // constants from the fixture). callCount advances by 1.
  const range = LIFESPAN_RANGE[1] - LIFESPAN_RANGE[0] + 1; // = 26
  const { next: deathOffset, rngState: postDeathRoll } = drawInt(rngState, range);
  const deathAge = deathOffset + LIFESPAN_RANGE[0];

  const playerCharacter: Character = {
    id: STARTING_HEAD_CHARACTER_ID,
    houseId: PLAYER_HOUSE_ID,
    name: STARTING_HEAD_NAME,
    birthTick: 0, // campaign-start head
    age: 25,
    deathAge,
    alive: true,
    diedAtTick: null,
    mood: "Receptive",
    moodLockUntilTick: 0,
    role: "HeadOfHouse",
    archetype: "None",
    traits: [],
    marriageId: null,
    composure: 100,
    maxComposure: 100,
    // P7 defaults. Gender derived from FNV-1a hash (same source-of-truth as
    // legacy-lift path) so v1→v8 chain hash parity holds. parentCharacterIds
    // is null for the campaign-start head (pre-history parents).
    happiness: HAPPINESS_INITIAL,
    temptationHookUnlocked: false,
    assignedTutorCharacterId: null,
    tutorBonusTraitGranted: false,
    dullSpouseExposureStartTick: null,
    parentCharacterIds: null,
    gender: hashCharIdToGender(STARTING_HEAD_CHARACTER_ID),
    // P10: empty by default; bootstrapPlayerArtifactsForInit mutates this
    // in-place when called from createInitialState.
    equippedArtifactIds: [],
  };

  const playerHouse: House = {
    id: PLAYER_HOUSE_ID,
    wealth: 100,
    reputation: 50,
    scandal: 0,
    headOfHouseCharacterId: STARTING_HEAD_CHARACTER_ID,
    generation: 0,
    ancestorSummary: [],
    heirless: false,
    // P3 additions — defaults match migrate_v3_to_v4's lift values so a
    // fresh-state + serialized-to-v4 hash equals a migrated-v3-to-v4 hash.
    currentLocation: "Capital",
    consecutiveTicksAtCurrentLocation: 0,
    lastAudienceTick: null,
    wardrobeLastRefreshTick: null,
    blockadeBypassEarned: false,
    // P5: empty grievance list at fresh state. Symmetric with the V6 lift
    // (defaultHouseV4Fields/defaultHouseV6Fields both default this to []).
    grievances: [],
    // P6: not exiled at fresh state. Symmetric with defaultHouseV*Fields
    // helpers in schema.ts.
    exiled: false,
    // P8: player house is on the Crown faction; hostility 0 (load-bearing
    // only on rival entries — predicate reads House.hostility for rivals).
    hostility: 0,
    factionId: "faction-crown" as FactionId,
    // P11: empty ledgers at fresh state. Sibling-rivals only mint on succession
    // (year-pass STEPS slot 4). Inherited secrets accumulate from succession.
    // Blood feuds open via inherited-secret surfacing rolls.
    siblingRivals: [],
    inheritedSecrets: [],
    bloodFeuds: [],
  };

  // P4: Independent house + 5 NPCs. Built from constants — no RNG draws.
  const independentHouse = buildIndependentHouse();
  const npcs = BASELINE_NPCS.map(buildBaselineNpcCharacter);
  // P6: 4 baseline household staff. Built from constants — no RNG draws.
  // Draw budget preserved: only the player deathAge draw above consumes RNG.
  const staff = BASELINE_STAFF.map(buildBaselineStaffMember);

  // P8: 3 rival houses + 9 rival-associated characters + 3 per-rival RNG
  // entries + 3 RivalActorState entries. Built from constants — no RNG draws.
  // Per-rival seed = `${campaignSeed}|${houseId}` (string-concat, engine-stable).
  const rivalHouses: House[] = [];
  const rivalCharacters: Character[] = [];
  const rivalActors: RivalActorState[] = [];
  const rivalRngEntries: [HouseId, RngState][] = [];
  for (const seed of RIVAL_HOUSES_FIXTURE) {
    rivalHouses.push(buildRivalHouse(seed));
    // Head is adult (age 35); associated chars are adults (age 30).
    rivalCharacters.push(buildRivalCharacter(seed.headSeed, seed.houseId, "HeadOfHouse", 35));
    rivalCharacters.push(
      buildRivalCharacter(seed.associatedSeeds[0], seed.houseId, "Dependent", 30),
    );
    rivalCharacters.push(
      buildRivalCharacter(seed.associatedSeeds[1], seed.houseId, "Dependent", 30),
    );
    rivalActors.push(buildRivalActorState(seed));
    rivalRngEntries.push([seed.houseId, buildRivalRngState(campaignSeed, seed.houseId)]);
  }

  return {
    rngState: postDeathRoll,
    houses: [playerHouse, independentHouse, ...rivalHouses],
    characters: [playerCharacter, ...npcs, ...rivalCharacters],
    staff,
    rivalActors,
    rivalRngEntries,
  };
}

// ─── P10: Artifact bootstrap helpers ─────────────────────────────────────
//
// Two exported variants sharing a private core. The split is necessary because
// createInitialState builds GameState as a single literal — it needs a helper
// that mutates the in-flight `characters` Map AND returns the seeded
// artifactInstances Map (so the literal can reference it). The migration path
// threads GameState; it needs a state-in/state-out helper.

// Internal helper — computes the 3 ArtifactInstance literals with deterministic
// ids. Walks the existing artifactInstances map for per-definitionId index
// counting (always returns 0 from an empty Map; the walker is robust to future
// extensions where this helper might run on top of existing state).
function computeStartingArtifactInstances(
  existing: ReadonlyMap<ArtifactInstanceId, ArtifactInstance>,
  headCharId: CharacterId,
  playerHouseId: HouseId,
  _tick: number,
): ArtifactInstance[] {
  const synthState: { artifactInstances: Map<ArtifactInstanceId, ArtifactInstance> } = {
    artifactInstances: new Map(existing),
  };
  const result: ArtifactInstance[] = [];
  for (const starter of PLAYER_STARTING_ARTIFACTS) {
    const def = ARTIFACT_REGISTRY.get(starter.definitionId);
    if (!def) {
      throw new Error(
        `bootstrapPlayerArtifacts: definition ${starter.definitionId} missing from ARTIFACT_REGISTRY`,
      );
    }
    const id = makeArtifactInstanceId(synthState as unknown as GameState, def.id);
    const inst: ArtifactInstance = {
      id,
      definitionId: def.id,
      ownerHouseId: playerHouseId,
      ownerCharacterId: headCharId,
      lastRefreshTick: starter.lastRefreshTick,
      forgedFlag: false,
    };
    synthState.artifactInstances.set(id, inst);
    result.push(inst);
  }
  return result;
}

// Used by createInitialState (store.ts). Mutates the local `characters` Map
// IN PLACE (appends to the player head's equippedArtifactIds). Returns the
// seeded artifactInstances Map for the createInitialState return literal.
export function bootstrapPlayerArtifactsForInit(
  characters: Map<CharacterId, Character>,
  houses: ReadonlyMap<HouseId, House>,
  tick: number,
): Map<ArtifactInstanceId, ArtifactInstance> {
  const player = houses.get(PLAYER_HOUSE_ID);
  if (!player) {
    throw new Error("bootstrapPlayerArtifactsForInit: player house not in `houses` map");
  }
  const headChar = characters.get(player.headOfHouseCharacterId);
  if (!headChar) {
    throw new Error(
      "bootstrapPlayerArtifactsForInit: player head character not in `characters` map",
    );
  }
  const artifactInstances = new Map<ArtifactInstanceId, ArtifactInstance>();
  const instances = computeStartingArtifactInstances(
    artifactInstances,
    headChar.id,
    player.id,
    tick,
  );
  const equippedIds: ArtifactInstanceId[] = [];
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    const starter = PLAYER_STARTING_ARTIFACTS[i];
    if (inst === undefined || starter === undefined) continue;
    artifactInstances.set(inst.id, inst);
    if (starter.equippedFromStart) equippedIds.push(inst.id);
  }
  characters.set(headChar.id, { ...headChar, equippedArtifactIds: equippedIds });
  return artifactInstances;
}

// P12: Idempotent NPC mount-family bootstrap. Mutates `characters` IN PLACE
// (appends to each named NPC's equippedArtifactIds) AND mutates
// `artifactInstances` IN PLACE (adds new ArtifactInstance entries). Returns
// void — the Map mutations are the contract. A future maintainer treating
// either map as immutable will silently break determinism; this in-place
// semantics matches `bootstrapPlayerArtifactsForInit` above.
//
// IDEMPOTENT: per-iteration `alreadyEquipped` check via the registry walk
// skips NPCs that already equip a mount-family instance. The load-resave-
// reload chain is therefore stable: first load seeds; second load is a no-op.
//
// Called from TWO sites:
//   1. createInitialState (fresh state path).
//   2. fromSaveV12 (live load path; legacy lifts reach this via the chain).
//
// Per-iteration synthState rebuild inside the for-loop is the canonical
// pattern here — each iteration freshly clones the LIVE `artifactInstances`
// Map, so consecutive seeds see the just-minted instance via the prior
// iteration's `artifactInstances.set` write. Single `.set` per iteration +
// per-iteration synthState rebuild = collision-free IDs across N seeds.
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
      // Typed `MOUNT_FAMILY` constant from rules/promenade.ts — single source
      // of truth (avoids a parallel "mount" literal in this file).
      return def?.family === MOUNT_FAMILY;
    });
    if (alreadyEquipped) continue;
    // Mint a fresh ArtifactInstance owned by this NPC + this NPC's house.
    // Synthstate is rebuilt per iteration so the factory's index walk sees
    // prior iterations' just-minted instances via the live-Map write below.
    const synthState = {
      artifactInstances: new Map(artifactInstances),
    } as unknown as GameState;
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
    characters.set(npc.id, {
      ...npc,
      equippedArtifactIds: [...npc.equippedArtifactIds, instId],
    });
  }
}

// Used by migrate_v10_to_v11 and the fromSaveV1..V11 outer wraps. Pure
// state-in/state-out. IDEMPOTENT — if the player head already has any
// equippedArtifactIds OR state.artifactInstances is non-empty, returns
// state unchanged for the player-side seeding (the migration-runner
// double-call path is safe).
//
// P12: ALSO threads through bootstrapNpcMountFamily so legacy lifts gain
// the same NPC mount seeding as the fresh-state path. Each helper is
// independently idempotent, so the call order is symmetric — player first
// (so the per-definitionId counter for "mount" lands at 0 for the player
// head, 1+2 for NPCs).
// No `seed` parameter — starting inventory is deterministic via
// PLAYER_STARTING_ARTIFACTS + NPC_STARTING_MOUNT_FAMILY + lex-sorted ids.
export function bootstrapPlayerArtifactsForMigration(state: GameState): GameState {
  // Player-artifact seeding. Guarded by the same "already seeded?" checks
  // as before P12 — skipped when state.artifactInstances has any entries
  // or the player head already equips anything.
  const player = state.houses.get(PLAYER_HOUSE_ID);
  if (!player) return state;
  const headChar = state.characters.get(player.headOfHouseCharacterId);
  if (!headChar) return state;

  const newArtifactInstances = new Map(state.artifactInstances);
  const newCharacters = new Map(state.characters);
  const playerAlreadySeeded =
    state.artifactInstances.size > 0 || headChar.equippedArtifactIds.length > 0;

  if (!playerAlreadySeeded) {
    const instances = computeStartingArtifactInstances(
      state.artifactInstances,
      headChar.id,
      player.id,
      state.tick,
    );
    const equippedIds: ArtifactInstanceId[] = [];
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i];
      const starter = PLAYER_STARTING_ARTIFACTS[i];
      if (inst === undefined || starter === undefined) continue;
      newArtifactInstances.set(inst.id, inst);
      if (starter.equippedFromStart) equippedIds.push(inst.id);
    }
    newCharacters.set(headChar.id, { ...headChar, equippedArtifactIds: equippedIds });
  }

  // P12: NPC mount seeding (per-NPC idempotent via the helper's
  // alreadyEquipped check). Always invoked — re-calls on already-seeded
  // NPCs are no-ops.
  bootstrapNpcMountFamily(newCharacters, newArtifactInstances, state.tick);

  return {
    ...state,
    artifactInstances: newArtifactInstances,
    characters: newCharacters,
  };
}
