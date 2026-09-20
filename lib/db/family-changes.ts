// Saving an officer's family change: the input rows, and the audit entry. The engine applies them
// on the next pipeline run; nothing here edits a derived table.
import { manualFamilyId } from "../engine/family-changes";
import {
  familyRefOf, type AddMemberCommand, type FamilyContext, type MoveCommand,
} from "../family-changes";
import { db } from "./client";
import { getFamilySummary } from "./queries";

/** An error with the HTTP status a route handler should answer with. */
export class ChangeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const UNIQUE_VIOLATION = "23505";
const DOCUMENT_REUSED = "That document reference has already been used for another change";

export async function loadFamilyContext(id: string): Promise<FamilyContext | null> {
  if (id === "") return null;
  const summary = await getFamilySummary(id);
  if (!summary) return null;
  return {
    id: summary.family.id,
    status: summary.family.status,
    district: summary.family.district,
    taluka: summary.family.taluka,
    village: summary.family.village,
    headPersonId: summary.family.head_person_id,
    members: summary.members.map(({ person }) => ({
      personId: person.id, anchorRecordId: person.anchor_record_id, isDeceased: person.is_deceased, dob: person.dob,
    })),
  };
}

async function audit(actor: string, entityId: string, before: unknown, after: unknown, reason: string): Promise<void> {
  const { error } = await db().from("audit_log").insert({
    actor, action: "family_change", entity_type: "family", entity_id: entityId,
    before: before ?? null, after: after ?? null, reason,
  });
  if (error) throw new Error(`Writing audit entry failed: ${error.message}`);
}

async function assertDocumentUnused(documentRef: string): Promise<void> {
  // The unique index is the real guard; this gives a clear message before anything is written.
  // Document references cannot contain % or _, so ilike is an exact, case-insensitive match here.
  const { data, error } = await db().from("family_events").select("id").ilike("document_ref", documentRef).limit(1);
  if (error) throw new Error(`Checking the document reference failed: ${error.message}`);
  if (data.length > 0) throw new ChangeError(DOCUMENT_REUSED, 409);
}

async function nextUserRecordNumber(): Promise<number> {
  const { data, error } = await db()
    .from("source_records").select("id").eq("source", "officer_entry").order("id", { ascending: false }).limit(1)
    .returns<{ id: string }[]>();
  if (error) throw new Error(`Reading officer records failed: ${error.message}`);
  return data.length === 0 ? 1 : Number(data[0].id.replace("USR-", "")) + 1;
}

export async function addMember(
  cmd: AddMemberCommand, family: FamilyContext, effectiveDate: string, actor: string,
): Promise<{ eventId: number; recordId: string }> {
  const ref = familyRefOf(family);
  if (ref === null) throw new ChangeError("This family has no member to attach the new person to", 400);
  await assertDocumentUnused(cmd.documentRef);
  const client = db();

  // A new member is a new, append-only source record. Retry once if another officer took the number.
  let recordId = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    recordId = `USR-${String((await nextUserRecordNumber()) + attempt).padStart(6, "0")}`;
    const { error } = await client.from("source_records").insert({
      id: recordId, source: "officer_entry", source_ref: recordId, household_ref: null,
      full_name: cmd.person.fullName, guardian_name: null, dob: cmd.person.dob, gender: cmd.person.gender,
      relation_to_head: cmd.person.relation, marital_status: cmd.person.marital,
      uid_hash: null, uid_last4: null,
      district: family.district, taluka: family.taluka, village: family.village,
      address: `${family.village}, ${family.taluka}`,
      income_declared: null, scheme_code: null, benefit_amount: null, is_student: cmd.person.isStudent,
      date_of_death: null, true_person_id: `MANUAL-${recordId}`,
    });
    if (!error) break;
    if (error.code !== UNIQUE_VIOLATION || attempt === 1) throw new Error(`Saving the new member failed: ${error.message}`);
  }

  const event = await client.from("family_events").insert({
    type: "member_add", subject_record_id: recordId,
    payload: { to: ref, relation: cmd.person.relation, effectiveDate, reason: cmd.reason, documentRef: cmd.documentRef, note: cmd.note },
    source: "officer", recorded_by: actor, document_ref: cmd.documentRef, reason: cmd.reason,
  }).select("id").single<{ id: number }>();
  if (event.error) {
    await client.from("source_records").delete().eq("id", recordId); // do not leave an orphan record behind
    if (event.error.code === UNIQUE_VIOLATION) throw new ChangeError(DOCUMENT_REUSED, 409);
    throw new Error(`Saving the change failed: ${event.error.message}`);
  }

  await audit(actor, family.id, null, {
    type: "member_add", eventId: event.data.id, recordId, relation: cmd.person.relation,
    reason: cmd.reason, documentRef: cmd.documentRef,
  }, cmd.note ?? cmd.reason);
  return { eventId: event.data.id, recordId };
}

export async function moveMembers(
  cmd: MoveCommand, source: FamilyContext, actor: string,
): Promise<{ eventId: number; familyId: string }> {
  await assertDocumentUnused(cmd.documentRef);
  const members = cmd.movers.map((m) => ({ recordId: m.anchorRecordId, relation: m.relation }));

  let to: Record<string, unknown>;
  if (cmd.destination.kind === "new") {
    const head = cmd.movers.find((m) => m.personId === (cmd.destination.kind === "new" ? cmd.destination.headPersonId : ""));
    if (!head) throw new ChangeError("Choose the head of the new family from the people moving", 400);
    to = {
      kind: "new", headRecordId: head.anchorRecordId, district: cmd.destination.district,
      taluka: cmd.destination.taluka, village: cmd.destination.village, income: cmd.destination.income,
    };
  } else {
    const ref = familyRefOf(cmd.destination.family);
    if (ref === null) throw new ChangeError("The family you are moving them into has no members", 400);
    to = { kind: "existing", family: ref };
  }

  const rows: Record<string, unknown>[] = [
    {
      type: "family_move", subject_record_id: cmd.movers[0].anchorRecordId,
      payload: { effectiveDate: cmd.effectiveDate, members, to, reason: cmd.reason, documentRef: cmd.documentRef, note: cmd.note },
      source: "officer", recorded_by: actor, document_ref: cmd.documentRef, reason: cmd.reason,
    },
  ];
  if (cmd.markMarried) {
    rows.push({
      type: "marital_status_change", subject_record_id: cmd.movers[0].anchorRecordId,
      payload: { marital_status: "married" }, source: "officer", recorded_by: actor,
    });
  }

  // One statement, so the move and the recorded marriage are saved together or not at all.
  const saved = await db().from("family_events").insert(rows).select("id,type").returns<{ id: number; type: string }[]>();
  if (saved.error) {
    if (saved.error.code === UNIQUE_VIOLATION) throw new ChangeError(DOCUMENT_REUSED, 409);
    throw new Error(`Saving the change failed: ${saved.error.message}`);
  }
  const eventId = saved.data.find((e) => e.type === "family_move")?.id;
  if (eventId === undefined) throw new Error("Saving the change failed");

  const familyId = cmd.destination.kind === "new" ? manualFamilyId(eventId) : cmd.destination.family.id;
  await audit(actor, source.id, { members: source.members.map((m) => m.personId) }, {
    type: "family_move", eventId, movedTo: familyId, moved: cmd.movers.map((m) => m.personId),
    reason: cmd.reason, documentRef: cmd.documentRef, effectiveDate: cmd.effectiveDate,
  }, cmd.note ?? cmd.reason);
  return { eventId, familyId };
}
