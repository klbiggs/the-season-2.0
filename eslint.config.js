// ESLint flat config for boundaries enforcement ONLY. Biome owns formatting +
// general lint. See plans/phases/00-foundation.md "Lint setup".

import tsParser from "@typescript-eslint/parser";
import boundaries from "eslint-plugin-boundaries";

// P1 adds two new elements (game-util folder, game-entities file). Both go
// BEFORE the game-other folder fallback so first-match-wins resolves them
// before the catch-all.
// P7.5 adds three new elements:
//   - llm-types (file-mode, src/llm/types.ts) — the wire-contract module
//     server is allowed to import; ordered BEFORE the broader llm folder.
//   - game-test-factories (file-mode, src/game/__test-utils__/factories.ts)
//     — re-exported through src/llm/types.ts for the moved
//     server/prompts/persona.test.ts; ordered BEFORE game-other.
//   - server (folder-mode, server/**) — the localhost proxy holding the
//     Gemini key. Sanctioned cross-tree edges to game-constants + llm-types.
const elements = [
  { type: "game-rng", pattern: "src/game/rng.ts", mode: "file" },
  { type: "game-rng-test", pattern: "src/game/rng*.test.ts", mode: "file" },
  { type: "game-hash", pattern: "src/game/hash.ts", mode: "file" },
  { type: "game-store", pattern: "src/game/store.ts", mode: "file" },
  { type: "game-constants", pattern: "src/game/constants.ts", mode: "file" },
  { type: "game-entities", pattern: "src/game/entities.ts", mode: "file" },
  { type: "game-bootstrap", pattern: "src/game/bootstrap.ts", mode: "file" },
  {
    type: "game-test-factories",
    pattern: "src/game/__test-utils__/factories.ts",
    mode: "file",
  },
  { type: "runtime-tick-orchestrator", pattern: "src/runtime/tickOrchestrator.ts", mode: "file" },
  { type: "app-main", pattern: "src/main.tsx", mode: "file" },
  { type: "llm-types", pattern: "src/llm/types.ts", mode: "file" },
  { type: "game-rules", pattern: "src/game/rules", mode: "folder" },
  { type: "game-fixtures", pattern: "src/game/fixtures", mode: "folder" },
  { type: "game-util", pattern: "src/game/util", mode: "folder" },
  // P4: shared conversation types (ConversationPairKey, Exchange,
  // ConversationFailure). Lives outside game-other so game-rules can
  // import it without crossing the game-rules → game-other ban.
  { type: "game-conversation-types", pattern: "src/game/conversation", mode: "folder" },
  { type: "game-other", pattern: "src/game", mode: "folder" },
  { type: "runtime", pattern: "src/runtime", mode: "folder" },
  { type: "llm", pattern: "src/llm", mode: "folder" },
  { type: "persist", pattern: "src/persist", mode: "folder" },
  { type: "ui", pattern: "src/ui", mode: "folder" },
  { type: "server", pattern: "server", mode: "folder" },
];

export default [
  {
    files: ["src/**/*.ts", "src/**/*.tsx", "server/**/*.ts"],
    ignores: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "server/**/*.test.ts",
      "src/**/*.gitkeep",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    plugins: { boundaries },
    settings: {
      "boundaries/elements": elements,
      "boundaries/include": ["src/**/*.ts", "src/**/*.tsx", "server/**/*.ts"],
      "boundaries/ignore": ["**/*.test.ts", "**/*.test.tsx"],
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: ["./tsconfig.json", "./server/tsconfig.json"],
        },
      },
    },
    rules: {
      // Rule (a): src/game/rules/** may import only from game-rules,
      // game-constants, game-fixtures, game-rng. Rule (b): src/game/rng.ts
      // may be imported only from game-rules and runtime/tickOrchestrator.ts.
      "boundaries/element-types": [
        "error",
        {
          default: "allow",
          rules: [
            {
              from: ["game-rules"],
              allow: [
                "game-rules",
                "game-constants",
                "game-fixtures",
                "game-rng",
                "game-entities",
                "game-util",
                "game-conversation-types",
              ],
              disallow: [
                "runtime",
                "runtime-tick-orchestrator",
                "llm",
                "llm-types",
                "persist",
                "ui",
                "game-store",
                "game-hash",
                "game-bootstrap",
                "game-other",
                "game-test-factories",
                "app-main",
                "server",
              ],
              message:
                "game/rules/** may import only from game-rules, game-constants, game-fixtures, game-rng, game-entities, game-util (rule a)",
            },
            {
              // Rule (b) per plan: block UI/LLM/app entry from importing rng
              // directly. The deterministic-LLM-boundary lesson (spec §8) is the
              // motivating concern.
              from: ["ui", "llm", "llm-types", "app-main"],
              disallow: ["game-rng"],
              message:
                "game/rng must not be imported from UI / LLM / app entry — route through the store or pure rules layer (rule b)",
            },
            {
              // Rule (c) P4: src/llm/** is the only non-deterministic
              // subsystem (post-P7.5: client-side fetch wrapper only — the
              // actual SDK call lives in server/). game-constants allowed
              // (model IDs, budgets); game-conversation-types allowed
              // (Exchange + brand re-exports); game-entities allowed for
              // typed parameter shapes; game-test-factories allowed for
              // the test-utility re-exports through src/llm/types.ts.
              from: ["llm", "llm-types"],
              allow: [
                "llm",
                "llm-types",
                "game-constants",
                "game-conversation-types",
                "game-entities",
                "game-fixtures",
                "game-test-factories",
              ],
              disallow: [
                "game-rules",
                "game-store",
                "game-hash",
                "game-bootstrap",
                "game-other",
                "persist",
                "runtime",
                "runtime-tick-orchestrator",
                "ui",
                "app-main",
                "server",
              ],
              message:
                "src/llm/** must not import gameplay state — route through the orchestrator (rule c)",
            },
            {
              // Rule (d) P7.5: server/** is the localhost proxy holding the
              // Gemini key. Only TWO sanctioned cross-tree edges:
              //   - server → src/game/constants (PERSONA_CACHE_* + MODEL_*
              //     + LLM_OUTPUT_TOKEN_BUDGET).
              //   - server → src/llm/types (wire-format Zod schemas +
              //     re-exports of Character/GameState/Role/TRAITS/Mood).
              // Server must NOT import gameplay state, rules, store, ui,
              // runtime, persistence, or the broader src/llm folder.
              // default:"allow" at the top of this config means unmatched
              // edges are PERMITTED — without this explicit rule, server
              // could freely import from game-store / game-rules / etc.
              from: ["server"],
              allow: ["server", "llm-types", "game-constants"],
              disallow: [
                "llm",
                "game-rules",
                "game-store",
                "game-hash",
                "game-rng",
                "game-bootstrap",
                "game-entities",
                "game-other",
                "game-fixtures",
                "game-conversation-types",
                "game-test-factories",
                "game-util",
                "persist",
                "runtime",
                "runtime-tick-orchestrator",
                "ui",
                "app-main",
              ],
              message:
                "server/** may only import from server, src/llm/types, and src/game/constants (rule d)",
            },
          ],
        },
      ],
    },
  },
];
