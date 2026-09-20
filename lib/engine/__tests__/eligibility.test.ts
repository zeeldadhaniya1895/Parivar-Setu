import { describe, expect, it } from "vitest";
import schemesJson from "../../../config/schemes.json";
import {
  ageFromDob, analyzeGaps, deriveIsStudent, evaluateCondition, evaluateEligibility, evaluateRule,
  parseSchemesConfig, type EvalContext,
} from "../eligibility";
import type {
  Condition, EligibilityResult, Enrollment, Family, FamilyMember, Person, Rule,
} from "../types";
import { norm } from "./fixtures";

const config = parseSchemesConfig(schemesJson);
const cond = (field: string, op: Condition["op"], value: Condition["value"]): Condition => ({ field, op, value });
const check = (c: Condition, ctx: EvalContext) => evaluateCondition(c, ctx).passed;

describe("operators", () => {
  it("eq and ne", () => {
    expect(check(cond("gender", "eq", "F"), { gender: "F" })).toBe(true);
    expect(check(cond("gender", "eq", "F"), { gender: "M" })).toBe(false);
    expect(check(cond("is_student", "eq", true), { is_student: true })).toBe(true);
    expect(check(cond("gender", "ne", "F"), { gender: "M" })).toBe(true);
    expect(check(cond("gender", "ne", "F"), { gender: "F" })).toBe(false);
  });

  it("gt, gte, lt, lte", () => {
    expect(check(cond("age", "gt", 60), { age: 61 })).toBe(true);
    expect(check(cond("age", "gt", 60), { age: 60 })).toBe(false);
    expect(check(cond("age", "gte", 60), { age: 60 })).toBe(true);
    expect(check(cond("age", "gte", 60), { age: 59 })).toBe(false);
    expect(check(cond("age", "lt", 18), { age: 17 })).toBe(true);
    expect(check(cond("age", "lt", 18), { age: 18 })).toBe(false);
    expect(check(cond("age", "lte", 18), { age: 18 })).toBe(true);
    expect(check(cond("age", "lte", 18), { age: 19 })).toBe(false);
  });

  it("in", () => {
    expect(check(cond("marital_status", "in", ["widowed", "unmarried"]), { marital_status: "widowed" })).toBe(true);
    expect(check(cond("marital_status", "in", ["widowed", "unmarried"]), { marital_status: "married" })).toBe(false);
    expect(check(cond("age", "in", [60, 61]), { age: 61 })).toBe(true);
  });

  it("on_or_after and on_or_before compare dates", () => {
    const after = cond("dob", "on_or_after", "2019-08-02");
    expect(check(after, { dob: "2019-08-02" })).toBe(true);
    expect(check(after, { dob: "2021-05-12" })).toBe(true);
    expect(check(after, { dob: "2019-08-01" })).toBe(false);
    const before = cond("dob", "on_or_before", "2019-08-02");
    expect(check(before, { dob: "2019-08-02" })).toBe(true);
    expect(check(before, { dob: "2019-08-03" })).toBe(false);
  });

  it("treats a year-only date conservatively", () => {
    const after = cond("dob", "on_or_after", "2019-08-02");
    expect(check(after, { dob: "2020" })).toBe(true);
    expect(check(after, { dob: "2019" })).toBe(false); // might be January 2019
    const before = cond("dob", "on_or_before", "2019-08-02");
    expect(check(before, { dob: "2018" })).toBe(true);
    expect(check(before, { dob: "2019" })).toBe(false); // might be December 2019
  });

  it("fails on a missing value or a type mismatch instead of guessing", () => {
    expect(check(cond("age", "gte", 60), { age: null })).toBe(false);
    expect(check(cond("age", "gte", 60), {})).toBe(false);
    expect(check(cond("gender", "ne", "F"), { gender: null })).toBe(false);
    expect(check(cond("age", "gte", 60), { age: "sixty" })).toBe(false);
  });
});

describe("rule groups and reasons", () => {
  it("records every condition with its actual value and result, even after one fails", () => {
    const rule: Rule = { all: [cond("age", "gte", 60), cond("family.resolved_income", "lte", 120_000)] };
    const { passed, reasons } = evaluateRule(rule, { age: 67, "family.resolved_income": 200_000 });
    expect(passed).toBe(false);
    expect(reasons).toEqual([
      { rule: "age gte 60", actual: 67, passed: true },
      { rule: "family.resolved_income lte 120000", actual: 200_000, passed: false },
    ]);
  });

  it("supports any, and nesting", () => {
    const rule: Rule = {
      all: [cond("age", "gte", 18), { any: [cond("gender", "eq", "F"), cond("marital_status", "eq", "widowed")] }],
    };
    expect(evaluateRule(rule, { age: 30, gender: "F", marital_status: "married" }).passed).toBe(true);
    expect(evaluateRule(rule, { age: 30, gender: "M", marital_status: "widowed" }).passed).toBe(true);
    expect(evaluateRule(rule, { age: 30, gender: "M", marital_status: "married" }).passed).toBe(false);
    expect(evaluateRule(rule, { age: 10, gender: "F" }).passed).toBe(false);
    expect(evaluateRule(rule, { age: 30, gender: "M", marital_status: "married" }).reasons).toHaveLength(3);
  });

  it("describes list values in the rule text", () => {
    expect(evaluateCondition(cond("marital_status", "in", ["widowed", "unmarried"]), {}).rule).toBe(
      "marital_status in widowed|unmarried",
    );
  });
});

describe("config", () => {
  it("parses config/schemes.json: six schemes, a version, and the demo-criteria notice", () => {
    expect(config.version).toBeTruthy();
    expect(config.notice.toLowerCase()).toContain("demo");
    expect(config.schemes.map((s) => s.code)).toEqual([
      "NFSA_RATION", "OLD_AGE_PENSION", "WIDOW_ASSIST", "SCHOLARSHIP", "VAHLI_DIKRI", "PMJAY_MA",
    ]);
    expect(config.schemes.filter((s) => s.scope === "family").map((s) => s.code)).toEqual(["NFSA_RATION", "PMJAY_MA"]);
    expect(config.schemes.filter((s) => s.enrollment === "none").map((s) => s.code)).toEqual(["VAHLI_DIKRI", "PMJAY_MA"]);
  });

  it("rejects an unknown operator, a duplicate code, and a missing version", () => {
    const scheme = { code: "X", name: "x", nameGu: "x", scope: "person", enrollment: "none", manualVerificationRequired: false, monthlyBenefit: null };
    const good = { version: "1", notice: "n", schemes: [{ ...scheme, rule: { all: [cond("age", "gte", 1)] } }] };
    expect(() => parseSchemesConfig(good)).not.toThrow();
    expect(() => parseSchemesConfig({
      ...good, schemes: [{ ...scheme, rule: { all: [{ field: "age", op: "approx", value: 1 }] } }],
    })).toThrow(/unknown operator/);
    expect(() => parseSchemesConfig({ ...good, schemes: [good.schemes[0], good.schemes[0]] })).toThrow(/duplicate/);
    expect(() => parseSchemesConfig({ ...good, version: "" })).toThrow(/version/);
  });

  it("requires monthlyBenefit to be a whole number of rupees or null, and manualVerificationRequired a boolean", () => {
    const scheme = {
      code: "X", name: "x", nameGu: "x", scope: "person", enrollment: "none",
      manualVerificationRequired: false, monthlyBenefit: null, rule: { all: [cond("age", "gte", 1)] },
    };
    const withScheme = (o: Record<string, unknown>) => ({ version: "1", notice: "n", schemes: [{ ...scheme, ...o }] });
    expect(() => parseSchemesConfig(withScheme({ monthlyBenefit: 1000 }))).not.toThrow();
    expect(() => parseSchemesConfig(withScheme({ monthlyBenefit: -5 }))).toThrow(/monthlyBenefit/);
    expect(() => parseSchemesConfig(withScheme({ monthlyBenefit: 12.5 }))).toThrow(/monthlyBenefit/);
    expect(() => parseSchemesConfig(withScheme({ monthlyBenefit: "1000" }))).toThrow(/monthlyBenefit/);
    expect(() => parseSchemesConfig(withScheme({ monthlyBenefit: undefined }))).toThrow(/monthlyBenefit/);
    expect(() => parseSchemesConfig(withScheme({ manualVerificationRequired: "yes" }))).toThrow(/manualVerificationRequired/);
  });
});

describe("ages", () => {
  it("counts completed years on the as-of date, and approximates from a year", () => {
    expect(ageFromDob("1959-03-14", "2026-09-20")).toBe(67);
    expect(ageFromDob("1959-09-21", "2026-09-20")).toBe(66);
    expect(ageFromDob("1959-09-20", "2026-09-20")).toBe(67);
    expect(ageFromDob("1959", "2026-09-20")).toBe(67);
    expect(ageFromDob(null, "2026-09-20")).toBeNull();
  });
});

describe("evaluateEligibility", () => {
  const person = (id: string, o: Partial<Person> = {}): Person => ({
    id, anchorRecordId: id, canonicalName: id, dob: "1959-03-14", gender: "M", uidLast4: null,
    maritalStatus: "married", isDeceased: false, deceasedOn: null, recordIds: [], ...o,
  });
  const family = (id: string, o: Partial<Family> = {}): Family => ({
    id, headPersonId: null, district: "d", taluka: "t", village: "v", resolvedIncome: 96_000, incomeSources: [],
    isAnchored: true, status: "active", mergedInto: null, parentFamilyId: null, cardRefs: [], ...o,
  });
  const member = (familyId: string, personId: string): FamilyMember => ({
    familyId, personId, relationToHead: null, validFrom: null, validTo: null,
  });
  const run = (persons: Person[], families: Family[], members: FamilyMember[], students: [string, boolean][] = []) =>
    evaluateEligibility({
      persons, families, familyMembers: members, isStudentByPerson: new Map(students),
      asOfDate: "2026-09-20", config,
    });
  const find = (results: EligibilityResult[], scheme: string, personId: string | null) =>
    results.find((r) => r.schemeCode === scheme && r.personId === personId);

  it("evaluates every scheme: family scope once per family, person scope once per member", () => {
    const results = run([person("P-1"), person("P-2")], [family("F-1")], [member("F-1", "P-1"), member("F-1", "P-2")]);
    expect(results).toHaveLength(2 + 4 * 2); // 2 family schemes + 4 person schemes x 2 members
    expect(results.every((r) => r.rulesVersion === config.version)).toBe(true);
    expect(find(results, "NFSA_RATION", null)?.eligible).toBe(true);
    expect(find(results, "PMJAY_MA", null)?.eligible).toBe(true);
  });

  it("stores every rule with its actual value", () => {
    const results = run([person("P-1")], [family("F-1")], [member("F-1", "P-1")]);
    expect(find(results, "OLD_AGE_PENSION", "P-1")).toMatchObject({
      eligible: true,
      reasons: [
        { rule: "is_deceased eq false", actual: false, passed: true },
        { rule: "age gte 60", actual: 67, passed: true },
        { rule: "family.resolved_income lte 120000", actual: 96_000, passed: true },
      ],
    });
  });

  it("marks a family over the income limit ineligible with the failing reason", () => {
    const results = run([person("P-1")], [family("F-1", { resolvedIncome: 200_000 })], [member("F-1", "P-1")]);
    const r = find(results, "OLD_AGE_PENSION", "P-1");
    expect(r?.eligible).toBe(false);
    expect(r?.reasons.filter((x) => !x.passed)).toEqual([
      { rule: "family.resolved_income lte 120000", actual: 200_000, passed: false },
    ]);
    expect(find(results, "NFSA_RATION", null)?.eligible).toBe(false);
    expect(find(results, "PMJAY_MA", null)?.eligible).toBe(true); // limit 500,000
  });

  it("never treats a deceased person as eligible, and says why first", () => {
    const results = run(
      [person("P-1", { isDeceased: true, deceasedOn: "2026-07-02" })], [family("F-1")], [member("F-1", "P-1")],
    );
    for (const r of results.filter((x) => x.personId === "P-1")) {
      expect(r.eligible).toBe(false);
      expect(r.reasons[0]).toEqual({ rule: "is_deceased eq false", actual: true, passed: false });
    }
    // the age and income rules themselves would have passed
    expect(find(results, "OLD_AGE_PENSION", "P-1")?.reasons.slice(1).every((x) => x.passed)).toBe(true);
  });

  it("widow assistance needs a woman, widowed, 18 or over", () => {
    const widow = person("P-1", { gender: "F", maritalStatus: "widowed", dob: "1962-08-02" });
    const wife = person("P-2", { gender: "F", maritalStatus: "married", dob: "1962-08-02" });
    const girl = person("P-3", { gender: "F", maritalStatus: "widowed", dob: "2015-01-01" });
    const man = person("P-4", { gender: "M", maritalStatus: "widowed" });
    const r = run([widow, wife, girl, man], [family("F-1")], ["P-1", "P-2", "P-3", "P-4"].map((p) => member("F-1", p)));
    expect(find(r, "WIDOW_ASSIST", "P-1")?.eligible).toBe(true);
    expect(find(r, "WIDOW_ASSIST", "P-2")?.eligible).toBe(false);
    expect(find(r, "WIDOW_ASSIST", "P-3")?.eligible).toBe(false);
    expect(find(r, "WIDOW_ASSIST", "P-4")?.eligible).toBe(false);
  });

  it("scholarship needs a student and family income up to 250,000", () => {
    const kid = person("P-1", { dob: "2013-06-20" });
    const students: [string, boolean][] = [["P-1", true]];
    expect(find(run([kid], [family("F-1", { resolvedIncome: 240_000 })], [member("F-1", "P-1")], students), "SCHOLARSHIP", "P-1")?.eligible).toBe(true);
    expect(find(run([kid], [family("F-1", { resolvedIncome: 260_000 })], [member("F-1", "P-1")], students), "SCHOLARSHIP", "P-1")?.eligible).toBe(false);
    expect(find(run([kid], [family("F-1")], [member("F-1", "P-1")]), "SCHOLARSHIP", "P-1")?.eligible).toBe(false); // student status unknown
  });

  it("Vahli Dikri: a girl born on or after 2019-08-02 in a family up to 200,000", () => {
    const girl = person("P-1", { gender: "F", dob: "2021-05-12", maritalStatus: "unmarried" });
    const boy = person("P-2", { gender: "M", dob: "2021-05-12", maritalStatus: "unmarried" });
    const older = person("P-3", { gender: "F", dob: "2019-08-01", maritalStatus: "unmarried" });
    const r = run([girl, boy, older], [family("F-1", { resolvedIncome: 150_000 })], ["P-1", "P-2", "P-3"].map((p) => member("F-1", p)));
    expect(find(r, "VAHLI_DIKRI", "P-1")?.eligible).toBe(true);
    expect(find(r, "VAHLI_DIKRI", "P-2")?.eligible).toBe(false);
    expect(find(r, "VAHLI_DIKRI", "P-3")?.eligible).toBe(false);
  });

  it("a family-scope scheme sees only family fields", () => {
    const familyOnly = parseSchemesConfig({
      version: "t", notice: "demo", schemes: [{
        code: "F_ONLY", name: "f", nameGu: "f", scope: "family", enrollment: "none", manualVerificationRequired: false, monthlyBenefit: null,
        rule: { all: [cond("age", "gte", 0)] },
      }],
    });
    const results = evaluateEligibility({
      persons: [person("P-1")], families: [family("F-1")], familyMembers: [member("F-1", "P-1")],
      isStudentByPerson: new Map(), asOfDate: "2026-09-20", config: familyOnly,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ personId: null, eligible: false, reasons: [{ rule: "age gte 0", actual: null, passed: false }] });
  });

  it("exposes family.size and skips merged families", () => {
    const sized = parseSchemesConfig({
      version: "t", notice: "demo", schemes: [{
        code: "BIG", name: "b", nameGu: "b", scope: "family", enrollment: "none", manualVerificationRequired: false, monthlyBenefit: null,
        rule: { all: [cond("family.size", "gte", 2)] },
      }],
    });
    const results = evaluateEligibility({
      persons: [person("P-1"), person("P-2")],
      families: [family("F-1"), family("F-2", { status: "merged", mergedInto: "F-1" })],
      familyMembers: [member("F-1", "P-1"), member("F-1", "P-2")],
      isStudentByPerson: new Map(), asOfDate: "2026-09-20", config: sized,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ familyId: "F-1", eligible: true });
  });

  it("derives student status from records: any true wins, otherwise false, otherwise unknown", () => {
    const records = [
      norm({ id: "R1", full_name: "A B Patel", is_student: false }),
      norm({ id: "S1", full_name: "A B Patel", source: "scholarship", is_student: true }),
      norm({ id: "R2", full_name: "C D Patel", is_student: false }),
      norm({ id: "R3", full_name: "E F Patel" }),
    ];
    const byRecord = new Map([["R1", "P-1"], ["S1", "P-1"], ["R2", "P-2"], ["R3", "P-3"]]);
    const result = deriveIsStudent(records, byRecord);
    expect(result.get("P-1")).toBe(true);
    expect(result.get("P-2")).toBe(false);
    expect(result.has("P-3")).toBe(false);
  });
});

describe("analyzeGaps", () => {
  const result = (
    familyId: string, personId: string | null, schemeCode: string, eligible: boolean,
  ): EligibilityResult => ({ familyId, personId, schemeCode, eligible, reasons: [], rulesVersion: "t" });
  const enrol = (personId: string, familyId: string, schemeCode: string, rec: string, amount: number | null): Enrollment =>
    ({ basis: "record", personId, familyId, schemeCode, sourceRecordId: rec, monthlyAmount: amount });

  it("eligible but not enrolled", () => {
    const gaps = analyzeGaps(
      [result("F-1", "P-1", "OLD_AGE_PENSION", true), result("F-1", "P-2", "OLD_AGE_PENSION", true)],
      [enrol("P-1", "F-1", "OLD_AGE_PENSION", "PEN-1", 1000)],
      config,
    );
    expect(gaps.eligibleNotEnrolled).toEqual([{ familyId: "F-1", personId: "P-2", schemeCode: "OLD_AGE_PENSION" }]);
    expect(gaps.enrolledNotEligible).toEqual([]);
  });

  it("enrolled but not eligible", () => {
    const gaps = analyzeGaps(
      [result("F-1", "P-1", "OLD_AGE_PENSION", false)],
      [enrol("P-1", "F-1", "OLD_AGE_PENSION", "PEN-1", 1000)],
      config,
    );
    expect(gaps.eligibleNotEnrolled).toEqual([]);
    expect(gaps.enrolledNotEligible).toEqual([
      { familyId: "F-1", personId: "P-1", schemeCode: "OLD_AGE_PENSION", sourceRecordId: "PEN-1", monthlyAmount: 1000 },
    ]);
  });

  it("matches family-scope enrollments by family, not by the head who holds them", () => {
    const enrolled = analyzeGaps(
      [result("F-1", null, "NFSA_RATION", true)], [enrol("P-1", "F-1", "NFSA_RATION", "RAT-1", null)], config,
    );
    expect(enrolled.eligibleNotEnrolled).toEqual([]);
    const missing = analyzeGaps([result("F-2", null, "NFSA_RATION", true)], [], config);
    expect(missing.eligibleNotEnrolled).toEqual([{ familyId: "F-2", personId: null, schemeCode: "NFSA_RATION" }]);
    const leaking = analyzeGaps(
      [result("F-1", null, "NFSA_RATION", false)], [enrol("P-1", "F-1", "NFSA_RATION", "RAT-1", null)], config,
    );
    expect(leaking.enrolledNotEligible).toHaveLength(1);
  });

  it("counts every eligible result of a discovery-only scheme", () => {
    const gaps = analyzeGaps(
      [result("F-1", "P-1", "VAHLI_DIKRI", true), result("F-1", "P-2", "VAHLI_DIKRI", false), result("F-1", null, "PMJAY_MA", true)],
      [], config,
    );
    expect(gaps.eligibleNotEnrolled).toEqual([
      { familyId: "F-1", personId: "P-1", schemeCode: "VAHLI_DIKRI" },
      { familyId: "F-1", personId: null, schemeCode: "PMJAY_MA" },
    ]);
  });

  it("ignores schemes the config does not know", () => {
    const gaps = analyzeGaps([], [enrol("P-1", "F-1", "MYSTERY", "X-1", 5)], config);
    expect(gaps).toEqual({ eligibleNotEnrolled: [], enrolledNotEligible: [] });
  });
});
