// Assistant orchestrator (DESIGN.md 7.9).
// Builds facts from family data, calls Gemini if available, falls back to a template.
// The LLM only receives derived, non-identifying facts: never names, IDs, village, or addresses.

import type { EligibilityRow, EnrollmentRow, FamilyRow, MemberRow, PersonRow } from "../db/queries";
import { ageFromDob } from "../engine/eligibility";
import { schemeName, schemeNameGu, schemeScope } from "../schemes";
import { buildFallback } from "./fallback";
import { callGemini, getProvider } from "./gemini";

// ---- fact types --------------------------------------------------------------------------

interface MemberFact {
  relation: string | null;
  ageBand: "0-17" | "18-59" | "60+";
  gender: "M" | "F" | null;
}

interface EligibilityFact {
  /** Used only for deduplication inside the fallback template builder, never sent to the LLM. */
  personId: string | null;
  schemeCode: string;
  schemeName: string;
  schemeNameGu: string;
  scope: "person" | "family";
  eligible: boolean;
  enrolled: boolean;
  reasons: { rule: string; actual: string | number | boolean | null; passed: boolean }[];
}

export interface AssistantFacts {
  familySize: number;
  incomeBand: string;
  members: MemberFact[];
  eligibility: EligibilityFact[];
}

export interface AssistantResponse {
  answer: string;
  source: "gemini" | "fallback";
}

// ---- helpers -----------------------------------------------------------------------------

function ageBand(age: number | null): MemberFact["ageBand"] {
  if (age === null || age < 0) return "0-17";
  if (age < 18) return "0-17";
  if (age < 60) return "18-59";
  return "60+";
}

function incomeBand(income: number | null): string {
  if (income === null) return "unknown";
  if (income <= 120_000) return "up to ₹1,20,000";
  if (income <= 250_000) return "₹1,20,001 to ₹2,50,000";
  if (income <= 500_000) return "₹2,50,001 to ₹5,00,000";
  return "above ₹5,00,000";
}

// ---- facts builder -----------------------------------------------------------------------

export function buildFacts(
  family: FamilyRow,
  members: MemberRow[],
  persons: PersonRow[],
  eligibility: EligibilityRow[],
  enrollments: EnrollmentRow[],
  asOfDate: string,
): AssistantFacts {
  const personById = new Map(persons.map((p) => [p.id, p]));

  const memberFacts: MemberFact[] = members.map((m) => {
    const person = personById.get(m.person_id);
    const age = person?.dob ? ageFromDob(person.dob, asOfDate) : null;
    return {
      relation: m.relation_to_head,
      ageBand: ageBand(age),
      gender: person?.gender ?? null,
    };
  });

  const enrolledKeys = new Set(
    enrollments.map((e) =>
      schemeScope(e.scheme_code) === "family"
        ? `family|${e.scheme_code}`
        : `${e.person_id}|${e.scheme_code}`,
    ),
  );

  const eligibilityFacts: EligibilityFact[] = eligibility.map((row) => {
    const key = row.person_id === null
      ? `family|${row.scheme_code}`
      : `${row.person_id}|${row.scheme_code}`;
    return {
      personId: row.person_id,
      schemeCode: row.scheme_code,
      schemeName: schemeName(row.scheme_code),
      schemeNameGu: schemeNameGu(row.scheme_code),
      scope: row.person_id === null ? "family" : "person",
      eligible: row.eligible,
      enrolled: enrolledKeys.has(key),
      reasons: row.reasons,
    };
  });

  return {
    familySize: members.length,
    incomeBand: incomeBand(family.resolved_income),
    members: memberFacts,
    eligibility: eligibilityFacts,
  };
}

// ---- system prompt -----------------------------------------------------------------------

function systemPrompt(lang: "en" | "gu"): string {
  const language = lang === "gu" ? "Gujarati" : "English";
  return [
    "You are a government welfare scheme assistant for Gujarat families.",
    "Answer ONLY from the facts provided below. If the answer is not in the facts, say you do not have that information.",
    `Reply in ${language}.`,
    "Keep your answer under 120 words.",
    "Do not make any promises about payment amounts or dates.",
    "Do not mention any names, IDs, addresses, or villages — only use the derived facts.",
    "All eligibility thresholds are simplified demo values, not official criteria.",
  ].join(" ");
}

function userMessage(facts: AssistantFacts, question: string): string {
  const lines: string[] = [];
  lines.push("--- FACTS ---");
  lines.push(`Family size: ${facts.familySize}`);
  lines.push(`Family income band: ${facts.incomeBand}`);
  lines.push("");
  lines.push("Members:");
  for (const m of facts.members) {
    lines.push(`  - relation: ${m.relation ?? "unknown"}, age band: ${m.ageBand}, gender: ${m.gender ?? "unknown"}`);
  }
  lines.push("");
  lines.push("Eligibility:");
  for (const e of facts.eligibility) {
    const reasons = e.reasons
      .map((r) => `${r.passed ? "✓" : "✗"} ${r.rule} (actual: ${String(r.actual ?? "unknown")})`)
      .join("; ");
    lines.push(`  - ${e.schemeName} (${e.schemeNameGu}): ${e.eligible ? "ELIGIBLE" : "NOT ELIGIBLE"}, ${e.enrolled ? "enrolled" : "not enrolled"}. Rules: ${reasons}`);
  }
  lines.push("--- END FACTS ---");
  lines.push("");
  lines.push(`Question: ${question}`);
  return lines.join("\n");
}

// ---- main entry point --------------------------------------------------------------------

export async function askAssistant(
  facts: AssistantFacts, question: string, lang: "en" | "gu",
): Promise<AssistantResponse> {
  const provider = getProvider();

  if (provider) {
    const system = systemPrompt(lang);
    const user = userMessage(facts, question);
    const reply = await callGemini(provider, system, user);
    if (reply) {
      return { answer: reply, source: "gemini" };
    }
  }

  // Fallback: template-based answer, always available.
  return { answer: buildFallback(facts, lang), source: "fallback" };
}
