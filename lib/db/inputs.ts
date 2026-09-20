// Read the input tables: source records, review decisions (and, from P8, family events).
import type { ReviewDecision, SourceRecord } from "../engine/types";
import { fetchAll } from "./client";

interface SourceRecordRow extends SourceRecord {
  true_person_id: string;
}

interface ReviewDecisionRow {
  pair_key: string;
  decision: "approved" | "rejected";
}

export interface PipelineInputs {
  records: SourceRecord[];
  /** Ground truth, used only to score the result. The engine never decides with it. */
  truth: Map<string, string>;
  decisions: ReviewDecision[];
}

export async function loadInputs(): Promise<PipelineInputs> {
  const [rows, decisionRows] = await Promise.all([
    fetchAll<SourceRecordRow>("source_records", "id"),
    fetchAll<ReviewDecisionRow>("review_decisions", "pair_key"),
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
  };
}
