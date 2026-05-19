// Renders the bounded conversation history (≤3 most-recent exchanges per
// pair). Speakers labeled "Player" / "NPC name" per spec §4 line 552
// wording (the stored "house-head"/"other" labels are pre-mapped here).

import type { Exchange } from "../../game/conversation/types";

type Props = {
  exchanges: ReadonlyArray<Exchange>;
  npcName: string;
};

export function ChatLog({ exchanges, npcName }: Props) {
  if (exchanges.length === 0) {
    return (
      <div
        className="rounded border border-stone-200 bg-stone-50 p-3 text-sm italic text-stone-500"
        data-testid="chat-log-empty"
      >
        No prior exchanges. Open with whatever you like.
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-2" data-testid="chat-log">
      {exchanges.map((ex, i) => (
        <li
          key={`${ex.tick}-${i}`}
          className={`rounded border p-2 text-sm ${
            ex.speaker === "house-head"
              ? "border-indigo-200 bg-indigo-50"
              : "border-stone-200 bg-white"
          }`}
        >
          <div className="text-xs font-semibold text-stone-600">
            {ex.speaker === "house-head" ? "You" : npcName}
            {ex.classifiedTactic !== null && (
              <span className="ml-2 font-normal text-stone-400">({ex.classifiedTactic})</span>
            )}
          </div>
          <div className="text-stone-800">{ex.text}</div>
        </li>
      ))}
    </ol>
  );
}
