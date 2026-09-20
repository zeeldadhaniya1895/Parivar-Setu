// Assistant orchestrator (DESIGN.md 7.9).
// Builds facts from family data, calls Gemini if available, falls back to a template.
// The LLM only receives derived, non-identifying facts: never names, IDs, village, or addresses,
// and never an exact age or income (only bands, and the rules in words).

import { benefitStatus, STATUS_LABELS, type BenefitStatus } from "../benefit-status";
import type { EligibilityRow, EnrollmentRow, FamilyRow, MemberRow, PersonRow } from "../db/queries";
import { ageFromDob } from "../engine/eligibility";
import { describeRule } from "../rule-text";
import { schemeName, schemeNameGu, schemesConfig } from "../schemes";
import { buildFallback } from "./fallback";
import { callGemini, getProvider } from "./gemini";

// ---- fact types --------------------------------------------------------------------------

export interface MemberFact {
  /** "member 1", "member 2", ...: lets an answer say who without saying a name */
  ref: string;
  relation: string | null;
  ageBand: "0-17" | "18-59" | "60+";
  gender: "M" | "F" | null;
}

export interface EligibilityFact {
  /** Which member this is about, or null for a family-wide scheme */
  memberRef: string | null;
  schemeCode: string;
  schemeName: string;
  schemeNameGu: string;
  scope: "person" | "family";
  eligible: boolean;
  status: BenefitStatus;
  /** The rules, with whether each passed. No exact ages or incomes. */
  reasons: { rule: string; passed: boolean }[];
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
  const refOf = new Map(members.map((m, i) => [m.person_id, `member ${i + 1}`]));

  const memberFacts: MemberFact[] = members.map((m, i) => {
    const person = personById.get(m.person_id);
    const age = person?.dob ? ageFromDob(person.dob, asOfDate) : null;
    return {
      ref: `member ${i + 1}`,
      relation: m.relation_to_head,
      ageBand: ageBand(age),
      gender: person?.gender ?? null,
    };
  });

  const statusEnrollments = enrollments.map((e) => ({
    personId: e.person_id, schemeCode: e.scheme_code, basis: e.basis,
  }));
  const schemeByCode = new Map(schemesConfig.schemes.map((s) => [s.code, s]));

  const eligibilityFacts: EligibilityFact[] = eligibility.map((row) => ({
    memberRef: row.person_id === null ? null : (refOf.get(row.person_id) ?? null),
    schemeCode: row.scheme_code,
    schemeName: schemeName(row.scheme_code),
    schemeNameGu: schemeNameGu(row.scheme_code),
    scope: row.person_id === null ? "family" : "person",
    eligible: row.eligible,
    status: benefitStatus(
      { schemeCode: row.scheme_code, personId: row.person_id, eligible: row.eligible },
      statusEnrollments,
      schemeByCode.get(row.scheme_code),
    ),
    reasons: row.reasons.map((r) => ({ rule: r.rule, passed: r.passed })),
  }));

  return {
    familySize: members.length,
    incomeBand: incomeBand(family.resolved_income),
    members: memberFacts,
    eligibility: eligibilityFacts,
  };
}

// ---- prompt ------------------------------------------------------------------------------

export function systemPrompt(lang: "en" | "gu"): string {
  const language = lang === "gu" ? "Gujarati" : "English";
  return [
    "You are a government welfare scheme assistant for Gujarat families.",
    "Answer ONLY from the facts provided below. If the answer is not in the facts, say you do not have that information.",
    `Reply in ${language}.`,
    "Keep your answer under 120 words.",
    "Each scheme line says whether the member is receiving it, it started automatically, it is waiting for officer verification, or they are not eligible.",
    "If a scheme is waiting for verification or the family is not eligible, tell them they can use the Ask an officer button on the page to file a question.",
    "Do not make any promises about payment amounts or dates.",
    "Do not mention any names, IDs, addresses, or villages. Refer to people as member 1, member 2 and so on.",
    "All eligibility thresholds are simplified demo values, not official criteria.",
  ].join(" ");
}

export function userMessage(facts: AssistantFacts, question: string): string {
  const memberByRef = new Map(facts.members.map((m) => [m.ref, m]));
  const lines: string[] = [];
  lines.push("--- FACTS ---");
  lines.push(`Family size: ${facts.familySize}`);
  lines.push(`Family income band: ${facts.incomeBand}`);
  lines.push("");
  lines.push("Members:");
  for (const m of facts.members) {
    lines.push(`  - ${m.ref}: relation ${m.relation ?? "unknown"}, age band ${m.ageBand}, gender ${m.gender ?? "unknown"}`);
  }
  lines.push("");
  lines.push("Schemes:");
  for (const e of facts.eligibility) {
    const who = e.memberRef ? `${e.memberRef} (${memberByRef.get(e.memberRef)?.relation ?? "member"})` : "the whole family";
    const rules = e.reasons
      .filter((r) => !r.rule.startsWith("is_deceased"))
      .map((r) => `${r.passed ? "meets" : "does not meet"}: ${describeRule(r.rule, "en")}`)
      .join("; ");
    lines.push(`  - ${e.schemeName} for ${who}: ${STATUS_LABELS[e.status].en}. ${rules}`);
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
    const reply = await callGemini(provider, systemPrompt(lang), userMessage(facts, question));
    if (reply) {
      return { answer: reply, source: "gemini" };
    }
  }

  // Fallback: template-based answer, always available.
  return { answer: buildFallback(facts, lang), source: "fallback" };
}
