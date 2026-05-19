import { z } from "zod";

// 5 mood values per spec §3 "Mood Transitions". Grieving is narrative-only and
// never appears in the weighted pool.
export const MOODS = ["Receptive", "Defensive", "Distracted", "Jealous", "Grieving"] as const;

export type Mood = (typeof MOODS)[number];

export const MoodSchema = z.enum(MOODS);

// Weighted pool for the 15% mood-drift reroll. Receptive 4 / Defensive 2 /
// Distracted 2 / Jealous 1 (total weight 9). Grieving is intentionally absent.
export const MOOD_POOL: ReadonlyArray<{ mood: Mood; weight: number }> = [
  { mood: "Receptive", weight: 4 },
  { mood: "Defensive", weight: 2 },
  { mood: "Distracted", weight: 2 },
  { mood: "Jealous", weight: 1 },
];

// Derived sum so test fixtures and the pool-pick formula reference the same
// constant; a future rebalance of individual weights doesn't drift them apart.
export const MOOD_POOL_TOTAL_WEIGHT: number = MOOD_POOL.reduce((s, e) => s + e.weight, 0);
