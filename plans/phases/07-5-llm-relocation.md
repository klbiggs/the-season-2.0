# P7.5 — LLM Key Relocation to Localhost Proxy

> Part of [The Season Master Plan](../MASTER.md). Prior: [P7 — Family, Marriage & Succession](./07-family-succession.md). Next: [P8 — Rival Houses, Patronesses & Duels](./08-rivals-patronesses.md).
>
> **Cross-cutting architectural amendment, not a feature phase.** P8+ "Depends on" columns do NOT inherit P7.5.

## Goal

Relocate the Gemini API key off the browser. Pre-P7.5 the SPA carried `@google/genai` in the bundle and accepted the key via a session-only React context (BYOK); post-P7.5 the SDK runs in a localhost-only Node proxy (`server/`) that holds the key in `server/.env`. The SPA fetches `/api/llm/conversation` via Vite's dev proxy. The build never carries the key. The game becomes machine-locked (only works where the proxy is running) — a deliberate trade for keeping the key out of the bundle without adding a hosted backend.

## In scope

**Server scaffold** (new `server/` tree):
- `server/index.ts` — Node `http.createServer` bound to `127.0.0.1:8787`; `validateEnv()` called from `listen()` (not module-load) so server tests can import without crashing.
- `server/conversation.ts` — `POST /api/llm/conversation` handler. Owns the SDK call composition (`RESPOND_TOOL` + `GENERATE_WHISPER_TOOL`, `FunctionCallingConfigMode.ANY` with `allowedFunctionNames:["respond"]`, 13s composite `AbortController` covering both `caches.create` and `generateContent`).
- `server/invalidate.ts` — `POST /api/llm/persona/invalidate` handler. Deletes any `personaCache` Map entries with key prefix `${targetCharacterId}|`.
- `server/personaCache.ts` — `Map<key, {name, createdAt}>` with 60-min TTL via the new `PERSONA_CACHE_TTL_MS` constant. Cache-create non-abort failures swallow and return null (caller falls back to `systemInstruction`).
- `server/routing.ts`, `server/tools.ts`, `server/prompts/persona.ts` — moved from `src/llm/`. `buildPersonaPrompt` refactored from `(target, otherCharactersInScene, state)` → `(snapshot: CharacterStateSnapshot)`.
- `server/env.ts` — `validateEnv()` with regex `/^AIza/` (moved from `BYOK_KEY_SHAPE_REGEX` in `src/game/constants.ts`; renamed `GEMINI_KEY_SHAPE_REGEX` as a local).
- `server/tsconfig.json` — extends root but overrides `lib: ["ES2022"]` (drops DOM) and `types: []` (drops vitest globals). Includes `__mocks__/@google/**/*.ts` so the SDK mock typechecks under the server project.
- `server/.env.example` — placeholder for `GEMINI_API_KEY`.

**Client rewrites**:
- `src/llm/types.ts` — adds `ProxyConversationRequestSchema` + `CharacterStateSnapshotSchema`. Deletes the pre-split `ConversationRequest` type. Adds re-exports for `Character`/`GameState`/`MarriageRecord`/`Role`/`Mood` (types) + `TRAITS` (value) + factory helpers (`makeCharacter` etc.) — the sole sanctioned cross-tree edge from `server/` back into `src/`.
- `src/llm/client.ts` — ~50 LOC typed `fetch` wrapper. No SDK import. No `apiKey` arg. No `public readonly ai` field. Timer-free (orchestrator owns the timeout via `AbortSignal.any`). Maps HTTP 408 → `CancelledError`, 5xx → `NetworkError`, 422 → `SchemaError`.
- `src/llm/errors.ts` — drops `MissingKeyError` class + removes it from the `LlmError` union. Keeps `TimeoutError` / `NetworkError` / `SchemaError` / `CancelledError`.
- `src/game/conversation/types.ts` — `ConversationFailure` union drops `{ reason: "missing-key" }`. Adds schema re-exports (`CharacterIdSchema`, `HouseIdSchema`) for the `src/llm/types.ts` Zod definitions.
- `src/ui/ballroom/ConversationFailureBanner.tsx` — removes the `missing-key` entry from `REASON_PROSE`; broadens the `network` copy to mention the proxy.
- `src/ui/shared/KeyContext.tsx`, `src/ui/shared/KeyEntryPanel.tsx` — DELETED.
- `src/App.tsx` — removes `<KeyProvider>` wrapper + `<KeyEntryPanel />` + their imports.
- `src/ui/ballroom/BallroomView.tsx` — drops `useApiKey()` + the three `key === null`/`key === ""` checks (`disabledReason`, `sendDisabled`, `onSend` guard).
- `src/game/store.ts` — drops `apiKey` from `sendBallroomMessage`; deletes `buildPersonaPrompt`/`routeModel` imports; deletes `if (!apiKey)` block; replaces `persona:`/`cacheName:`/`model:` fields with `characterStateSnapshot:` (resolves spouse inline before sending).
- `src/runtime/conversationOrchestrator.ts` — drops `apiKey`/`target`/`state` from `send()`. New signature: `send(request: ProxyConversationRequest, pinnedIntent: Tactic | null)`. Owns user-abort + 15s timeout controllers; composes via `AbortSignal.any`. The module-load `TargetCharacterDied` subscription POSTs to `/api/llm/persona/invalidate` (fire-and-forget; `typeof fetch === 'function'` guard + `.catch(() => {})`).
- `src/llm/cache.ts`, `src/llm/routing.ts`, `src/llm/tools.ts`, `src/llm/prompts/persona.ts`, `src/llm/prompts/persona.test.ts` — DELETED (moved to `server/`).

**Configs**:
- `package.json` — `dev` script becomes `concurrently --kill-others-on-fail` over `dev:vite` + `dev:server`. DevDeps add `tsx@~4.19.0` + `concurrently@~9.1.0`. `@google/genai` moves dependencies → devDependencies. `engines.node` bumps to `>=22.13.0`. `lint`/`lint:boundaries`/`typecheck` scripts extend to cover `server/`.
- `.nvmrc` — bumps `22.11.0` → `22.13.0`.
- `.npmrc` — new file with `engine-strict=true`.
- `.gitignore` — adds `server/.env` and `.claude/worktrees/`.
- `.worktreeinclude` — new file with `.env*` so future worktrees auto-copy the key.
- `tsconfig.json` — adds `vitest.setup.ts` to root include.
- `vitest.config.ts` — adds `"server/**/*.test.ts"` to include; adds `setupFiles: ["./vitest.setup.ts"]`.
- `vite.config.ts` — appends `proxy: { "/api": { target: "http://127.0.0.1:8787" } }` to existing `server:` block (preserves `port: 5173, strictPort: true`).
- `eslint.config.js` — FIVE-setting boundaries update: (a) extend top-level `files:` glob with `server/**/*.ts`; (b) extend `boundaries/include`; (c) add `server` folder element + `llm-types` and `game-test-factories` file-mode elements; (d) add explicit `{ from: ["server"], allow, disallow }` rule (the existing `default: "allow"` makes the prose enumeration non-enforceable without this); (e) extend rule (c)'s `from: ["llm","llm-types"]` allow set with `game-test-factories` so the test-utility re-export through `src/llm/types.ts` is sanctioned. `import/resolver.typescript.project` expands to `["./tsconfig.json", "./server/tsconfig.json"]`.
- `vitest.setup.ts` — new file at repo root. Registers `vi.stubGlobal('fetch', ...)` with a deterministic route table for `/api/llm/conversation` (hashes via `canonicalJSON` from `src/game/hash`) + `/api/llm/persona/invalidate` (returns 204). Throws on unknown paths.

**Constants**:
- `src/game/constants.ts` — DELETE `BYOK_KEY_SHAPE_REGEX` (moved to `server/env.ts`). ADD `PERSONA_CACHE_TTL_MS = 3600 * 1000` (number, for server-local expiry check) alongside the existing string `PERSONA_CACHE_TTL_SECONDS = "3600s"` (Gemini wire format). Proximity comment explains the consumer split.

**Tests**:
- `src/runtime/conversationOrchestrator.test.ts` — drop the two missing-key cases; rewrite happy-path + deterministic-replay assertion to the new `send(proxyRequest, pinnedIntent)` signature. Use the global `fetch` stub (`vitest.setup.ts`) instead of `vi.mock("@google/genai")`.
- `__mocks__/@google/genai.ts` — KEPT. Server tests opt in via `vi.mock("@google/genai")` at the top of each file (along with `import { vi } from "vitest"` since `server/tsconfig.json` drops `vitest/globals`).

## Out of scope

- Rate limiting, auth, per-user quotas — the proxy is single-user; explicitly accepted.
- Public deployment, Docker, systemd unit, "share the game with a friend" affordances.
- Migrating saves — saves don't contain LLM-key state; no save-version bump.
- Editing closed phase plans (P0-P7 records stay accurate to ship-time; the P4 callout is a documented one-line exception).
- Bumping `SAVE_VERSION_CURRENT` or `PERSONA_CACHE_VERSION` — neither's wire format changes.
- `pnpm install --prod` / Docker / CI-strict scenarios — the proxy is dev-only; production-install paths drop `@google/genai` (now devDep) and would break at module-load.

## Verification

Inside the worktree, before merging:

0. **Pre-flight**: `node --version` confirms `>=22.13.0`; `pnpm install` re-evaluates `engines.node` against the bump (with `.npmrc engine-strict=true`, install fails fast on Node mismatch); manually create `server/.env` from `server/.env.example` and fill in `GEMINI_API_KEY`.
1. `pnpm typecheck && pnpm lint && pnpm test` — all clean. Pure-logic test coverage on `src/game/rules/**` unchanged. Run `pnpm test server/conversation.test.ts` alone first as a smoke gate.
2. **Bundle leak check**: `pnpm build && ! grep -F "GoogleGenAI" dist/assets/*.js && ! grep -F "generativelanguage.googleapis.com" dist/assets/*.js && ! grep -F "AIza" dist/assets/*.js`. The devDep move is the durable guard; the greps are supplementary.
3. **Deterministic replay harness**: re-runs 30 identical campaigns; final hashes match across all 30. The harness doesn't invoke `sendBallroomMessage` so the LLM mock layer doesn't participate.
4. **Manual ballroom round-trip**: `pnpm dev` starts both processes. Open the ballroom, send a message. Stop the server mid-conversation; verify the client surfaces the broadened `"network"` banner without advancing tick.
5. **Local-bind verification**: `lsof -i :8787` shows `127.0.0.1` binding, not `*`/`0.0.0.0`.
6. **Worktree cleanup gate**: no `dist/` / `node_modules/` accidentally committed; `git status` clean apart from intentional changes.
7. **Post-merge propagation**: copy `server/.env` from this worktree into main's `server/` directory after merge (gitignored files don't propagate via merge; `.worktreeinclude` then auto-includes for future worktrees).

## CLAUDE.md additions

- "LLM integration specifics" section rewritten end-to-end — key in `server/.env`, persona cache server-side, model routing server-decided, 13s/15s composite timeout, failure paths split client/server.
- "What not to do" updated: don't expose the key in bundle/localStorage/IndexedDB; don't expand the proxy beyond LLM relay; don't deploy publicly.
- `server/` boundary contract pinned: only `src/game/constants` + `src/llm/types` are sanctioned import sources.
- "Persona prompt format version bump" rule updated for the post-move file paths (`buildPersonaPrompt` at `server/prompts/persona.ts`; `PERSONA_CACHE_VERSION` stays in `src/game/constants.ts`).

## Notes for downstream phases

- P8+ do NOT depend on P7.5; the relocation is a cross-cutting amendment, not a feature dependency.
- Any future feature that adds a persona-relevant `Character` field MUST: (a) bump `PERSONA_CACHE_VERSION`, (b) extend `CharacterStateSnapshotSchema` if the field needs to ride on the wire, (c) extend `buildPersonaPrompt` to consume it.
