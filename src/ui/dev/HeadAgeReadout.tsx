// Prop-driven leaf component; the Zustand selector + lookup lives in
// <DevApp />. Optional-chain form in the selector returns null for the brief
// transient between replaceState calls; this leaf renders "—" in that case.
//
// Render contract: bare integer when present, em-dash when null. No "Age:"
// prefix. Playwright `toHaveText("25")` assertion expects this exact format.

type Props = { age: number | null };

export function HeadAgeReadout({ age }: Props) {
  return (
    <span data-testid="head-age-readout" className="text-stone-700 font-mono">
      {age === null ? "—" : age}
    </span>
  );
}
