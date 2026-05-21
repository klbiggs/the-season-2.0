// POST /api/llm/persona/invalidate handler. Replaces the in-browser
// personaCacheRegistry.invalidateForTarget() call that previously fired
// from conversationOrchestrator.ts's TargetCharacterDied subscription.
// Fire-and-forget from the client (the browser doesn't wait for the
// response); 50-min TTL bounds staleness on failure.

import type { IncomingMessage, ServerResponse } from "node:http";
import { invalidateForTarget } from "./personaCache";

export async function handleInvalidate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJson(req);
  if (
    body === null ||
    typeof body !== "object" ||
    typeof (body as { targetCharacterId?: unknown }).targetCharacterId !== "string"
  ) {
    res.writeHead(400).end();
    return;
  }
  const { targetCharacterId } = body as { targetCharacterId: string };
  invalidateForTarget(targetCharacterId);
  res.writeHead(204).end();
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf-8");
        resolve(raw === "" ? null : JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
