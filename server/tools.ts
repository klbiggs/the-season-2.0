// Function-call tool declarations for forced structured output. RESPOND_TOOL
// is the only allowed function (toolConfig.allowedFunctionNames = ["respond"]);
// GENERATE_WHISPER_TOOL is registered so the model can emit valid
// generateWhisper payloads inside respond's toolCalls field.
//
// Moved from src/llm/tools.ts at P7.5; server owns function-call config now.

import type { FunctionDeclaration } from "@google/genai";

export const RESPOND_TOOL_NAME = "respond" as const;
export const GENERATE_WHISPER_TOOL_NAME = "generateWhisper" as const;
export const GENERATE_GRIEVANCE_TOOL_NAME = "generateGrievance" as const;
export const CLASSIFY_TOOL_NAME = "classify" as const;

// P26 (G1): the two-phase classify leg's forced function. Same fields as
// RESPOND_TOOL MINUS `dialogue` (call #1 streamed the prose). The classifier
// sees the player's message + the already-generated reply and labels the
// exchange; toolCalls ride here since the streamed leg carries no tools.
const TOOL_CALLS_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      name: { type: "string", enum: ["generateWhisper", "generateGrievance"] },
      args: {
        type: "object",
        properties: {
          subjectCharacterId: { type: "string" },
          text: { type: "string" },
          severity: { type: "string" },
        },
      },
    },
    required: ["name", "args"],
  },
} as const;

export const RESPOND_TOOL: FunctionDeclaration = {
  name: RESPOND_TOOL_NAME,
  description: "Reply in-character to the player's message and classify their tactic.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      dialogue: { type: "string" },
      classifiedTactic: {
        type: "string",
        // P12: widened with "ComplimentMount" — promenade-only tactic. The
        // ballroom mode-framing prefix (absent in ballroom) does not steer
        // the model toward this value; promenade mode-framing actively names
        // it. Server-side widening keeps the SDK declaration consistent with
        // ProxyConversationRequestSchema.history's enum.
        enum: ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy", "ComplimentMount"],
      },
      qualityMultiplier: { type: "number" },
      moodHint: {
        type: "string",
        enum: ["Receptive", "Defensive", "Distracted", "Jealous", "Grieving"],
      },
      // P26 (G6): the toolCall union widened to generateWhisper +
      // generateGrievance. The JSON schema is permissive (widen-and-validate);
      // the client-side Zod union (types.ts) discriminates on `name` and drops
      // unknown shapes. args carry the superset of both calls' fields.
      toolCalls: TOOL_CALLS_SCHEMA,
    },
    required: ["dialogue", "classifiedTactic", "qualityMultiplier"],
  },
};

// P26 (G1): forced function for the classify leg of the two-phase path.
export const CLASSIFY_TOOL: FunctionDeclaration = {
  name: CLASSIFY_TOOL_NAME,
  description:
    "Classify the player's message (which tactic they used) and rate its phrasing quality, " +
    "given the reply that was just made to them.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      classifiedTactic: {
        type: "string",
        enum: ["Flattery", "WittyBanter", "SlyGossip", "DeepEmpathy", "ComplimentMount"],
      },
      qualityMultiplier: { type: "number" },
      moodHint: {
        type: "string",
        enum: ["Receptive", "Defensive", "Distracted", "Jealous", "Grieving"],
      },
      toolCalls: TOOL_CALLS_SCHEMA,
    },
    required: ["classifiedTactic", "qualityMultiplier"],
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

// P26 (G6): registered so the model can emit valid generateGrievance payloads
// inside respond's toolCalls (nested, NOT in allowedFunctionNames). Used when
// the player's remark gives genuine offence — records a Conversation-source
// grievance against the player.
export const GENERATE_GRIEVANCE_TOOL: FunctionDeclaration = {
  name: GENERATE_GRIEVANCE_TOOL_NAME,
  description:
    "Record that the player's message gave real offence to you. Use ONLY when " +
    "the player has been genuinely insulting or dishonorable — not for ordinary " +
    "disagreement. Records a grievance the player may have to answer for.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      severity: { type: "string", description: "A short reason the offence was taken." },
    },
  },
};
