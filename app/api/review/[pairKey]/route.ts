import { runPipeline } from "@/lib/pipeline";
import { db } from "@/lib/db/client";

interface RequestBody {
  decision?: "approved" | "rejected";
  reason?: string;
}

export async function POST(request: Request, { params }: { params: Promise<{ pairKey: string }> }) {
  const { pairKey } = await params;
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { decision, reason } = body;
  if (decision !== "approved" && decision !== "rejected") {
    return Response.json({ error: "Decision must be 'approved' or 'rejected'" }, { status: 400 });
  }

  try {
    // 1. Insert or update review_decisions
    const { error: upsertError } = await db()
      .from("review_decisions")
      .upsert({
        pair_key: pairKey,
        decision,
        decided_by: "Officer",
        reason: reason || null,
        decided_at: new Date().toISOString(),
      }, { onConflict: "pair_key" });
    if (upsertError) throw new Error(upsertError.message);

    // 2. Insert audit_log
    const { error: auditError } = await db()
      .from("audit_log")
      .insert({
        actor: "officer:demo",
        action: "review_decision",
        entity_type: "pair",
        entity_id: pairKey,
        after: { decision, reason: reason || null },
      });
    if (auditError) throw new Error(auditError.message);
  } catch (error) {
    console.error("Failed to record review decision:", error);
    return Response.json({ error: "Failed to record decision" }, { status: 500 });
  }

  // 3. Rerun pipeline
  try {
    const stats = await runPipeline("Officer");
    return Response.json({ success: true, stats });
  } catch (error) {
    console.error("Failed to run pipeline:", error);
    return Response.json({ error: "Decision saved, but pipeline failed" }, { status: 500 });
  }
}
