import { describe, expect, it } from "vitest";
import {
  dobScore, findMatches, isMatch, jaroWinkler, nameScore, pairKeyOf, scorePair,
} from "../match";
import { norm, rec } from "./fixtures";

const RAMESH = {
  full_name: "Ramesh Kantilal Patel", dob: "14/03/1959", gender: "M" as const,
};

describe("Jaro-Winkler", () => {
  it("matches the published reference values", () => {
    expect(jaroWinkler("MARTHA", "MARHTA")).toBeCloseTo(0.9611, 3);
    expect(jaroWinkler("DIXON", "DICKSONX")).toBeCloseTo(0.8133, 3);
    expect(jaroWinkler("DWAYNE", "DUANE")).toBeCloseTo(0.84, 2);
  });

  it("is 1 for equal strings and 0 for disjoint or empty ones", () => {
    expect(jaroWinkler("patel", "patel")).toBe(1);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
    expect(jaroWinkler("", "patel")).toBe(0);
  });

  it("scores patel / patal high even though their phonetic keys differ", () => {
    expect(jaroWinkler("patel", "patal")).toBeGreaterThan(0.85);
  });
});

describe("field scores", () => {
  it("scores DOB: exact 1, day/month swapped 0.8, same year 0.6, approximate within a year 0.5, else 0", () => {
    const base = norm({ id: "A", full_name: "X Y Patel", dob: "05/11/1984" });
    const score = (dob: string) => dobScore(base, norm({ id: "B", full_name: "X Y Patel", dob }));
    expect(score("05/11/1984")).toBe(1);
    expect(score("11/05/1984")).toBe(0.8);
    expect(score("1984")).toBe(0.6);
    expect(score("20/01/1984")).toBe(0.6);
    expect(score("age 42")).toBe(0.6); // 2026 - 42 = 1984
    expect(score("age 41")).toBe(0.5); // 1985: one year off, approximate
    expect(score("05/11/1985")).toBe(0);
    expect(score("age 30")).toBe(0);
  });

  it("returns null when either DOB is missing", () => {
    const a = norm({ id: "A", full_name: "X Y Patel", dob: "1984" });
    expect(dobScore(a, norm({ id: "B", full_name: "X Y Patel" }))).toBeNull();
  });

  it("weights name parts 0.5 / 0.3 / 0.2 and treats equal phonetic keys as 1.0", () => {
    const a = norm({ id: "A", full_name: "Pooja Ramesh Chaudhary" });
    const b = norm({ id: "B", full_name: "Puja Ramesh Choudhari" });
    expect(nameScore(a, b)).toMatchObject({ first: 1, middle: 1, last: 1, total: 1 });
  });

  it("scores an initial against a full middle name 0.85 when the letter matches, else 0", () => {
    const full = norm({ id: "A", full_name: "Ramesh Kantilal Patel" });
    expect(nameScore(full, norm({ id: "B", full_name: "Ramesh K. Patel" })).middle).toBe(0.85);
    expect(nameScore(full, norm({ id: "C", full_name: "Ramesh D Patel" })).middle).toBe(0);
  });

  it("drops missing name parts and rescales the remaining weights", () => {
    const full = norm({ id: "A", full_name: "Dhruv Jayesh Patel" });
    const noMiddle = norm({ id: "B", full_name: "Dhruv Patel" });
    const result = nameScore(full, noMiddle);
    expect(result.middle).toBeNull();
    expect(result.total).toBe(1);
  });
});

describe("pair scoring", () => {
  it("auto-merges the same person written two ways", () => {
    const a = norm({ id: "RAT-1", ...RAMESH });
    const b = norm({
      id: "PEN-1", source: "pension", full_name: "Shri Rameshbhai Kantilaal Patel", dob: "14-03-1959",
      gender: "M", address: "H.No 21 Shivnagar Kansaa", village: "Kansaa",
    });
    const scored = scorePair(a, b);
    expect(scored.decision).toBe("auto_merge");
    expect(scored.score).toBeGreaterThanOrEqual(0.9);
  });

  it("missing fields return null and do not penalize", () => {
    const a = norm({ id: "A", ...RAMESH });
    const b = norm({ id: "B", full_name: "Ramesh Kantilal Patel", village: "" });
    const scored = scorePair(a, b);
    expect(scored.breakdown.dob).toBeNull();
    expect(scored.breakdown.address).toBeNull();
    expect(scored.score).toBe(1);
  });

  it("keeps a father and son with near-identical names distinct (DOB gap over 5 years)", () => {
    const father = norm({ id: "A", full_name: "Ramesh Bhikha Parmar", dob: "28/05/1948", gender: "M" });
    const son = norm({ id: "B", full_name: "Rakesh Ramesh Parmar", dob: "06/01/1971", gender: "M" });
    const scored = scorePair(father, son);
    expect(scored.decision).toBe("distinct");
    expect(scored.breakdown.rules.join(" ")).toContain("dob_gap_over_5_years");

    const sonkumar = norm({ id: "C", full_name: "Sureshkumar Ramesh Parmar", dob: "06/01/1971", gender: "M" });
    const suresh = norm({ id: "D", full_name: "Suresh Bhikha Parmar", dob: "28/05/1948", gender: "M" });
    expect(scorePair(suresh, sonkumar).decision).toBe("distinct");
  });

  it("forces distinct when both uid hashes are present and different", () => {
    const a = norm({ id: "A", ...RAMESH, uid_hash: "aaa" });
    const b = norm({ id: "B", ...RAMESH, uid_hash: "bbb" });
    const scored = scorePair(a, b);
    expect(scored.decision).toBe("distinct");
    expect(scored.breakdown.uid).toBe(0);
    expect(scored.breakdown.rules.join(" ")).toContain("uid_different");
  });

  it("gives an equal uid hash a final 0.99, even when middle name and surname changed", () => {
    const maiden = norm({
      id: "A", full_name: "Ami Arvind Parmar", dob: "20/07/1986", gender: "F", uid_hash: "same", village: "Dharmaj",
      taluka: "Anand",
    });
    const married = norm({
      id: "B", full_name: "Ami Alpesh Gohil", dob: "20/07/1986", gender: "F", uid_hash: "same", village: "Danta",
      taluka: "Deesa", district: "Banaskantha",
    });
    const scored = scorePair(maiden, married);
    expect(scored.score).toBe(0.99);
    expect(scored.decision).toBe("auto_merge");
    expect(scored.breakdown.uid).toBe(1);
    expect(scored.breakdown.rules).toEqual(["uid_equal: score set to 0.99"]);
  });

  it("subtracts 0.25 when both middle names are full and differ", () => {
    const a = norm({ id: "A", ...RAMESH });
    const b = norm({ id: "B", ...RAMESH, full_name: "Ramesh Dinesh Patel" });
    const scored = scorePair(a, b);
    expect(scored.breakdown.rules.join(" ")).toContain("middle_name_mismatch");
    expect(scored.score).toBeCloseTo(scored.breakdown.weighted - 0.25, 3);
    expect(scored.decision).not.toBe("auto_merge");
  });

  it("does not apply the middle-name penalty to an initial", () => {
    const a = norm({ id: "A", ...RAMESH });
    const b = norm({ id: "B", ...RAMESH, full_name: "Ramesh D Patel" });
    expect(scorePair(a, b).breakdown.rules).toEqual([]);
  });

  it("forces distinct when gender differs", () => {
    const a = norm({ id: "A", ...RAMESH });
    const b = norm({ id: "B", ...RAMESH, gender: "F" });
    expect(scorePair(a, b).decision).toBe("distinct");
  });

  it("classifies 0.90 and above as auto_merge, 0.75 up to 0.90 as review, below 0.75 as distinct", () => {
    // same name and village, different day of birth in the same year: 0.45 + 0.35*0.6 + 0.2*0.7 = 0.80
    const a = norm({ id: "A", ...RAMESH, address: "21, Shivnagar, Kansa" });
    const sameYear = norm({ id: "B", ...RAMESH, dob: "20/09/1959", address: "99, Other Road, Kansa" });
    expect(scorePair(a, sameYear).decision).toBe("review");
    const otherYear = norm({ id: "C", ...RAMESH, dob: "20/09/1962", address: "99, Other Road, Kansa" });
    expect(scorePair(a, otherYear).decision).toBe("distinct");
  });
});

describe("blocking and classification over a record set", () => {
  const ids = (list: ReturnType<typeof findMatches>) => list.map((c) => c.pairKey);

  it("pairs records by district + surname key, by uid, and by birth year + first letter", () => {
    const records = [
      norm({ id: "R1", ...RAMESH }),
      // shares district and surname phonetic key (chaudhary / choudhari), nothing else
      norm({ id: "R2", full_name: "Kiran Dinesh Chaudhary", dob: "01/01/1990", gender: "F" }),
      norm({ id: "R3", full_name: "Anita Mohan Choudhari", dob: "03/03/1991", gender: "F" }),
      // shares only a uid
      norm({ id: "R4", full_name: "Zzz Qqq Xxx", district: "Anand", uid_hash: "u1", dob: "01/01/1970" }),
      norm({ id: "R5", full_name: "Yyy Www Vvv", district: "Banaskantha", uid_hash: "u1", dob: "01/01/1971" }),
      // shares only birth year and first letter, in a different district with a different surname
      norm({ id: "R6", full_name: "Rajesh Bhikha Solanki", district: "Anand", dob: "02/04/1959", gender: "M" }),
      // no shared block with anything
      norm({ id: "R7", full_name: "Maya Lalit Modi", district: "Anand", dob: "01/01/2001", gender: "F" }),
    ];
    const keys = ids(findMatches(records));
    expect(keys).toContain("R2|R3");
    expect(keys).toContain("R4|R5");
    expect(keys).toContain("R1|R6");
    expect(keys.filter((k) => k.includes("R7"))).toHaveLength(0);
    expect(keys.filter((k) => k.includes("R1|R7"))).toHaveLength(0);
  });

  it("never compares two death registry records with each other", () => {
    const records = [
      norm({ id: "DTH-1", source: "death_registry", ...RAMESH }),
      norm({ id: "DTH-2", source: "death_registry", ...RAMESH }),
      norm({ id: "RAT-1", ...RAMESH }),
    ];
    const keys = ids(findMatches(records));
    expect(keys).not.toContain("DTH-1|DTH-2");
    expect(keys).toContain("DTH-1|RAT-1");
    expect(keys).toContain("DTH-2|RAT-1");
  });

  it("stores the score breakdown on every candidate and orders pair keys smaller|larger", () => {
    const [c] = findMatches([norm({ id: "B-2", ...RAMESH }), norm({ id: "A-1", ...RAMESH })]);
    expect(c.pairKey).toBe("A-1|B-2");
    expect(c.pairKey).toBe(pairKeyOf("B-2", "A-1"));
    expect(c.breakdown).toMatchObject({ name: 1, dob: 1, address: 1, uid: null, rules: [] });
    expect(c.decision).toBe("auto_merge");
  });

  it("marks review-band pairs pending", () => {
    const [c] = findMatches([
      norm({ id: "A", ...RAMESH }),
      norm({ id: "B", ...RAMESH, dob: "20/09/1959", address: "99, Other Road, Kansa" }),
    ]);
    expect(c.decision).toBe("review");
    expect(c.reviewStatus).toBe("pending");
    expect(isMatch(c)).toBe(false);
  });

  it("lets an officer's decision override the classification", () => {
    const records = [
      norm({ id: "A", ...RAMESH }),
      norm({ id: "B", ...RAMESH, dob: "20/09/1959", address: "99, Other Road, Kansa" }),
    ];
    const approved = findMatches(records, [{ pairKey: "A|B", decision: "approved" }])[0];
    expect(approved.reviewStatus).toBe("approved");
    expect(isMatch(approved)).toBe(true);

    const rejected = findMatches(records, [{ pairKey: "A|B", decision: "rejected" }])[0];
    expect(rejected.decision).toBe("distinct");
    expect(rejected.reviewStatus).toBe("rejected");
    expect(isMatch(rejected)).toBe(false);
  });

  it("applies a decision even when blocking would not have proposed the pair", () => {
    const records = [
      norm({ id: "A", full_name: "Aaa Bbb Ccc", district: "Anand", dob: "01/01/1950", gender: "M" }),
      norm({ id: "B", full_name: "Xxx Yyy Zzz", district: "Mehsana", dob: "01/01/1990", gender: "M" }),
    ];
    expect(findMatches(records)).toHaveLength(0);
    const [c] = findMatches(records, [{ pairKey: "A|B", decision: "approved" }]);
    expect(isMatch(c)).toBe(true);
  });

  it("is deterministic and independent of input order", () => {
    const records = [
      norm({ id: "R1", ...RAMESH }),
      norm({ id: "R2", ...RAMESH, source: "pension" }),
      norm({ id: "R3", full_name: "Savita Ramesh Patel", dob: "02/08/1962", gender: "F" }),
      norm({ id: "R4", full_name: "Savitaben Ramesh Patel", dob: "02/08/1962", gender: "F" }),
    ];
    const forward = findMatches(records);
    expect(findMatches([...records].reverse())).toEqual(forward);
    expect(findMatches(records)).toEqual(forward);
  });
});

describe("rec fixture sanity", () => {
  it("builds normalizable records", () => {
    expect(norm({ id: "X", full_name: "Ramesh Kantilal Patel" }).phonetic.last).toBe("patel");
    expect(rec({ id: "X", full_name: "A B C" }).source).toBe("ration");
  });
});
