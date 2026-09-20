import type { JsonValue } from "./engine/types";
import type { FlagRow } from "./db/queries";
import { rupees } from "./format";
import { schemeName } from "./schemes";

const text = (v: JsonValue | undefined): string => (typeof v === "string" ? v : "");
const list = (v: JsonValue | undefined): JsonValue[] => (Array.isArray(v) ? v : []);
const field = (v: JsonValue | undefined, key: string): JsonValue | undefined =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? v[key] : undefined;

/** One plain sentence saying what a flag means, built only from the stored facts. */
export function flagSentence(flag: FlagRow, personName: string | null): string {
  const who = personName ?? "This person";
  const e = flag.evidence;
  switch (flag.type) {
    case "deceased_beneficiary": {
      const schemes = list(e.enrollments).map((x) => schemeName(text(field(x, "scheme")))).join(", ");
      return `${who} died on ${text(e.deceasedOn) || "an unknown date"} but is still enrolled in ${schemes}` +
        (flag.est_monthly_leakage ? ` (${rupees(flag.est_monthly_leakage)} a month).` : ".");
    }
    case "duplicate_enrollment":
      if (text(e.duplicateCard)) {
        return `Ration cards ${text(e.keptCard)} and ${text(e.duplicateCard)} list mostly the same people, so this family holds two cards.`;
      }
      return `${who} is enrolled ${list(e.enrollments).length} times in ${schemeName(text(e.scheme))}` +
        (flag.est_monthly_leakage ? ` (extra ${rupees(flag.est_monthly_leakage)} a month).` : ".");
    case "multi_household":
      return `${who} appears on ration cards ${[text(e.keptCard), ...list(e.otherCards).map(text)].join(" and ")}. They are kept in the more recent card, ${text(e.keptCard)}.`;
    case "income_mismatch": {
      const high = typeof e.highest === "number" ? e.highest : null;
      const low = typeof e.lowest === "number" ? e.lowest : null;
      return `Declared income differs between records, from ${rupees(low)} to ${rupees(high)} a year.`;
    }
    case "unanchored_beneficiary":
      return `${who} receives ${list(e.enrollments).map((x) => schemeName(text(field(x, "scheme")))).join(", ")} but is not on any ration card.`;
  }
}
