// 5 portrait cards arranged in a CSS grid. Selection is single-target.

import type { Character } from "../../game/entities";
import type { CharacterId } from "../../game/rng";
import { PortraitCard } from "./PortraitCard";

type Props = {
  npcs: ReadonlyArray<Character>;
  selectedTargetId: CharacterId | null;
  onSelect: (id: CharacterId) => void;
};

export function PortraitRing({ npcs, selectedTargetId, onSelect }: Props) {
  return (
    <div
      className="grid grid-cols-5 gap-3"
      data-testid="portrait-ring"
      role="radiogroup"
      aria-label="Choose a conversation target"
    >
      {npcs.map((npc) => (
        <PortraitCard
          key={npc.id}
          character={npc}
          selected={selectedTargetId === npc.id}
          onSelect={() => onSelect(npc.id)}
        />
      ))}
    </div>
  );
}
