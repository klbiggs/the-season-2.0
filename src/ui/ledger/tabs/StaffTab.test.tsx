// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { makeGameState, makeHouse } from "../../../game/__test-utils__/factories";
import type { CourierPayload } from "../../../game/entities";
import {
  type CourierPayloadId,
  INDEPENDENT_HOUSE_ID,
  PLAYER_HOUSE_ID,
  type WhisperId,
} from "../../../game/rng.seeds";
import { createStore } from "../../../game/store";
import { StaffTab } from "./StaffTab";

afterEach(cleanup);

function makeCourier(overrides: Partial<CourierPayload> = {}): CourierPayload {
  return {
    id: "courier-0001" as CourierPayloadId,
    payloadType: "Whisper",
    whisperId: "whisper-0001" as WhisperId,
    originHouseId: INDEPENDENT_HOUSE_ID,
    destinationHouseId: PLAYER_HOUSE_ID,
    originLocation: "Capital",
    destinationLocation: "Capital",
    originTick: 0,
    arrivalTick: 10,
    interceptable: true,
    direction: "Inbound",
    status: "InFlight",
    resolvedAtTick: null,
    ...overrides,
  };
}

describe("StaffTab couriers readout (P21)", () => {
  it("renders in-flight couriers with ticks-remaining + interceptable badge", () => {
    const store = createStore({ seed: "s" });
    const courier = makeCourier({ arrivalTick: 10 });
    const state = makeGameState({
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID })]]),
      couriers: new Map([[courier.id, courier]]),
      tick: 7,
    });
    store.getState().replaceState(state);
    render(<StaffTab store={store} />);

    expect(screen.getByTestId("staff-couriers-list")).toBeTruthy();
    const row = screen.getByTestId(`courier-row-${courier.id}`);
    expect(row.textContent).toContain("3t left"); // 10 - 7
    expect(row.textContent).toContain("interceptable");
    expect(row.textContent).toContain("Inbound");
  });

  it("collapses resolved couriers into a history disclosure", () => {
    const store = createStore({ seed: "s" });
    const courier = makeCourier({
      id: "courier-0002" as CourierPayloadId,
      status: "Intercepted",
      resolvedAtTick: 9,
    });
    const state = makeGameState({
      houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID })]]),
      couriers: new Map([[courier.id, courier]]),
      tick: 12,
    });
    store.getState().replaceState(state);
    render(<StaffTab store={store} />);

    expect(screen.queryByTestId("staff-couriers-list")).toBeNull();
    expect(screen.getByTestId("staff-couriers-history")).toBeTruthy();
    expect(screen.getByTestId(`courier-row-${courier.id}`).textContent).toContain("Intercepted");
  });

  it("shows an empty state with no couriers", () => {
    const store = createStore({ seed: "s" });
    store
      .getState()
      .replaceState(
        makeGameState({ houses: new Map([[PLAYER_HOUSE_ID, makeHouse({ id: PLAYER_HOUSE_ID })]]) }),
      );
    render(<StaffTab store={store} />);
    expect(screen.getByText("No couriers in transit.")).toBeTruthy();
  });
});
