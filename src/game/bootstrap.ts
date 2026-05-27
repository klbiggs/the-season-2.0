// Single source of truth for starting-family construction. Called by
// createInitialState (fresh-state path). Must be byte-identical shared
// bootstrap math so a fresh campaign hashes deterministically across runs.
//
// P4: returns PLURAL arrays { rngState, houses, characters } so both the
// player house AND the Independent house's 5 baseline NPCs can be seeded
// in one call. Both arrays are in deterministic order: houses[0] is the
// player house, houses[1] is Independent. characters[0] is the player
// head, characters[1..5] are the 5 NPCs in BASELINE_NPCS order.
//
// NPC deathAges are CONSTANTS from the BASELINE_NPCS fixture — ZERO RNG
// draws for NPC construction. The bootstrap draw budget stays at 1
// (player head's deathAge only), unchanged from P3.

import {
  HAPPINESS_INITIAL,
  LIFESPAN_RANGE,
  NON_PLAYER_FORGED_INSTANCE_PCT,
  PROCEDURAL_ARTIFACT_DEF_COUNT,
  PROCEDURAL_NPC_COUNT,
  SOCIETY_ARTIFACT_HOLDER_COUNT,
} from "./constants";
import type {
  ArtifactInstance,
  Character,
  ForgeryRecord,
  GameState,
  House,
  RivalActorState,
  StaffMember,
} from "./entities";
import {
  type ArtifactDefinition,
  NPC_STARTING_MOUNT_FAMILY,
  PLAYER_STARTING_ARTIFACTS,
  makeArtifactInstanceId,
  makeForgeryId,
  resolveArtifactDefinition,
} from "./fixtures/artifacts";
import { hashCharIdToGender } from "./fixtures/hashCharIdToGender";
import { STARTING_HEAD_CHARACTER_ID, STARTING_HEAD_NAME } from "./fixtures/names";
import { BASELINE_NPCS, buildBaselineNpcCharacter, buildIndependentHouse } from "./fixtures/npcs";
import {
  RIVAL_HOUSES_FIXTURE,
  RIVAL_HOUSE_IDS_SET,
  buildRivalActorState,
  buildRivalCharacter,
  buildRivalHouse,
  buildRivalRngState,
} from "./fixtures/rivals";
import { BASELINE_STAFF, buildBaselineStaffMember } from "./fixtures/staff";
import {
  type ArtifactDefinitionId,
  type ArtifactInstanceId,
  type CharacterId,
  type FactionId,
  type ForgeryId,
  type HouseId,
  type RngState,
  createRngState,
  drawInt,
} from "./rng";
import { PLAYER_HOUSE_ID } from "./rng";
import { generateArtifactDefinitions } from "./rules/proceduralArtifacts";
import { PROCEDURAL_NPC_ID_PREFIX } from "./rules/proceduralNpcs";
import { generateSocietyNpcs } from "./rules/proceduralNpcs";
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
  // P24b (E1): procedurally-generated artifact definitions. Drawn from a
  // transient sub-stream (discarded) and persisted into state.
  proceduralArtifactDefinitions: ReadonlyArray<ArtifactDefinition>;
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
    // P3 additions.
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
    // P13: no Later-era courier research at fresh state. Flipped true by
    // researchFastCouriers store action once era flips.
    courierResearchEarned: false,
    // P15: no perks / zeroed counters at fresh state (going-forward-only, §10 OQ#22).
    awardedDynastyPerks: [],
    consecutiveHeirsNaturalDeath: 0,
    cumulativeSuccessfulSeductions: 0,
    cumulativeWeaponizedWhispers: 0,
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

  // P16: procedural society batch. Drawn from a TRANSIENT sub-stream
  // (`${campaignSeed}|procedural-npcs`) that is consumed here and discarded —
  // never added to state.rng, so the player rngState return is unchanged. Era
  // is pinned to "Earlier" (founding era) so society generation is
  // deterministic across runs.
  const societyNpcs = generateSocietyNpcs(
    createRngState(`${campaignSeed}|procedural-npcs`),
    "Earlier",
    PROCEDURAL_NPC_COUNT,
  ).characters;

  // P24b (E1): procedural artifact definitions. Drawn from a SEPARATE transient
  // sub-stream (`${campaignSeed}|procedural-artifacts`) consumed here and
  // discarded — never added to state.rng (mirrors the |procedural-npcs pattern).
  const proceduralArtifactDefinitions = generateArtifactDefinitions(
    createRngState(`${campaignSeed}|procedural-artifacts`),
    PROCEDURAL_ARTIFACT_DEF_COUNT,
  ).definitions;

  return {
    rngState: postDeathRoll,
    houses: [playerHouse, independentHouse, ...rivalHouses],
    characters: [playerCharacter, ...npcs, ...rivalCharacters, ...societyNpcs],
    staff,
    rivalActors,
    rivalRngEntries,
    proceduralArtifactDefinitions,
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
  // synthState carries an empty proceduralArtifactDefinitions — player starters
  // are all fixture defs, so resolveArtifactDefinition's fixture half resolves
  // (the `??` never reaches the procedural map). The empty Map keeps the
  // resolver non-throwing regardless.
  const synthState = {
    artifactInstances: new Map(existing),
    proceduralArtifactDefinitions: new Map(),
  } as unknown as GameState;
  const result: ArtifactInstance[] = [];
  for (const starter of PLAYER_STARTING_ARTIFACTS) {
    const def = resolveArtifactDefinition(synthState, starter.definitionId);
    if (!def) {
      throw new Error(
        `bootstrapPlayerArtifacts: definition ${starter.definitionId} missing from ARTIFACT_REGISTRY`,
      );
    }
    const id = makeArtifactInstanceId(synthState, def.id);
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
//   2. fromSaveV1 (live load path).
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
    // resolveState carries an empty proceduralArtifactDefinitions — NPC mounts
    // are fixture defs, so the resolver's fixture half resolves.
    const resolveState = {
      artifactInstances,
      proceduralArtifactDefinitions: new Map(),
    } as unknown as GameState;
    const alreadyEquipped = npc.equippedArtifactIds.some((instId) => {
      const inst = artifactInstances.get(instId);
      if (inst === undefined) return false;
      const def = resolveArtifactDefinition(resolveState, inst.definitionId);
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

// P24b (E6): seed equipped procedural artifact instances into NON-PLAYER houses
// at bootstrap. One instance per eligible owner — each rival house head + the
// first SOCIETY_ARTIFACT_HOLDER_COUNT alive society NPCs (lex by id). Drawn from
// a TRANSIENT sub-stream (`${campaignSeed}|procedural-artifact-instances`)
// consumed here and discarded (never added to state.rng — mirrors the
// |procedural-npcs / |procedural-artifacts pattern). A forgeable pick may be
// flagged forged (→ a ForgeryRecord), giving E3 Observant detection + the
// surfacing cascade a live non-player target. Mutates characters +
// artifactInstances + forgeries IN PLACE. Fixed 2-draw budget per owner
// (definition pick + forged gate). Runs ONLY at createInitialState — the minted
// instances persist in the save and re-read verbatim on load (no re-seed).
export function bootstrapNonPlayerArtifactsForInit(
  characters: Map<CharacterId, Character>,
  houses: ReadonlyMap<HouseId, House>,
  proceduralArtifactDefinitions: ReadonlyMap<ArtifactDefinitionId, ArtifactDefinition>,
  artifactInstances: Map<ArtifactInstanceId, ArtifactInstance>,
  forgeries: Map<ForgeryId, ForgeryRecord>,
  campaignSeed: string,
  tick: number,
): void {
  const definitions = [...proceduralArtifactDefinitions.values()].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  if (definitions.length === 0) return;

  // Eligible owners, lex within each group: rival house heads, then society NPCs.
  const owners: Character[] = [];
  for (const houseId of [...houses.keys()].sort((a, b) => a.localeCompare(b))) {
    if (!RIVAL_HOUSE_IDS_SET.has(houseId)) continue;
    const house = houses.get(houseId);
    if (house === undefined) continue;
    const head = characters.get(house.headOfHouseCharacterId);
    if (head?.alive) owners.push(head);
  }
  const society = [...characters.values()]
    .filter((c) => c.id.startsWith(PROCEDURAL_NPC_ID_PREFIX) && c.alive)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, SOCIETY_ARTIFACT_HOLDER_COUNT);
  owners.push(...society);

  let rng = createRngState(`${campaignSeed}|procedural-artifact-instances`);
  for (const owner of owners) {
    const defPick = drawInt(rng, definitions.length);
    rng = defPick.rngState;
    const forgedGate = drawInt(rng, 100);
    rng = forgedGate.rngState;
    const def = definitions[defPick.next];
    if (def === undefined) continue;
    const forged = def.forgeable && forgedGate.next < NON_PLAYER_FORGED_INSTANCE_PCT;
    const synth = { artifactInstances: new Map(artifactInstances) } as unknown as GameState;
    const instId = makeArtifactInstanceId(synth, def.id);
    artifactInstances.set(instId, {
      id: instId,
      definitionId: def.id,
      ownerHouseId: owner.houseId,
      ownerCharacterId: owner.id,
      lastRefreshTick: tick,
      forgedFlag: forged,
    });
    characters.set(owner.id, {
      ...owner,
      equippedArtifactIds: [...owner.equippedArtifactIds, instId],
    });
    if (forged) {
      const synthF = { forgeries: new Map(forgeries) } as unknown as GameState;
      const forgeryId = makeForgeryId(synthF, instId);
      forgeries.set(forgeryId, {
        id: forgeryId,
        forgedArtifactInstanceId: instId,
        forgerCharacterId: owner.id,
        forgedAtTick: tick,
        surfaced: false,
        surfacedAtTick: null,
      });
    }
  }
}
