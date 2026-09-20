import { describe, expect, it } from "vitest";
import { phoneticKey } from "../../../lib/engine/normalize";
import {
  FEMALE_MID, FEMALE_OLD, FEMALE_YOUNG, MALE_MID, MALE_OLD, MALE_YOUNG, SURNAMES, VILLAGE_POOL,
} from "../names";
import { SPELL_RULES } from "../noise";

// The seed corrupts names with SPELL_RULES. The engine's phonetic key should undo all of them,
// except the one deliberate rule that only Jaro-Winkler can recover (patel -> patal).
const JARO_ONLY = String(/e(?=l$)/);

const words = [
  ...MALE_OLD, ...MALE_MID, ...MALE_YOUNG, ...FEMALE_OLD, ...FEMALE_MID, ...FEMALE_YOUNG,
  ...SURNAMES.map(([s]) => s), ...VILLAGE_POOL,
];

describe("seed spelling noise vs the phonetic key", () => {
  it("keeps the key stable for every variant except the Jaro-Winkler-only rule", () => {
    const drift: string[] = [];
    let checked = 0;
    for (const word of words) {
      const lower = word.toLowerCase();
      for (const [pattern, replacement] of SPELL_RULES) {
        if (!pattern.test(lower)) continue;
        const variant = lower.replace(pattern, replacement);
        if (variant === lower) continue;
        checked++;
        if (phoneticKey(variant) !== phoneticKey(lower) && String(pattern) !== JARO_ONLY) {
          drift.push(`${lower} -> ${variant} (${String(pattern)}): ${phoneticKey(lower)} vs ${phoneticKey(variant)}`);
        }
      }
    }
    expect(checked).toBeGreaterThan(200);
    expect(drift).toEqual([]);
  });
});
