// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeCharacter } from "../../game/__test-utils__/factories";
import type { CallingCard } from "../../game/entities";
import type { CallingCardId, CharacterId } from "../../game/rng";
import { createStore } from "../../game/store";
import { conversationOrchestrator } from "../../runtime/conversationOrchestrator";
import { CallingCardBanner } from "./CallingCardBanner";

const CALLER_ID = "cc-banner-caller" as CharacterId;

function storeWithPendingCard() {
  const store = createStore({ seed: "cc-banner-test" });
  const chars = new Map(store.getState().characters);
  chars.set(CALLER_ID, makeCharacter({ id: CALLER_ID, name: "Lady Test", alive: true, age: 28 }));
  const card: CallingCard = {
    id: "card-0" as CallingCardId,
    callerCharacterId: CALLER_ID,
    issuedAtTick: 3,
    expiresAtTick: 100,
    status: "Pending",
  };
  store.setState({ characters: chars, callingCards: new Map([[card.id, card]]) });
  return store;
}

afterEach(() => {
  cleanup();
  conversationOrchestrator.endSession();
});

describe("CallingCardBanner", () => {
  it("renders nothing when no Pending card exists", () => {
    const store = createStore({ seed: "cc-banner-empty" });
    const { container } = render(<CallingCardBanner store={store} onAccepted={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the caller name and Accept/Decline affordances", () => {
    const store = storeWithPendingCard();
    render(<CallingCardBanner store={store} onAccepted={() => {}} />);
    expect(screen.getByTestId("calling-card-banner").textContent).toContain("Lady Test");
    expect(screen.getByTestId("calling-card-accept")).toBeTruthy();
    expect(screen.getByTestId("calling-card-decline")).toBeTruthy();
  });

  it("accept opens a Visit session and fires onAccepted", () => {
    const store = storeWithPendingCard();
    let accepted = false;
    const onAccepted = () => {
      accepted = true;
    };
    render(<CallingCardBanner store={store} onAccepted={onAccepted} />);
    fireEvent.click(screen.getByTestId("calling-card-accept"));
    expect(accepted).toBe(true);
    expect(conversationOrchestrator.currentMode()).toBe("Visit");
    expect(store.getState().callingCards.get("card-0" as CallingCardId)?.status).toBe("Accepted");
  });

  it("decline marks the card Declined without opening a session", () => {
    const store = storeWithPendingCard();
    render(<CallingCardBanner store={store} onAccepted={() => {}} />);
    fireEvent.click(screen.getByTestId("calling-card-decline"));
    expect(store.getState().callingCards.get("card-0" as CallingCardId)?.status).toBe("Declined");
    expect(conversationOrchestrator.currentMode()).toBeNull();
  });
});
