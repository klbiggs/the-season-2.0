// Client opener-wrapper tests: success (via the global fetch stub) + HTTP-status
// → typed-failure mapping. Mirrors src/llm/flavor.test.ts.

import { afterEach, describe, expect, it, vi } from "vitest";
import { CancelledError, NetworkError, SchemaError } from "./errors";
import { fetchOpener } from "./opener";
import type { OpenerRequest } from "./types";

const REQUEST: OpenerRequest = {
  characterStateSnapshot: {
    target: {
      id: "npc-1" as never,
      houseId: "independent" as never,
      name: "Lady Test",
      birthTick: 0,
      age: 28,
      deathAge: 90,
      alive: true,
      diedAtTick: null,
      mood: "Receptive",
      moodLockUntilTick: 0,
      role: "Dependent",
      archetype: "None",
      traits: [],
      marriageId: null,
      composure: 100,
      maxComposure: 100,
      happiness: 100,
      temptationHookUnlocked: false,
      assignedTutorCharacterId: null,
      tutorBonusTraitGranted: false,
      dullSpouseExposureStartTick: null,
      parentCharacterIds: null,
      gender: "Female",
      equippedArtifactIds: [],
      assignedLocationId: "Capital",
    },
    targetMarriage: null,
    spouse: null,
  },
  history: [],
  approachContext: "Ballroom",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchOpener (via the global fetch stub)", () => {
  it("returns the opener line on success", async () => {
    const text = await fetchOpener(REQUEST, AbortSignal.timeout(5000));
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
  });

  it("maps a 408 to CancelledError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 408 }));
    await expect(fetchOpener(REQUEST, AbortSignal.timeout(5000))).rejects.toBeInstanceOf(
      CancelledError,
    );
  });

  it("maps a 5xx to NetworkError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(null, { status: 502 }));
    await expect(fetchOpener(REQUEST, AbortSignal.timeout(5000))).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it("maps a 422 to SchemaError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ issues: [{ path: "text", message: "bad" }] }), { status: 422 }),
    );
    await expect(fetchOpener(REQUEST, AbortSignal.timeout(5000))).rejects.toBeInstanceOf(
      SchemaError,
    );
  });

  it("wraps a fetch rejection as NetworkError", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new TypeError("network down"));
    await expect(fetchOpener(REQUEST, AbortSignal.timeout(5000))).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});
