// Standalone idempotence assertion separate from v2-to-v3.test.ts so the
// pattern is replicable for future migrations. Every future
// migrate_vN_to_vN+1.idempotence.test.ts file reuses assertMigrationIdempotent.

import { describe, it } from "vitest";
import { createStore, selectGameState } from "../../game/store";
import { toSaveV2 } from "../schema";
import { assertMigrationIdempotent } from "./__test-utils__/idempotence";
import { migrate_v2_to_v3 } from "./v2-to-v3";

describe("migrate_v2_to_v3 — idempotence", () => {
  it("running twice produces deeply-equal outputs", () => {
    const sut = createStore({ seed: "alpha" });
    const v2 = toSaveV2(selectGameState(sut.getState()));
    assertMigrationIdempotent(migrate_v2_to_v3, v2);
  });
});
