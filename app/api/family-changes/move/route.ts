import { currentAsOfDate } from "@/lib/asof";
import { ChangeError, loadFamilyContext, moveMembers } from "@/lib/db/family-changes";
import { validateMove } from "@/lib/family-changes";
import { runPipeline } from "@/lib/pipeline";
import { getRole } from "@/lib/role";

export const maxDuration = 60;

/**
 * An officer separates members into a new family, or moves them into an existing one. Officer role
 * only. The members leave their old family; the engine applies the change on the rerun.
 */
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

  try {
    const source = await loadFamilyContext(typeof body.sourceFamilyId === "string" ? body.sourceFamilyId : "");
    const destination = typeof body.destination === "object" && body.destination !== null ? (body.destination as Record<string, unknown>) : {};
    const target = destination.kind === "existing" && typeof destination.familyId === "string"
      ? await loadFamilyContext(destination.familyId.trim())
      : null;

    const checked = validateMove(body, source, target, currentAsOfDate());
    if (!checked.ok || source === null) {
      return Response.json({ ok: false, error: checked.ok ? "Family not found" : checked.error }, { status: 400 });
    }
    const saved = await moveMembers(checked.value, source, "officer:demo");
    try {
      await runPipeline("officer:demo", { afterChange: true });
    } catch (error) {
      console.error("pipeline failed after a family change", error);
      return Response.json(
        { ok: false, error: "The change was saved, but rebuilding the results failed. Click Run resolution on the dashboard." },
        { status: 500 },
      );
    }
    return Response.json({ ok: true, sourceFamilyId: source.id, ...saved });
  } catch (error) {
    if (error instanceof ChangeError) return Response.json({ ok: false, error: error.message }, { status: error.status });
    console.error("family change failed", error);
    return Response.json({ ok: false, error: "Could not save the change" }, { status: 500 });
  }
}
