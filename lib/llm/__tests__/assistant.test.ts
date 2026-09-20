import { describe, expect, it } from "vitest";
import type { EligibilityRow, EnrollmentRow, FamilyRow, MemberRow, PersonRow } from "../../db/queries";
import { buildFacts, systemPrompt, userMessage, type AssistantFacts, type EligibilityFact } from "../assistant";
import { buildFallback, buildFallbackEn, buildFallbackGu } from "../fallback";

// ---- fixtures ----------------------------------------------------------------------------

const rule = (text: string, passed: boolean) => ({ rule: text, passed });

const ration: EligibilityFact = {
  memberRef: null, schemeCode: "NFSA_RATION", schemeName: "Food security ration",
  schemeNameGu: "ખાદ્ય સુરક્ષા રાશન", scope: "family", eligible: true, status: "receiving_record",
  reasons: [rule("family.resolved_income lte 120000", true)],
};
const pensionAuto: EligibilityFact = {
  memberRef: "member 1", schemeCode: "OLD_AGE_PENSION", schemeName: "Old age pension",
  schemeNameGu: "વૃદ્ધ સહાય પેન્શન", scope: "person", eligible: true, status: "receiving_auto",
  reasons: [rule("is_deceased eq false", true), rule("age gte 60", true), rule("family.resolved_income lte 120000", true)],
};
const vahli: EligibilityFact = {
  memberRef: "member 4", schemeCode: "VAHLI_DIKRI", schemeName: "Vahli Dikri Yojana",
  schemeNameGu: "વહાલી દીકરી યોજના", scope: "person", eligible: true, status: "awaiting_verification",
  reasons: [
    rule("is_deceased eq false", true), rule("gender eq F", true), rule("dob on_or_after 2019-08-02", true),
    rule("family.resolved_income lte 200000", true),
  ],
};
const pensionNo: EligibilityFact = {
  memberRef: "member 3", schemeCode: "OLD_AGE_PENSION", schemeName: "Old age pension",
  schemeNameGu: "વૃદ્ધ સહાય પેન્શન", scope: "person", eligible: false, status: "not_eligible",
  reasons: [rule("is_deceased eq false", true), rule("age gte 60", false), rule("family.resolved_income lte 120000", true)],
};

function makeFacts(overrides: Partial<AssistantFacts> = {}): AssistantFacts {
  return {
    familySize: 4,
    incomeBand: "up to ₹1,20,000",
    members: [
      { ref: "member 1", relation: "head", ageBand: "60+", gender: "M" },
      { ref: "member 2", relation: "spouse", ageBand: "18-59", gender: "F" },
      { ref: "member 3", relation: "son", ageBand: "18-59", gender: "M" },
      { ref: "member 4", relation: "granddaughter", ageBand: "0-17", gender: "F" },
    ],
    eligibility: [ration, pensionAuto, vahli, pensionNo],
    ...overrides,
  };
}

// ---- fallback ----------------------------------------------------------------------------

describe("buildFallbackEn", () => {
  const text = buildFallbackEn(makeFacts());

  it("separates what the family receives from what is waiting for an officer", () => {
    expect(text).toContain("4 member(s)");
    expect(text).toContain("Benefits your family is receiving:");
    expect(text).toContain("Food security ration");
    expect(text).toContain("Old age pension");
    expect(text).toContain("Started automatically");
    expect(text).toContain("Eligible, waiting for an officer to verify");
    expect(text).toContain("Vahli Dikri Yojana");
    expect(text).toContain("demo values");
  });

  it("says who each scheme is for, without a name", () => {
    expect(text).toContain("family member 1 (Head, age 60+)");
    expect(text).toContain("family member 4 (Granddaughter, age 0-17)");
    expect(text).toContain("whole family");
  });

  it("gives the reasons in words, not as rule strings or exact values", () => {
    expect(text).toContain("age 60 or above");
    expect(text).toContain("family income up to ₹1,20,000 a year");
    expect(text).toContain("born on or after 02/08/2019");
    for (const raw of [" lte ", " gte ", " eq ", "is_deceased", "actual", "family.resolved_income"]) {
      expect(text).not.toContain(raw);
    }
  });

  it("does not list the schemes the family is not eligible for one by one", () => {
    expect(text).not.toContain("Not currently eligible");
    expect(text).toContain("do not meet the rules");
    expect(text.match(/Old age pension/g)).toHaveLength(1); // member 3's ineligible row is not printed
  });

  it("handles a family with nothing to show", () => {
    const none = buildFallbackEn(makeFacts({ eligibility: [pensionNo] }));
    expect(none).toContain("no schemes apply to this family right now");
    expect(buildFallbackEn(makeFacts({ eligibility: [] }))).toContain("no schemes apply");
  });
});

describe("buildFallbackGu", () => {
  const text = buildFallbackGu(makeFacts());

  it("answers in Gujarati with scheme names, statuses and the demo note", () => {
    expect(text).toContain("4 સભ્ય(ઓ) છે");
    expect(text).toContain("તમારા પરિવારને મળતા લાભ");
    expect(text).toContain("ખાદ્ય સુરક્ષા રાશન");
    expect(text).toContain("વૃદ્ધ સહાય પેન્શન");
    expect(text).toContain("આપોઆપ શરૂ થયો");
    expect(text).toContain("ચકાસણીની રાહ");
    expect(text).toContain("વહાલી દીકરી યોજના");
    expect(text).toContain("પૌત્રી");
    expect(text).toContain("ડેમો મૂલ્યો");
  });

  it("gives reasons in Gujarati, not rule strings", () => {
    expect(text).toContain("ઉંમર 60 વર્ષ કે તેથી વધુ");
    expect(text).not.toMatch(/ (lte|gte|eq) /);
  });

  it("handles nothing to show", () => {
    expect(buildFallbackGu(makeFacts({ eligibility: [] }))).toContain("કોઈ યોજના લાગુ પડતી નથી");
  });
});

describe("buildFallback", () => {
  it("dispatches by language", () => {
    expect(buildFallback(makeFacts(), "en")).toContain("member(s)");
    expect(buildFallback(makeFacts(), "gu")).toContain("સભ્ય(ઓ)");
  });

  it("prints one row per person and scheme even if the facts repeat one", () => {
    const text = buildFallbackEn(makeFacts({ eligibility: [pensionAuto, pensionAuto] }));
    expect(text.match(/Old age pension/g)).toHaveLength(1);
  });
});

// ---- facts -------------------------------------------------------------------------------

const family: FamilyRow = {
  id: "GJ-FID-000001", head_person_id: "P-000001", district: "mehsana", taluka: "visnagar", village: "delvada",
  resolved_income: 80000, income_sources: [{ recordId: "RAT-000001", source: "ration", value: 80000 }],
  is_anchored: true, status: "active", merged_into: null, parent_family_id: null,
};
const members: MemberRow[] = [
  { family_id: "GJ-FID-000001", person_id: "P-000001", relation_to_head: "head" },
  { family_id: "GJ-FID-000001", person_id: "P-000002", relation_to_head: "spouse" },
];
const persons: PersonRow[] = [
  {
    id: "P-000001", anchor_record_id: "RAT-000001", canonical_name: "Ramesh Kantilal Patel", dob: "1959-03-15",
    gender: "M", uid_last4: "1234", marital_status: "married", is_deceased: false, deceased_on: null,
  },
  {
    id: "P-000002", anchor_record_id: "RAT-000002", canonical_name: "Savita Ramesh Patel", dob: "1965-07-20",
    gender: "F", uid_last4: "5678", marital_status: "married", is_deceased: false, deceased_on: null,
  },
];
const eligibility: EligibilityRow[] = [
  {
    family_id: "GJ-FID-000001", person_id: null, scheme_code: "NFSA_RATION", eligible: true,
    reasons: [{ rule: "family.resolved_income lte 120000", actual: 80000, passed: true }], rules_version: "v",
  },
  {
    family_id: "GJ-FID-000001", person_id: "P-000001", scheme_code: "OLD_AGE_PENSION", eligible: true,
    reasons: [{ rule: "is_deceased eq false", actual: false, passed: true }, { rule: "age gte 60", actual: 67, passed: true }],
    rules_version: "v",
  },
  {
    family_id: "GJ-FID-000001", person_id: "P-000002", scheme_code: "WIDOW_ASSIST", eligible: true,
    reasons: [{ rule: "marital_status eq widowed", actual: "widowed", passed: true }], rules_version: "v",
  },
  {
    family_id: "GJ-FID-000001", person_id: "P-000002", scheme_code: "SCHOLARSHIP", eligible: false,
    reasons: [{ rule: "is_student eq true", actual: false, passed: false }], rules_version: "v",
  },
];
const enrollments: EnrollmentRow[] = [
  { person_id: "P-000001", family_id: "GJ-FID-000001", scheme_code: "OLD_AGE_PENSION", source_record_id: "PEN-000001", basis: "record", monthly_amount: 1000 },
  { person_id: "P-000001", family_id: "GJ-FID-000001", scheme_code: "NFSA_RATION", source_record_id: null, basis: "auto", monthly_amount: null },
];

describe("buildFacts", () => {
  const facts = buildFacts(family, members, persons, eligibility, enrollments, "2026-09-20");

  it("counts the family and bands the income and ages", () => {
    expect(facts.familySize).toBe(2);
    expect(facts.incomeBand).toBe("up to ₹1,20,000");
    expect(facts.members.map((m) => m.ageBand)).toEqual(["60+", "60+"]); // 67 and 61
    expect(buildFacts({ ...family, resolved_income: null }, members, persons, [], [], "2026-09-20").incomeBand).toBe("unknown");
    expect(buildFacts({ ...family, resolved_income: 300000 }, members, persons, [], [], "2026-09-20").incomeBand).toBe("₹2,50,001 to ₹5,00,000");
    expect(buildFacts({ ...family, resolved_income: 900000 }, members, persons, [], [], "2026-09-20").incomeBand).toBe("above ₹5,00,000");
  });

  it("refers to people as member 1, member 2, never by name", () => {
    expect(facts.members.map((m) => m.ref)).toEqual(["member 1", "member 2"]);
    expect(facts.eligibility.find((e) => e.schemeCode === "WIDOW_ASSIST")?.memberRef).toBe("member 2");
    expect(facts.eligibility.find((e) => e.schemeCode === "NFSA_RATION")?.memberRef).toBeNull();
  });

  it("gives each scheme one of the four benefit statuses", () => {
    const status = (code: string) => facts.eligibility.find((e) => e.schemeCode === code)?.status;
    expect(status("OLD_AGE_PENSION")).toBe("receiving_record");
    expect(status("NFSA_RATION")).toBe("receiving_auto"); // family-scope, covered by an automatic grant
    expect(status("WIDOW_ASSIST")).toBe("awaiting_verification");
    expect(status("SCHOLARSHIP")).toBe("not_eligible");
  });

  it("never includes names, IDs, addresses, exact ages or exact incomes", () => {
    const json = JSON.stringify(facts);
    for (const secret of [
      "Ramesh", "Savita", "Patel", "RAT-000001", "PEN-000001", "P-000001", "1234", "5678",
      "delvada", "visnagar", "mehsana", "80000", "67", "actual", "1959",
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it("handles a member with no date of birth", () => {
    const noDob = buildFacts(family, members, [{ ...persons[0], dob: null }, persons[1]], [], [], "2026-09-20");
    expect(noDob.members[0].ageBand).toBe("0-17");
  });
});

describe("what the model is told", () => {
  const facts = makeFacts();
  const message = userMessage(facts, "Why is my mother not getting a pension?");

  it("lists members by reference and each scheme with its status and rules in words", () => {
    expect(message).toContain("member 1: relation head, age band 60+");
    expect(message).toContain("Old age pension for member 1 (head): Started automatically");
    expect(message).toContain("Vahli Dikri Yojana for member 4 (granddaughter): Eligible, waiting for officer verification");
    expect(message).toContain("Food security ration for the whole family: Receiving");
    expect(message).toContain("does not meet: age 60 or above");
    expect(message).toContain("Question: Why is my mother not getting a pension?");
  });

  it("carries no rule strings, exact values or identifiers", () => {
    for (const raw of [" lte ", " gte ", "actual", "P-000001", "is_deceased"]) {
      expect(message).not.toContain(raw);
    }
  });

  it("tells the model to answer only from the facts, stay short, promise nothing and point to Ask an officer", () => {
    const prompt = systemPrompt("gu");
    expect(prompt).toContain("Reply in Gujarati.");
    expect(systemPrompt("en")).toContain("Reply in English.");
    expect(prompt).toContain("ONLY from the facts");
    expect(prompt).toContain("under 120 words");
    expect(prompt).toContain("Do not make any promises");
    expect(prompt).toContain("Ask an officer");
    expect(prompt).toContain("member 1");
  });
});
