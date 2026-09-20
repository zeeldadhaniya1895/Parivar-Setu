// Anomaly detection (DESIGN.md 7.5). Every flag stores its evidence: source record ids and the
// values that triggered it.
import { NFSA_SCHEME } from "./enrollments";
import type {
  AnomalyFlag, AnomalyType, CardMerge, Enrollment, Family, JsonValue, MultiHousehold, Person,
  Severity,
} from "./types";

const INCOME_RATIO = 1.5;
const INCOME_GAP = 50_000;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const TYPE_ORDER: readonly AnomalyType[] = [
  "deceased_beneficiary", "duplicate_enrollment", "multi_household",
  "income_mismatch", "unanchored_beneficiary",
];
const SEVERITY: Record<AnomalyType, Severity> = {
  deceased_beneficiary: "high",
  duplicate_enrollment: "high",
  multi_household: "medium",
  income_mismatch: "medium",
  unanchored_beneficiary: "low",
};

export interface AnomalyInput {
  persons: readonly Person[];
  families: readonly Family[];
  enrollments: readonly Enrollment[];
  cardMerges: readonly CardMerge[];
  multiHousehold: readonly MultiHousehold[];
  /** Death registry record ids per person, cited as evidence on deceased_beneficiary flags */
  deathRecordIdsByPerson: ReadonlyMap<string, readonly string[]>;
}

export interface AnomalyResult {
  flags: AnomalyFlag[];
  /**
   * Monthly benefit that should not be paid, keyed by enrollment source record id. A benefit is
   * counted once even when several flags (or the eligibility gap) point at it.
   */
  leakageByEnrollment: Map<string, number>;
}

const sum = (values: readonly (number | null)[]): number =>
  values.reduce<number>((total, v) => total + (v ?? 0), 0);
const hasAmount = (values: readonly (number | null)[]) => values.some((v) => v !== null);

export function detectAnomalies(input: AnomalyInput): AnomalyResult {
  const { persons, families, enrollments, cardMerges, multiHousehold, deathRecordIdsByPerson } = input;
  const familyById = new Map(families.map((f) => [f.id, f]));
  const enrollmentsByPerson = new Map<string, Enrollment[]>();
  for (const e of enrollments) {
    enrollmentsByPerson.set(e.personId, [...(enrollmentsByPerson.get(e.personId) ?? []), e]);
  }

  type Draft = Omit<AnomalyFlag, "id">;
  const drafts: Draft[] = [];
  const leakage = new Map<string, number>();
  const leak = (sourceRecordId: string, amount: number | null) => {
    if (amount !== null && amount > 0) leakage.set(sourceRecordId, Math.max(leakage.get(sourceRecordId) ?? 0, amount));
  };
  const draft = (
    type: AnomalyType, familyId: string | null, personId: string | null,
    evidence: { [key: string]: JsonValue }, estMonthlyLeakage: number | null,
  ) => drafts.push({ type, severity: SEVERITY[type], familyId, personId, evidence, estMonthlyLeakage, status: "open" });

  // deceased_beneficiary: a dead person with an enrollment that pays a benefit
  for (const person of persons) {
    if (!person.isDeceased) continue;
    const paying = (enrollmentsByPerson.get(person.id) ?? []).filter((e) => e.monthlyAmount !== null);
    if (paying.length === 0) continue;
    for (const e of paying) leak(e.sourceRecordId, e.monthlyAmount);
    draft("deceased_beneficiary", paying[0].familyId, person.id, {
      deceasedOn: person.deceasedOn,
      enrollments: paying.map((e) => ({
        recordId: e.sourceRecordId, scheme: e.schemeCode, monthlyAmount: e.monthlyAmount,
      })),
      deathRecordIds: [...(deathRecordIdsByPerson.get(person.id) ?? [])],
    }, sum(paying.map((e) => e.monthlyAmount)));
  }

  // duplicate_enrollment (a): the same person enrolled twice in one scheme
  const byPersonScheme = new Map<string, Enrollment[]>();
  for (const e of enrollments) {
    if (e.schemeCode === NFSA_SCHEME) continue;
    const key = `${e.personId}|${e.schemeCode}`;
    byPersonScheme.set(key, [...(byPersonScheme.get(key) ?? []), e]);
  }
  for (const group of byPersonScheme.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => cmp(a.sourceRecordId, b.sourceRecordId));
    // Keep the first enrollment; the rest are the extra benefit.
    const extras = sorted.slice(1);
    for (const e of extras) leak(e.sourceRecordId, e.monthlyAmount);
    draft("duplicate_enrollment", sorted[0].familyId, sorted[0].personId, {
      scheme: sorted[0].schemeCode,
      enrollments: sorted.map((e) => ({ recordId: e.sourceRecordId, monthlyAmount: e.monthlyAmount })),
    }, hasAmount(extras.map((e) => e.monthlyAmount)) ? sum(extras.map((e) => e.monthlyAmount)) : null);
  }

  // duplicate_enrollment (b): duplicate ration cards (7.4 rule 2)
  for (const m of cardMerges) {
    draft("duplicate_enrollment", m.keptFamilyId, null, {
      scheme: NFSA_SCHEME,
      keptCard: m.keptRef,
      duplicateCard: m.mergedRef,
      keptFamilyId: m.keptFamilyId,
      duplicateFamilyId: m.mergedFamilyId,
      sharedPersons: m.sharedPersons,
      shareOfSmallerCard: Math.round(m.ratio * 100) / 100,
    }, null);
  }

  // multi_household: a person on two ration cards that were not merged
  for (const m of multiHousehold) {
    draft("multi_household", m.keptFamilyId, m.personId, {
      keptCard: m.keptCardRef,
      otherCards: m.otherCardRefs,
      otherFamilyIds: m.otherFamilyIds,
    }, null);
  }

  // income_mismatch: highest declared income over 1.5x the lowest, and the gap over 50,000
  for (const family of families) {
    if (family.status !== "active" || family.incomeSources.length < 2) continue;
    const values = family.incomeSources.map((s) => s.value);
    const high = Math.max(...values);
    const low = Math.min(...values);
    if (high > INCOME_RATIO * low && high - low > INCOME_GAP) {
      draft("income_mismatch", family.id, null, {
        highest: high,
        lowest: low,
        sources: family.incomeSources.map((s) => ({ recordId: s.recordId, source: s.source, value: s.value })),
      }, null);
    }
  }

  // unanchored_beneficiary: a benefit in a family not built from a ration card
  for (const person of persons) {
    const own = (enrollmentsByPerson.get(person.id) ?? []).filter((e) => {
      const family = familyById.get(e.familyId);
      return family !== undefined && !family.isAnchored && e.schemeCode !== NFSA_SCHEME;
    });
    if (own.length === 0) continue;
    draft("unanchored_beneficiary", own[0].familyId, person.id, {
      enrollments: own.map((e) => ({ recordId: e.sourceRecordId, scheme: e.schemeCode, monthlyAmount: e.monthlyAmount })),
    }, null);
  }

  // Deterministic order and IDs: type, then family, then person.
  drafts.sort(
    (a, b) =>
      TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) ||
      cmp(a.familyId ?? "", b.familyId ?? "") ||
      cmp(a.personId ?? "", b.personId ?? "") ||
      cmp(JSON.stringify(a.evidence), JSON.stringify(b.evidence)),
  );
  const flags = drafts.map((d, i): AnomalyFlag => ({ id: `FLG-${String(i + 1).padStart(6, "0")}`, ...d }));
  return { flags, leakageByEnrollment: leakage };
}
