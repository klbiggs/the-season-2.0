// Golden-output Vitest for the FNV-1a 32-bit gender derivation. The hash
// algorithm is FROZEN — any change silently re-rolls every legacy character's
// gender on next load. The pinned outputs ARE the contract; the
// BASELINE_NPCS gender field + bootstrap player gender derive from this hash,
// so a hash drift cascades to v1→v8 chain hash-parity test failures.
//
// Plan: plans/phases/07-family-succession.md "hashCharIdToGender".

import { describe, expect, it } from "vitest";
import type { CharacterId } from "../rng";
import { hashCharIdToGender } from "./hashCharIdToGender";

describe("hashCharIdToGender — FNV-1a 32-bit golden outputs", () => {
  // Pinned pairs computed via:
  //   node -e "const FNV_OFFSET = 0x811c9dc5; const FNV_PRIME = 0x01000193;
  //            function h(id){let x=FNV_OFFSET;for(let i=0;i<id.length;i++){
  //              x^=id.charCodeAt(i); x=Math.imul(x,FNV_PRIME);} return (x&1)===0?'Female':'Male';}
  //            ['npc-aldridge','npc-blackwood','npc-carrington','npc-dunmore',
  //             'npc-ellsworth','player-head'].forEach(i=>console.log(i,h(i)));"
  it.each([
    ["npc-aldridge", "Male"],
    ["npc-blackwood", "Male"],
    ["npc-carrington", "Female"],
    ["npc-dunmore", "Male"],
    ["npc-ellsworth", "Male"],
    ["player-head", "Male"],
  ])("hashes %s → %s", (id, expected) => {
    expect(hashCharIdToGender(id as CharacterId)).toBe(expected);
  });

  it("is deterministic (same input → same output across calls)", () => {
    const id = "npc-aldridge" as CharacterId;
    const a = hashCharIdToGender(id);
    const b = hashCharIdToGender(id);
    expect(a).toBe(b);
  });

  it("distributes across the 0/1 bit space (regression guard)", () => {
    // Spot-check: not all inputs hash to the same gender. If the algorithm
    // were broken (e.g., constant return), this would catch it.
    const sample = ["a", "b", "c", "d", "e", "f", "g", "h"].map((s) =>
      hashCharIdToGender(s as CharacterId),
    );
    const females = sample.filter((g) => g === "Female").length;
    const males = sample.filter((g) => g === "Male").length;
    expect(females).toBeGreaterThan(0);
    expect(males).toBeGreaterThan(0);
  });
});
