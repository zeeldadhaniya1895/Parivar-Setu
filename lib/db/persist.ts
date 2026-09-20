// Write engine output. Derived tables are wiped and rebuilt on every run, in batches of 500.
// Known limitation (DESIGN.md Section 12): the wipe and reinsert are not one transaction, so a
// crash midway leaves derived tables partly filled until the next run. Inputs are never touched.
import type { EngineResult } from "../engine/run";
import type { MatchCandidate } from "../engine/types";
import { db } from "./client";

const BATCH_SIZE = 500;

type Row = Record<string, unknown>;
export type DerivedTable =
  | "persons" | "match_candidates" | "families" | "family_members"
  | "enrollments" | "eligibility_results" | "anomaly_flags";

/** Table name and a filter that matches every row (Supabase refuses an unfiltered delete). */
const DERIVED_TABLES: readonly (readonly [table: DerivedTable, key: string, everything: string | number])[] = [
  ["persons", "id", ""],
  ["match_candidates", "pair_key", ""],
  ["families", "id", ""],
  ["family_members", "id", 0],
  ["enrollments", "id", 0],
  ["eligibility_results", "id", 0],
  ["anomaly_flags", "id", ""],
];

/**
 * Persist the pairs worth showing: everything that merged or needs review, officer-rejected
 * pairs, and pairs a hard rule kept apart even though the weighted score alone would have
 * merged them (father and son, different uid). The other ~20,000 clearly-distinct candidate
 * pairs are recomputed on demand and would only bloat the table.
 */
export function isPersistedCandidate(c: MatchCandidate): boolean {
  return (
    c.decision !== "distinct" ||
    c.reviewStatus === "rejected" ||
    (c.breakdown.rules.length > 0 && c.breakdown.weighted >= 0.75)
  );
}

export function toRows(result: EngineResult): Record<DerivedTable, Row[]> {
  return {
    persons: result.persons.map((p) => ({
      id: p.id,
      anchor_record_id: p.anchorRecordId,
      canonical_name: p.canonicalName,
      dob: p.dob,
      gender: p.gender,
      uid_last4: p.uidLast4,
      marital_status: p.maritalStatus,
      is_deceased: p.isDeceased,
      deceased_on: p.deceasedOn,
    })),
    match_candidates: result.candidates.filter(isPersistedCandidate).map((c) => ({
      pair_key: c.pairKey,
      record_a_id: c.recordAId,
      record_b_id: c.recordBId,
      score: c.score,
      score_breakdown: c.breakdown,
      decision: c.decision,
      review_status: c.reviewStatus,
    })),
    families: result.families.map((f) => ({
      id: f.id,
      head_person_id: f.headPersonId,
      district: f.district,
      taluka: f.taluka,
      village: f.village,
      resolved_income: f.resolvedIncome,
      income_sources: f.incomeSources,
      is_anchored: f.isAnchored,
      status: f.status,
      merged_into: f.mergedInto,
      parent_family_id: f.parentFamilyId,
    })),
    family_members: result.familyMembers.map((m) => ({
      family_id: m.familyId,
      person_id: m.personId,
      relation_to_head: m.relationToHead,
      valid_from: m.validFrom,
      valid_to: m.validTo,
    })),
    enrollments: result.enrollments.map((e) => ({
      person_id: e.personId,
      family_id: e.familyId,
      scheme_code: e.schemeCode,
      source_record_id: e.sourceRecordId,
      basis: e.basis,
      monthly_amount: e.monthlyAmount,
    })),
    eligibility_results: result.eligibility.map((r) => ({
      family_id: r.familyId,
      person_id: r.personId,
      scheme_code: r.schemeCode,
      eligible: r.eligible,
      reasons: r.reasons,
      rules_version: r.rulesVersion,
    })),
    anomaly_flags: result.flags.map((f) => ({
      id: f.id,
      type: f.type,
      severity: f.severity,
      family_id: f.familyId,
      person_id: f.personId,
      evidence: f.evidence,
      est_monthly_leakage: f.estMonthlyLeakage,
      status: f.status,
    })),
  };
}

/** Tables have no foreign keys between them, so wipes and batches can all run concurrently. */
export async function replaceDerived(result: EngineResult): Promise<void> {
  const client = db();
  await Promise.all(
    DERIVED_TABLES.map(async ([table, key, everything]) => {
      const query = client.from(table).delete();
      const { error } = await (typeof everything === "number" ? query.gt(key, everything) : query.neq(key, everything));
      if (error) throw new Error(`Clearing ${table} failed: ${error.message}`);
    }),
  );

  const rows = toRows(result);
  const inserts: Promise<void>[] = [];
  for (const [table] of DERIVED_TABLES) {
    const tableRows = rows[table];
    for (let i = 0; i < tableRows.length; i += BATCH_SIZE) {
      inserts.push(
        (async () => {
          const { error } = await client.from(table).insert(tableRows.slice(i, i + BATCH_SIZE));
          if (error) throw new Error(`Inserting into ${table} failed at row ${i}: ${error.message}`);
        })(),
      );
    }
  }
  await Promise.all(inserts);
}

export interface RunRecord {
  startedAt: string;
  finishedAt: string;
  rulesVersion: string;
  stats: EngineResult["stats"];
}

/** Append a pipeline_runs row and the matching audit entry. Returns the run id. */
export async function recordRun(run: RunRecord, actor: string): Promise<number> {
  const client = db();
  const { data, error } = await client
    .from("pipeline_runs")
    .insert({
      started_at: run.startedAt, finished_at: run.finishedAt,
      rules_version: run.rulesVersion, stats: run.stats,
    })
    .select("id")
    .single<{ id: number }>();
  if (error) throw new Error(`Recording pipeline run failed: ${error.message}`);

  const { error: auditError } = await client.from("audit_log").insert({
    actor,
    action: "pipeline_run",
    entity_type: "pipeline_run",
    entity_id: String(data.id),
    before: null,
    after: run.stats,
    reason: null,
  });
  if (auditError) throw new Error(`Writing audit entry failed: ${auditError.message}`);
  return data.id;
}
