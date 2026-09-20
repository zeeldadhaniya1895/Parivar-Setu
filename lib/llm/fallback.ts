// Template-based fallback (DESIGN.md 7.9). Lists the schemes that apply, who they apply to and the
// main reason, directly from eligibility results. No LLM call, always available.

import { STATUS_LABELS, isReceiving, type BenefitStatus, type Lang } from "../benefit-status";
import { RELATION_LABELS, RELATION_LABELS_GU } from "../format";
import { describeRule } from "../rule-text";
import type { AssistantFacts, EligibilityFact, MemberFact } from "./assistant";

const TEXT = {
  en: {
    size: (n: number) => `Your family has ${n} member(s).`,
    receiving: "Benefits your family is receiving:",
    waiting: "Eligible, waiting for an officer to verify (you can ask an officer why):",
    none: "Based on the current rules, no schemes apply to this family right now.",
    other: "For every other scheme, the family's records do not meet the rules. You can ask an officer if you think this is wrong.",
    wholeFamily: "whole family",
    member: (n: string) => `family member ${n}`,
    age: (band: string) => `age ${band}`,
    note: "Note: All thresholds are simplified demo values, not official criteria. This is information, not a promise of payment.",
  },
  gu: {
    size: (n: number) => `તમારા પરિવારમાં ${n} સભ્ય(ઓ) છે.`,
    receiving: "તમારા પરિવારને મળતા લાભ:",
    waiting: "પાત્ર, અધિકારીની ચકાસણીની રાહ (તમે અધિકારીને કારણ પૂછી શકો છો):",
    none: "હાલના નિયમો મુજબ, આ પરિવાર માટે હાલમાં કોઈ યોજના લાગુ પડતી નથી.",
    other: "બાકીની બધી યોજનાઓ માટે પરિવારના રેકોર્ડ નિયમોમાં બેસતા નથી. જો તમને ભૂલ લાગે તો અધિકારીને પૂછી શકો છો.",
    wholeFamily: "આખો પરિવાર",
    member: (n: string) => `પરિવારના સભ્ય ${n}`,
    age: (band: string) => `ઉંમર ${band}`,
    note: "નોંધ: બધી મર્યાદાઓ સરળ ડેમો મૂલ્યો છે, સત્તાવાર માપદંડ નથી. આ માહિતી છે, ચુકવણીની ખાતરી નથી.",
  },
} as const;

function who(entry: EligibilityFact, members: Map<string, MemberFact>, lang: Lang): string {
  const t = TEXT[lang];
  if (entry.memberRef === null) return t.wholeFamily;
  const member = members.get(entry.memberRef);
  const number = entry.memberRef.replace("member ", "");
  const relation = member?.relation
    ? (lang === "gu" ? RELATION_LABELS_GU : RELATION_LABELS)[member.relation]
    : null;
  const parts = [relation, member ? t.age(member.ageBand) : null].filter(Boolean).join(", ");
  return parts ? `${t.member(number)} (${parts})` : t.member(number);
}

/** The rules that pass, in words. The deceased check is left out: it is not a reason to celebrate. */
function whyText(entry: EligibilityFact, lang: Lang): string {
  return entry.reasons
    .filter((r) => r.passed && !r.rule.startsWith("is_deceased"))
    .map((r) => describeRule(r.rule, lang))
    .join("; ");
}

function line(entry: EligibilityFact, members: Map<string, MemberFact>, lang: Lang, status: BenefitStatus): string {
  const name = lang === "gu" ? entry.schemeNameGu : entry.schemeName;
  const label = status === "receiving_auto" ? ` (${STATUS_LABELS[status][lang]})` : "";
  const why = whyText(entry, lang);
  return `• ${name} — ${who(entry, members, lang)}${label}${why ? `: ${why}` : ""}`;
}

export function buildFallback(facts: AssistantFacts, lang: Lang): string {
  const t = TEXT[lang];
  const members = new Map(facts.members.map((m) => [m.ref, m]));

  // One row per member and scheme, however the facts were assembled.
  const seen = new Set<string>();
  const entries = facts.eligibility.filter((e) => {
    const key = `${e.memberRef ?? "family"}|${e.schemeCode}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const receiving = entries.filter((e) => isReceiving(e.status));
  const waiting = entries.filter((e) => e.status === "awaiting_verification");

  const lines: string[] = [t.size(facts.familySize), ""];
  if (receiving.length === 0 && waiting.length === 0) {
    lines.push(t.none);
  }
  if (receiving.length > 0) {
    lines.push(t.receiving);
    for (const e of receiving) lines.push(line(e, members, lang, e.status));
    lines.push("");
  }
  if (waiting.length > 0) {
    lines.push(t.waiting);
    for (const e of waiting) lines.push(line(e, members, lang, e.status));
    lines.push("");
  }
  if (entries.length > receiving.length + waiting.length) lines.push(t.other);
  lines.push("", t.note);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n");
}

export const buildFallbackEn = (facts: AssistantFacts) => buildFallback(facts, "en");
export const buildFallbackGu = (facts: AssistantFacts) => buildFallback(facts, "gu");
