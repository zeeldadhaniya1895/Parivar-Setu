// Read-side queries for pages. Server-only: pages are server components that call these directly.
// The ground-truth column (`true_person_id`) is deliberately never selected here.
import type { RunStats } from "../engine/evaluate";
import type {
  AnomalyType, JsonValue, MatchDecision, Reason, ReviewStatus, ScoreBreakdown, Severity, SourceRecord,
} from "../engine/types";
import { db, fetchAll } from "./client";

const SOURCE_COLUMNS =
  "id,source,source_ref,household_ref,full_name,guardian_name,dob,gender,relation_to_head,marital_status," +
  "uid_hash,uid_last4,district,taluka,village,address,income_declared,scheme_code,benefit_amount," +
  "is_student,date_of_death";

export interface RunRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  rules_version: string | null;
  stats: RunStats | null;
}

export interface FamilyRow {
  id: string;
  head_person_id: string | null;
  district: string;
  taluka: string;
  village: string;
  resolved_income: number | null;
  income_sources: { recordId: string; source: string; value: number }[];
  is_anchored: boolean;
  status: "active" | "merged";
  merged_into: string | null;
  parent_family_id: string | null;
}

export interface PersonRow {
  id: string;
  anchor_record_id: string;
  canonical_name: string;
  dob: string | null;
  gender: "M" | "F" | null;
  uid_last4: string | null;
  marital_status: "married" | "unmarried" | "widowed" | null;
  is_deceased: boolean;
  deceased_on: string | null;
}

export interface MemberRow {
  family_id: string;
  person_id: string;
  relation_to_head: string | null;
}

export interface EligibilityRow {
  family_id: string;
  person_id: string | null;
  scheme_code: string;
  eligible: boolean;
  reasons: Reason[];
  rules_version: string;
}

export interface EnrollmentRow {
  person_id: string;
  family_id: string;
  scheme_code: string;
  source_record_id: string;
  monthly_amount: number | null;
}

export interface FlagRow {
  id: string;
  type: AnomalyType;
  severity: Severity;
  family_id: string | null;
  person_id: string | null;
  evidence: Record<string, JsonValue>;
  est_monthly_leakage: number | null;
  status: string;
}

export interface CandidateRow {
  pair_key: string;
  record_a_id: string;
  record_b_id: string;
  score: number;
  score_breakdown: ScoreBreakdown;
  decision: MatchDecision;
  review_status: ReviewStatus | null;
}

// ---- helpers -----------------------------------------------------------------------------

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];

/** Values that would break out of a PostgREST filter expression are removed. */
const safeSearch = (q: string) => q.replace(/[%,()*\\]/g, " ").trim();

async function rowsIn<Row>(
  table: string, column: string, values: readonly string[], columns = "*",
): Promise<Row[]> {
  if (values.length === 0) return [];
  const out: Row[] = [];
  // Keep request URLs short by chunking long id lists.
  for (let i = 0; i < values.length; i += 150) {
    const { data, error } = await db()
      .from(table)
      .select(columns)
      .in(column, values.slice(i, i + 150))
      .returns<Row[]>();
    if (error) throw new Error(`Reading ${table} failed: ${error.message}`);
    out.push(...data);
  }
  return out;
}

// ---- dashboard ---------------------------------------------------------------------------

export async function latestRun(): Promise<RunRow | null> {
  const { data, error } = await db()
    .from("pipeline_runs")
    .select("*")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle<RunRow>();
  if (error) throw new Error(`Reading pipeline_runs failed: ${error.message}`);
  return data;
}

// ---- families ----------------------------------------------------------------------------

export interface FamilyListItem extends FamilyRow {
  headName: string | null;
  memberCount: number;
  flagCount: number;
}

export const FAMILY_PAGE_SIZE = 25;

export async function listFamilies(
  query: string, page: number,
): Promise<{ rows: FamilyListItem[]; total: number }> {
  const q = safeSearch(query);
  let request = db().from("families").select("*", { count: "exact" }).eq("status", "active");

  if (q !== "") {
    // Match a family by its ID or place, or by the name of any member.
    const people = await db()
      .from("persons")
      .select("id")
      .ilike("canonical_name", `%${q}%`)
      .limit(200)
      .returns<{ id: string }[]>();
    if (people.error) throw new Error(`Searching persons failed: ${people.error.message}`);
    const members = await rowsIn<{ family_id: string }>(
      "family_members", "person_id", people.data.map((p) => p.id), "family_id",
    );
    const familyIds = unique(members.map((m) => m.family_id));
    const filters = [`id.ilike.%${q}%`, `village.ilike.%${q}%`, `taluka.ilike.%${q}%`, `district.ilike.%${q}%`];
    if (familyIds.length > 0) filters.push(`id.in.(${familyIds.join(",")})`);
    request = request.or(filters.join(","));
  }

  const from = Math.max(0, page - 1) * FAMILY_PAGE_SIZE;
  const { data, count, error } = await request
    .order("id")
    .range(from, from + FAMILY_PAGE_SIZE - 1)
    .returns<FamilyRow[]>();
  if (error) throw new Error(`Reading families failed: ${error.message}`);

  const ids = data.map((f) => f.id);
  const headIds = data.map((f) => f.head_person_id).filter((id): id is string => id !== null);
  const [heads, members, flags] = await Promise.all([
    rowsIn<PersonRow>("persons", "id", headIds, "id,canonical_name"),
    rowsIn<MemberRow>("family_members", "family_id", ids, "family_id,person_id"),
    rowsIn<FlagRow>("anomaly_flags", "family_id", ids, "id,family_id"),
  ]);
  const headName = new Map(heads.map((p) => [p.id, p.canonical_name]));
  const countBy = (rows: { family_id: string | null }[]) => {
    const map = new Map<string, number>();
    for (const r of rows) if (r.family_id) map.set(r.family_id, (map.get(r.family_id) ?? 0) + 1);
    return map;
  };
  const memberCounts = countBy(members);
  const flagCounts = countBy(flags);

  return {
    total: count ?? data.length,
    rows: data.map((f) => ({
      ...f,
      headName: f.head_person_id ? (headName.get(f.head_person_id) ?? null) : null,
      memberCount: memberCounts.get(f.id) ?? 0,
      flagCount: flagCounts.get(f.id) ?? 0,
    })),
  };
}

export interface PersonLineage {
  /** Source records that were resolved into this person */
  records: SourceRecord[];
  /** Pairs among those records that were merged, with the score breakdown that justified it */
  mergedPairs: CandidateRow[];
  /** Pairs involving these records that were kept apart or sent to review */
  otherPairs: CandidateRow[];
  /** Every record mentioned above, including the far side of each pair, by id */
  lookup: Record<string, SourceRecord>;
}

export interface MemberDetail {
  member: MemberRow;
  person: PersonRow;
  lineage: PersonLineage;
}

export interface FamilyDetail {
  family: FamilyRow;
  headName: string | null;
  mergedInto: FamilyRow | null;
  mergedFrom: FamilyRow[];
  members: MemberDetail[];
  enrollments: EnrollmentRow[];
  eligibility: EligibilityRow[];
  flags: FlagRow[];
}

const isMatched = (c: CandidateRow) => c.decision === "auto_merge" || c.review_status === "approved";

/**
 * A person's source records are the connected component, over merged pairs, that contains their
 * anchor record. Merged pairs are always persisted (see persist.ts), so no extra table is needed.
 */
async function buildLineage(persons: readonly PersonRow[]): Promise<Map<string, PersonLineage>> {
  const merged = await db()
    .from("match_candidates")
    .select("*")
    .or("decision.eq.auto_merge,review_status.eq.approved")
    .returns<CandidateRow[]>();
  if (merged.error) throw new Error(`Reading match_candidates failed: ${merged.error.message}`);
  const neighbours = new Map<string, string[]>();
  for (const c of merged.data.filter(isMatched)) {
    neighbours.set(c.record_a_id, [...(neighbours.get(c.record_a_id) ?? []), c.record_b_id]);
    neighbours.set(c.record_b_id, [...(neighbours.get(c.record_b_id) ?? []), c.record_a_id]);
  }

  const idsByPerson = new Map<string, Set<string>>();
  for (const p of persons) {
    const seen = new Set([p.anchor_record_id]);
    const queue = [p.anchor_record_id];
    while (queue.length > 0) {
      const next = queue.pop();
      for (const n of neighbours.get(next ?? "") ?? []) {
        if (!seen.has(n)) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    idsByPerson.set(p.id, seen);
  }

  const allIds = unique([...idsByPerson.values()].flatMap((s) => [...s]));
  const [records, aSide, bSide] = await Promise.all([
    rowsIn<SourceRecord>("source_records", "id", allIds, SOURCE_COLUMNS),
    rowsIn<CandidateRow>("match_candidates", "record_a_id", allIds),
    rowsIn<CandidateRow>("match_candidates", "record_b_id", allIds),
  ]);
  const recordById = new Map(records.map((r) => [r.id, r]));
  const pairs = new Map([...aSide, ...bSide].map((c) => [c.pair_key, c]));
  const farSide = unique([...pairs.values()].flatMap((c) => [c.record_a_id, c.record_b_id])).filter(
    (id) => !recordById.has(id),
  );
  for (const r of await rowsIn<SourceRecord>("source_records", "id", farSide, SOURCE_COLUMNS)) {
    recordById.set(r.id, r);
  }

  const result = new Map<string, PersonLineage>();
  for (const p of persons) {
    const ids = idsByPerson.get(p.id) ?? new Set<string>();
    const touching = [...pairs.values()].filter((c) => ids.has(c.record_a_id) || ids.has(c.record_b_id));
    result.set(p.id, {
      records: [...ids].sort().flatMap((id) => recordById.get(id) ?? []),
      mergedPairs: touching.filter((c) => isMatched(c) && ids.has(c.record_a_id) && ids.has(c.record_b_id)),
      otherPairs: touching.filter((c) => !isMatched(c)),
      lookup: Object.fromEntries(recordById),
    });
  }
  return result;
}

export async function getFamilyDetail(id: string): Promise<FamilyDetail | null> {
  const { data: family, error } = await db()
    .from("families").select("*").eq("id", id).maybeSingle<FamilyRow>();
  if (error) throw new Error(`Reading family failed: ${error.message}`);
  if (!family) return null;

  const [members, enrollments, eligibility, flags, mergedFromResult, mergedIntoResult] = await Promise.all([
    rowsIn<MemberRow>("family_members", "family_id", [id]),
    rowsIn<EnrollmentRow>("enrollments", "family_id", [id]),
    rowsIn<EligibilityRow>("eligibility_results", "family_id", [id]),
    rowsIn<FlagRow>("anomaly_flags", "family_id", [id]),
    db().from("families").select("*").eq("merged_into", id).returns<FamilyRow[]>(),
    family.merged_into
      ? db().from("families").select("*").eq("id", family.merged_into).maybeSingle<FamilyRow>()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const persons = await rowsIn<PersonRow>("persons", "id", members.map((m) => m.person_id));
  const personById = new Map(persons.map((p) => [p.id, p]));
  const lineage = await buildLineage(persons);

  const relationOrder = ["head", "spouse", "mother", "father", "son", "daughter", "daughter_in_law",
    "son_in_law", "grandson", "granddaughter", "other"];
  const details: MemberDetail[] = members
    .flatMap((m) => {
      const person = personById.get(m.person_id);
      const memberLineage = lineage.get(m.person_id);
      return person && memberLineage ? [{ member: m, person, lineage: memberLineage }] : [];
    })
    .sort(
      (a, b) =>
        relationOrder.indexOf(a.member.relation_to_head ?? "other") -
          relationOrder.indexOf(b.member.relation_to_head ?? "other") ||
        a.person.id.localeCompare(b.person.id),
    );

  return {
    family,
    headName: family.head_person_id ? (personById.get(family.head_person_id)?.canonical_name ?? null) : null,
    mergedInto: mergedIntoResult.data ?? null,
    mergedFrom: mergedFromResult.data ?? [],
    members: details,
    enrollments,
    eligibility,
    flags,
  };
}

// ---- flags and review --------------------------------------------------------------------

export interface FlagListItem extends FlagRow {
  personName: string | null;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export async function listFlags(type: string | null): Promise<FlagListItem[]> {
  let request = db().from("anomaly_flags").select("*");
  if (type) request = request.eq("type", type);
  const { data, error } = await request.order("id").returns<FlagRow[]>();
  if (error) throw new Error(`Reading anomaly_flags failed: ${error.message}`);

  const persons = await rowsIn<PersonRow>(
    "persons", "id", unique(data.map((f) => f.person_id).filter((p): p is string => p !== null)), "id,canonical_name",
  );
  const names = new Map(persons.map((p) => [p.id, p.canonical_name]));
  return data
    .map((f) => ({ ...f, personName: f.person_id ? (names.get(f.person_id) ?? null) : null }))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.id.localeCompare(b.id));
}

export async function flagCountsByType(): Promise<Record<string, number>> {
  const rows = await fetchAll<{ type: string }>("anomaly_flags", "id", "id,type");
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.type] = (counts[r.type] ?? 0) + 1;
  return counts;
}

export interface PendingReview {
  candidate: CandidateRow;
  a: SourceRecord | null;
  b: SourceRecord | null;
}

export async function pendingReviews(): Promise<PendingReview[]> {
  const { data, error } = await db()
    .from("match_candidates")
    .select("*")
    .eq("review_status", "pending")
    .order("score", { ascending: false })
    .order("pair_key")
    .returns<CandidateRow[]>();
  if (error) throw new Error(`Reading match_candidates failed: ${error.message}`);
  const records = await rowsIn<SourceRecord>(
    "source_records", "id", unique(data.flatMap((c) => [c.record_a_id, c.record_b_id])), SOURCE_COLUMNS,
  );
  const byId = new Map(records.map((r) => [r.id, r]));
  return data.map((candidate) => ({
    candidate,
    a: byId.get(candidate.record_a_id) ?? null,
    b: byId.get(candidate.record_b_id) ?? null,
  }));
}
