// Enrollments (DESIGN.md 7.8 "derive enrollments", plus automatic benefits).
import type {
  EligibilityResult, Enrollment, Family, NormalizedRecord, RecordEnrollment, SchemeConfig, SchemesConfig,
} from "./types";

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const NFSA_SCHEME = "NFSA_RATION";

/**
 * Enrollments backed by a source record:
 * - Every pension and scholarship record is one enrollment for the person it resolved to.
 * - Every active, anchored family holds one NFSA_RATION enrollment (family scope, recorded on the
 *   head), sourced from the head's ration record. A merged duplicate card adds none: it is
 *   reported as a duplicate_enrollment flag instead.
 */
export function deriveEnrollments(
  records: readonly NormalizedRecord[],
  personIdByRecord: ReadonlyMap<string, string>,
  familyIdByPerson: ReadonlyMap<string, string>,
  families: readonly Family[],
): RecordEnrollment[] {
  const enrollments: RecordEnrollment[] = [];

  for (const r of records) {
    if ((r.source !== "pension" && r.source !== "scholarship") || r.schemeCode === null) continue;
    const personId = personIdByRecord.get(r.id);
    const familyId = personId === undefined ? undefined : familyIdByPerson.get(personId);
    if (personId === undefined || familyId === undefined) continue;
    enrollments.push({
      basis: "record", personId, familyId, schemeCode: r.schemeCode, sourceRecordId: r.id,
      monthlyAmount: r.benefitAmount,
    });
  }

  const rationByCardAndPerson = new Map<string, NormalizedRecord[]>();
  for (const r of records) {
    if (r.source !== "ration" || r.householdRef === null) continue;
    const personId = personIdByRecord.get(r.id);
    if (personId === undefined) continue;
    const key = `${r.householdRef}|${personId}`;
    rationByCardAndPerson.set(key, [...(rationByCardAndPerson.get(key) ?? []), r]);
  }
  for (const family of families) {
    if (!family.isAnchored || family.status !== "active" || family.headPersonId === null) continue;
    const headRecord = family.cardRefs
      .flatMap((ref) => rationByCardAndPerson.get(`${ref}|${family.headPersonId}`) ?? [])
      .sort((a, b) => cmp(a.id, b.id))[0];
    if (!headRecord) continue;
    enrollments.push({
      basis: "record", personId: family.headPersonId, familyId: family.id, schemeCode: NFSA_SCHEME,
      sourceRecordId: headRecord.id, monthlyAmount: null,
    });
  }

  return enrollments.sort((a, b) => cmp(a.sourceRecordId, b.sourceRecordId));
}

/** Person-scope schemes are keyed by person, family-scope ones by family (whoever holds them). */
const coverKey = (scheme: SchemeConfig, familyId: string, personId: string | null) =>
  scheme.scope === "family" ? `f|${familyId}|${scheme.code}` : `p|${personId}|${scheme.code}`;

/**
 * Benefits that start without an application. For every eligible result on a scheme that needs
 * no manual verification, and that has a real enrollment source, add an `auto` enrollment unless a
 * record already covers it. Schemes that need manual verification, and discovery-only schemes,
 * stay "eligible, not receiving" until an officer acts.
 *
 * A family-scope benefit is recorded on the family's head. Deceased people are never eligible, so
 * they never get one.
 */
export function grantAutomatic(
  eligibility: readonly EligibilityResult[],
  existing: readonly Enrollment[],
  families: readonly Family[],
  config: SchemesConfig,
): Enrollment[] {
  const schemeByCode = new Map(config.schemes.map((s) => [s.code, s]));
  const headOf = new Map(families.map((f) => [f.id, f.headPersonId]));
  const covered = new Set<string>();
  for (const e of existing) {
    const scheme = schemeByCode.get(e.schemeCode);
    if (scheme) covered.add(coverKey(scheme, e.familyId, e.personId));
  }

  const granted: Enrollment[] = [];
  for (const result of eligibility) {
    const scheme = schemeByCode.get(result.schemeCode);
    if (!result.eligible || !scheme) continue;
    if (scheme.manualVerificationRequired || scheme.enrollment === "none") continue;

    const key = coverKey(scheme, result.familyId, result.personId);
    if (covered.has(key)) continue;
    const personId = result.personId ?? headOf.get(result.familyId) ?? null;
    if (personId === null) continue;

    covered.add(key);
    granted.push({
      basis: "auto", personId, familyId: result.familyId, schemeCode: scheme.code,
      sourceRecordId: null, monthlyAmount: scheme.monthlyBenefit,
    });
  }
  return granted.sort(
    (a, b) => cmp(a.familyId, b.familyId) || cmp(a.personId, b.personId) || cmp(a.schemeCode, b.schemeCode),
  );
}
