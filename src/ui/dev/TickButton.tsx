import type { SeasonStore } from "../../game/store";

type Props = { store: SeasonStore };

export function TickButton({ store }: Props) {
  const advanceTick = store((s) => s.advanceTick);
  return (
    <button
      type="button"
      onClick={advanceTick}
      className="px-4 py-2 rounded bg-stone-800 text-stone-50 hover:bg-stone-700"
      data-testid="tick-button"
    >
      Advance tick
    </button>
  );
}
