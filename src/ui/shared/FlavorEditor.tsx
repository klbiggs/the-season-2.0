// P26 (G8): the edit + regenerate control shared by every flavor-prose surface
// (ballroom PortraitCard bio, SocietyView bio, FamilyTreeTab bio, ArtifactsTab
// backstory). Extracted rather than inlined four times: the read/edit toggle
// carries enough local state (draft buffer, cancel-restores-original) that four
// copies would drift.
//
// Scandal columns deliberately get NO editor — regenerating one re-aggregates
// over a (priorColumnTick, now] window that has since moved, so the replacement
// would cover the wrong events (see the P18 aggregation-window pin).

import { useState } from "react";
import type { FlavorContentId } from "../../game/rng.seeds";
import { useStreamingFlavor } from "./useStreamingFlavor";

type Props = {
  // The text currently displayed — a persisted entry OR the designer stub.
  text: string;
  // The entry's id, so the editor can render an in-flight generation
  // progressively (P26 G1). Streaming text preempts `text` while it lasts.
  flavorId: FlavorContentId;
  onSave: (text: string) => void;
  onRegenerate: () => void;
  testIdPrefix: string;
};

export function FlavorEditor({ text, flavorId, onSave, onRegenerate, testIdPrefix }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const streaming = useStreamingFlavor(flavorId);

  // A passage mid-generation: show the partial, suppress the affordances.
  // Editing or re-regenerating half a sentence is meaningless, and the buffer
  // is about to be replaced by the settled text anyway.
  if (streaming !== undefined) {
    return (
      <p
        className="mt-1 italic leading-relaxed text-stone-400"
        data-testid={`${testIdPrefix}-streaming`}
      >
        {streaming}
      </p>
    );
  }

  if (draft !== null) {
    return (
      <div className="mt-1 flex flex-col gap-1">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={4}
          className="w-full rounded border border-stone-300 p-1 text-xs leading-relaxed text-stone-700"
          data-testid={`${testIdPrefix}-textarea`}
        />
        <div className="flex gap-2 self-end">
          <button
            type="button"
            onClick={() => setDraft(null)}
            className="text-[11px] text-stone-400 hover:text-stone-600"
            data-testid={`${testIdPrefix}-cancel`}
          >
            Cancel
          </button>
          <button
            type="button"
            // Empty drafts are rejected by authorFlavorText; disabling here
            // makes that a visible affordance rather than a silent no-op.
            disabled={draft.trim() === ""}
            onClick={() => {
              onSave(draft);
              setDraft(null);
            }}
            className="text-[11px] text-emerald-700 hover:text-emerald-900 disabled:text-stone-300"
            data-testid={`${testIdPrefix}-save`}
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-1">
      <p className="italic leading-relaxed text-stone-600">{text}</p>
      <div className="flex gap-2 self-end">
        <button
          type="button"
          onClick={() => setDraft(text)}
          className="text-[11px] text-stone-400 hover:text-stone-600"
          data-testid={`${testIdPrefix}-edit`}
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onRegenerate}
          className="text-[11px] text-stone-400 hover:text-stone-600"
          data-testid={`${testIdPrefix}-regenerate`}
        >
          Regenerate
        </button>
      </div>
    </div>
  );
}
