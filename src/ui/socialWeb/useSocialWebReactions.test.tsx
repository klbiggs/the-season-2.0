// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CharacterId, HouseId, SchemeId } from "../../game/rng.seeds";
import { conversationBus } from "../../runtime/events/conversation";
import { familyBus } from "../../runtime/events/family";
import { schemeBus } from "../../runtime/events/scheme";
import { useSocialWebReactions } from "./useSocialWebReactions";

const TARGET = "npc-target" as CharacterId;

describe("useSocialWebReactions", () => {
  it("emits a slide cue on FauxPasFired (matrix #12)", () => {
    const { result } = renderHook(() => useSocialWebReactions());
    act(() => {
      conversationBus.publish({
        kind: "FauxPasFired",
        tick: 1,
        targetCharacterId: TARGET,
        lockUntilTick: 5,
        wasAlreadyLocked: false,
      });
    });
    const cue = result.current.get(TARGET);
    expect(cue).toBeDefined();
    expect(cue?.expiresAtMs).toBeGreaterThan(Date.now());
  });

  it("emits a slide cue on a Sabotage SchemeCompleted (matrix #13)", () => {
    const { result } = renderHook(() => useSocialWebReactions());
    act(() => {
      schemeBus.publish({
        kind: "SchemeCompleted",
        tick: 2,
        schemeId: "scheme-1" as SchemeId,
        schemeKind: "Sabotage",
        ownerHouseId: "rival-ashford" as HouseId,
        targetCharacterId: TARGET,
      });
    });
    expect(result.current.has(TARGET)).toBe(true);
  });

  it("ignores a non-Sabotage / target-less SchemeCompleted (null-guard)", () => {
    const { result } = renderHook(() => useSocialWebReactions());
    act(() => {
      schemeBus.publish({
        kind: "SchemeCompleted",
        tick: 3,
        schemeId: "scheme-2" as SchemeId,
        schemeKind: "Smuggling",
        ownerHouseId: "rival-ashford" as HouseId,
        targetCharacterId: null,
      });
    });
    expect(result.current.size).toBe(0);
  });

  it("emits a slide cue on ProposalRejected via targetId (matrix #14)", () => {
    const { result } = renderHook(() => useSocialWebReactions());
    act(() => {
      familyBus.publish({
        kind: "ProposalRejected",
        proposerId: "player-head" as CharacterId,
        targetId: TARGET,
        scandalDelta: 5,
        tick: 4,
      });
    });
    expect(result.current.has(TARGET)).toBe(true);
  });

  it("drops subscriptions on unmount (no cue from post-unmount publish)", () => {
    const { result, unmount } = renderHook(() => useSocialWebReactions());
    unmount();
    const sizeBefore = result.current.size;
    act(() => {
      conversationBus.publish({
        kind: "FauxPasFired",
        tick: 9,
        targetCharacterId: TARGET,
        lockUntilTick: 12,
        wasAlreadyLocked: false,
      });
    });
    expect(result.current.size).toBe(sizeBefore);
  });
});
