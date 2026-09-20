import { describe, expect, it } from "vitest";
import { buildFallback, buildFallbackEn, buildFallbackGu } from "../fallback";
import { buildFacts, type AssistantFacts } from "../assistant";
import type { EligibilityRow, EnrollmentRow, FamilyRow, MemberRow, PersonRow } from "../../db/queries";

// ---- test fixtures -----------------------------------------------------------------------

function makeFacts(overrides: Partial<AssistantFacts> = {}): AssistantFacts {
  return {
    familySize: 4,
    incomeBand: "up to ₹1,20,000",
    members: [
      { relation: "head", ageBand: "60+", gender: "M" },
      { relation: "spouse", ageBand: "18-59", gender: "F" },
      { relation: "son", ageBand: "18-59", gender: "M" },
      { relation: "granddaughter", ageBand: "0-17", gender: "F" },
    ],
    eligibility: [
      {
        personId: null,
        schemeCode: "NFSA_RATION",
        schemeName: "Food security ration",
        schemeNameGu: "ખાદ્ય સુરક્ષા રાશન",
        scope: "family",
        eligible: true,
        enrolled: true,
        reasons: [{ rule: "family.resolved_income lte 120000", actual: 80000, passed: true }],
      },
      {
        personId: "P-000001",
        schemeCode: "OLD_AGE_PENSION",
        schemeName: "Old age pension",
        schemeNameGu: "વૃદ્ધ સહાય પેન્શન",
        scope: "person",
        eligible: true,
        enrolled: true,
        reasons: [
          { rule: "is_deceased eq false", actual: false, passed: true },
          { rule: "age gte 60", actual: 67, passed: true },
          { rule: "family.resolved_income lte 120000", actual: 80000, passed: true },
        ],
      },
      {
        personId: "P-000004",
        schemeCode: "VAHLI_DIKRI",
        schemeName: "Vahli Dikri Yojana",
        schemeNameGu: "વહાલી દીકરી યોજના",
        scope: "person",
        eligible: true,
        enrolled: false,
        reasons: [
          { rule: "is_deceased eq false", actual: false, passed: true },
          { rule: "gender eq F", actual: "F", passed: true },
          { rule: "dob on_or_after 2019-08-02", actual: "2021-03-15", passed: true },
          { rule: "family.resolved_income lte 200000", actual: 80000, passed: true },
        ],
      },
      {
        personId: "P-000003",
        schemeCode: "OLD_AGE_PENSION",
        schemeName: "Old age pension",
        schemeNameGu: "વૃદ્ધ સહાય પેન્શન",
        scope: "person",
        eligible: false,
        enrolled: false,
        reasons: [
          { rule: "is_deceased eq false", actual: false, passed: true },
          { rule: "age gte 60", actual: 30, passed: false },
          { rule: "family.resolved_income lte 120000", actual: 80000, passed: true },
        ],
      },
    ],
    ...overrides,
  };
}

// ---- fallback tests ----------------------------------------------------------------------

describe("buildFallbackEn", () => {
  it("lists eligible and ineligible schemes", () => {
    const result = buildFallbackEn(makeFacts());
    expect(result).toContain("4 member(s)");
    expect(result).toContain("Food security ration");
    expect(result).toContain("currently enrolled");
    expect(result).toContain("Old age pension");
    expect(result).toContain("Vahli Dikri Yojana");
    expect(result).toContain("not yet enrolled");
    expect(result).toContain("Not currently eligible");
    expect(result).toContain("demo values");
  });

  it("handles no eligible schemes", () => {
    const facts = makeFacts({
      eligibility: [
        {
          personId: "P-000001",
          schemeCode: "OLD_AGE_PENSION",
          schemeName: "Old age pension",
          schemeNameGu: "વૃદ્ધ સહાય પેન્શન",
          scope: "person",
          eligible: false,
          enrolled: false,
          reasons: [{ rule: "age gte 60", actual: 30, passed: false }],
        },
      ],
    });
    const result = buildFallbackEn(facts);
    expect(result).toContain("no schemes show eligibility");
    expect(result).toContain("Not currently eligible");
  });

  it("handles empty eligibility", () => {
    const result = buildFallbackEn(makeFacts({ eligibility: [] }));
    expect(result).toContain("no schemes show eligibility");
    expect(result).not.toContain("Not currently eligible");
  });
});

describe("buildFallbackGu", () => {
  it("produces Gujarati output with scheme names", () => {
    const result = buildFallbackGu(makeFacts());
    expect(result).toContain("4 સભ્ય(ઓ) છે");
    expect(result).toContain("ખાદ્ય સુરક્ષા રાશન");
    expect(result).toContain("વૃદ્ધ સહાય પેન્શન");
    expect(result).toContain("વહાલી દીકરી યોજના");
    expect(result).toContain("હાલમાં નોંધાયેલ");
    expect(result).toContain("હજુ નોંધાયેલ નથી");
    expect(result).toContain("ડેમો મૂલ્યો");
  });

  it("handles no eligible schemes in Gujarati", () => {
    const facts = makeFacts({ eligibility: [] });
    const result = buildFallbackGu(facts);
    expect(result).toContain("કોઈ યોજના પાત્રતા દર્શાવતી નથી");
  });
});

describe("buildFallback", () => {
  it("dispatches to English", () => {
    const result = buildFallback(makeFacts(), "en");
    expect(result).toContain("member(s)");
  });

  it("dispatches to Gujarati", () => {
    const result = buildFallback(makeFacts(), "gu");
    expect(result).toContain("સભ્ય(ઓ)");
  });
});

// ---- deduplication -----------------------------------------------------------------------

describe("fallback deduplication", () => {
  it("deduplicates by personId + schemeCode", () => {
    const facts = makeFacts({
      eligibility: [
        {
          personId: "P-000001",
          schemeCode: "OLD_AGE_PENSION",
          schemeName: "Old age pension",
          schemeNameGu: "વૃદ્ધ સહાય પેન્શન",
          scope: "person",
          eligible: true,
          enrolled: true,
          reasons: [{ rule: "age gte 60", actual: 67, passed: true }],
        },
        // Duplicate of the same person+scheme
        {
          personId: "P-000001",
          schemeCode: "OLD_AGE_PENSION",
          schemeName: "Old age pension",
          schemeNameGu: "વૃદ્ધ સહાય પેન્શન",
          scope: "person",
          eligible: true,
          enrolled: true,
          reasons: [{ rule: "age gte 60", actual: 67, passed: true }],
        },
      ],
    });
    const result = buildFallbackEn(facts);
    // Should only appear once
    const matches = result.match(/Old age pension/g);
    expect(matches).toHaveLength(1);
  });
});

// ---- buildFacts tests --------------------------------------------------------------------

function makeFamily(): FamilyRow {
  return {
    id: "GJ-FID-000001",
    head_person_id: "P-000001",
    district: "mehsana",
    taluka: "visnagar",
    village: "delvada",
    resolved_income: 80000,
    income_sources: [{ recordId: "RAT-000001", source: "ration", value: 80000 }],
    is_anchored: true,
    status: "active",
    merged_into: null,
    parent_family_id: null,
  };
}

function makeMembers(): MemberRow[] {
  return [
    { family_id: "GJ-FID-000001", person_id: "P-000001", relation_to_head: "head" },
    { family_id: "GJ-FID-000001", person_id: "P-000002", relation_to_head: "spouse" },
  ];
}

function makePersons(): PersonRow[] {
  return [
    {
      id: "P-000001", anchor_record_id: "RAT-000001", canonical_name: "Ramesh Kantilal Patel",
      dob: "1959-03-15", gender: "M", uid_last4: "1234", marital_status: "married",
      is_deceased: false, deceased_on: null,
    },
    {
      id: "P-000002", anchor_record_id: "RAT-000002", canonical_name: "Savita Ramesh Patel",
      dob: "1965-07-20", gender: "F", uid_last4: "5678", marital_status: "married",
      is_deceased: false, deceased_on: null,
    },
  ];
}

function makeEligibility(): EligibilityRow[] {
  return [
    {
      family_id: "GJ-FID-000001", person_id: null, scheme_code: "NFSA_RATION",
      eligible: true, reasons: [{ rule: "family.resolved_income lte 120000", actual: 80000, passed: true }],
      rules_version: "demo-2026-09-1",
    },
    {
      family_id: "GJ-FID-000001", person_id: "P-000001", scheme_code: "OLD_AGE_PENSION",
      eligible: true,
      reasons: [
        { rule: "is_deceased eq false", actual: false, passed: true },
        { rule: "age gte 60", actual: 67, passed: true },
      ],
      rules_version: "demo-2026-09-1",
    },
  ];
}

function makeEnrollments(): EnrollmentRow[] {
  return [
    {
      person_id: "P-000001", family_id: "GJ-FID-000001",
      scheme_code: "OLD_AGE_PENSION", source_record_id: "PEN-000001", monthly_amount: 1000,
    },
  ];
}

describe("buildFacts", () => {
  it("produces correct family size", () => {
    const facts = buildFacts(
      makeFamily(), makeMembers(), makePersons(), makeEligibility(), makeEnrollments(), "2026-09-20",
    );
    expect(facts.familySize).toBe(2);
  });

  it("computes income band", () => {
    const facts = buildFacts(
      makeFamily(), makeMembers(), makePersons(), makeEligibility(), makeEnrollments(), "2026-09-20",
    );
    expect(facts.incomeBand).toBe("up to ₹1,20,000");
  });

  it("computes age bands from DOB", () => {
    const facts = buildFacts(
      makeFamily(), makeMembers(), makePersons(), makeEligibility(), makeEnrollments(), "2026-09-20",
    );
    // Ramesh born 1959 → 67 → 60+
    expect(facts.members[0].ageBand).toBe("60+");
    // Savita born 1965 → 61 → 60+
    expect(facts.members[1].ageBand).toBe("60+");
  });

  it("marks enrolled schemes correctly", () => {
    const facts = buildFacts(
      makeFamily(), makeMembers(), makePersons(), makeEligibility(), makeEnrollments(), "2026-09-20",
    );
    // NFSA_RATION: family scope, no enrollment record for it → not enrolled
    const ration = facts.eligibility.find((e) => e.schemeCode === "NFSA_RATION");
    expect(ration?.enrolled).toBe(false);
    // OLD_AGE_PENSION: person scope, has enrollment → enrolled
    const pension = facts.eligibility.find((e) => e.schemeCode === "OLD_AGE_PENSION");
    expect(pension?.enrolled).toBe(true);
  });

  it("never includes names, IDs, or addresses in facts", () => {
    const facts = buildFacts(
      makeFamily(), makeMembers(), makePersons(), makeEligibility(), makeEnrollments(), "2026-09-20",
    );
    const json = JSON.stringify(facts);
    expect(json).not.toContain("Ramesh");
    expect(json).not.toContain("Savita");
    expect(json).not.toContain("Patel");
    expect(json).not.toContain("RAT-000001");
    expect(json).not.toContain("1234"); // uid_last4
    expect(json).not.toContain("delvada");
    expect(json).not.toContain("visnagar");
    expect(json).not.toContain("mehsana");
  });

  it("handles null income", () => {
    const family = makeFamily();
    family.resolved_income = null;
    const facts = buildFacts(
      family, makeMembers(), makePersons(), makeEligibility(), makeEnrollments(), "2026-09-20",
    );
    expect(facts.incomeBand).toBe("unknown");
  });

  it("handles missing DOB", () => {
    const persons = makePersons();
    persons[0].dob = null;
    const facts = buildFacts(
      makeFamily(), makeMembers(), persons, makeEligibility(), makeEnrollments(), "2026-09-20",
    );
    // Missing DOB → defaults to 0-17 age band
    expect(facts.members[0].ageBand).toBe("0-17");
  });

  it("handles higher income bands", () => {
    const family = makeFamily();
    family.resolved_income = 300000;
    const facts = buildFacts(
      family, makeMembers(), makePersons(), makeEligibility(), makeEnrollments(), "2026-09-20",
    );
    expect(facts.incomeBand).toBe("₹2,50,001 to ₹5,00,000");
  });
});
