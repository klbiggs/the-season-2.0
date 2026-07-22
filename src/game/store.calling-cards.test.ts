// P26 — acceptCallingCard / declineCallingCard store-action behavior.
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { conversationOrchestrator } from "../runtime/conversationOrchestrator";
import { makeCharacter } from "./__test-utils__/factories";
import { CALLING_CARD_DECLINE_AFFECTION_PENALTY } from "./constants";
import { makePairKey } from "./conversation/types";
import type { CallingCard } from "./entities";
import { type CallingCardId, type CharacterId, PLAYER_HOUSE_ID } from "./rng";
import { INDEPENDENT_HOUSE_ID } from "./rng.seeds";
import { createStore } from "./store";

const CALLER_ID = "cc-caller" as CharacterId;
const CARD_ID = "card-0" as CallingCardId;

function pendingCard(overrides: Partial<CallingCard> = {}): CallingCard {
  return {
    id: CARD_ID,
    callerCharacterId: CALLER_ID,
    issuedAtTick: 0,
    expiresAtTick: 100,
    status: "Pending",
    ...overrides,
  };
}

function setupWithCard(card: CallingCard = pendingCard(), callerAlive = true) {
  const store = createStore({ seed: "cc-store-test" });
  const st = store.getState();
  const chars = new Map(st.characters);
  chars.set(
    CALLER_ID,
    makeCharacter({ id: CALLER_ID, houseId: INDEPENDENT_HOUSE_ID, alive: callerAlive, age: 30 }),
  );
  store.setState({ characters: chars, callingCards: new Map([[card.id, card]]) });
  return store;
}

afterEach(() => {
  // Sessions are in-memory on the module-singleton orchestrator; clear between
  // tests so a leftover Visit session doesn't leak into the next case.
  conversationOrchestrator.endSession();
});

describe("acceptCallingCard", () => {
  it("flips the card to Accepted and opens a Visit session", () => {
    const store = setupWithCard();
    const result = store.getState().acceptCallingCard(CARD_ID);
    expect(result.ok).toBe(true);
    expect(store.getState().callingCards.get(CARD_ID)?.status).toBe("Accepted");
    expect(conversationOrchestrator.currentMode()).toBe("Visit");
    expect(conversationOrchestrator.currentVisitCaller()).toBe(CALLER_ID);
  });

  it("rejects a non-Pending card with CardNotPending", () => {
    const store = setupWithCard(pendingCard({ status: "Expired" }));
    const result = store.getState().acceptCallingCard(CARD_ID);
    expect(result).toEqual({ ok: false, reason: { kind: "CardNotPending" } });
  });

  it("rejects a dead caller with CallerDead", () => {
    const store = setupWithCard(pendingCard(), false);
    const result = store.getState().acceptCallingCard(CARD_ID);
    expect(result).toEqual({ ok: false, reason: { kind: "CallerDead" } });
  });

  it("rejects when a ballroom session is already open (cross-mode)", () => {
    const store = setupWithCard();
    conversationOrchestrator.beginSession(store.getState().tick);
    const result = store.getState().acceptCallingCard(CARD_ID);
    expect(result).toEqual({ ok: false, reason: { kind: "SessionAlreadyOpen" } });
  });

  it("rejects PlayerExiled", () => {
    const store = setupWithCard();
    const houses = new Map(store.getState().houses);
    const player = houses.get(PLAYER_HOUSE_ID);
    if (player !== undefined) houses.set(PLAYER_HOUSE_ID, { ...player, exiled: true });
    store.setState({ houses });
    const result = store.getState().acceptCallingCard(CARD_ID);
    expect(result).toEqual({ ok: false, reason: { kind: "PlayerExiled" } });
  });
});

describe("declineCallingCard", () => {
  it("flips the card to Declined and applies the affection penalty", () => {
    const store = setupWithCard();
    const pairKey = makePairKey(PLAYER_HOUSE_ID, CALLER_ID);
    // Seed a starting affection so the penalty is observable (not clamped at 0).
    const aff = new Map(store.getState().affectionMap);
    aff.set(pairKey, 40);
    store.setState({ affectionMap: aff });
    const result = store.getState().declineCallingCard(CARD_ID);
    expect(result.ok).toBe(true);
    expect(store.getState().callingCards.get(CARD_ID)?.status).toBe("Declined");
    expect(store.getState().affectionMap.get(pairKey)).toBe(
      40 - CALLING_CARD_DECLINE_AFFECTION_PENALTY,
    );
    expect(conversationOrchestrator.currentMode()).toBeNull(); // no session opened
  });

  it("clamps the affection penalty at 0", () => {
    const store = setupWithCard();
    const pairKey = makePairKey(PLAYER_HOUSE_ID, CALLER_ID);
    store.getState().declineCallingCard(CARD_ID); // pair affection defaults to 0
    expect(store.getState().affectionMap.get(pairKey)).toBe(0);
  });

  it("rejects a non-Pending card with CardNotPending", () => {
    const store = setupWithCard(pendingCard({ status: "Declined" }));
    const result = store.getState().declineCallingCard(CARD_ID);
    expect(result).toEqual({ ok: false, reason: { kind: "CardNotPending" } });
  });
});

describe("recordNpcOpener (staleness guard)", () => {
  it("appends an NPC opener exchange when the session is current", () => {
    const store = setupWithCard();
    const sessionId = conversationOrchestrator.beginVisitSession(store.getState().tick, CALLER_ID);
    store.getState().recordNpcOpener(sessionId, CALLER_ID, "A word with you.");
    const pairKey = makePairKey(PLAYER_HOUSE_ID, CALLER_ID);
    const hist = store.getState().conversationHistory.get(pairKey) ?? [];
    expect(hist.at(-1)).toMatchObject({ speaker: "other", text: "A word with you." });
  });

  it("no-ops when the requesting session is no longer current", () => {
    const store = setupWithCard();
    const sessionId = conversationOrchestrator.beginVisitSession(store.getState().tick, CALLER_ID);
    conversationOrchestrator.endSession(); // player left; the opener is now stale
    store.getState().recordNpcOpener(sessionId, CALLER_ID, "stale line");
    const pairKey = makePairKey(PLAYER_HOUSE_ID, CALLER_ID);
    const hist = store.getState().conversationHistory.get(pairKey) ?? [];
    expect(hist.some((e) => e.text === "stale line")).toBe(false);
  });
});
