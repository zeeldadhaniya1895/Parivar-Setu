import { currentAsOfDate } from "@/lib/asof";
import { addMember, ChangeError, loadFamilyContext } from "@/lib/db/family-changes";
import { validateAddMember } from "@/lib/family-changes";
import { runPipeline } from "@/lib/pipeline";
import { getRole } from "@/lib/role";

export const maxDuration = 60;

/** An officer adds a new member to a family. Officer role only; validated, audited, then the pipeline reruns. */
export async function POST(request: Request) {
  if ((await getRole()) !== "officer") {
    return Response.json({ ok: false, error: "Only officers can change families" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const asOf = currentAsOfDate();
  try {
    const family = await loadFamilyContext(typeof body.familyId === "string" ? body.familyId : "");
    const checked = validateAddMember(body, family, asOf);
    if (!checked.ok || family === null) {
      return Response.json({ ok: false, error: checked.ok ? "Family not found" : checked.error }, { status: 400 });
    }
    const saved = await addMember(checked.value, family, asOf, "officer:demo");
    try {
      await runPipeline("officer:demo", { afterChange: true });
    } catch (error) {
      console.error("pipeline failed after adding a member", error);
      return Response.json(
        { ok: false, error: "The member was saved, but rebuilding the results failed. Click Run resolution on the dashboard." },
        { status: 500 },
      );
    }
    return Response.json({ ok: true, familyId: family.id, ...saved });
  } catch (error) {
    if (error instanceof ChangeError) return Response.json({ ok: false, error: error.message }, { status: error.status });
    console.error("adding a member failed", error);
    return Response.json({ ok: false, error: "Could not add the member" }, { status: 500 });
  }
}
