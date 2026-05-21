// Function-call tool declarations for forced structured output. RESPOND_TOOL
// is the only allowed function (toolConfig.allowedFunctionNames = ["respond"]);
// GENERATE_WHISPER_TOOL is registered so the model can emit valid
// generateWhisper payloads inside respond's toolCalls field.
//
// Moved from src/llm/tools.ts at P7.5; server owns function-call config now.

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
