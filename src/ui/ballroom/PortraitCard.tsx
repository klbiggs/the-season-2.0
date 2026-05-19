// Single NPC portrait card. Shows name, mood, role label. Click selects
// the NPC as the conversation target.

import type { Character } from "../../game/entities";

type Props = {
  character: Character;
  selected: boolean;
  onSelect: () => void;
};

const MOOD_COLOR: Readonly<Record<string, string>> = {
  Receptive: "text-emerald-700",
  Defensive: "text-amber-700",
  Distracted: "text-stone-500",
  Jealous: "text-rose-700",
  Grieving: "text-indigo-700",
};

export function PortraitCard({ character, selected, onSelect }: Props) {
  const moodClass = MOOD_COLOR[character.mood] ?? "text-stone-500";
  return (
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
  );
}
