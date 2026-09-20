// Read the input tables: source records, review decisions (and, from P8, family events).
import type { FamilyEvent, Marital, ReviewDecision, SourceRecord } from "../engine/types";
import { fetchAll } from "./client";

interface SourceRecordRow extends SourceRecord {
  true_person_id: string;
}

interface ReviewDecisionRow {
  pair_key: string;
  decision: "approved" | "rejected";
}

interface FamilyEventRow {
  type: "death" | "marital_status_change";
  subject_record_id: string;
  payload: {
    date_of_death?: string | null;
    marital_status?: string | null;
  };
}

export interface PipelineInputs {
  records: SourceRecord[];
  /** Ground truth, used only to score the result. The engine never decides with it. */
  truth: Map<string, string>;
  decisions: ReviewDecision[];
  events: FamilyEvent[];
}

export async function loadInputs(): Promise<PipelineInputs> {
  const [rows, decisionRows, eventRows] = await Promise.all([
    fetchAll<SourceRecordRow>("source_records", "id"),
    fetchAll<ReviewDecisionRow>("review_decisions", "pair_key"),
    fetchAll<FamilyEventRow>("family_events", "subject_record_id"),
  ]);
  const truth = new Map<string, string>();
  const records = rows.map(({ true_person_id, ...record }) => {
    truth.set(record.id, true_person_id);
    return record;
  });
  return {
    records,
    truth,
    decisions: decisionRows.map((d) => ({ pairKey: d.pair_key, decision: d.decision })),
    events: eventRows.map((e) => ({
      type: e.type,
      subjectRecordId: e.subject_record_id,
      date: e.payload?.date_of_death || null,
      newMaritalStatus: (e.payload?.marital_status as Marital) || null,
    })),
  };
}
