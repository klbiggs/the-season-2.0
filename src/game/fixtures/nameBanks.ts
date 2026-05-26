// P16: era/gender-keyed name banks for procedural NPC generation + newborn
// naming. Given names are keyed by era ("Earlier" ≈ Regency, "Later" ≈ early
// Victorian) × gender; surnames are keyed by era. Surname lists intentionally
// avoid the hand-crafted baseline (Aldridge/Blackwood/Carrington/Dunmore/
// Ellsworth) and rival (Ashford/Beaumont/Cavendish) surnames to avoid identity
// confusion in the ledger and social web.
//
// dynastySurnameForHouse derives a stable per-house family surname from the
// houseId via the shared FNV-1a; it is pinned to the FOUNDING era ("Earlier")
// so a house's surname never changes when the era flips. Newborn children take
// `${givenName} ${dynastySurnameForHouse(houseId)}`.

import type { CharacterId, HouseId } from "../rng";
import { fnv1a32, hashCharIdToGender } from "./hashCharIdToGender";

type Era = "Earlier" | "Later";
type Gender = "Female" | "Male";

export const GIVEN_NAMES: Readonly<Record<Era, Record<Gender, readonly string[]>>> = {
  Earlier: {
    Female: [
      "Arabella",
      "Honoria",
      "Augusta",
      "Cordelia",
      "Georgiana",
      "Henrietta",
      "Lavinia",
      "Beatrix",
      "Wilhelmina",
      "Sophia",
      "Charlotte",
      "Frederica",
      "Maria",
      "Eleanor",
      "Penelope",
      "Clarissa",
      "Dorothea",
      "Amelia",
      "Theodosia",
      "Isabella",
      "Cassandra",
      "Rosamund",
      "Margaret",
      "Catherine",
      "Louisa",
    ],
    Male: [
      "Augustus",
      "Frederick",
      "Reginald",
      "Percival",
      "Bartholomew",
      "Cornelius",
      "Horatio",
      "Tobias",
      "Lionel",
      "Edmund",
      "Sebastian",
      "Algernon",
      "Montague",
      "Rupert",
      "Tristram",
      "Ambrose",
      "Benedict",
      "Crispin",
      "Hugh",
      "Marcus",
      "Nathaniel",
      "Roderick",
      "Theodore",
      "Valentine",
      "Lucius",
    ],
  },
  Later: {
    Female: [
      "Florence",
      "Beatrice",
      "Adelaide",
      "Victoria",
      "Evangeline",
      "Millicent",
      "Constance",
      "Edith",
      "Agnes",
      "Mabel",
      "Harriet",
      "Josephine",
      "Clara",
      "Rosalind",
      "Winifred",
      "Gwendolen",
      "Matilda",
      "Prudence",
      "Cecilia",
      "Blanche",
      "Ada",
      "Lillian",
      "Maud",
      "Violet",
      "Eugenia",
    ],
    Male: [
      "Albert",
      "Edmund",
      "Walter",
      "Clarence",
      "Percy",
      "Herbert",
      "Cuthbert",
      "Aloysius",
      "Leopold",
      "Bertram",
      "Gideon",
      "Mortimer",
      "Ernest",
      "Wilfred",
      "Reuben",
      "Sidney",
      "Archibald",
      "Cyril",
      "Humphrey",
      "Lambert",
      "Oswald",
      "Quentin",
      "Silas",
      "Vernon",
      "Barnaby",
    ],
  },
} as const;

export const SURNAMES: Readonly<Record<Era, readonly string[]>> = {
  Earlier: [
    "Hartwell",
    "Pembroke",
    "Wexford",
    "Ashby",
    "Fairfax",
    "Carteret",
    "Sinclair",
    "Thornbury",
    "Wycliffe",
    "Davenport",
    "Ravenscroft",
    "Hawkesworth",
    "Lindsey",
    "Marchmont",
    "Netherby",
    "Oakenshaw",
    "Pennington",
    "Quillan",
    "Risley",
    "Stradbroke",
    "Tilney",
    "Underhill",
    "Vaughan",
    "Wenlock",
    "Yardley",
    "Almsley",
    "Brackenbury",
    "Coreford",
    "Denbigh",
    "Estcourt",
    "Fenwick",
    "Grantham",
    "Holloway",
    "Kelsey",
    "Larkspur",
    "Mowbray",
    "Norcliffe",
    "Ottershaw",
    "Penhallow",
    "Redmayne",
  ],
  Later: [
    "Ashworth",
    "Blackmore",
    "Cresswell",
    "Drummond",
    "Ellingham",
    "Fotheringay",
    "Grenville",
    "Harcourt",
    "Inglewood",
    "Jardine",
    "Kingsley",
    "Lockwood",
    "Merriweather",
    "Northcote",
    "Ormsby",
    "Prentiss",
    "Quenby",
    "Rutherford",
    "Stanhope",
    "Trevelyan",
    "Ulverton",
    "Vansittart",
    "Westbrook",
    "Yarborough",
    "Aldous",
    "Bexley",
    "Cardew",
    "Dorrington",
    "Everleigh",
    "Falconer",
    "Granby",
    "Hetherington",
    "Ilminster",
    "Jephson",
    "Kentigern",
    "Loxley",
    "Mainwaring",
    "Norbury",
    "Ovingdean",
    "Pemberton",
  ],
} as const;

// Period honorific by gender. Society NPCs are all unwed gentry, so the marital
// "Mrs." form is not produced at v1; newborns get no honorific (just
// "<Given> <Surname>"). Gender-only — role does not affect the honorific for the
// unwed society cohort.
export function honorificFor(gender: Gender): string {
  return gender === "Female" ? "Miss" : "Mr.";
}

// Deterministic per-house dynasty surname, pinned to the FOUNDING era so it is
// stable across an era flip. Uses the shared unsigned FNV-1a over the houseId.
export function dynastySurnameForHouse(houseId: HouseId): string {
  const bank = SURNAMES.Earlier;
  return bank[fnv1a32(houseId) % bank.length] as string;
}

// P22: founder name. Same scheme as descendants (`${given} ${dynastySurname}`,
// no regnal numeral) so the founder is not the odd one out. Gender + given name
// are HASH-picked over the founder id (founding-era bank), NOT RNG draws — the
// bootstrap draw budget stays at 1 (player deathAge only). Surname = the house
// dynasty surname, so founder and descendants share it.
export function founderName(characterId: CharacterId, houseId: HouseId): string {
  const gender = hashCharIdToGender(characterId);
  const bank = GIVEN_NAMES.Earlier[gender];
  const given = bank[fnv1a32(characterId) % bank.length] as string;
  return `${given} ${dynastySurnameForHouse(houseId)}`;
}
