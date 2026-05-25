// Single NPC portrait card. Shows name, mood, role label. Click selects
// the NPC as the conversation target. P18: an expandable biographical note
// (generated-or-stub) sits below the card; it lives OUTSIDE the <button>
// (a <details> may not nest inside a button).

import type { Character } from "../../game/entities";

type Props = {
  character: Character;
  selected: boolean;
  onSelect: () => void;
  // P18: persisted-or-stub biographical note for this NPC.
  bio: string;
  // P18: fired when the player opens the "Who is this?" bio expander — triggers
  // generation (idempotent). The deliberate reveal, not a conversation.
  onRevealBio: () => void;
};

const MOOD_COLOR: Readonly<Record<string, string>> = {
  Receptive: "text-emerald-700",
  Defensive: "text-amber-700",
  Distracted: "text-stone-500",
  Jealous: "text-rose-700",
  Grieving: "text-indigo-700",
};

export function PortraitCard({ character, selected, onSelect, bio, onRevealBio }: Props) {
  const moodClass = MOOD_COLOR[character.mood] ?? "text-stone-500";
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={onSelect}
        className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-sm transition ${
          selected
            ? "border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200"
            : "border-stone-300 bg-white hover:border-stone-400"
        }`}
        data-testid={`portrait-card-${character.id}`}
        aria-pressed={selected}
      >
        <div className="h-16 w-16 rounded-full bg-stone-200 flex items-center justify-center text-2xl text-stone-500">
          {character.name.charAt(0)}
        </div>
        <div className="font-medium text-stone-800">{character.name}</div>
        <div className={`text-xs ${moodClass}`}>{character.mood}</div>
      </button>
      <details
        data-testid={`portrait-bio-${character.id}`}
        className="text-xs text-stone-500"
        onToggle={(e) => {
          if (e.currentTarget.open) onRevealBio();
        }}
      >
        <summary className="cursor-pointer select-none text-center text-stone-400 hover:text-stone-600">
          Who is this?
        </summary>
        <p className="mt-1 italic leading-relaxed text-stone-600">{bio}</p>
      </details>
    </div>
  );
}
