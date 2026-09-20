import { normalizeRecord } from "../normalize";
import type { Gender, NormalizedRecord, Relation, SourceRecord } from "../types";

export const AS_OF = "2026-09-20";

type Overrides = Partial<SourceRecord> & Pick<SourceRecord, "id" | "full_name">;

/** A source record with sensible defaults; override only what a test cares about. */
export function rec(o: Overrides): SourceRecord {
  return {
    source: "ration",
    source_ref: o.id,
    household_ref: null,
    guardian_name: null,
    dob: null,
    gender: null,
    relation_to_head: null,
    marital_status: null,
    uid_hash: null,
    uid_last4: null,
    district: "Mehsana",
    taluka: "Kadi",
    village: "Kansa",
    address: "21, Shivnagar, Kansa",
    income_declared: null,
    scheme_code: null,
    benefit_amount: null,
    is_student: null,
    date_of_death: null,
    ...o,
  };
}

export const norm = (o: Overrides): NormalizedRecord => normalizeRecord(rec(o), AS_OF);

export interface PersonSpec {
  readonly name: string;
  readonly dob: string;
  readonly gender: Gender;
  readonly relation: Relation;
}

/** A family that appears on ration cards in several tests. Names never match one another. */
export const PEOPLE: readonly PersonSpec[] = [
  { name: "Ramesh Kantilal Patel", dob: "14/03/1959", gender: "M", relation: "head" },
  { name: "Savita Ramesh Patel", dob: "02/08/1962", gender: "F", relation: "spouse" },
  { name: "Jayesh Ramesh Patel", dob: "05/11/1984", gender: "M", relation: "son" },
  { name: "Hetal Jayesh Patel", dob: "17/02/1988", gender: "F", relation: "daughter_in_law" },
];

/** Ration records for one card. `prefix` keeps record ids unique across cards. */
export function card(
  ref: string, prefix: string, people: readonly PersonSpec[] = PEOPLE,
): SourceRecord[] {
  return people.map((p, i) =>
    rec({
      id: `RAT-${prefix}${i + 1}`,
      household_ref: ref,
      full_name: p.name,
      dob: p.dob,
      gender: p.gender,
      relation_to_head: p.relation,
    }),
  );
}
