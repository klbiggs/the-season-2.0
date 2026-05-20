// P4 ship: single `respond` FunctionDeclaration. P6 extends with the
// `generateWhisper` declaration (registered in client.ts alongside
// RESPOND_TOOL; toolConfig.functionCallingConfig.allowedFunctionNames
// stays ["respond"] — generateWhisper is REGISTERED for tool-decl-level
// shape constraint on the model's emitted toolCalls payloads, but is not
// forced as a second top-level call).
//
// Plan: plans/phases/06-whispers-espionage.md "LLM tool surface widening".

import type { FunctionDeclaration } from "@google/genai";

export const RESPOND_TOOL_NAME = "respond" as const;
export const GENERATE_WHISPER_TOOL_NAME = "generateWhisper" as const;

export const RESPOND_TOOL: FunctionDeclaration = {
  name: RESPOND_TOOL_NAME,
  description: "Reply in-character to the player's message and classify their tactic.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      dialogue: { type: "string" },
      classifiedTactic: {
        type: "string",
        enum: ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy"],
      },
      qualityMultiplier: { type: "number" },
      moodHint: {
        type: "string",
        enum: ["Receptive", "Defensive", "Distracted", "Jealous", "Grieving"],
      },
      // P6: widened items schema — constrains the model AT GENERATION TIME
      // to emit only generateWhisper toolCalls with the right shape. The
      // ConversationResponseSchema Zod parse at types.ts is defense-in-depth.
      toolCalls: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string", enum: ["generateWhisper"] },
            args: {
              type: "object",
              properties: {
                subjectCharacterId: { type: "string" },
                text: { type: "string" },
              },
              required: ["subjectCharacterId", "text"],
            },
          },
          required: ["name", "args"],
        },
      },
    },
    required: ["dialogue", "classifiedTactic", "qualityMultiplier"],
  },
};

// P6: generateWhisper tool — emit an in-character rumor about a third
// party. Registered in client.ts:tools[] alongside RESPOND_TOOL. Not
// forced via allowedFunctionNames (which stays ["respond"]); the model
// freely includes generateWhisper payloads inside respond's toolCalls
// when the in-character moment naturally produces gossip.
export const GENERATE_WHISPER_TOOL: FunctionDeclaration = {
  name: GENERATE_WHISPER_TOOL_NAME,
  description:
    "Emit an in-character rumor/whisper about a third party. The whisper " +
    "becomes Unverified in the player's ledger and may be weaponized later. " +
    "Use sparingly — only when the in-character moment naturally produces gossip.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      subjectCharacterId: { type: "string" },
      text: { type: "string", description: "1-2 sentence whisper body, in-character." },
    },
    required: ["subjectCharacterId", "text"],
  },
};
