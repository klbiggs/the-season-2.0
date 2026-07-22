// Single NPC portrait card. Shows name, mood, role label. Click selects
// the NPC as the conversation target. P18: an expandable biographical note
// (generated-or-stub) sits below the card; it lives OUTSIDE the <button>
// (a <details> may not nest inside a button).

import type { Character } from "../../game/entities";
import type { FlavorContentId } from "../../game/rng.seeds";
import { FlavorEditor } from "../shared/FlavorEditor";

type Props = {
  character: Character;
  selected: boolean;
  onSelect: () => void;
  // P18: persisted-or-stub biographical note for this NPC.
  bio: string;
  // P18: fired when the player opens the "Who is this?" bio expander — triggers
  // generation (idempotent). The deliberate reveal, not a conversation.
  onRevealBio: () => void;
  // P26 (G8): author-over / regenerate the bio.
  onAuthorBio: (text: string) => void;
  onRegenerateBio: () => void;
  // P20: current tick, for the faux-pas mood-lock indicator. A character is
  // mood-locked (Defensive, immovable) while tick < moodLockUntilTick.
  tick: number;
};

const MOOD_COLOR: Readonly<Record<string, string>> = {
  Receptive: "text-emerald-700",
  Defensive: "text-amber-700",
  Distracted: "text-stone-500",
  Jealous: "text-rose-700",
  Grieving: "text-indigo-700",
};

export function PortraitCard({
  character,
  selected,
  onSelect,
  bio,
  onRevealBio,
  onAuthorBio,
  onRegenerateBio,
  tick,
}: Props) {
  const moodClass = MOOD_COLOR[character.mood] ?? "text-stone-500";
  const locked = tick < character.moodLockUntilTick;
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
        {locked && (
          <div
            className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900"
            data-testid={`portrait-moodlock-${character.id}`}
            title={`Mood-locked (Defensive) until tick ${character.moodLockUntilTick} after a faux pas.`}
          >
            🔒 Locked
          </div>
        )}
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
        <FlavorEditor
          text={bio}
          flavorId={`bio:${character.id}` as FlavorContentId}
          onSave={onAuthorBio}
          onRegenerate={onRegenerateBio}
          testIdPrefix={`portrait-bio-${character.id}`}
        />
      </details>
    </div>
  );
}
