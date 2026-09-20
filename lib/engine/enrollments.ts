// Derive enrollments from source records and families (DESIGN.md 7.8, "derive enrollments").
import type { Enrollment, Family, NormalizedRecord } from "./types";

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const NFSA_SCHEME = "NFSA_RATION";

/**
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
): Enrollment[] {
  const enrollments: Enrollment[] = [];

  for (const r of records) {
    if ((r.source !== "pension" && r.source !== "scholarship") || r.schemeCode === null) continue;
    const personId = personIdByRecord.get(r.id);
    const familyId = personId === undefined ? undefined : familyIdByPerson.get(personId);
    if (personId === undefined || familyId === undefined) continue;
    enrollments.push({
      personId, familyId, schemeCode: r.schemeCode, sourceRecordId: r.id, monthlyAmount: r.benefitAmount,
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
      personId: family.headPersonId, familyId: family.id, schemeCode: NFSA_SCHEME,
      sourceRecordId: headRecord.id, monthlyAmount: null,
    });
  }

  return enrollments.sort((a, b) => cmp(a.sourceRecordId, b.sourceRecordId));
}
