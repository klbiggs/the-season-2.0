// P10 modal-state gate matrix for the 4 new artifact-loop wrappers.
//
// Per CLAUDE.md "Modal-state rule-layer gate principle (P9 generalization of
// P6)", every player-elected mutation wrapper gates on:
//   (a) state.houses.get(PLAYER_HOUSE_ID).exiled === true → PlayerExiled
//   (b) state.elopement !== null → ElopementInProgress
//
// 4 wrappers × 2 gates = 8 test blocks.

import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { ElopementSprintState } from "./entities";
import type {
  ArtifactDefinitionId,
  ArtifactInstanceId,
  CharacterId,
  ElopementId,
  SchemeId,
  ThiefAttemptId,
} from "./rng";
import { PLAYER_HOUSE_ID } from "./rng";
import { createStore } from "./store";

const SYNTH_SPRINT: ElopementSprintState = {
  id: "elopement:synth-scheme:0" as ElopementId,
  schemeId: "synth-scheme" as SchemeId,
  elopingCharacterId: "synth-eloper" as CharacterId,
  targetCharacterId: "synth-target" as CharacterId,
  initiatorHouseId: PLAYER_HOUSE_ID,
  pursuerHouseId: PLAYER_HOUSE_ID,
  isPlayerControlled: true,
  playerTilePosition: 3,
  fatherTilePosition: 1,
  freshHorsesUsedCount: 0,
  abandonOnWin: false,
  resolved: false,
  outcome: null,
  resolvedAtTick: null,
  startedAtTick: 0,
};

function setupWithExiled() {
  const store = createStore({ seed: "artifact-gate-exile" });
  const state = store.getState();
  const playerHouse = state.houses.get(PLAYER_HOUSE_ID);
  if (!playerHouse) throw new Error("player house missing in fresh state");
  const newHouses = new Map(state.houses);
  newHouses.set(PLAYER_HOUSE_ID, { ...playerHouse, exiled: true });
  store.setState({ houses: newHouses });
  return store;
}

function setupWithActiveSprint() {
  const store = createStore({ seed: "artifact-gate-sprint" });
  store.setState({ elopements: new Map([[SYNTH_SPRINT.id, SYNTH_SPRINT]]) });
  return store;
}

const DUMMY_CHAR = "test-char" as CharacterId;
const DUMMY_ARTIFACT = "artifact-x-0" as ArtifactInstanceId;
const DUMMY_THIEF = "thief-x-0" as ThiefAttemptId;

describe("P10 modal-state gate matrix — PlayerExiled", () => {
  it("equipArtifact rejects PlayerExiled", () => {
    const store = setupWithExiled();
    const result = store.getState().equipArtifact(DUMMY_CHAR, DUMMY_ARTIFACT);
    expect(result).toEqual({ ok: false, reason: { kind: "PlayerExiled" } });
  });
  it("unequipArtifact rejects PlayerExiled", () => {
    const store = setupWithExiled();
    const result = store.getState().unequipArtifact(DUMMY_CHAR, DUMMY_ARTIFACT);
    expect(result).toEqual({ ok: false, reason: { kind: "PlayerExiled" } });
  });
  it("commissionForgery rejects PlayerExiled", () => {
    const store = setupWithExiled();
    const result = store.getState().commissionForgery(DUMMY_CHAR, "sapphires" as ArtifactDefinitionId);
    expect(result).toEqual({ ok: false, reason: { kind: "PlayerExiled" } });
  });
  it("thwartTheft rejects PlayerExiled", () => {
    const store = setupWithExiled();
    const result = store.getState().thwartTheft(DUMMY_THIEF);
    expect(result).toEqual({ ok: false, reason: { kind: "PlayerExiled" } });
  });
});

describe("P10 modal-state gate matrix — ElopementInProgress", () => {
  it("equipArtifact rejects ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().equipArtifact(DUMMY_CHAR, DUMMY_ARTIFACT);
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });
  it("unequipArtifact rejects ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().unequipArtifact(DUMMY_CHAR, DUMMY_ARTIFACT);
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });
  it("commissionForgery rejects ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().commissionForgery(DUMMY_CHAR, "sapphires" as ArtifactDefinitionId);
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });
  it("thwartTheft rejects ElopementInProgress", () => {
    const store = setupWithActiveSprint();
    const result = store.getState().thwartTheft(DUMMY_THIEF);
    expect(result).toEqual({ ok: false, reason: { kind: "ElopementInProgress" } });
  });
});
