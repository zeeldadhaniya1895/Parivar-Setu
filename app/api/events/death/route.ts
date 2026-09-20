import { runPipeline } from "@/lib/pipeline";
import { db } from "@/lib/db/client";
import { getFamilyDetail } from "@/lib/db/queries";

interface RequestBody {
  familyId?: string;
  anchorRecordId?: string;
  dateOfDeath?: string;
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { familyId, anchorRecordId, dateOfDeath } = body;
  if (!familyId || typeof familyId !== "string") {
    return Response.json({ error: "familyId is required" }, { status: 400 });
  }
  if (!anchorRecordId || typeof anchorRecordId !== "string") {
    return Response.json({ error: "anchorRecordId is required" }, { status: 400 });
  }

  // 1. Verify family and person
  const detail = await getFamilyDetail(familyId);
  if (!detail) {
    return Response.json({ error: "Family not found" }, { status: 404 });
  }

  const deceasedMember = detail.members.find((m) => m.person.anchor_record_id === anchorRecordId);
  if (!deceasedMember) {
    return Response.json({ error: "Person not found in family" }, { status: 404 });
  }

  if (deceasedMember.person.is_deceased) {
    return Response.json({ error: "Person is already deceased" }, { status: 400 });
  }

  // 2. Find if they have a spouse (to mark them widowed)
  // If deceased is "head", spouse is "spouse". If deceased is "spouse", spouse is "head".
  let spouseMember = null;
  if (deceasedMember.member.relation_to_head === "head") {
    spouseMember = detail.members.find((m) => m.member.relation_to_head === "spouse");
  } else if (deceasedMember.member.relation_to_head === "spouse") {
    spouseMember = detail.members.find((m) => m.member.relation_to_head === "head");
  } else {
    // Try to find spouse by name matching (e.g. son and daughter_in_law)
    const parts = deceasedMember.person.canonical_name.split(" ");
    if (deceasedMember.person.gender === "M" && parts.length >= 2) {
      const firstName = parts[0];
      spouseMember = detail.members.find(
        (m) => m.person.gender === "F" && m.person.canonical_name.split(" ")[1] === firstName
      ) || null;
    } else if (deceasedMember.person.gender === "F" && parts.length >= 2) {
      const middleName = parts[1];
      spouseMember = detail.members.find(
        (m) => m.person.gender === "M" && m.person.canonical_name.split(" ")[0] === middleName
      ) || null;
    }
  }

  // 3. Insert events
  try {
    const eventsToInsert = [];
    eventsToInsert.push({
      type: "death",
      subject_record_id: anchorRecordId,
      payload: { date_of_death: dateOfDeath || null },
      source: "officer",
      recorded_by: "Officer",
    });

    if (spouseMember) {
      eventsToInsert.push({
        type: "marital_status_change",
        subject_record_id: spouseMember.person.anchor_record_id,
        payload: { marital_status: "widowed" },
        source: "officer",
        recorded_by: "Officer",
      });
    }

    const { error: eventError } = await db().from("family_events").insert(eventsToInsert);
    if (eventError) throw new Error(eventError.message);

    const evidence = {
      dateOfDeath: dateOfDeath || null,
      spouseUpdated: spouseMember ? spouseMember.person.anchor_record_id : null,
    };
    
    const { error: auditError } = await db().from("audit_log").insert({
      actor: "officer:demo",
      action: "event:death",
      entity_type: "person",
      entity_id: deceasedMember.person.id,
      after: evidence,
    });
    if (auditError) throw new Error(auditError.message);

  } catch (error) {
    console.error("Failed to insert death event:", error);
    return Response.json({ error: "Failed to record death" }, { status: 500 });
  }

  // 4. Rerun pipeline
  try {
    const stats = await runPipeline("Officer");
    return Response.json({ success: true, stats });
  } catch (error) {
    console.error("Failed to run pipeline:", error);
    return Response.json({ error: "Death recorded, but pipeline failed" }, { status: 500 });
  }
}
