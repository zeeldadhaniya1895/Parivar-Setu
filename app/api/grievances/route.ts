import { fileGrievance, GrievanceError } from "@/lib/db/grievances";

/** A citizen asks why a scheme is not reaching them. Validated and audited on the server. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return Response.json({ ok: false, error: "Expected a JSON object" }, { status: 400 });
  }

  try {
    const { grievance, existing } = await fileGrievance(body as Record<string, unknown>);
    return Response.json({ ok: true, existing, grievance }, { status: existing ? 200 : 201 });
  } catch (error) {
    if (error instanceof GrievanceError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("filing grievance failed", error);
    return Response.json({ ok: false, error: "Could not file the grievance" }, { status: 500 });
  }
}
