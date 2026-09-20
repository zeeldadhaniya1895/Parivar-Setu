import { describe, expect, it } from "vitest";
import schemesJson from "../../../config/schemes.json";
import { parseSchemesConfig } from "../../../lib/engine/eligibility";
import { runEngine } from "../../../lib/engine/run";
import { toRows } from "../../../lib/db/persist";
import { generateSeed } from "../generate";

const seed = generateSeed();
const config = parseSchemesConfig(schemesJson);
const truth = new Map(seed.records.map((r) => [r.id, r.true_person_id]));

function run() {
  const records = seed.records.map((r) => {
    const { true_person_id: hidden, ...row } = r;
    void hidden;
    return row;
  });
  return runEngine({ records, decisions: [], events: [], asOfDate: "2026-09-20", config, truth });
}

const result = run();

const personOfTrue = (trueId: string): string => {
  const record = seed.records.find((r) => r.true_person_id === trueId);
  const person = record && result.personIdByRecord.get(record.id);
  if (!person) throw new Error(`no person for ${trueId}`);
  return person;
};
const flagsOfType = (type: string) => result.flags.filter((f) => f.type === type);

describe("full pipeline on the seed", () => {
  it("gives identical results on two consecutive runs", () => {
    expect(run()).toEqual(result);
  });

  it("reports real, imperfect evaluation numbers", () => {
    const { precision, recall, f1 } = result.stats;
    expect(precision).toBeGreaterThanOrEqual(0.98);
    expect(recall).toBeGreaterThanOrEqual(0.9);
    expect(recall).toBeLessThan(1);
    expect(f1).toBeGreaterThan(0.9);
  });

  it("flags the planted deceased pensioners, with evidence", () => {
    const flagged = seed.planted.deceasedPension.filter((id) =>
      flagsOfType("deceased_beneficiary").some((f) => f.personId === personOfTrue(id)),
    );
    expect(flagged.length).toBeGreaterThanOrEqual(9); // a death record that stays in review is missed
    for (const flag of flagsOfType("deceased_beneficiary")) {
      expect(flag.estMonthlyLeakage).toBeGreaterThan(0);
      expect(flag.evidence.deathRecordIds).not.toEqual([]);
    }
  });

  it("flags the planted double enrollments", () => {
    const flagged = seed.planted.doubleEnrollment.filter((id) =>
      flagsOfType("duplicate_enrollment").some((f) => f.personId === personOfTrue(id)),
    );
    expect(flagged.length).toBeGreaterThanOrEqual(5);
  });

  it("flags the 5 duplicate ration cards and the 5 people on two cards", () => {
    const cardFlags = flagsOfType("duplicate_enrollment").filter((f) => f.evidence.scheme === "NFSA_RATION");
    expect(cardFlags).toHaveLength(5);
    expect(flagsOfType("multi_household")).toHaveLength(5);
  });

  it("flags every planted income mismatch", () => {
    for (const ref of seed.planted.incomeMismatch) {
      const family = result.families.find((f) => f.cardRefs.includes(ref) && f.status === "active");
      expect(family, ref).toBeDefined();
      expect(flagsOfType("income_mismatch").some((f) => f.familyId === family?.id), ref).toBe(true);
    }
  });

  it("flags benefits in families without a ration card", () => {
    expect(flagsOfType("unanchored_beneficiary").length).toBeGreaterThanOrEqual(seed.planted.noCardBenefit.length);
  });

  it("estimates leakage from the flagged and ineligible benefits, counting each benefit once", () => {
    const { estMonthlyLeakage } = result.stats;
    expect(estMonthlyLeakage).toBeGreaterThan(10_000);
    const allBenefits = result.enrollments.reduce((t, e) => t + (e.monthlyAmount ?? 0), 0);
    expect(estMonthlyLeakage).toBeLessThan(allBenefits);
  });

  it("shows the demo story on the showcase family", () => {
    const { headId, motherId, householdRef } = seed.planted.showcase;
    const family = result.families.find((f) => f.cardRefs.includes(householdRef));
    expect(family).toBeDefined();
    const flags = result.flags.filter((f) => f.familyId === family?.id);
    expect(flags.map((f) => f.type)).toContain("deceased_beneficiary");
    expect(flags.find((f) => f.type === "deceased_beneficiary")?.personId).toBe(personOfTrue(motherId));

    // Manual-verification schemes wait for an officer: they show as eligible, not enrolled.
    const waiting = result.gaps.eligibleNotEnrolled.filter((g) => g.familyId === family?.id).map((g) => g.schemeCode);
    expect(waiting).toContain("VAHLI_DIKRI"); // the granddaughter
    expect(waiting).toContain("PMJAY_MA");
    expect(waiting).not.toContain("OLD_AGE_PENSION"); // no manual step, so it starts by itself

    // The spouse is eligible for the old-age pension, so it starts automatically.
    const autoSchemes = result.enrollments
      .filter((e) => e.basis === "auto" && e.familyId === family?.id)
      .map((e) => e.schemeCode);
    expect(autoSchemes).toContain("OLD_AGE_PENSION");
    const gaps = result.gaps.eligibleNotEnrolled.filter((g) => g.familyId === family?.id);

    // the head is enrolled and eligible
    expect(gaps.some((g) => g.personId === personOfTrue(headId) && g.schemeCode === "OLD_AGE_PENSION")).toBe(false);
    // the dead mother's pension is paid to someone ineligible
    expect(
      result.gaps.enrolledNotEligible.some((g) => g.familyId === family?.id && g.personId === personOfTrue(motherId)),
    ).toBe(true);
  });

  it("starts benefits automatically without fake records, and never twice", () => {
    const auto = result.enrollments.filter((e) => e.basis === "auto");
    expect(auto.length).toBeGreaterThan(50);
    expect(auto.every((e) => e.sourceRecordId === null)).toBe(true);
    expect(result.enrollments.some((e) => e.sourceRecordId === "AUTO-ENROLL")).toBe(false);

    const key = (e: { familyId: string; personId: string; schemeCode: string }) =>
      `${e.familyId}|${e.personId}|${e.schemeCode}`;
    // Automatic grants never repeat each other or a benefit a record already provides. (Two real
    // pension records for one person are the planted double enrollments, and are flagged instead.)
    const autoKeys = auto.map(key);
    expect(new Set(autoKeys).size).toBe(autoKeys.length);
    const recordKeys = new Set(result.enrollments.filter((e) => e.basis === "record").map(key));
    expect(autoKeys.filter((k) => recordKeys.has(k))).toEqual([]);

    const nfsaPerFamily = new Map<string, number>();
    for (const e of result.enrollments.filter((x) => x.schemeCode === "NFSA_RATION")) {
      nfsaPerFamily.set(e.familyId, (nfsaPerFamily.get(e.familyId) ?? 0) + 1);
    }
    expect(Math.max(...nfsaPerFamily.values())).toBe(1);
  });

  it("leaves only manual-verification and discovery schemes as eligible, not enrolled", () => {
    const manualOrDiscovery = new Set(
      config.schemes.filter((s) => s.manualVerificationRequired || s.enrollment === "none").map((s) => s.code),
    );
    expect(result.gaps.eligibleNotEnrolled.length).toBeGreaterThan(0);
    for (const g of result.gaps.eligibleNotEnrolled) expect(manualOrDiscovery.has(g.schemeCode)).toBe(true);
    const pending = result.stats.pendingVerificationByScheme;
    expect(Object.keys(pending).every((code) => manualOrDiscovery.has(code))).toBe(true);
  });

  it("does not let automatic benefits raise flags or count as leakage", () => {
    const autoIds = new Set(
      result.enrollments.filter((e) => e.basis === "auto").map((e) => `${e.personId}|${e.schemeCode}`),
    );
    for (const flag of result.flags) {
      if (flag.type !== "unanchored_beneficiary") continue;
      const enrollments = (flag.evidence.enrollments as { recordId: string }[]) ?? [];
      expect(enrollments.every((e) => typeof e.recordId === "string" && e.recordId !== "")).toBe(true);
    }
    expect(autoIds.size).toBeGreaterThan(0);
    const recordBacked = result.enrollments.filter((e) => e.basis === "record");
    const total = recordBacked.reduce((t, e) => t + (e.monthlyAmount ?? 0), 0);
    expect(result.stats.estMonthlyLeakage).toBeLessThanOrEqual(total);
  });

  it("never marks a deceased person eligible", () => {
    const dead = new Set(result.persons.filter((p) => p.isDeceased).map((p) => p.id));
    expect(dead.size).toBeGreaterThan(10);
    for (const r of result.eligibility) {
      if (r.personId !== null && dead.has(r.personId)) expect(r.eligible).toBe(false);
    }
  });

  it("stores the reasons behind every eligibility result", () => {
    expect(result.eligibility.every((r) => r.reasons.length > 0 && r.rulesVersion === config.version)).toBe(true);
  });

  it("produces database rows that respect the schema constraints", () => {
    const rows = toRows(result);
    expect(rows.persons).toHaveLength(result.stats.persons);
    const decisions = new Set(rows.match_candidates.map((c) => c.decision));
    expect([...decisions].every((d) => ["auto_merge", "review", "distinct"].includes(String(d)))).toBe(true);
    expect(rows.match_candidates.length).toBeLessThan(1000); // clearly distinct pairs are not stored
    expect(rows.match_candidates.some((c) => c.decision === "distinct")).toBe(true); // hard-rule separations are
    const memberPersons = rows.family_members.map((m) => m.person_id);
    expect(new Set(memberPersons).size).toBe(memberPersons.length); // one current family per person
    for (const f of rows.families) {
      expect(typeof f.district).toBe("string");
      expect(["active", "merged"]).toContain(f.status);
    }
  });
});
