// P11 verification matrix #17: pruneOrphanedConversationKeys branches 9 + 10.

import { describe, expect, it } from "vitest";
import {
  makeCharacter,
  makeCharactersMap,
  makeGameState,
  makeHouse,
  makeHousesMap,
} from "../__test-utils__/factories";
import type { BloodFeud, RivalActorState, SiblingRivalState } from "../entities";
import {
  type BloodFeudId,
  type CharacterId,
  type FactionId,
  type GrievanceId,
  type HouseId,
  type InheritedSecretId,
  PLAYER_HOUSE_ID,
  type SiblingRivalActorId,
} from "../rng";
import { pruneOrphanedConversationKeys } from "./aging";

describe("pruneOrphanedConversationKeys — P11 branch 9 (sibling-rival actor cleanup)", () => {
  it("removes sibling-rival entry when the character dies", () => {
    const deadChar = makeCharacter({ id: "sib" as CharacterId, alive: false });
    const survivor = makeCharacter({ id: "live-sib" as CharacterId, alive: true });
    const actorDead: SiblingRivalState = {
      id: "siblingRival-sib" as SiblingRivalActorId,
      characterId: deadChar.id,
      hostility: 50,
      lastActionTick: 0,
      reconciled: false,
      promotedAtTick: 0,
    };
    const actorAlive: SiblingRivalState = {
      id: "siblingRival-live-sib" as SiblingRivalActorId,
      characterId: survivor.id,
      hostility: 30,
      lastActionTick: 0,
      reconciled: false,
      promotedAtTick: 0,
    };
    const state = makeGameState({
      characters: makeCharactersMap([deadChar, survivor]),
      houses: makeHousesMap([makeHouse({ siblingRivals: [actorDead, actorAlive] })]),
    });
    const next = pruneOrphanedConversationKeys(state, new Set([deadChar.id]));
    const playerAfter = next.houses.get(PLAYER_HOUSE_ID);
    expect(playerAfter?.siblingRivals).toHaveLength(1);
    expect(playerAfter?.siblingRivals[0]?.characterId).toBe(survivor.id);
  });

  it("is a no-op when dead character is not a sibling-rival actor", () => {
    const dead = makeCharacter({ id: "random" as CharacterId, alive: false });
    const state = makeGameState({
      characters: makeCharactersMap([dead]),
      houses: makeHousesMap([makeHouse({ siblingRivals: [] })]),
    });
    const next = pruneOrphanedConversationKeys(state, new Set([dead.id]));
    expect(next.houses.get(PLAYER_HOUSE_ID)?.siblingRivals).toEqual([]);
  });
});

describe("pruneOrphanedConversationKeys — P11 branch 10 (rival die-out blood-feud auto-resolve)", () => {
  it("auto-resolves Active blood-feud when ALL rival associates die", () => {
    const rivalHouseId = "rival-ashford" as HouseId;
    const a1 = makeCharacter({
      id: "rival-ashford-a1" as CharacterId,
      alive: false,
      houseId: rivalHouseId,
    });
    const a2 = makeCharacter({
      id: "rival-ashford-a2" as CharacterId,
      alive: false,
      houseId: rivalHouseId,
    });
    const a3 = makeCharacter({
      id: "rival-ashford-a3" as CharacterId,
      alive: false,
      houseId: rivalHouseId,
    });
    const feud: BloodFeud = {
      id: "feud-1" as BloodFeudId,
      offendingHouseId: rivalHouseId,
      triggeringSecretId: "s1" as InheritedSecretId,
      triggeringGrievanceId: "g1" as GrievanceId,
      incurredAtTick: 10,
      resolved: false,
      resolvedAtTick: null,
      resolutionKind: null,
    };
    const rivalActor: RivalActorState = {
      houseId: rivalHouseId,
      factionId: "faction-court" as FactionId,
      associatedCharacterIds: [a1.id, a2.id, a3.id],
      lastActionTick: null,
    };
    const playerHouse = makeHouse({ bloodFeuds: [feud] });
    const rivalHouse = makeHouse({ id: rivalHouseId });
    const state = makeGameState({
      characters: makeCharactersMap([a1, a2, a3]),
      houses: makeHousesMap([playerHouse, rivalHouse]),
      rivalActors: new Map([[rivalHouseId, rivalActor]]),
      tick: 25,
    });
    // All three rival associates die same call → die-out predicate fires.
    const next = pruneOrphanedConversationKeys(state, new Set([a1.id, a2.id, a3.id]));
    const playerAfter = next.houses.get(PLAYER_HOUSE_ID);
    expect(playerAfter?.bloodFeuds[0]?.resolved).toBe(true);
    expect(playerAfter?.bloodFeuds[0]?.resolutionKind).toBe("GenerationalDecay");
    expect(playerAfter?.bloodFeuds[0]?.resolvedAtTick).toBe(25);
  });

  it("does NOT auto-resolve when at least one rival associate remains alive", () => {
    const rivalHouseId = "rival-ashford" as HouseId;
    const dead = makeCharacter({
      id: "rival-ashford-a1" as CharacterId,
      alive: false,
      houseId: rivalHouseId,
    });
    const alive = makeCharacter({
      id: "rival-ashford-a2" as CharacterId,
      alive: true,
      houseId: rivalHouseId,
    });
    const feud: BloodFeud = {
      id: "feud-1" as BloodFeudId,
      offendingHouseId: rivalHouseId,
      triggeringSecretId: "s1" as InheritedSecretId,
      triggeringGrievanceId: "g1" as GrievanceId,
      incurredAtTick: 10,
      resolved: false,
      resolvedAtTick: null,
      resolutionKind: null,
    };
    const rivalActor: RivalActorState = {
      houseId: rivalHouseId,
      factionId: "faction-court" as FactionId,
      associatedCharacterIds: [dead.id, alive.id],
      lastActionTick: null,
    };
    const state = makeGameState({
      characters: makeCharactersMap([dead, alive]),
      houses: makeHousesMap([makeHouse({ bloodFeuds: [feud] }), makeHouse({ id: rivalHouseId })]),
      rivalActors: new Map([[rivalHouseId, rivalActor]]),
      tick: 20,
    });
    const next = pruneOrphanedConversationKeys(state, new Set([dead.id]));
    expect(next.houses.get(PLAYER_HOUSE_ID)?.bloodFeuds[0]?.resolved).toBe(false);
  });

  it("composes branch 9 and branch 10 in one call (sibling-rival dies + rival dies-out same call)", () => {
    const rivalHouseId = "rival-ashford" as HouseId;
    const rivalAssociate = makeCharacter({
      id: "rival-ashford-a1" as CharacterId,
      alive: false,
      houseId: rivalHouseId,
    });
    const deadSibling = makeCharacter({ id: "sib" as CharacterId, alive: false });
    const actor: SiblingRivalState = {
      id: "siblingRival-sib" as SiblingRivalActorId,
      characterId: deadSibling.id,
      hostility: 50,
      lastActionTick: 0,
      reconciled: false,
      promotedAtTick: 0,
    };
    const feud: BloodFeud = {
      id: "feud-1" as BloodFeudId,
      offendingHouseId: rivalHouseId,
      triggeringSecretId: "s1" as InheritedSecretId,
      triggeringGrievanceId: "g1" as GrievanceId,
      incurredAtTick: 10,
      resolved: false,
      resolvedAtTick: null,
      resolutionKind: null,
    };
    const rivalActor: RivalActorState = {
      houseId: rivalHouseId,
      factionId: "faction-court" as FactionId,
      associatedCharacterIds: [rivalAssociate.id],
      lastActionTick: null,
    };
    const state = makeGameState({
      characters: makeCharactersMap([deadSibling, rivalAssociate]),
      houses: makeHousesMap([
        makeHouse({ bloodFeuds: [feud], siblingRivals: [actor] }),
        makeHouse({ id: rivalHouseId }),
      ]),
      rivalActors: new Map([[rivalHouseId, rivalActor]]),
      tick: 25,
    });
    const next = pruneOrphanedConversationKeys(state, new Set([deadSibling.id, rivalAssociate.id]));
    const playerAfter = next.houses.get(PLAYER_HOUSE_ID);
    // Branch 9: sibling-rival removed.
    expect(playerAfter?.siblingRivals).toHaveLength(0);
    // Branch 10: feud auto-resolved.
    expect(playerAfter?.bloodFeuds[0]?.resolved).toBe(true);
    expect(playerAfter?.bloodFeuds[0]?.resolutionKind).toBe("GenerationalDecay");
  });
});
