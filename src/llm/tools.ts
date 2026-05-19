// Single FunctionDeclaration: `respond`. Forces structured output via
// Gemini's function-calling API. P6 widens this with a `generateWhisper`
// declaration (additional element in the same functionDeclarations array;
// toolConfig.functionCallingConfig.allowedFunctionNames selects which is
// forced per request).
//
// Plan: plans/phases/04-ballroom-llm.md "src/llm/tools.ts".

import type { FunctionDeclaration } from "@google/genai";

export const RESPOND_TOOL_NAME = "respond" as const;

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
      toolCalls: { type: "array", items: { type: "object" } }, // P6 widens
    },
    required: ["dialogue", "classifiedTactic", "qualityMultiplier"],
  },
};
