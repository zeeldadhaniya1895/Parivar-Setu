// POST /api/assistant — citizen assistant (DESIGN.md 7.9).
// Body: { familyId: string, question: string, lang: "en" | "gu" }
// Response: { answer: string, source: "gemini" | "fallback" }

import { currentAsOfDate } from "@/lib/asof";
import { getFamilyDetail } from "@/lib/db/queries";
import { buildFacts, askAssistant } from "@/lib/llm/assistant";

interface RequestBody {
  familyId?: string;
  question?: string;
  lang?: string;
}

export async function POST(request: Request) {
  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { familyId, question, lang } = body;
  if (!familyId || typeof familyId !== "string") {
    return Response.json({ error: "familyId is required" }, { status: 400 });
  }
  if (!question || typeof question !== "string" || question.trim() === "") {
    return Response.json({ error: "question is required" }, { status: 400 });
  }
  const resolvedLang = lang === "gu" ? "gu" : "en";

  const detail = await getFamilyDetail(familyId);
  if (!detail) {
    return Response.json({ error: "Family not found" }, { status: 404 });
  }

  const asOfDate = currentAsOfDate();
  const persons = detail.members.map((m) => m.person);
  const memberRows = detail.members.map((m) => m.member);

  const facts = buildFacts(
    detail.family,
    memberRows,
    persons,
    detail.eligibility,
    detail.enrollments,
    asOfDate,
  );

  try {
    const response = await askAssistant(facts, question.trim(), resolvedLang);
    return Response.json(response);
  } catch (err) {
    console.error("assistant error", err);
    return Response.json(
      { error: "Assistant failed" },
      { status: 500 },
    );
  }
}
