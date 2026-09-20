import { NextRequest } from "next/server";
import { getFamilySummary } from "@/lib/db/queries";
import { getRole } from "@/lib/role";

/** Officer-only: confirm which family a Family ID is before moving someone into it. */
export async function GET(request: NextRequest) {
  if ((await getRole()) !== "officer") {
    return Response.json({ ok: false, error: "Only officers can look up families" }, { status: 403 });
  }
  const id = (request.nextUrl.searchParams.get("id") ?? "").trim();
  if (id === "") return Response.json({ ok: false, error: "id is required" }, { status: 400 });

  const summary = await getFamilySummary(id);
  if (!summary) return Response.json({ ok: false, error: "No family has that ID" }, { status: 404 });
  const head = summary.members.find((m) => m.person.id === summary.family.head_person_id);
  return Response.json({
    ok: true,
    family: {
      id: summary.family.id,
      status: summary.family.status,
      headName: head?.person.canonical_name ?? null,
      village: summary.family.village,
      taluka: summary.family.taluka,
      district: summary.family.district,
      memberCount: summary.members.length,
    },
  });
}
