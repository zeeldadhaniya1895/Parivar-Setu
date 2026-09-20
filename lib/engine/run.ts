// The whole engine, in memory (DESIGN.md 7.8): records in, one result object out.
// No database, no network, no clock: "today" arrives as `asOfDate`.
import { detectAnomalies } from "./anomalies";
import { analyzeGaps, deriveIsStudent, evaluateEligibility } from "./eligibility";
import { deriveEnrollments } from "./enrollments";
import { buildStats, evaluatePairs, type RunStats } from "./evaluate";
import { findMatches } from "./match";
import { normalizeRecord } from "./normalize";
import { resolve } from "./resolve";
import type {
  AnomalyFlag, CardMerge, EligibilityResult, Enrollment, Family, FamilyMember, GapAnalysis,
  MatchCandidate, MultiHousehold, Person, ReviewDecision, SchemesConfig, SourceRecord,
} from "./types";

export interface EngineInput {
  records: readonly SourceRecord[];
  decisions: readonly ReviewDecision[];
  asOfDate: string;
  config: SchemesConfig;
  /**
   * Ground truth (record id -> true person id), used only to score the result. Decisions never
   * look at it. Omit it to skip evaluation.
   */
  truth?: ReadonlyMap<string, string>;
}

export interface EngineResult {
  candidates: MatchCandidate[];
  persons: Person[];
  personIdByRecord: Map<string, string>;
  families: Family[];
  familyMembers: FamilyMember[];
  cardMerges: CardMerge[];
  multiHousehold: MultiHousehold[];
  enrollments: Enrollment[];
  flags: AnomalyFlag[];
  eligibility: EligibilityResult[];
  gaps: GapAnalysis;
  stats: RunStats;
}

export function runEngine(input: EngineInput): EngineResult {
  const { records, decisions, asOfDate, config, truth } = input;

  const normalized = records.map((r) => normalizeRecord(r, asOfDate));
  const scored = findMatches(normalized, decisions);
  const resolved = resolve(normalized, scored);

  const enrollments = deriveEnrollments(
    normalized, resolved.personIdByRecord, resolved.familyIdByPerson, resolved.families,
  );

  const deathRecordIdsByPerson = new Map<string, string[]>();
  for (const r of normalized) {
    const personId = resolved.personIdByRecord.get(r.id);
    if (r.source !== "death_registry" || personId === undefined) continue;
    deathRecordIdsByPerson.set(personId, [...(deathRecordIdsByPerson.get(personId) ?? []), r.id]);
  }
  const anomalies = detectAnomalies({
    persons: resolved.persons,
    families: resolved.families,
    enrollments,
    cardMerges: resolved.cardMerges,
    multiHousehold: resolved.multiHousehold,
    deathRecordIdsByPerson,
  });

  const eligibility = evaluateEligibility({
    persons: resolved.persons,
    families: resolved.families,
    familyMembers: resolved.familyMembers,
    isStudentByPerson: deriveIsStudent(normalized, resolved.personIdByRecord),
    asOfDate,
    config,
  });
  const gaps = analyzeGaps(eligibility, enrollments, config);

  const evaluation = truth
    ? evaluatePairs(
        normalized.filter((r) => r.source !== "death_registry").map((r) => r.id),
        resolved.personIdByRecord,
        truth,
      )
    : null;

  const stats = buildStats({
    sourceRecordCount: records.length,
    persons: resolved.persons,
    families: resolved.families,
    candidates: resolved.candidates,
    cardMergeCount: resolved.cardMerges.length,
    flags: anomalies.flags,
    eligibility,
    gaps,
    leakageByEnrollment: anomalies.leakageByEnrollment,
    evaluation,
  });

  return {
    candidates: resolved.candidates,
    persons: resolved.persons,
    personIdByRecord: resolved.personIdByRecord,
    families: resolved.families,
    familyMembers: resolved.familyMembers,
    cardMerges: resolved.cardMerges,
    multiHousehold: resolved.multiHousehold,
    enrollments,
    flags: anomalies.flags,
    eligibility,
    gaps,
    stats,
  };
}
