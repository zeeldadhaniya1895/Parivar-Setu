// Evaluation against ground truth (DESIGN.md 7.10) and run statistics.
import type {
  AnomalyFlag, AnomalyType, EligibilityResult, Enrollment, Family, GapAnalysis, MatchCandidate, Person,
  SchemesConfig,
} from "./types";

const pairs = (n: number) => (n * (n - 1)) / 2;

export interface PairwiseEvaluation {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  truePairs: number;
  predictedPairs: number;
  correctPairs: number;
}

/**
 * Pairwise precision, recall and F1 over source records. A pair is a true match when both
 * records share a true person, and predicted when they ended up in the same person. Callers
 * exclude the death registry, which is not part of the evaluation.
 */
export function evaluatePairs(
  recordIds: readonly string[],
  personIdByRecord: ReadonlyMap<string, string>,
  truthByRecord: ReadonlyMap<string, string>,
): PairwiseEvaluation {
  const truthCounts = new Map<string, number>();
  const predictedCounts = new Map<string, number>();
  const cellCounts = new Map<string, number>();
  for (const id of recordIds) {
    const truth = truthByRecord.get(id);
    const predicted = personIdByRecord.get(id);
    if (truth === undefined || predicted === undefined) continue;
    truthCounts.set(truth, (truthCounts.get(truth) ?? 0) + 1);
    predictedCounts.set(predicted, (predictedCounts.get(predicted) ?? 0) + 1);
    const cell = `${predicted}|${truth}`;
    cellCounts.set(cell, (cellCounts.get(cell) ?? 0) + 1);
  }
  const sumPairs = (counts: Map<string, number>) => [...counts.values()].reduce((t, n) => t + pairs(n), 0);
  const truePairs = sumPairs(truthCounts);
  const predictedPairs = sumPairs(predictedCounts);
  const correctPairs = sumPairs(cellCounts);

  const precision = predictedPairs === 0 ? null : correctPairs / predictedPairs;
  const recall = truePairs === 0 ? null : correctPairs / truePairs;
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? null
      : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, truePairs, predictedPairs, correctPairs };
}

/** Who receives a scheme today, from records and from automatic grants. */
export interface ReceivingTotals {
  families: number;
  /** People for person-scope schemes; every family member for family-scope schemes */
  beneficiaries: number;
  /** Total demo monthly benefit in rupees */
  monthlyAmount: number;
  /** How many of the families' benefits started automatically rather than from a record */
  automatic: number;
}

/** Who is eligible but waiting, because the scheme needs manual verification. */
export interface PendingTotals {
  families: number;
  beneficiaries: number;
}

export interface RunStats {
  sourceRecords: number;
  persons: number;
  families: number;
  mergedFamilies: number;
  unanchoredFamilies: number;
  autoMerges: number;
  reviewPending: number;
  cardMerges: number;
  flagsByType: Record<AnomalyType, number>;
  estMonthlyLeakage: number;
  eligibleNotEnrolled: number;
  eligibleNotEnrolledByScheme: Record<string, number>;
  receivingByScheme: Record<string, ReceivingTotals>;
  pendingVerificationByScheme: Record<string, PendingTotals>;
  enrolledNotEligible: number;
  eligibleResults: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
  truePairs: number | null;
  predictedPairs: number | null;
  correctPairs: number | null;
}

const FLAG_TYPES: readonly AnomalyType[] = [
  "deceased_beneficiary", "duplicate_enrollment", "multi_household",
  "income_mismatch", "unanchored_beneficiary",
];

export function buildStats(input: {
  sourceRecordCount: number;
  persons: readonly Person[];
  families: readonly Family[];
  candidates: readonly MatchCandidate[];
  cardMergeCount: number;
  flags: readonly AnomalyFlag[];
  eligibility: readonly EligibilityResult[];
  gaps: GapAnalysis;
  enrollments: readonly Enrollment[];
  memberCountByFamily: ReadonlyMap<string, number>;
  config: SchemesConfig;
  leakageByEnrollment: ReadonlyMap<string, number>;
  evaluation: PairwiseEvaluation | null;
}): RunStats {
  const { flags, gaps, candidates, families, evaluation } = input;

  // A benefit that is flagged, ineligible, or both counts once.
  const leaking = new Map(input.leakageByEnrollment);
  for (const e of gaps.enrolledNotEligible) {
    if (e.monthlyAmount !== null && e.monthlyAmount > 0) {
      leaking.set(e.sourceRecordId, Math.max(leaking.get(e.sourceRecordId) ?? 0, e.monthlyAmount));
    }
  }
  const byScheme: Record<string, number> = {};
  for (const g of gaps.eligibleNotEnrolled) byScheme[g.schemeCode] = (byScheme[g.schemeCode] ?? 0) + 1;

  const schemeByCode = new Map(input.config.schemes.map((s) => [s.code, s]));
  const sizeOf = (familyId: string) => input.memberCountByFamily.get(familyId) ?? 0;

  const receivingFamilies = new Map<string, Set<string>>();
  const receiving: Record<string, ReceivingTotals> = {};
  for (const e of input.enrollments) {
    const scheme = schemeByCode.get(e.schemeCode);
    if (!scheme) continue;
    const totals = (receiving[e.schemeCode] ??= { families: 0, beneficiaries: 0, monthlyAmount: 0, automatic: 0 });
    const seen = receivingFamilies.get(e.schemeCode) ?? new Set<string>();
    if (!seen.has(e.familyId)) {
      seen.add(e.familyId);
      totals.families += 1;
      if (e.basis === "auto") totals.automatic += 1;
    }
    receivingFamilies.set(e.schemeCode, seen);
    totals.beneficiaries += scheme.scope === "family" ? sizeOf(e.familyId) : 1;
    totals.monthlyAmount += e.monthlyAmount ?? 0;
  }

  const pendingFamilies = new Map<string, Set<string>>();
  const pending: Record<string, PendingTotals> = {};
  for (const g of gaps.eligibleNotEnrolled) {
    const scheme = schemeByCode.get(g.schemeCode);
    if (!scheme) continue;
    const totals = (pending[g.schemeCode] ??= { families: 0, beneficiaries: 0 });
    const seen = pendingFamilies.get(g.schemeCode) ?? new Set<string>();
    if (!seen.has(g.familyId)) {
      seen.add(g.familyId);
      totals.families += 1;
    }
    pendingFamilies.set(g.schemeCode, seen);
    totals.beneficiaries += scheme.scope === "family" ? sizeOf(g.familyId) : 1;
  }
  const sortedByCode = <T,>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

  return {
    sourceRecords: input.sourceRecordCount,
    persons: input.persons.length,
    families: families.filter((f) => f.status === "active").length,
    mergedFamilies: families.filter((f) => f.status === "merged").length,
    unanchoredFamilies: families.filter((f) => f.status === "active" && !f.isAnchored).length,
    autoMerges: candidates.filter((c) => c.decision === "auto_merge").length,
    reviewPending: candidates.filter((c) => c.reviewStatus === "pending").length,
    cardMerges: input.cardMergeCount,
    flagsByType: Object.fromEntries(
      FLAG_TYPES.map((t) => [t, flags.filter((f) => f.type === t).length]),
    ) as Record<AnomalyType, number>,
    estMonthlyLeakage: [...leaking.values()].reduce((t, n) => t + n, 0),
    eligibleNotEnrolled: gaps.eligibleNotEnrolled.length,
    eligibleNotEnrolledByScheme: Object.fromEntries(Object.entries(byScheme).sort()),
    receivingByScheme: sortedByCode(receiving),
    pendingVerificationByScheme: sortedByCode(pending),
    enrolledNotEligible: gaps.enrolledNotEligible.length,
    eligibleResults: input.eligibility.filter((r) => r.eligible).length,
    precision: evaluation?.precision ?? null,
    recall: evaluation?.recall ?? null,
    f1: evaluation?.f1 ?? null,
    truePairs: evaluation?.truePairs ?? null,
    predictedPairs: evaluation?.predictedPairs ?? null,
    correctPairs: evaluation?.correctPairs ?? null,
  };
}
