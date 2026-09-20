// Template-based fallback (DESIGN.md 7.9). Lists eligible schemes and the main reason for each,
// directly from eligibility results. No LLM call, always available.

import type { AssistantFacts } from "./assistant";

interface SchemeEntry {
  name: string;
  nameGu: string;
  eligible: boolean;
  enrolled: boolean;
  mainReason: string | null;
}

function mainReason(reasons: { rule: string; actual: string | number | boolean | null; passed: boolean }[]): string | null {
  // The first failing rule is usually the most informative when ineligible.
  // When eligible, the first passing rule describes the primary criterion.
  const failing = reasons.find((r) => !r.passed);
  if (failing) return `${failing.rule} (actual: ${String(failing.actual ?? "unknown")})`;
  const passing = reasons.find((r) => r.passed);
  if (passing) return `${passing.rule} (actual: ${String(passing.actual ?? "unknown")})`;
  return null;
}

function buildSchemeEntries(facts: AssistantFacts): SchemeEntry[] {
  const entries: SchemeEntry[] = [];
  const seen = new Set<string>();
  for (const e of facts.eligibility) {
    const key = e.personId ? `${e.personId}|${e.schemeCode}` : `family|${e.schemeCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      name: e.schemeName,
      nameGu: e.schemeNameGu,
      eligible: e.eligible,
      enrolled: e.enrolled,
      mainReason: mainReason(e.reasons),
    });
  }
  return entries;
}

export function buildFallbackEn(facts: AssistantFacts): string {
  const entries = buildSchemeEntries(facts);
  const eligible = entries.filter((e) => e.eligible);
  const ineligible = entries.filter((e) => !e.eligible);

  const lines: string[] = [];
  lines.push(`Your family has ${facts.familySize} member(s).`);
  lines.push("");

  if (eligible.length > 0) {
    lines.push("Schemes you may be eligible for:");
    for (const e of eligible) {
      const status = e.enrolled ? "currently enrolled" : "not yet enrolled";
      const reason = e.mainReason ? ` — ${e.mainReason}` : "";
      lines.push(`• ${e.name} (${status})${reason}`);
    }
  } else {
    lines.push("Based on the current rules, no schemes show eligibility for this family.");
  }

  if (ineligible.length > 0) {
    lines.push("");
    lines.push("Not currently eligible for:");
    for (const e of ineligible) {
      const reason = e.mainReason ? ` — ${e.mainReason}` : "";
      lines.push(`• ${e.name}${reason}`);
    }
  }

  lines.push("");
  lines.push("Note: All thresholds are simplified demo values, not official criteria.");
  return lines.join("\n");
}

export function buildFallbackGu(facts: AssistantFacts): string {
  const entries = buildSchemeEntries(facts);
  const eligible = entries.filter((e) => e.eligible);
  const ineligible = entries.filter((e) => !e.eligible);

  const lines: string[] = [];
  lines.push(`તમારા પરિવારમાં ${facts.familySize} સભ્ય(ઓ) છે.`);
  lines.push("");

  if (eligible.length > 0) {
    lines.push("તમે આ યોજનાઓ માટે પાત્ર હોઈ શકો છો:");
    for (const e of eligible) {
      const status = e.enrolled ? "હાલમાં નોંધાયેલ" : "હજુ નોંધાયેલ નથી";
      const reason = e.mainReason ? ` — ${e.mainReason}` : "";
      lines.push(`• ${e.nameGu} (${status})${reason}`);
    }
  } else {
    lines.push("હાલના નિયમો મુજબ, આ પરિવાર માટે કોઈ યોજના પાત્રતા દર્શાવતી નથી.");
  }

  if (ineligible.length > 0) {
    lines.push("");
    lines.push("હાલમાં પાત્ર નથી:");
    for (const e of ineligible) {
      const reason = e.mainReason ? ` — ${e.mainReason}` : "";
      lines.push(`• ${e.nameGu}${reason}`);
    }
  }

  lines.push("");
  lines.push("નોંધ: બધી મર્યાદાઓ સરળ ડેમો મૂલ્યો છે, સત્તાવાર માપદંડ નથી.");
  return lines.join("\n");
}

export function buildFallback(facts: AssistantFacts, lang: "en" | "gu"): string {
  return lang === "gu" ? buildFallbackGu(facts) : buildFallbackEn(facts);
}
