// One-off dev script. NOT part of the runtime BYOK conversation layer in
// src/llm — runs locally with the developer's own Gemini key and writes a
// committed static asset to public/map.png. Image generation is
// non-deterministic but that's irrelevant here: the output is a build-time
// artifact, never executed in the gameplay loop or the hash projection.
//
// Modes (auto-selected by file existence):
//   - public/map.png absent  → fresh generation from INITIAL_PROMPT
//   - public/map.png present → iterative edit: sends the existing PNG back
//     in as inlineData input alongside EDIT_PROMPT. Delete the file to force
//     fresh generation.
//
// Usage: GEMINI_API_KEY=AIza... pnpm generate:map

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("Missing GEMINI_API_KEY env var.");
  console.error("Usage: GEMINI_API_KEY=AIza... pnpm generate:map");
  process.exit(1);
}

// Initial-generation prompt. Encodes the spatial layout from
// LOCATION_PIN_COORDS in src/game/fixtures/locations.ts: Britain-analog on
// the right (Capital + Country), continental Europe across the left/middle
// (ForeignCapital upper-left, Finishing/Canal/Renaissance cities
// mid-to-lower), Channel between. No in-image labels — DOM pins render
// all placenames.
const INITIAL_PROMPT = [
  "Aged hand-drawn cartography backdrop for a Regency-era social-strategy game.",
  "Composition: a large island nation occupies the right third of the image (Britain-analog), with one major city in its upper portion and a country estate in its lower portion. To the left, separated by a narrow diagonal sea channel, the continental landmass spans the middle and left of the image with several stylized 1800s cities scattered across it — one prominent northern coastal capital in the upper-left, two cultured continental capitals in the middle, two canal/renaissance cities in the lower-left.",
  "Style: 1800s engraved atlas plate. Parchment vellum texture, sepia and umber inks, hand-drawn coastlines, faint cross-hatched shading on the landmasses, an ornamental compass rose in one corner, decorative scrolled border framing the image.",
  "Critical: muted, low-contrast palette throughout so that small colored markers placed on top remain readable. NO TEXT, NO LABELS, NO PLACENAMES, NO NUMBERS anywhere in the image — the cartography is wordless. Weathered, soft, painterly.",
].join(" ");

// Iterative-edit prompt. Applied when an existing map.png is fed back in.
// Uses an allowlist approach: enumerate the 7 cities that correspond to
// LOCATION_PIN_COORDS gameplay locations, instruct the model to remove
// every other settlement (extra hamlets/forts the prior gen scattered as
// decorative filler that have no in-game meaning).
const EDIT_PROMPT = [
  "This is an existing aged-cartography map. It currently shows the 7 named cities below plus a few EXTRA decorative settlements that do not correspond to gameplay locations. Remove the extras; keep the 7 named cities exactly where they currently sit, in their current styles.",
  "KEEP these 7 cities, unchanged in position and style:",
  "  (1) The coastal port town on the upper-left of the continental (left) landmass — clustered buildings on a peninsula.",
  "  (2) The walled domed city in the middle-left of the continental landmass — circular walls around a domed center.",
  "  (3) The large circular walled city in the center of the continental landmass — the biggest fortified town on the continent.",
  "  (4) The canal-town cluster at the lower-left edge of the continental landmass — buildings with a winding canal/waterway through them.",
  "  (5) The Italian-Renaissance city in the lower portion of the continental landmass, near the compass rose — large Brunelleschi-dome cathedral with a slender campanile beside it.",
  "  (6) The large London-style city on the right-side landmass — central cathedral dome, Parliament towers, urban sprawl, river with bridges. The most visually dominant city.",
  "  (7) The chateau with formal geometric gardens on the right-side landmass — south of the London city.",
  "REMOVE any other city, town, hamlet, fortress, walled compound, or settlement illustration. In particular: remove any small hexagonal walled fortress or castle compound on the right-side landmass (currently between the London city and the chateau); remove any small spired settlement, tower, or fortified hill town in the upper-middle of the map between the upper-left port and the London city; and remove any other minor settlement clusters that don't match the 7 keepers above.",
  "Where settlements are removed, replace them with surrounding terrain: gentle hill cross-hatching, faint cross-hatched landmass shading, or empty parchment — matching the texture of adjacent terrain. Do not add new cities anywhere. Do not redraw or relocate any of the 7 keepers.",
  "Preserve everything else exactly: parchment vellum texture, sepia/umber ink palette, hand-drawn coastlines, cross-hatched water and landmass shading, ornamental scrolled border, compass rose, two-landmass composition with diagonal channel, muted low-contrast palette. The image must remain wordless — ZERO letters, ZERO words, ZERO calligraphy, ZERO numerals anywhere.",
].join(" ");

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "public", "map.png");
const inputExists = await access(outPath)
  .then(() => true)
  .catch(() => false);

// Image-editing mode in the @google/genai SDK does not accept imageConfig
// (per the SDK's "Edit Images" docs: config options other than modality are
// unsupported during editing). The output's dimensions match the input's.
const ai = new GoogleGenAI({ apiKey });
const request = inputExists
  ? {
      model: "gemini-3-pro-image-preview",
      contents: [
        {
          inlineData: { mimeType: "image/png", data: (await readFile(outPath)).toString("base64") },
        },
        { text: EDIT_PROMPT },
      ],
    }
  : {
      model: "gemini-3-pro-image-preview",
      contents: INITIAL_PROMPT,
      config: { imageConfig: { aspectRatio: "4:3", imageSize: "2K" } },
    };

console.log(
  inputExists
    ? "Editing existing public/map.png via gemini-3-pro-image-preview (this can take ~30s)..."
    : "Generating fresh public/map.png via gemini-3-pro-image-preview (this can take ~30s)...",
);

const response = await ai.models.generateContent(request);

const parts = response?.candidates?.[0]?.content?.parts ?? [];
const imagePart = parts.find((p) => p.inlineData?.data);
if (!imagePart?.inlineData?.data) {
  console.error("No image in response. Full response:");
  console.error(JSON.stringify(response, null, 2));
  process.exit(1);
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, Buffer.from(imagePart.inlineData.data, "base64"));

console.log(`Wrote ${outPath}`);
