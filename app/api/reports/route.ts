import { NextRequest } from "next/server";
import { schemeFamilyLists } from "@/lib/db/queries";
import { pendingCsv, receivingCsv } from "@/lib/reports";

/**
 * CSV downloads for officers.
 *   /api/reports?type=receiving&scheme=OLD_AGE_PENSION   families receiving the scheme
 *   /api/reports?type=pending&scheme=WIDOW_ASSIST        families eligible, waiting for manual verification
 */
export async function GET(request: NextRequest) {
  const type = request.nextUrl.searchParams.get("type");
  const code = request.nextUrl.searchParams.get("scheme");
  if ((type !== "receiving" && type !== "pending") || !code) {
    return Response.json({ ok: false, error: "type (receiving or pending) and scheme are required" }, { status: 400 });
  }

  try {
    const lists = await schemeFamilyLists(code);
    if (!lists) return Response.json({ ok: false, error: `Unknown scheme ${code}` }, { status: 404 });

    const body = type === "receiving"
      ? receivingCsv(lists.scheme.name, lists.receiving)
      : pendingCsv(lists.scheme.name, lists.pending);
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${code}_${type}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("report failed", error);
    return Response.json({ ok: false, error: "Could not build the report" }, { status: 500 });
  }
}
