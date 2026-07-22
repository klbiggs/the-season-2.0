// P12 Hyde Park Promenade rules unit tests. Covers all 5 entry points plus
// the read-side helpers. Pure-rules layer — no orchestrator, no UI, no store.

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeElopementSprint,
  makeGameState,
  makeHouse,
} from "../__test-utils__/factories";
import {
  PROMENADE_BASE_AFFECTION_COMPLIMENT_MOUNT,
  PROMENADE_BASE_AFFECTION_DEEP_EMPATHY,
  PROMENADE_BASE_AFFECTION_WITTY_BANTER,
  PROMENADE_PLAYER_MOUNT_MINGLE_BONUS,
} from "../constants";
import { makePairKey } from "../conversation/types";
import type { ArtifactInstance, GameState } from "../entities";
import { RIVAL_CHARACTER_IDS_SET } from "../fixtures/rivals";
import {
  type ArtifactDefinitionId,
  type ArtifactInstanceId,
  type CharacterId,
  type HouseId,
  PLAYER_HOUSE_ID,
  createRngState,
} from "../rng";
import {
  appendPromenadeExchange,
  ballroomRoster,
  canEnterPromenade,
  characterEquipsMountFamily,
  eligiblePromenadePartners,
  narrowToPromenadeTactic,
  pickPromenadePartner,
  playerHeadEquipsMountFamily,
  resolvePromenadeCombat,
  rollBallroomApproach,
} from "./promenade";

// Helpers ────────────────────────────────────────────────────────────────

function buildStateWithNpcs(opts?: {
  playerLocation?: "Capital" | "Country";
  npcIds?: ReadonlyArray<CharacterId>;
  exiled?: boolean;
}): GameState {
  const playerHeadId = "player-head" as CharacterId;
  const npcIds =
    opts?.npcIds ??
    (["npc-a", "npc-b", "npc-c"] as ReadonlyArray<string>).map((s) => s as CharacterId);
  const playerHead = makeCharacter({ id: playerHeadId, houseId: PLAYER_HOUSE_ID });
  const npcs = npcIds.map((id) =>
    makeCharacter({ id, houseId: "independent" as HouseId, alive: true }),
  );
  const characters = new Map<CharacterId, ReturnType<typeof makeCharacter>>();
  characters.set(playerHeadId, playerHead);
  for (const c of npcs) characters.set(c.id, c);
  const playerHouse = makeHouse({
    id: PLAYER_HOUSE_ID,
    headOfHouseCharacterId: playerHeadId,
    currentLocation: opts?.playerLocation ?? "Capital",
    exiled: opts?.exiled ?? false,
  });
  return makeGameState({
    characters,
    houses: new Map([[PLAYER_HOUSE_ID, playerHouse]]),
    rng: new Map([[PLAYER_HOUSE_ID, createRngState("test-seed")]]),
  });
}

function attachMountToCharacter(state: GameState, charId: CharacterId, instId: string): GameState {
  const char = state.characters.get(charId);
  if (char === undefined) throw new Error("attachMountToCharacter: char not found");
  const inst: ArtifactInstance = {
    id: instId as ArtifactInstanceId,
    definitionId: "mount" as ArtifactDefinitionId,
    ownerHouseId: char.houseId,
    ownerCharacterId: char.id,
    lastRefreshTick: 0,
    forgedFlag: false,
  };
  const newArtifactInstances = new Map(state.artifactInstances);
  newArtifactInstances.set(inst.id, inst);
  const newCharacters = new Map(state.characters);
  newCharacters.set(char.id, {
    ...char,
    equippedArtifactIds: [...char.equippedArtifactIds, inst.id],
  });
  return { ...state, characters: newCharacters, artifactInstances: newArtifactInstances };
}

// ── eligiblePromenadePartners ────────────────────────────────────────────

describe("eligiblePromenadePartners", () => {
  it("excludes the player house, dead characters, and rivals", () => {
    let state = buildStateWithNpcs({ npcIds: ["npc-a", "npc-b"] as CharacterId[] });
    // Add a dead NPC + a rival NPC.
    const deadId = "npc-dead" as CharacterId;
    const rivalId = [...RIVAL_CHARACTER_IDS_SET][0];
    if (rivalId === undefined) throw new Error("RIVAL_CHARACTER_IDS_SET is empty");
    const newChars = new Map(state.characters);
    newChars.set(
      deadId,
      makeCharacter({ id: deadId, houseId: "independent" as HouseId, alive: false }),
    );
    newChars.set(
      rivalId,
      makeCharacter({ id: rivalId, houseId: "rival-bingham" as HouseId, alive: true }),
    );
    state = { ...state, characters: newChars };
    const pool = eligiblePromenadePartners(state);
    expect(pool).toContain("npc-a" as CharacterId);
    expect(pool).toContain("npc-b" as CharacterId);
    expect(pool).not.toContain(deadId);
    expect(pool).not.toContain(rivalId);
    // Player head excluded too.
    expect(pool).not.toContain("player-head" as CharacterId);
  });

  it("returns the pool lex-sorted by CharacterId", () => {
    const state = buildStateWithNpcs({
      npcIds: ["npc-z", "npc-a", "npc-m"] as CharacterId[],
    });
    const pool = eligiblePromenadePartners(state);
    expect(pool).toEqual(["npc-a" as CharacterId, "npc-m" as CharacterId, "npc-z" as CharacterId]);
  });

  it("includes children (pre-adult) — matches ballroom precedent", () => {
    let state = buildStateWithNpcs({ npcIds: ["npc-a"] as CharacterId[] });
    const childId = "npc-child" as CharacterId;
    const newChars = new Map(state.characters);
    newChars.set(
      childId,
      makeCharacter({ id: childId, houseId: "independent" as HouseId, alive: true, age: 12 }),
    );
    state = { ...state, characters: newChars };
    const pool = eligiblePromenadePartners(state);
    expect(pool).toContain(childId);
  });
});

// ── pickPromenadePartner ────────────────────────────────────────────────

describe("pickPromenadePartner", () => {
  it("is deterministic given the same RNG state", () => {
    const state = buildStateWithNpcs({
      npcIds: ["npc-a", "npc-b", "npc-c"] as CharacterId[],
    });
    const r1 = pickPromenadePartner(state);
    const r2 = pickPromenadePartner(state);
    expect(r1.partnerId).toBe(r2.partnerId);
  });

  it("advances player RNG by exactly 1 callCount on success", () => {
    const state = buildStateWithNpcs({
      npcIds: ["npc-a", "npc-b"] as CharacterId[],
    });
    const before = state.rng.get(PLAYER_HOUSE_ID);
    expect(before).toBeDefined();
    const result = pickPromenadePartner(state);
    expect(result.partnerId).not.toBeNull();
    const after = result.nextState.rng.get(PLAYER_HOUSE_ID);
    expect(after).toBeDefined();
    expect(after?.callCount).toBe((before?.callCount ?? 0) + 1);
  });

  it("returns partnerId null + RNG unchanged when the pool is empty", () => {
    const state = buildStateWithNpcs({ npcIds: [] });
    const before = state.rng.get(PLAYER_HOUSE_ID);
    const result = pickPromenadePartner(state);
    expect(result.partnerId).toBeNull();
    const after = result.nextState.rng.get(PLAYER_HOUSE_ID);
    // RNG callCount NOT advanced on empty-pool rejection.
    expect(after?.callCount).toBe(before?.callCount);
  });
});

// ── canEnterPromenade ────────────────────────────────────────────────────

describe("canEnterPromenade", () => {
  it("returns ok at Capital with a non-exiled non-elopement player", () => {
    const state = buildStateWithNpcs();
    const result = canEnterPromenade(state);
    expect(result.ok).toBe(true);
  });

  it("rejects WrongLocation when not at Capital", () => {
    const state = buildStateWithNpcs({ playerLocation: "Country" });
    const result = canEnterPromenade(state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe("WrongLocation");
    }
  });

  it("rejects PlayerExiled when the player house is exiled", () => {
    const state = buildStateWithNpcs({ exiled: true });
    const result = canEnterPromenade(state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe("PlayerExiled");
    }
  });

  it("rejects ElopementInProgress when a player sprint is active", () => {
    const sprint = makeElopementSprint();
    const state = {
      ...buildStateWithNpcs(),
      elopements: new Map([[sprint.id, sprint]]),
    };
    const result = canEnterPromenade(state);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason.kind).toBe("ElopementInProgress");
    }
  });
});

// ── resolvePromenadeCombat ───────────────────────────────────────────────

describe("resolvePromenadeCombat", () => {
  it("returns affectionDelta = base × 1.0 for WittyBanter with quality=1.0 and no mount", () => {
    const out = resolvePromenadeCombat({
      tactic: "WittyBanter",
      qualityMultiplier: 1.0,
      targetHasMountFamilyEquipped: false,
      playerHasMountFamilyEquipped: false,
    });
    expect(out.affectionDelta).toBe(PROMENADE_BASE_AFFECTION_WITTY_BANTER);
    expect(out.composureDelta).toBe(0);
  });

  it("returns affectionDelta = base × 1.0 for DeepEmpathy with quality=1.0", () => {
    const out = resolvePromenadeCombat({
      tactic: "DeepEmpathy",
      qualityMultiplier: 1.0,
      targetHasMountFamilyEquipped: false,
      playerHasMountFamilyEquipped: false,
    });
    expect(out.affectionDelta).toBe(PROMENADE_BASE_AFFECTION_DEEP_EMPATHY);
  });

  it("returns affectionDelta = compliment-base for ComplimentMount when target equips mount", () => {
    const out = resolvePromenadeCombat({
      tactic: "ComplimentMount",
      qualityMultiplier: 1.0,
      targetHasMountFamilyEquipped: true,
      playerHasMountFamilyEquipped: false,
    });
    expect(out.affectionDelta).toBe(PROMENADE_BASE_AFFECTION_COMPLIMENT_MOUNT);
  });

  it("returns affectionDelta = 0 for ComplimentMount when target does NOT equip mount", () => {
    const out = resolvePromenadeCombat({
      tactic: "ComplimentMount",
      qualityMultiplier: 1.0,
      targetHasMountFamilyEquipped: false,
      playerHasMountFamilyEquipped: false,
    });
    expect(out.affectionDelta).toBe(0);
  });

  it("stacks the Mingle+mount bonus additively before quality modulation", () => {
    const out = resolvePromenadeCombat({
      tactic: "WittyBanter",
      qualityMultiplier: 1.0,
      targetHasMountFamilyEquipped: false,
      playerHasMountFamilyEquipped: true,
    });
    expect(out.affectionDelta).toBe(
      PROMENADE_BASE_AFFECTION_WITTY_BANTER + PROMENADE_PLAYER_MOUNT_MINGLE_BONUS,
    );
  });

  it("clamps qualityMultiplier defensively (floor)", () => {
    const out = resolvePromenadeCombat({
      tactic: "WittyBanter",
      qualityMultiplier: 0.0, // below floor (0.5)
      targetHasMountFamilyEquipped: false,
      playerHasMountFamilyEquipped: false,
    });
    expect(out.affectionDelta).toBe(Math.round(PROMENADE_BASE_AFFECTION_WITTY_BANTER * 0.5));
  });

  it("clamps qualityMultiplier defensively (ceil)", () => {
    const out = resolvePromenadeCombat({
      tactic: "WittyBanter",
      qualityMultiplier: 2.0, // above ceil (1.5)
      targetHasMountFamilyEquipped: false,
      playerHasMountFamilyEquipped: false,
    });
    expect(out.affectionDelta).toBe(Math.round(PROMENADE_BASE_AFFECTION_WITTY_BANTER * 1.5));
  });

  it("composure delta is ALWAYS 0 across every parametric combination", () => {
    const tactics = ["WittyBanter", "DeepEmpathy", "ComplimentMount"] as const;
    const qualities = [0.5, 1.0, 1.5];
    const bools = [false, true];
    for (const tactic of tactics) {
      for (const q of qualities) {
        for (const targetMount of bools) {
          for (const playerMount of bools) {
            const out = resolvePromenadeCombat({
              tactic,
              qualityMultiplier: q,
              targetHasMountFamilyEquipped: targetMount,
              playerHasMountFamilyEquipped: playerMount,
            });
            expect(out.composureDelta).toBe(0);
          }
        }
      }
    }
  });
});

// ── narrowToPromenadeTactic ─────────────────────────────────────────────

describe("narrowToPromenadeTactic", () => {
  it("passes through valid promenade tactics", () => {
    expect(narrowToPromenadeTactic("WittyBanter")).toBe("WittyBanter");
    expect(narrowToPromenadeTactic("DeepEmpathy")).toBe("DeepEmpathy");
    expect(narrowToPromenadeTactic("ComplimentMount")).toBe("ComplimentMount");
  });

  it("throws on out-of-set values (defense-in-depth)", () => {
    expect(() => narrowToPromenadeTactic("Flattery")).toThrow();
    expect(() => narrowToPromenadeTactic("SlyGossip")).toThrow();
    expect(() => narrowToPromenadeTactic("Nonsense")).toThrow();
  });
});

// ── characterEquipsMountFamily / playerHeadEquipsMountFamily ────────────

describe("characterEquipsMountFamily + playerHeadEquipsMountFamily", () => {
  it("returns false when the character equips nothing", () => {
    const state = buildStateWithNpcs();
    expect(playerHeadEquipsMountFamily(state)).toBe(false);
  });

  it("returns true when the player head equips a mount-family artifact", () => {
    let state = buildStateWithNpcs();
    state = attachMountToCharacter(state, "player-head" as CharacterId, "artifact-mount-0");
    expect(playerHeadEquipsMountFamily(state)).toBe(true);
  });

  it("characterEquipsMountFamily returns true for an NPC with an equipped mount", () => {
    let state = buildStateWithNpcs({ npcIds: ["npc-a"] as CharacterId[] });
    state = attachMountToCharacter(state, "npc-a" as CharacterId, "artifact-mount-1");
    const npc = state.characters.get("npc-a" as CharacterId);
    expect(npc).toBeDefined();
    if (npc !== undefined) {
      expect(characterEquipsMountFamily(state, npc.equippedArtifactIds)).toBe(true);
    }
  });
});

// ── appendPromenadeExchange ─────────────────────────────────────────────

describe("appendPromenadeExchange", () => {
  it("writes both speaker exchanges to history with the pinned tactic", () => {
    const state = buildStateWithNpcs();
    const partnerId = "npc-a" as CharacterId;
    const after = appendPromenadeExchange(
      state,
      partnerId,
      { text: "Hello.", classifiedTactic: "WittyBanter" },
      { text: "Indeed." },
      5,
      3,
    );
    const pairKey = makePairKey(PLAYER_HOUSE_ID, partnerId);
    const history = after.conversationHistory.get(pairKey);
    expect(history).toHaveLength(2);
    expect(history?.[0]?.speaker).toBe("house-head");
    expect(history?.[0]?.classifiedTactic).toBe("WittyBanter");
    expect(history?.[1]?.speaker).toBe("other");
    expect(history?.[1]?.classifiedTactic).toBeNull();
  });

  it("clamps affection to [0, 100] at the mutation site", () => {
    const state = buildStateWithNpcs();
    const partnerId = "npc-a" as CharacterId;
    // Pre-seed affection at 95; +10 would land at 105 but clamp to 100.
    const pairKey = makePairKey(PLAYER_HOUSE_ID, partnerId);
    const seeded = {
      ...state,
      affectionMap: new Map([[pairKey, 95]]),
    };
    const after = appendPromenadeExchange(
      seeded,
      partnerId,
      { text: "Hi", classifiedTactic: "WittyBanter" },
      { text: "Hi" },
      10,
      1,
    );
    expect(after.affectionMap.get(pairKey)).toBe(100);
  });
});

// ── ballroomRoster + rollBallroomApproach (P26 Q14 ballroom-approach) ──────

describe("ballroomRoster", () => {
  it("returns alive society-house NPCs in lex-sorted CharacterId order", () => {
    const state = buildStateWithNpcs({
      npcIds: ["npc-c", "npc-a", "npc-b"] as CharacterId[],
    });
    expect(ballroomRoster(state)).toEqual(["npc-a", "npc-b", "npc-c"]);
  });

  it("excludes the player house + dead NPCs", () => {
    let state = buildStateWithNpcs({ npcIds: ["npc-a", "npc-b"] as CharacterId[] });
    const dead = state.characters.get("npc-b" as CharacterId);
    if (dead !== undefined) {
      const chars = new Map(state.characters);
      chars.set(dead.id, { ...dead, alive: false });
      state = { ...state, characters: chars };
    }
    const roster = ballroomRoster(state);
    expect(roster).toEqual(["npc-a"]);
    expect(roster).not.toContain("player-head");
  });
});

describe("rollBallroomApproach", () => {
  it("is deterministic — same seed produces the same approacher + rng", () => {
    const state = buildStateWithNpcs();
    const a = rollBallroomApproach(state);
    const b = rollBallroomApproach(state);
    expect(a.approachingCharacterId).toBe(b.approachingCharacterId);
    expect(a.nextState.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(
      b.nextState.rng.get(PLAYER_HOUSE_ID)?.callCount,
    );
  });

  it("ALWAYS burns at least the trigger draw (rng callCount advances)", () => {
    const state = buildStateWithNpcs();
    const before = state.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    const { nextState } = rollBallroomApproach(state);
    const after = nextState.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    expect(after).toBeGreaterThanOrEqual(before + 1);
  });

  it("burns the trigger draw but returns null on an empty roster", () => {
    const state = buildStateWithNpcs({ npcIds: [] });
    const before = state.rng.get(PLAYER_HOUSE_ID)?.callCount ?? 0;
    const { nextState, approachingCharacterId } = rollBallroomApproach(state);
    expect(approachingCharacterId).toBeNull();
    expect(nextState.rng.get(PLAYER_HOUSE_ID)?.callCount).toBe(before + 1);
  });

  it("an approacher (when picked) is always a roster member", () => {
    // Sweep many seeds; every non-null approacher must be on the lex-sorted roster.
    const roster = ballroomRoster(buildStateWithNpcs());
    for (const seed of ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"]) {
      const state = buildStateWithNpcs();
      const seeded = { ...state, rng: new Map([[PLAYER_HOUSE_ID, createRngState(seed)]]) };
      const { approachingCharacterId } = rollBallroomApproach(seeded);
      if (approachingCharacterId !== null) {
        expect(roster).toContain(approachingCharacterId);
      }
    }
  });
});
