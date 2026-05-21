// MarriageId factory tests. Pinned format: `${lex-min}:${lex-max}:${tick}:${index}`.

import { describe, expect, it } from "vitest";
import { makeGameState } from "../__test-utils__/factories";
import type { Character, MarriageRecord } from "../entities";
import type { CharacterId, MarriageId } from "../rng";
import { makeMarriageId } from "./marriageIdFactory";

describe("makeMarriageId — deterministic factory", () => {
  it("lex-sorts the spouse pair", () => {
    const state = makeGameState({ tick: 5 });
    const a = "z-alice" as CharacterId;
    const b = "a-bob" as CharacterId;
    const id1 = makeMarriageId(state, a, b);
    const id2 = makeMarriageId(state, b, a);
    // Both orderings produce the same id — lex-min:lex-max ordering.
    expect(id1).toBe(id2);
    expect(id1).toBe("a-bob:z-alice:5:0" as MarriageId);
  });

  it("uses state.tick in the id", () => {
    const a = "alice" as CharacterId;
    const b = "bob" as CharacterId;
    expect(makeMarriageId(makeGameState({ tick: 0 }), a, b)).toBe("alice:bob:0:0" as MarriageId);
    expect(makeMarriageId(makeGameState({ tick: 42 }), a, b)).toBe("alice:bob:42:0" as MarriageId);
  });

  it("indexes from 0 with no existing same-pair same-tick marriages", () => {
    const a = "alice" as CharacterId;
    const b = "bob" as CharacterId;
    const id = makeMarriageId(makeGameState({ tick: 7 }), a, b);
    expect(id).toBe("alice:bob:7:0" as MarriageId);
  });

  it("increments index when a same-pair same-tick marriage already exists", () => {
    // Synthetic case — at v1 the PlayerAlreadyMarried + TargetAlreadyMarried
    // gates prevent this, but the factory remains robust for future flows.
    const a = "alice" as CharacterId;
    const b = "bob" as CharacterId;
    const existing: MarriageRecord = {
      id: "alice:bob:7:0" as MarriageId,
      spouseAId: a,
      spouseBId: b,
      marriedAtTick: 7,
      dissolved: true,
      dissolvedAtTick: null,
      viaElopement: false,
    };
    const state = makeGameState({
      tick: 7,
      marriages: new Map([[existing.id, existing]]),
    });
    expect(makeMarriageId(state, a, b)).toBe("alice:bob:7:1" as MarriageId);
  });

  it("does not increment for different-tick marriages of the same pair", () => {
    const a = "alice" as CharacterId;
    const b = "bob" as CharacterId;
    const existing: MarriageRecord = {
      id: "alice:bob:5:0" as MarriageId,
      spouseAId: a,
      spouseBId: b,
      marriedAtTick: 5,
      dissolved: true,
      dissolvedAtTick: null,
      viaElopement: false,
    };
    const state = makeGameState({
      tick: 7,
      marriages: new Map([[existing.id, existing]]),
    });
    expect(makeMarriageId(state, a, b)).toBe("alice:bob:7:0" as MarriageId);
  });

  // Defensive: unused-import suppress.
  it("Character type compiles", () => {
    const _c: Character | undefined = undefined;
    expect(_c).toBeUndefined();
  });
});
