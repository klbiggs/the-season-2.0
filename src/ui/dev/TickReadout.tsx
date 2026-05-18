type Props = { tick: number };

export function TickReadout({ tick }: Props) {
  return (
    <div className="text-5xl font-mono tabular-nums" data-testid="tick-readout">
      {tick}
    </div>
  );
}
