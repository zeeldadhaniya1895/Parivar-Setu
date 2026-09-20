// Evaluation against ground truth (DESIGN.md 7.10) and run statistics.
import type {
  AnomalyFlag, AnomalyType, EligibilityResult, Family, GapAnalysis, MatchCandidate, Person,
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
