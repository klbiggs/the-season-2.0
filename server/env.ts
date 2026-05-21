// Validates GEMINI_API_KEY presence + shape. Called from listen() in
// server/index.ts, NOT at module-load — server tests can import this
// module without the process crashing; they stub the env via
// vi.stubEnv("GEMINI_API_KEY", ...) before calling validateEnv().
//
// Regex moved here from src/game/constants.ts (where it was named
// BYOK_KEY_SHAPE_REGEX) as part of the P7.5 LLM-key relocation. Renamed
// to drop the "BYOK" framing — the browser no longer holds a key; only
// the server-side env does.

const GEMINI_KEY_SHAPE_REGEX = /^AIza.+/;

export function validateEnv(): { GEMINI_API_KEY: string } {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!GEMINI_KEY_SHAPE_REGEX.test(key)) {
    throw new Error(
      "GEMINI_API_KEY missing or malformed. Expected shape /^AIza/ (Google AI Studio key). " +
        "Set it in server/.env or your shell environment.",
    );
  }
  return { GEMINI_API_KEY: key };
}
