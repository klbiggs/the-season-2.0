// P17: pre-authored lore corpus for semantic memory. Embedded once per save
// slot at first launch (seedLoreCorpus) into the vector-index sidecar with
// `entryType: "Lore"` and null (house, npc) filters — global context eligible
// for any conversation. These are flavor passages (Regency / early-Victorian
// London Society), NOT designer tuning, so they live in fixtures, not
// constants.ts. Keep each passage short (one or two sentences) — they ride on
// the per-turn prompt and the token budget is shared with the recency window.

export type LorePassage = {
  id: string;
  text: string;
};

export const LORE_CORPUS: ReadonlyArray<LorePassage> = [
  {
    id: "lore-capital-season",
    text: "The Season in the Capital runs from the spring drawing rooms to the summer's end; reputations are made at its balls and unmade in its retiring rooms.",
  },
  {
    id: "lore-capital-patronesses",
    text: "Entry to the most exclusive Capital assemblies turns on the favor of its lady patronesses, whose vouchers are withheld as readily as they are granted.",
  },
  {
    id: "lore-country-estate",
    text: "A family's country estate is the seat of its name — its rents, its tenantry, and the quiet alliances struck at its shooting parties sustain the house between Seasons.",
  },
  {
    id: "lore-country-retreat",
    text: "When scandal grows too warm in town, a prudent family retires to the country to let the gossip cool, returning when memories have conveniently shortened.",
  },
  {
    id: "lore-finishing-cultured",
    text: "The cultured continental capital polishes a young person in music, languages, and the arts; a finishing season there lends a fashionable continental gloss.",
  },
  {
    id: "lore-finishing-political",
    text: "The political continental capital schools its visitors in statecraft and intrigue; those who finish there return fluent in the grammar of power.",
  },
  {
    id: "lore-canal-city",
    text: "The canal city, all masked carnivals and shadowed waterways, is where discreet affairs of the heart are conducted far from the eyes of London society.",
  },
  {
    id: "lore-renaissance-city",
    text: "The renaissance city, with its art and its languid afternoons, has undone many a careful engagement; lovers elope to it as often as they merely visit.",
  },
  {
    id: "lore-foreign-capital",
    text: "The foreign capital sits behind a wartime blockade; fortunes are run through it by smugglers, and a single intercepted cargo can ruin a house.",
  },
  {
    id: "lore-whispers",
    text: "A whisper carried by courier from the country to a town drawing room can arrive weeks after the deed, yet land with all the force of fresh news.",
  },
  {
    id: "lore-duels",
    text: "An insult that cannot be answered in words is answered at dawn; a duel settles honor but seldom settles the grievance that prompted it.",
  },
  {
    id: "lore-marriage-market",
    text: "Marriage in society is a treaty between houses as much as a match between persons; affection is welcome but is rarely the first article negotiated.",
  },
  {
    id: "lore-succession",
    text: "When a head of house dies, the title and its burdens pass to the heir; a contested or premature succession can unsettle alliances built over a generation.",
  },
  {
    id: "lore-scandal-sheets",
    text: "The scandal sheets trade in initials and innuendo; a name need never be printed for all of society to know precisely whose ruin is being described.",
  },
  {
    id: "lore-forgery",
    text: "A forged heirloom or letter may pass unremarked for years, until a careless boast or a sharp-eyed rival brings the counterfeit to light.",
  },
  {
    id: "lore-promenade",
    text: "The daytime promenade in the park is society's gentler stage: a place for studied accidents of meeting, where a turn about the path can advance a courtship by weeks.",
  },
];
