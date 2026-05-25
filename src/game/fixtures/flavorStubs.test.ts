// flavorStubs tests: every artifact definition has a non-empty stub; the
// resolver routes by id prefix; bio/scandal stubs are non-empty.

import { describe, expect, it } from "vitest";
import { makeCharacter } from "../__test-utils__/factories";
import type { FlavorContentId } from "../rng";
import { ARTIFACT_REGISTRY } from "./artifacts";
import {
  ARTIFACT_BACKSTORY_STUBS,
  flavorStubFor,
  npcBioStub,
  scandalColumnStub,
} from "./flavorStubs";

describe("ARTIFACT_BACKSTORY_STUBS", () => {
  it("has a non-empty stub for every artifact definition", () => {
    for (const def of ARTIFACT_REGISTRY.values()) {
      const stub = ARTIFACT_BACKSTORY_STUBS.get(def.id);
      expect(stub, `missing backstory stub for ${def.id}`).toBeDefined();
      expect((stub ?? "").length).toBeGreaterThan(0);
    }
  });
});

describe("npcBioStub / scandalColumnStub", () => {
  it("npcBioStub includes the character name", () => {
    const c = makeCharacter({ name: "Lord Ashby" });
    expect(npcBioStub(c)).toContain("Lord Ashby");
  });

  it("scandalColumnStub is non-empty", () => {
    expect(scandalColumnStub(2).length).toBeGreaterThan(0);
  });
});

describe("flavorStubFor", () => {
  it("routes artifact ids to the registry stub", () => {
    const id = "artifact:sapphires" as FlavorContentId;
    expect(flavorStubFor(id)).toBe(ARTIFACT_BACKSTORY_STUBS.get("sapphires"));
  });

  it("falls back to a generic line for an unknown artifact", () => {
    const id = "artifact:unknown-thing" as FlavorContentId;
    expect(flavorStubFor(id).length).toBeGreaterThan(0);
  });

  it("routes bio ids to npcBioStub when a character is provided", () => {
    const c = makeCharacter({ name: "Miss Dasher" });
    const id = `bio:${c.id}` as FlavorContentId;
    expect(flavorStubFor(id, { character: c })).toContain("Miss Dasher");
  });

  it("routes scandal ids to scandalColumnStub", () => {
    const id = "scandal:3" as FlavorContentId;
    expect(flavorStubFor(id).length).toBeGreaterThan(0);
  });
});
