// Strategy-map backdrop. Static asset generated once at dev time via
// `pnpm generate:map` (scripts/generate-map.mjs → gemini-3-pro-image-preview).
// The pin overlay in <MapView /> renders all placenames; the artwork itself
// is wordless so DOM labels stay alignable.

export function MapBackdrop() {
  return (
    <img
      src="/map.png"
      alt=""
      aria-hidden="true"
      data-testid="map-backdrop"
      className="absolute inset-0 w-full h-full object-cover rounded-lg border border-stone-300"
    />
  );
}
