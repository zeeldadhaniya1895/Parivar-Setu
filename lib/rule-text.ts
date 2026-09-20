// Turn a stored rule string ("age gte 60") into a sentence a citizen or officer can read.
// Gujarati wording should be reviewed by a native speaker before real use.
import type { Lang } from "./benefit-status";

const inr = new Intl.NumberFormat("en-IN");
const rupees = (v: string) => `₹${inr.format(Number(v))}`;

function date(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

const en = {
  gender: { F: "female", M: "male" } as Record<string, string>,
  marital: { widowed: "widowed", married: "married", unmarried: "unmarried" } as Record<string, string>,
};
const gu = {
  gender: { F: "સ્ત્રી", M: "પુરુષ" } as Record<string, string>,
  marital: { widowed: "વિધવા", married: "પરિણીત", unmarried: "અપરિણીત" } as Record<string, string>,
};

/** `rule` is "<field> <op> <value>", as stored in eligibility reasons. Unknown rules pass through. */
export function describeRule(rule: string, lang: Lang): string {
  const [field, op, ...rest] = rule.split(" ");
  const value = rest.join(" ");
  const g = lang === "gu";

  switch (`${field} ${op}`) {
    case "age gte": return g ? `ઉંમર ${value} વર્ષ કે તેથી વધુ` : `age ${value} or above`;
    case "age gt": return g ? `ઉંમર ${value} વર્ષથી વધુ` : `older than ${value}`;
    case "age lte": return g ? `ઉંમર ${value} વર્ષ સુધી` : `age ${value} or below`;
    case "age lt": return g ? `ઉંમર ${value} વર્ષથી ઓછી` : `younger than ${value}`;
    case "family.resolved_income lte":
      return g ? `કુટુંબની વાર્ષિક આવક ${rupees(value)} સુધી` : `family income up to ${rupees(value)} a year`;
    case "family.resolved_income gte":
      return g ? `કુટુંબની વાર્ષિક આવક ઓછામાં ઓછી ${rupees(value)}` : `family income at least ${rupees(value)} a year`;
    case "family.size gte": return g ? `કુટુંબમાં ${value} કે વધુ સભ્યો` : `family of ${value} or more`;
    case "gender eq": return (g ? gu : en).gender[value] ?? value;
    case "marital_status eq": return (g ? gu : en).marital[value] ?? value;
    case "is_student eq":
      return value === "true" ? (g ? "વિદ્યાર્થી" : "is a student") : (g ? "વિદ્યાર્થી નથી" : "is not a student");
    case "dob on_or_after": return g ? `${date(value)} અથવા તે પછી જન્મેલ` : `born on or after ${date(value)}`;
    case "dob on_or_before": return g ? `${date(value)} અથવા તે પહેલાં જન્મેલ` : `born on or before ${date(value)}`;
    case "is_deceased eq": return value === "false" ? (g ? "હયાત" : "is alive") : (g ? "અવસાન પામેલ" : "is deceased");
    default: return rule;
  }
}
