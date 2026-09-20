import { describe, expect, it } from "vitest";
import { detectAnomalies, type AnomalyInput } from "../anomalies";
import type { CardMerge, Enrollment, Family, MultiHousehold, Person } from "../types";

const person = (id: string, o: Partial<Person> = {}): Person => ({
  id, anchorRecordId: `RAT-${id}`, canonicalName: "Test Person", dob: "1950-01-01", gender: "M",
  uidLast4: null, maritalStatus: null, isDeceased: false, deceasedOn: null, recordIds: [], ...o,
});

const family = (id: string, o: Partial<Family> = {}): Family => ({
  id, headPersonId: null, district: "Mehsana", taluka: "Kadi", village: "Kansa", resolvedIncome: 90_000,
  incomeSources: [], isAnchored: true, status: "active", mergedInto: null, parentFamilyId: null,
  cardRefs: [], ...o,
});

const enrollment = (
  personId: string, familyId: string, schemeCode: string, sourceRecordId: string, monthlyAmount: number | null,
): Enrollment => ({ personId, familyId, schemeCode, sourceRecordId, monthlyAmount });

const detect = (o: Partial<AnomalyInput> = {}) =>
  detectAnomalies({
    persons: [], families: [], enrollments: [], cardMerges: [], multiHousehold: [],
    deathRecordIdsByPerson: new Map(), ...o,
  });

const income = (...values: number[]) =>
  values.map((value, i) => ({ recordId: `R-${i}`, source: "ration" as const, value }));

describe("deceased_beneficiary", () => {
  const dead = person("P-1", { isDeceased: true, deceasedOn: "2026-07-02" });

  it("flags a dead person who still has a paying enrollment, with evidence and the benefit as leakage", () => {
    const { flags, leakageByEnrollment } = detect({
      persons: [dead], families: [family("F-1")],
      enrollments: [enrollment("P-1", "F-1", "OLD_AGE_PENSION", "PEN-1", 1000)],
      deathRecordIdsByPerson: new Map([["P-1", ["DTH-1"]]]),
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      type: "deceased_beneficiary", severity: "high", familyId: "F-1", personId: "P-1",
      estMonthlyLeakage: 1000, status: "open",
      evidence: {
        deceasedOn: "2026-07-02", deathRecordIds: ["DTH-1"],
        enrollments: [{ recordId: "PEN-1", scheme: "OLD_AGE_PENSION", monthlyAmount: 1000 }],
      },
    });
    expect(leakageByEnrollment.get("PEN-1")).toBe(1000);
  });

  it("sums several benefits", () => {
    const { flags } = detect({
      persons: [dead], families: [family("F-1")],
      enrollments: [
        enrollment("P-1", "F-1", "OLD_AGE_PENSION", "PEN-1", 1000),
        enrollment("P-1", "F-1", "WIDOW_ASSIST", "PEN-2", 1250),
      ],
    });
    expect(flags[0].estMonthlyLeakage).toBe(2250);
  });

  it("ignores living people and enrollments without a benefit amount", () => {
    expect(detect({
      persons: [person("P-1")], families: [family("F-1")],
      enrollments: [enrollment("P-1", "F-1", "OLD_AGE_PENSION", "PEN-1", 1000)],
    }).flags).toHaveLength(0);
    expect(detect({
      persons: [dead], families: [family("F-1")],
      enrollments: [enrollment("P-1", "F-1", "NFSA_RATION", "RAT-1", null)],
    }).flags).toHaveLength(0);
  });
});

describe("duplicate_enrollment", () => {
  it("flags one person enrolled twice in the same scheme and counts the extra benefit", () => {
    const { flags, leakageByEnrollment } = detect({
      persons: [person("P-1")], families: [family("F-1")],
      enrollments: [
        enrollment("P-1", "F-1", "OLD_AGE_PENSION", "PEN-2", 1000),
        enrollment("P-1", "F-1", "OLD_AGE_PENSION", "PEN-1", 1000),
      ],
    });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      type: "duplicate_enrollment", severity: "high", personId: "P-1", estMonthlyLeakage: 1000,
      evidence: {
        scheme: "OLD_AGE_PENSION",
        enrollments: [{ recordId: "PEN-1", monthlyAmount: 1000 }, { recordId: "PEN-2", monthlyAmount: 1000 }],
      },
    });
    expect(leakageByEnrollment.get("PEN-2")).toBe(1000);
    expect(leakageByEnrollment.has("PEN-1")).toBe(false);
  });

  it("does not flag different schemes or a single enrollment", () => {
    expect(detect({
      persons: [person("P-1")], families: [family("F-1")],
      enrollments: [
        enrollment("P-1", "F-1", "OLD_AGE_PENSION", "PEN-1", 1000),
        enrollment("P-1", "F-1", "WIDOW_ASSIST", "PEN-2", 1250),
      ],
    }).flags).toHaveLength(0);
  });

  it("leaves leakage null when the amounts are unknown", () => {
    const { flags } = detect({
      persons: [person("P-1")], families: [family("F-1")],
      enrollments: [
        enrollment("P-1", "F-1", "SCHOLARSHIP", "SCH-1", null),
        enrollment("P-1", "F-1", "SCHOLARSHIP", "SCH-2", null),
      ],
    });
    expect(flags[0].estMonthlyLeakage).toBeNull();
  });

  it("flags a duplicate ration card, in the kept family, with the evidence", () => {
    const merge: CardMerge = {
      keptRef: "RC-1", mergedRef: "RC-9", keptFamilyId: "F-1", mergedFamilyId: "F-9", sharedPersons: 3, ratio: 0.75,
    };
    const { flags } = detect({ cardMerges: [merge] });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      type: "duplicate_enrollment", severity: "high", familyId: "F-1", personId: null, estMonthlyLeakage: null,
      evidence: { scheme: "NFSA_RATION", keptCard: "RC-1", duplicateCard: "RC-9", sharedPersons: 3, shareOfSmallerCard: 0.75 },
    });
  });
});

describe("multi_household", () => {
  it("flags a person on two unmerged ration cards, with no leakage estimate", () => {
    const m: MultiHousehold = {
      personId: "P-1", keptFamilyId: "F-2", keptCardRef: "RC-2", otherCardRefs: ["RC-1"], otherFamilyIds: ["F-1"],
    };
    const { flags } = detect({ multiHousehold: [m] });
    expect(flags).toEqual([
      expect.objectContaining({
        type: "multi_household", severity: "medium", familyId: "F-2", personId: "P-1", estMonthlyLeakage: null,
        evidence: { keptCard: "RC-2", otherCards: ["RC-1"], otherFamilyIds: ["F-1"] },
      }),
    ]);
  });
});

describe("income_mismatch", () => {
  const flagsFor = (...values: number[]) =>
    detect({ families: [family("F-1", { incomeSources: income(...values) })] }).flags;

  it("flags highest over 1.5x the lowest when the gap exceeds 50,000", () => {
    const [flag] = flagsFor(90_000, 200_000);
    expect(flag).toMatchObject({
      type: "income_mismatch", severity: "medium", familyId: "F-1", estMonthlyLeakage: null,
      evidence: { highest: 200_000, lowest: 90_000 },
    });
    expect(flag.evidence.sources).toHaveLength(2);
    expect(flagsFor(40_000, 100_000)).toHaveLength(1); // ratio 2.5, gap 60,000
  });

  it("needs both conditions", () => {
    expect(flagsFor(100_000, 140_000)).toHaveLength(0); // gap 40,000, ratio 1.4
    expect(flagsFor(10_000, 30_000)).toHaveLength(0); // ratio 3 but gap only 20,000
    expect(flagsFor(200_000, 240_000)).toHaveLength(0); // gap 40,000
    expect(flagsFor(100_000, 150_000)).toHaveLength(0); // ratio exactly 1.5
    expect(flagsFor(100_000, 151_000)).toHaveLength(1);
  });

  it("ignores a single income value and merged families", () => {
    expect(flagsFor(90_000)).toHaveLength(0);
    expect(
      detect({ families: [family("F-1", { status: "merged", incomeSources: income(10_000, 200_000) })] }).flags,
    ).toHaveLength(0);
  });
});

describe("unanchored_beneficiary", () => {
  it("flags a benefit in a family that was not built from a ration card", () => {
    const { flags } = detect({
      persons: [person("P-1")], families: [family("F-1", { isAnchored: false })],
      enrollments: [enrollment("P-1", "F-1", "OLD_AGE_PENSION", "PEN-1", 1000)],
    });
    expect(flags).toEqual([
      expect.objectContaining({
        type: "unanchored_beneficiary", severity: "low", familyId: "F-1", personId: "P-1", estMonthlyLeakage: null,
        evidence: { enrollments: [{ recordId: "PEN-1", scheme: "OLD_AGE_PENSION", monthlyAmount: 1000 }] },
      }),
    ]);
  });

  it("does not flag anchored families", () => {
    expect(detect({
      persons: [person("P-1")], families: [family("F-1")],
      enrollments: [enrollment("P-1", "F-1", "OLD_AGE_PENSION", "PEN-1", 1000)],
    }).flags).toHaveLength(0);
  });
});

describe("flag ids and ordering", () => {
  const input: Partial<AnomalyInput> = {
    persons: [person("P-1", { isDeceased: true }), person("P-2")],
    families: [family("F-1", { incomeSources: income(50_000, 200_000) }), family("F-2", { isAnchored: false })],
    enrollments: [
      enrollment("P-1", "F-1", "OLD_AGE_PENSION", "PEN-1", 1000),
      enrollment("P-2", "F-2", "OLD_AGE_PENSION", "PEN-2", 1000),
    ],
  };

  it("numbers flags after sorting by type, then family and person", () => {
    const { flags } = detect(input);
    expect(flags.map((f) => [f.id, f.type])).toEqual([
      ["FLG-000001", "deceased_beneficiary"],
      ["FLG-000002", "income_mismatch"],
      ["FLG-000003", "unanchored_beneficiary"],
    ]);
  });

  it("is deterministic", () => {
    expect(detect(input)).toEqual(detect(input));
  });

  it("stores evidence on every flag", () => {
    for (const flag of detect(input).flags) expect(Object.keys(flag.evidence).length).toBeGreaterThan(0);
  });
});
