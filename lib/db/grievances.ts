// Grievances: a citizen asks why a scheme is not reaching them, an officer answers. Both actions
// are audited. The eligibility snapshot is built here, on the server, so a client cannot forge it.
import { benefitStatus, isReceiving } from "../benefit-status";
import {
  validateAnswer, validateGrievanceInput, type EligibilitySnapshot, type GrievanceInput, type GrievanceRow,
} from "../grievances";
import { schemesConfig } from "../schemes";
import { db } from "./client";
import type { EligibilityRow, EnrollmentRow, FamilyRow } from "./queries";

/** An error with the HTTP status a route handler should answer with. */
export class GrievanceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function audit(
  actor: string, action: string, entityId: string, before: unknown, after: unknown,
): Promise<void> {
  const { error } = await db().from("audit_log").insert({
    actor, action, entity_type: "grievance", entity_id: entityId,
    before: before ?? null, after: after ?? null, reason: null,
  });
  if (error) throw new Error(`Writing audit entry failed: ${error.message}`);
}

export interface FiledGrievance {
  grievance: GrievanceRow;
  /** True when the family already had an open question about this scheme, which is returned instead */
  existing: boolean;
}

export async function fileGrievance(raw: Record<string, unknown>): Promise<FiledGrievance> {
  const parsed = validateGrievanceInput(raw, schemesConfig);
  if (!parsed.ok) throw new GrievanceError(parsed.error, 400);
  const input: GrievanceInput = parsed.value;
  const client = db();

  const family = await client.from("families").select("id,status").eq("id", input.familyId).maybeSingle<Pick<FamilyRow, "id" | "status">>();
  if (family.error) throw new Error(family.error.message);
  if (!family.data) throw new GrievanceError("Family not found", 404);
  if (family.data.status !== "active") throw new GrievanceError("This Family ID was merged into another one", 400);

  if (input.personId) {
    const member = await client
      .from("family_members").select("person_id").eq("family_id", input.familyId).eq("person_id", input.personId).maybeSingle();
    if (member.error) throw new Error(member.error.message);
    if (!member.data) throw new GrievanceError("That person is not in this family", 400);
  }

  let open = client.from("grievances").select("*").eq("family_id", input.familyId)
    .eq("scheme_code", input.schemeCode).eq("status", "pending");
  open = input.personId ? open.eq("person_id", input.personId) : open.is("person_id", null);
  const duplicate = await open.limit(1).returns<GrievanceRow[]>();
  if (duplicate.error) throw new Error(duplicate.error.message);
  if (duplicate.data.length > 0) return { grievance: duplicate.data[0], existing: true };

  // What the system currently says about this scheme for this person or family.
  let resultQuery = client.from("eligibility_results").select("*").eq("family_id", input.familyId).eq("scheme_code", input.schemeCode);
  resultQuery = input.personId ? resultQuery.eq("person_id", input.personId) : resultQuery.is("person_id", null);
  const [result, enrollments] = await Promise.all([
    resultQuery.maybeSingle<EligibilityRow>(),
    client.from("enrollments").select("*").eq("family_id", input.familyId).returns<EnrollmentRow[]>(),
  ]);
  if (result.error) throw new Error(result.error.message);
  if (enrollments.error) throw new Error(enrollments.error.message);
  if (!result.data) throw new GrievanceError("No eligibility result for that scheme; run resolution first", 400);

  const scheme = schemesConfig.schemes.find((s) => s.code === input.schemeCode);
  const status = benefitStatus(
    { schemeCode: input.schemeCode, personId: input.personId, eligible: result.data.eligible },
    enrollments.data.map((e) => ({ personId: e.person_id, schemeCode: e.scheme_code, basis: e.basis })),
    scheme,
  );
  if (isReceiving(status)) throw new GrievanceError("This scheme is already reaching you", 409);

  const snapshot: EligibilitySnapshot = {
    status, eligible: result.data.eligible, rulesVersion: result.data.rules_version, reasons: result.data.reasons,
  };
  const inserted = await client.from("grievances").insert({
    family_id: input.familyId, person_id: input.personId, scheme_code: input.schemeCode,
    message: input.message, eligibility_snapshot: snapshot, status: "pending",
  }).select("*").single<GrievanceRow>();
  if (inserted.error) throw new Error(inserted.error.message);

  await audit(`citizen:${input.familyId}`, "grievance_filed", String(inserted.data.id), null, {
    schemeCode: input.schemeCode, personId: input.personId, status,
  });
  return { grievance: inserted.data, existing: false };
}

export async function answerGrievance(id: number, rawAnswer: unknown, officer = "officer:demo"): Promise<GrievanceRow> {
  if (!Number.isInteger(id) || id < 1) throw new GrievanceError("Invalid grievance id", 400);
  const parsed = validateAnswer(rawAnswer);
  if (!parsed.ok) throw new GrievanceError(parsed.error, 400);

  const client = db();
  const current = await client.from("grievances").select("*").eq("id", id).maybeSingle<GrievanceRow>();
  if (current.error) throw new Error(current.error.message);
  if (!current.data) throw new GrievanceError("Grievance not found", 404);
  if (current.data.status === "resolved") throw new GrievanceError("This grievance has already been answered", 409);

  const updated = await client.from("grievances").update({
    status: "resolved", officer_response: parsed.value, answered_by: officer, resolved_at: new Date().toISOString(),
  }).eq("id", id).eq("status", "pending").select("*").maybeSingle<GrievanceRow>();
  if (updated.error) throw new Error(updated.error.message);
  if (!updated.data) throw new GrievanceError("This grievance has already been answered", 409);

  await audit(officer, "grievance_answered", String(id), { status: "pending" }, {
    status: "resolved", answerLength: parsed.value.length,
  });
  return updated.data;
}

export async function listGrievances(status: "pending" | "resolved" | null): Promise<GrievanceRow[]> {
  let query = db().from("grievances").select("*");
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("created_at", { ascending: false }).returns<GrievanceRow[]>();
  if (error) throw new Error(`Reading grievances failed: ${error.message}`);
  return data;
}

export async function grievancesForFamily(familyId: string): Promise<GrievanceRow[]> {
  const { data, error } = await db().from("grievances").select("*").eq("family_id", familyId)
    .order("created_at", { ascending: false }).returns<GrievanceRow[]>();
  if (error) throw new Error(`Reading grievances failed: ${error.message}`);
  return data;
}
