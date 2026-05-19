// Placeholder backdrop for the strategy map. P16 polish will replace with
// real artwork; for P3 a styled gradient div is sufficient.

export function MapBackdrop() {
  return (
    <div
      className="absolute inset-0 rounded-lg bg-gradient-to-br from-stone-200 via-stone-100 to-amber-50 border border-stone-300"
      aria-hidden="true"
      data-testid="map-backdrop"
    />
  );
}
