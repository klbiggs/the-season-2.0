// Localhost-only Node proxy holding the Gemini API key. Runs alongside
// `pnpm dev` via concurrently; the SPA fetches /api/* via Vite's dev proxy.
//
// Listens on 127.0.0.1:8787 only — not 0.0.0.0. Even if the dev machine is
// on a network, the proxy is unreachable except from itself.

import { createServer } from "node:http";
import { handleConversation } from "./conversation";
import { handleEmbed } from "./embeddings";
import { validateEnv } from "./env";
import { handleFlavor } from "./flavor";
import { handleInvalidate } from "./invalidate";
import { handleOpener } from "./opener";

const PORT = 8787;
const HOST = "127.0.0.1";

// Eager validation before binding the socket. Fails fast with a clear
// message if GEMINI_API_KEY is missing or malformed; `pnpm dev`'s
// `concurrently --kill-others-on-fail` then tears Vite down too so the
// user sees a clean shutdown rather than a half-running stack.
validateEnv();

const server = createServer(async (req, res) => {
  if (req.url === "/api/llm/conversation" && req.method === "POST") {
    try {
      await handleConversation(req, res);
    } catch (err) {
      console.error("[server] conversation handler error:", err);
      if (!res.headersSent) res.writeHead(500).end();
    }
    return;
  }
  if (req.url === "/api/llm/embed" && req.method === "POST") {
    try {
      await handleEmbed(req, res);
    } catch (err) {
      console.error("[server] embed handler error:", err);
      if (!res.headersSent) res.writeHead(500).end();
    }
    return;
  }
  if (req.url === "/api/llm/flavor" && req.method === "POST") {
    try {
      await handleFlavor(req, res);
    } catch (err) {
      console.error("[server] flavor handler error:", err);
      if (!res.headersSent) res.writeHead(500).end();
    }
    return;
  }
  if (req.url === "/api/llm/persona/invalidate" && req.method === "POST") {
    try {
      await handleInvalidate(req, res);
    } catch (err) {
      console.error("[server] invalidate handler error:", err);
      if (!res.headersSent) res.writeHead(500).end();
    }
    return;
  }
  if (req.url === "/api/llm/opener" && req.method === "POST") {
    try {
      await handleOpener(req, res);
    } catch (err) {
      console.error("[server] opener handler error:", err);
      if (!res.headersSent) res.writeHead(500).end();
    }
    return;
  }
  res.writeHead(404).end();
});

server.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`);
});
