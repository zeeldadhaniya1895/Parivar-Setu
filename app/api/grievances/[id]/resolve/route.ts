import { answerGrievance, GrievanceError } from "@/lib/db/grievances";

/** An officer answers a grievance. Answering twice is refused (409). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const answer = typeof body === "object" && body !== null ? (body as Record<string, unknown>).officerResponse : undefined;

  try {
    const grievance = await answerGrievance(Number(id), answer);
    return Response.json({ ok: true, grievance });
  } catch (error) {
    if (error instanceof GrievanceError) {
      return Response.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("answering grievance failed", error);
    return Response.json({ ok: false, error: "Could not save the answer" }, { status: 500 });
  }
}
