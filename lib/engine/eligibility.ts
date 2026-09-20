// Eligibility rules as data (DESIGN.md 7.6). Thresholds live in config/schemes.json and are
// simplified demo values, not official scheme criteria.
import type {
  Condition, EligibilityResult, Enrollment, Family, FamilyMember, GapAnalysis, NormalizedRecord,
  Operator, Person, Reason, Rule, SchemeConfig, SchemesConfig,
} from "./types";

const OPERATORS: readonly Operator[] = [
  "eq", "ne", "gt", "gte", "lt", "lte", "in", "on_or_after", "on_or_before",
];
const ENROLLMENT_SOURCES = ["ration_card", "pension_record", "scholarship_record", "none"];

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ---- config parsing ----------------------------------------------------------------------

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

function parseRule(raw: unknown, path: string): Rule {
  if (!isObject(raw)) throw new Error(`${path}: rule must be an object`);
  for (const key of ["all", "any"] as const) {
    if (key in raw) {
      const children = raw[key];
      if (!Array.isArray(children)) throw new Error(`${path}.${key}: must be an array`);
      const parsed = children.map((c, i) => parseRule(c, `${path}.${key}[${i}]`));
      return key === "all" ? { all: parsed } : { any: parsed };
    }
  }
  const { field, op, value } = raw;
  if (typeof field !== "string") throw new Error(`${path}: condition needs a string "field"`);
  if (typeof op !== "string" || !(OPERATORS as readonly string[]).includes(op)) {
    throw new Error(`${path}: unknown operator ${String(op)}`);
  }
  const validValue =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean" ||
    (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number"));
  if (!validValue) throw new Error(`${path}: invalid "value"`);
  return { field, op: op as Operator, value: value as Condition["value"] };
}

/** Validate the JSON in config/schemes.json. Throws a readable error on any mistake. */
export function parseSchemesConfig(json: unknown): SchemesConfig {
  if (!isObject(json)) throw new Error("schemes config must be an object");
  const { version, notice, schemes } = json;
  if (typeof version !== "string" || version === "") throw new Error("schemes config needs a version");
  if (typeof notice !== "string") throw new Error("schemes config needs a notice");
  if (!Array.isArray(schemes)) throw new Error("schemes config needs a schemes array");

  const seen = new Set<string>();
  const parsed = schemes.map((s, i): SchemeConfig => {
    const path = `schemes[${i}]`;
    if (!isObject(s)) throw new Error(`${path}: must be an object`);
    const { code, name, nameGu, scope, enrollment, manualVerificationRequired, monthlyBenefit, rule } = s;
    if (typeof code !== "string" || code === "") throw new Error(`${path}: needs a code`);
    if (seen.has(code)) throw new Error(`${path}: duplicate scheme code ${code}`);
    seen.add(code);
    if (typeof name !== "string" || typeof nameGu !== "string") throw new Error(`${path}: needs name and nameGu`);
    if (scope !== "person" && scope !== "family") throw new Error(`${path}: scope must be person or family`);
    if (typeof enrollment !== "string" || !ENROLLMENT_SOURCES.includes(enrollment)) {
      throw new Error(`${path}: invalid enrollment source`);
    }
    if (typeof manualVerificationRequired !== "boolean") {
      throw new Error(`${path}: manualVerificationRequired must be a boolean`);
    }
    if (monthlyBenefit !== null && (typeof monthlyBenefit !== "number" || !Number.isInteger(monthlyBenefit) || monthlyBenefit < 0)) {
      throw new Error(`${path}: monthlyBenefit must be a whole number of rupees or null`);
    }
    return {
      code, name, nameGu, scope, enrollment: enrollment as SchemeConfig["enrollment"],
      manualVerificationRequired,
      monthlyBenefit,
      rule: parseRule(rule, `${path}.rule`),
    };
  });
  return { version, notice, schemes: parsed };
}

// ---- rule evaluation ---------------------------------------------------------------------

export type EvalValue = string | number | boolean | null;
export type EvalContext = Readonly<Record<string, EvalValue>>;

const describeValue = (value: Condition["value"]): string =>
  Array.isArray(value) ? value.join("|") : String(value);

function isYearOnly(s: string): boolean {
  return /^\d{4}$/.test(s);
}

function testCondition(c: Condition, actual: string | number | boolean): boolean {
  const { op, value } = c;
  switch (op) {
    case "eq":
      return actual === value;
    case "ne":
      return actual !== value;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof value !== "number") return false;
      if (op === "gt") return actual > value;
      if (op === "gte") return actual >= value;
      return op === "lt" ? actual < value : actual <= value;
    }
    case "in":
      return Array.isArray(value) && (typeof actual === "string" || typeof actual === "number") &&
        (value as readonly (string | number)[]).includes(actual);
    case "on_or_after":
    case "on_or_before": {
      if (typeof actual !== "string" || typeof value !== "string") return false;
      // A year-only DOB is compared conservatively: the family only qualifies when every
      // possible date in that year would.
      const date = isYearOnly(actual) ? `${actual}-${op === "on_or_after" ? "01-01" : "12-31"}` : actual;
      return op === "on_or_after" ? date >= value : date <= value;
    }
  }
}

export function evaluateCondition(c: Condition, ctx: EvalContext): Reason {
  const actual = ctx[c.field] ?? null;
  return {
    rule: `${c.field} ${c.op} ${describeValue(c.value)}`,
    actual,
    passed: actual !== null && testCondition(c, actual),
  };
}

/** Evaluate every condition (no short-circuit) so the reasons list is complete. */
export function evaluateRule(rule: Rule, ctx: EvalContext): { passed: boolean; reasons: Reason[] } {
  if ("all" in rule) {
    const results = rule.all.map((r) => evaluateRule(r, ctx));
    return { passed: results.every((r) => r.passed), reasons: results.flatMap((r) => r.reasons) };
  }
  if ("any" in rule) {
    const results = rule.any.map((r) => evaluateRule(r, ctx));
    return { passed: results.some((r) => r.passed), reasons: results.flatMap((r) => r.reasons) };
  }
  const reason = evaluateCondition(rule, ctx);
  return { passed: reason.passed, reasons: [reason] };
}

// ---- context -----------------------------------------------------------------------------

/** Completed years on `asOf`; a year-only DOB gives an approximate age. */
export function ageFromDob(dob: string | null, asOf: string): number | null {
  if (dob === null) return null;
  const year = Number(dob.slice(0, 4));
  const asOfYear = Number(asOf.slice(0, 4));
  if (dob.length === 4) return asOfYear - year;
  const birthdayPassed = asOf.slice(5) >= dob.slice(5);
  return asOfYear - year - (birthdayPassed ? 0 : 1);
}

/** True if any record says the person is a student, false if some say no, null if none say. */
export function deriveIsStudent(
  records: readonly NormalizedRecord[], personIdByRecord: ReadonlyMap<string, string>,
): Map<string, boolean> {
  const result = new Map<string, boolean>();
  for (const r of records) {
    const personId = personIdByRecord.get(r.id);
    if (personId === undefined || r.isStudent === null) continue;
    result.set(personId, (result.get(personId) ?? false) || r.isStudent);
  }
  return result;
}

export interface EligibilityInput {
  persons: readonly Person[];
  families: readonly Family[];
  familyMembers: readonly FamilyMember[];
  isStudentByPerson: ReadonlyMap<string, boolean>;
  asOfDate: string;
  config: SchemesConfig;
}

/**
 * Evaluate every scheme for every active family and, for person-scope schemes, every member.
 * Deceased persons are never eligible (global rule, listed first in their reasons).
 */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult[] {
  const { persons, families, familyMembers, isStudentByPerson, asOfDate, config } = input;
  const personById = new Map(persons.map((p) => [p.id, p]));
  const membersOf = new Map<string, string[]>();
  for (const m of familyMembers) membersOf.set(m.familyId, [...(membersOf.get(m.familyId) ?? []), m.personId]);

  const results: EligibilityResult[] = [];
  const activeFamilies = families.filter((f) => f.status === "active").sort((a, b) => cmp(a.id, b.id));
  for (const family of activeFamilies) {
    const memberIds = [...(membersOf.get(family.id) ?? [])].sort(cmp);
    const familyContext: EvalContext = {
      "family.resolved_income": family.resolvedIncome,
      "family.size": memberIds.length,
    };

    for (const scheme of config.schemes) {
      if (scheme.scope === "family") {
        const { passed, reasons } = evaluateRule(scheme.rule, familyContext);
        results.push({
          familyId: family.id, personId: null, schemeCode: scheme.code,
          eligible: passed, reasons, rulesVersion: config.version,
        });
        continue;
      }
      for (const personId of memberIds) {
        const person = personById.get(personId);
        if (!person) continue;
        const context: EvalContext = {
          ...familyContext,
          age: ageFromDob(person.dob, asOfDate),
          gender: person.gender,
          marital_status: person.maritalStatus,
          is_student: isStudentByPerson.get(personId) ?? null,
          dob: person.dob,
        };
        const { passed, reasons } = evaluateRule(scheme.rule, context);
        const alive: Reason = { rule: "is_deceased eq false", actual: person.isDeceased, passed: !person.isDeceased };
        results.push({
          familyId: family.id, personId, schemeCode: scheme.code,
          eligible: alive.passed && passed, reasons: [alive, ...reasons], rulesVersion: config.version,
        });
      }
    }
  }
  return results;
}

// ---- gap analysis ------------------------------------------------------------------------

/**
 * Eligible but not enrolled (discovery-only schemes count every eligible result), and
 * enrolled but not eligible.
 */
export function analyzeGaps(
  results: readonly EligibilityResult[], enrollments: readonly Enrollment[], config: SchemesConfig,
): GapAnalysis {
  const schemeByCode = new Map(config.schemes.map((s) => [s.code, s]));
  const keyOf = (scheme: SchemeConfig, familyId: string, personId: string | null) =>
    scheme.scope === "family" ? `f|${familyId}|${scheme.code}` : `p|${personId}|${scheme.code}`;

  const enrolled = new Set<string>();
  for (const e of enrollments) {
    const scheme = schemeByCode.get(e.schemeCode);
    if (scheme) enrolled.add(keyOf(scheme, e.familyId, e.personId));
  }
  const resultByKey = new Map<string, EligibilityResult>();
  for (const r of results) {
    const scheme = schemeByCode.get(r.schemeCode);
    if (scheme) resultByKey.set(keyOf(scheme, r.familyId, r.personId), r);
  }

  const eligibleNotEnrolled: GapAnalysis["eligibleNotEnrolled"] = [];
  for (const r of results) {
    const scheme = schemeByCode.get(r.schemeCode);
    if (!scheme || !r.eligible) continue;
    const discovery = scheme.enrollment === "none";
    if (discovery || !enrolled.has(keyOf(scheme, r.familyId, r.personId))) {
      eligibleNotEnrolled.push({ familyId: r.familyId, personId: r.personId, schemeCode: r.schemeCode });
    }
  }

  // Automatic benefits are granted because the rules pass, so only record-backed ones can leak.
  const enrolledNotEligible: GapAnalysis["enrolledNotEligible"] = [];
  for (const e of enrollments) {
    if (e.basis !== "record") continue;
    const scheme = schemeByCode.get(e.schemeCode);
    if (!scheme) continue;
    const result = resultByKey.get(keyOf(scheme, e.familyId, e.personId));
    if (result && !result.eligible) {
      enrolledNotEligible.push({
        familyId: e.familyId, personId: e.personId, schemeCode: e.schemeCode,
        sourceRecordId: e.sourceRecordId, monthlyAmount: e.monthlyAmount,
      });
    }
  }
  return { eligibleNotEnrolled, enrolledNotEligible };
}
