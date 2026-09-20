// The whole engine, in memory (DESIGN.md 7.8): records in, one result object out.
// No database, no network, no clock: "today" arrives as `asOfDate`.
import { detectAnomalies } from "./anomalies";
import { analyzeGaps, deriveIsStudent, evaluateEligibility } from "./eligibility";
import { deriveEnrollments, grantAutomatic } from "./enrollments";
import { buildStats, evaluatePairs, type RunStats } from "./evaluate";
import { findMatches } from "./match";
import { normalizeRecord } from "./normalize";
import { resolve } from "./resolve";
import type {
  AnomalyFlag, CardMerge, EligibilityResult, Enrollment, Family, FamilyEvent, FamilyMember, GapAnalysis,
  MatchCandidate, MultiHousehold, Person, ReviewDecision, SchemesConfig, SourceRecord,
} from "./types";

export interface EngineInput {
  records: readonly SourceRecord[];
  decisions: readonly ReviewDecision[];
  events: readonly FamilyEvent[];
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
  /** Record-backed enrollments plus benefits that started automatically */
  enrollments: Enrollment[];
  flags: AnomalyFlag[];
  eligibility: EligibilityResult[];
  gaps: GapAnalysis;
  stats: RunStats;
}

export function runEngine(input: EngineInput): EngineResult {
  const { records, decisions, events, asOfDate, config, truth } = input;

  const normalized = records.map((r) => normalizeRecord(r, asOfDate));
  const scored = findMatches(normalized, decisions);
  const resolved = resolve(normalized, scored);

  // Apply family events (P8: marking deceased, updating marital status)
  for (const event of events) {
    const personId = resolved.personIdByRecord.get(event.subjectRecordId);
    if (!personId) continue;
    const person = resolved.persons.find((p) => p.id === personId);
    if (!person) continue;

    if (event.type === "death") {
      person.isDeceased = true;
      person.deceasedOn = event.date;
    } else if (event.type === "marital_status_change") {
      person.maritalStatus = event.newMaritalStatus;
    }
  }

  const recordEnrollments = deriveEnrollments(
    normalized, resolved.personIdByRecord, resolved.familyIdByPerson, resolved.families,
  );

  const deathRecordIdsByPerson = new Map<string, string[]>();
  for (const r of normalized) {
    const personId = resolved.personIdByRecord.get(r.id);
    if (r.source !== "death_registry" || personId === undefined) continue;
    deathRecordIdsByPerson.set(personId, [...(deathRecordIdsByPerson.get(personId) ?? []), r.id]);
  }

  const eligibility = evaluateEligibility({
    persons: resolved.persons,
    families: resolved.families,
    familyMembers: resolved.familyMembers,
    isStudentByPerson: deriveIsStudent(normalized, resolved.personIdByRecord),
    asOfDate,
    config,
  });

  // Schemes that need no manual verification start paying by themselves. Only record-backed
  // enrollments are audited for leakage: an automatic benefit is granted because the rules pass.
  const enrollments: Enrollment[] = [
    ...recordEnrollments,
    ...grantAutomatic(eligibility, recordEnrollments, resolved.families, config),
  ];

  const anomalies = detectAnomalies({
    persons: resolved.persons,
    families: resolved.families,
    enrollments: recordEnrollments,
    cardMerges: resolved.cardMerges,
    multiHousehold: resolved.multiHousehold,
    deathRecordIdsByPerson,
  });

  // What is still "eligible, not enrolled" is exactly what waits for an officer.
  const gaps = analyzeGaps(eligibility, enrollments, config);

  const evaluation = truth
    ? evaluatePairs(
        normalized.filter((r) => r.source !== "death_registry").map((r) => r.id),
        resolved.personIdByRecord,
        truth,
      )
    : null;

  const memberCountByFamily = new Map<string, number>();
  for (const m of resolved.familyMembers) {
    memberCountByFamily.set(m.familyId, (memberCountByFamily.get(m.familyId) ?? 0) + 1);
  }

  const stats = buildStats({
    sourceRecordCount: records.length,
    persons: resolved.persons,
    families: resolved.families,
    candidates: resolved.candidates,
    cardMergeCount: resolved.cardMerges.length,
    flags: anomalies.flags,
    eligibility,
    gaps,
    enrollments,
    memberCountByFamily,
    config,
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
