// P26 (G1): the shared SSE reader for the two streaming proxy endpoints
// (/api/llm/conversation/stream via client.ts, /api/llm/flavor/stream via
// flavor.ts). Extracted rather than duplicated: the trailing-frame flush below
// is a real bug that shipped once (replies truncated mid-sentence whenever the
// terminal `done` frame arrived in the same read as the last delta), and a
// second hand-rolled copy would be a second chance to get it wrong.
//
// Boundary (rule c): imports only llm/types + llm/errors.

import { CancelledError, NetworkError } from "./errors";
import { StreamEventSchema } from "./types";

// Drains an SSE response body, invoking onDelta per token chunk, and resolves
// with the full text. Throws CancelledError on an abort or a server `timeout`
// frame, NetworkError on transport faults / server `network`|`internal` frames
// / a stream that ends with no content.
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  // Returns the terminal text when a `done` frame is seen, else null.
  const drainFrames = (flushTail: boolean): string | null => {
    const frames = buffer.split("\n\n");
    // Mid-stream the trailing element is an incomplete frame — keep it
    // buffered. On flush (reader exhausted) it IS complete, so process it:
    // otherwise the terminal `done` frame can be dropped and the text
    // silently truncates to whatever deltas happened to land on a boundary.
    buffer = flushTail ? "" : (frames.pop() ?? "");
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(line.slice("data:".length).trim());
      } catch {
        continue; // partial/garbled frame — skip
      }
      const parsed = StreamEventSchema.safeParse(parsedJson);
      if (!parsed.success) continue;
      const event = parsed.data;
      if (event.kind === "delta") {
        full += event.text;
        onDelta(event.text);
      } else if (event.kind === "done") {
        return event.text === "" ? full : event.text;
      } else {
        if (event.reason === "timeout") throw new CancelledError();
        throw new NetworkError(`stream ${event.reason}`);
      }
    }
    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const terminal = drainFrames(false);
      if (terminal !== null) return terminal;
    }
    // Reader exhausted — flush any complete frame still buffered.
    const terminal = drainFrames(true);
    if (terminal !== null) return terminal;
  } catch (cause) {
    if (cause instanceof CancelledError || cause instanceof NetworkError) throw cause;
    if (cause instanceof Error && cause.name === "AbortError") throw new CancelledError();
    throw new NetworkError(cause);
  }
  // Stream ended without a terminal `done` frame — treat whatever arrived as
  // the result if non-empty, else a network fault.
  if (full === "") throw new NetworkError("stream ended with no content");
  return full;
}
