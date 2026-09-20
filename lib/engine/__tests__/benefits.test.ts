import { describe, expect, it } from "vitest";
import schemesJson from "../../../config/schemes.json";
import { grantAutomatic } from "../enrollments";
import { parseSchemesConfig } from "../eligibility";
import { runEngine } from "../run";
import type { EligibilityResult, Enrollment, Family, FamilyEvent, SourceRecord } from "../types";
import { rec } from "./fixtures";

const config = parseSchemesConfig(schemesJson);
const AS_OF = "2026-09-20";

// ---- grantAutomatic on hand-built inputs --------------------------------------------------

const result = (
  familyId: string, personId: string | null, schemeCode: string, eligible: boolean,
): EligibilityResult => ({ familyId, personId, schemeCode, eligible, reasons: [], rulesVersion: "t" });

const family = (id: string, headPersonId: string | null): Family => ({
  id, headPersonId, district: "d", taluka: "t", village: "v", resolvedIncome: 90_000, incomeSources: [],
  isAnchored: true, status: "active", mergedInto: null, parentFamilyId: null, cardRefs: [],
});

const recordEnrollment = (personId: string, familyId: string, schemeCode: string, rec: string): Enrollment => ({
  basis: "record", personId, familyId, schemeCode, sourceRecordId: rec, monthlyAmount: null,
});

describe("grantAutomatic", () => {
  const families = [family("F-1", "P-1")];

  it("starts an eligible person's benefit on a scheme that needs no manual verification, with the config amount", () => {
    const granted = grantAutomatic([result("F-1", "P-2", "OLD_AGE_PENSION", true)], [], families, config);
    expect(granted).toEqual([
      { basis: "auto", personId: "P-2", familyId: "F-1", schemeCode: "OLD_AGE_PENSION", sourceRecordId: null, monthlyAmount: 1000 },
    ]);
  });

  it("gives a family-scope benefit to the family, recorded on its head, without a cash amount", () => {
    const granted = grantAutomatic([result("F-1", null, "NFSA_RATION", true)], [], families, config);
    expect(granted).toEqual([
      { basis: "auto", personId: "P-1", familyId: "F-1", schemeCode: "NFSA_RATION", sourceRecordId: null, monthlyAmount: null },
    ]);
  });

  it("does not add a second ration benefit when a ration card already covers the family (regression)", () => {
    const existing = [recordEnrollment("P-1", "F-1", "NFSA_RATION", "RAT-1")];
    expect(grantAutomatic([result("F-1", null, "NFSA_RATION", true)], existing, families, config)).toEqual([]);
  });

  it("does not duplicate a person's benefit that a record already covers, but covers a different person", () => {
    const existing = [recordEnrollment("P-2", "F-1", "OLD_AGE_PENSION", "PEN-1")];
    const granted = grantAutomatic(
      [result("F-1", "P-2", "OLD_AGE_PENSION", true), result("F-1", "P-3", "OLD_AGE_PENSION", true)],
      existing, families, config,
    );
    expect(granted.map((g) => g.personId)).toEqual(["P-3"]);
  });

  it("leaves manual-verification and discovery-only schemes waiting", () => {
    const granted = grantAutomatic(
      [
        result("F-1", "P-2", "WIDOW_ASSIST", true),
        result("F-1", "P-3", "VAHLI_DIKRI", true),
        result("F-1", null, "PMJAY_MA", true),
      ],
      [], families, config,
    );
    expect(granted).toEqual([]);
  });

  it("grants nothing when not eligible, and skips a family-scope benefit with no head", () => {
    expect(grantAutomatic([result("F-1", "P-2", "OLD_AGE_PENSION", false)], [], families, config)).toEqual([]);
    expect(grantAutomatic([result("F-9", null, "NFSA_RATION", true)], [], [family("F-9", null)], config)).toEqual([]);
  });

  it("returns grants in a stable order", () => {
    const eligible = [
      result("F-2", "P-9", "SCHOLARSHIP", true), result("F-1", "P-3", "OLD_AGE_PENSION", true),
      result("F-1", "P-2", "OLD_AGE_PENSION", true),
    ];
    const list = [family("F-1", "P-1"), family("F-2", "P-8")];
    const a = grantAutomatic(eligible, [], list, config);
    expect(grantAutomatic([...eligible].reverse(), [], list, config)).toEqual(a);
    expect(a.map((g) => `${g.familyId}|${g.personId}`)).toEqual(["F-1|P-2", "F-1|P-3", "F-2|P-9"]);
  });
});

// ---- the whole engine on a small world ----------------------------------------------------

const person = (o: Partial<SourceRecord> & Pick<SourceRecord, "id" | "full_name" | "dob" | "gender" | "relation_to_head">) =>
  rec({ household_ref: "RC-1", income_declared: 90_000, marital_status: "married", ...o });

const world: SourceRecord[] = [
  person({ id: "RAT-1", full_name: "Ramesh Kantilal Patel", dob: "14/03/1959", gender: "M", relation_to_head: "head" }),
  person({ id: "RAT-2", full_name: "Savita Ramesh Patel", dob: "02/08/1962", gender: "F", relation_to_head: "spouse" }),
  person({
    id: "RAT-3", full_name: "Hetal Jayesh Patel", dob: "17/02/1988", gender: "F",
    relation_to_head: "daughter_in_law", marital_status: "widowed",
  }),
];

const run = (records: SourceRecord[] = world, events: FamilyEvent[] = []) =>
  runEngine({ records, decisions: [], events, asOfDate: AS_OF, config });

describe("automatic benefits in the whole engine", () => {
  const out = run();
  const auto = out.enrollments.filter((e) => e.basis === "auto");
  const nameOf = (id: string) => out.persons.find((p) => p.id === id)?.canonicalName;

  it("starts the old-age pension for both eligible members, from no record", () => {
    const pension = auto.filter((e) => e.schemeCode === "OLD_AGE_PENSION");
    expect(pension.map((e) => nameOf(e.personId)).sort()).toEqual(["Ramesh Kantilal Patel", "Savita Ramesh Patel"]);
    expect(pension.every((e) => e.sourceRecordId === null && e.monthlyAmount === 1000)).toBe(true);
  });

  it("has exactly one ration benefit for the family, backed by the ration record", () => {
    const nfsa = out.enrollments.filter((e) => e.schemeCode === "NFSA_RATION");
    expect(nfsa).toHaveLength(1);
    expect(nfsa[0].basis).toBe("record");
  });

  it("does not start manual-verification schemes: they wait as eligible, not enrolled", () => {
    expect(out.enrollments.some((e) => e.schemeCode === "WIDOW_ASSIST" || e.schemeCode === "PMJAY_MA")).toBe(false);
    const waiting = out.gaps.eligibleNotEnrolled.map((g) => g.schemeCode);
    expect(waiting).toContain("WIDOW_ASSIST");
    expect(waiting).toContain("PMJAY_MA");
    expect(waiting).not.toContain("OLD_AGE_PENSION");
    expect(waiting).not.toContain("NFSA_RATION");
  });

  it("does not turn automatic benefits into flags or leakage", () => {
    expect(out.flags).toEqual([]);
    expect(out.stats.estMonthlyLeakage).toBe(0);
    expect(out.gaps.enrolledNotEligible).toEqual([]);
  });

  it("reports who is receiving and who is waiting, per scheme", () => {
    expect(out.stats.receivingByScheme.OLD_AGE_PENSION).toEqual({
      families: 1, beneficiaries: 2, monthlyAmount: 2000, automatic: 1,
    });
    expect(out.stats.receivingByScheme.NFSA_RATION).toEqual({
      families: 1, beneficiaries: 3, monthlyAmount: 0, automatic: 0,
    });
    expect(out.stats.pendingVerificationByScheme.WIDOW_ASSIST).toEqual({ families: 1, beneficiaries: 1 });
    expect(out.stats.pendingVerificationByScheme.PMJAY_MA).toEqual({ families: 1, beneficiaries: 3 });
  });

  it("never grants a benefit to a person who has died, and keeps the record-backed pension as leakage", () => {
    const dead = run(
      [
        ...world,
        rec({
          id: "PEN-1", source: "pension", full_name: "Ramesh Kantilal Patel", dob: "14/03/1959", gender: "M",
          scheme_code: "OLD_AGE_PENSION", benefit_amount: 1000, income_declared: 90_000,
        }),
      ],
      [{ type: "death", subjectRecordId: "RAT-1", date: "2026-08-01", newMaritalStatus: null }],
    );
    const ramesh = dead.persons.find((p) => p.canonicalName === "Ramesh Kantilal Patel");
    expect(ramesh?.isDeceased).toBe(true);
    expect(dead.enrollments.filter((e) => e.personId === ramesh?.id && e.basis === "auto")).toEqual([]);
    // his pension is a real record, so it is flagged and counted as leakage
    expect(dead.flags.map((f) => f.type)).toContain("deceased_beneficiary");
    expect(dead.stats.estMonthlyLeakage).toBe(1000);
    // Savita still gets her automatic pension
    expect(dead.enrollments.some((e) => e.basis === "auto" && e.schemeCode === "OLD_AGE_PENSION")).toBe(true);
  });

  it("is deterministic", () => {
    expect(run()).toEqual(out);
    expect(run([...world].reverse())).toEqual(out);
  });
});
