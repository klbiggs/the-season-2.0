// ESLint flat config for boundaries enforcement ONLY. Biome owns formatting +
// general lint. See plans/phases/00-foundation.md "Lint setup".

import boundaries from "eslint-plugin-boundaries";
import tsParser from "@typescript-eslint/parser";

const elements = [
  { type: "game-rng", pattern: "src/game/rng.ts", mode: "file" },
  { type: "game-rng-test", pattern: "src/game/rng*.test.ts", mode: "file" },
  { type: "game-hash", pattern: "src/game/hash.ts", mode: "file" },
  { type: "game-store", pattern: "src/game/store.ts", mode: "file" },
  { type: "game-constants", pattern: "src/game/constants.ts", mode: "file" },
  { type: "runtime-tick-orchestrator", pattern: "src/runtime/tickOrchestrator.ts", mode: "file" },
  { type: "app-main", pattern: "src/main.tsx", mode: "file" },
  { type: "game-rules", pattern: "src/game/rules", mode: "folder" },
  { type: "game-fixtures", pattern: "src/game/fixtures", mode: "folder" },
  { type: "game-other", pattern: "src/game", mode: "folder" },
  { type: "runtime", pattern: "src/runtime", mode: "folder" },
  { type: "llm", pattern: "src/llm", mode: "folder" },
  { type: "persist", pattern: "src/persist", mode: "folder" },
  { type: "ui", pattern: "src/ui", mode: "folder" },
];

export default [
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.gitkeep"],
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
      "boundaries/include": ["src/**/*.ts", "src/**/*.tsx"],
      "boundaries/ignore": ["**/*.test.ts", "**/*.test.tsx"],
      "import/resolver": {
        typescript: {
          alwaysTryTypes: true,
          project: "./tsconfig.json",
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
              allow: ["game-rules", "game-constants", "game-fixtures", "game-rng"],
              disallow: [
                "runtime",
                "runtime-tick-orchestrator",
                "llm",
                "persist",
                "ui",
                "game-store",
                "game-hash",
                "game-other",
                "app-main",
              ],
              message:
                "game/rules/** may import only from game-rules, game-constants, game-fixtures, game-rng (rule a)",
            },
            {
              // Rule (b) per plan: block UI/LLM/app entry from importing rng
              // directly. The deterministic-LLM-boundary lesson (spec §8) is the
              // motivating concern. game-store/hash/other/persist still need
              // type and helper imports to wire the store, project state, and
              // serialize saves — those are allowed.
              from: ["ui", "llm", "app-main"],
              disallow: ["game-rng"],
              message:
                "game/rng must not be imported from UI / LLM / app entry — route through the store or pure rules layer (rule b)",
            },
          ],
        },
      ],
    },
  },
];
