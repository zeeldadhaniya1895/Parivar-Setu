// Normalization (DESIGN.md 7.1 and 7.2). Pure functions, no clock: "today" is always `asOf`.
import type {
  NormalizedName, NormalizedRecord, ParsedDob, PhoneticName, SourceRecord,
} from "./types";

/** ~30 common Gujarati surnames. A first token in this list means the name is surname-first. */
export const KNOWN_SURNAMES: ReadonlySet<string> = new Set([
  "patel", "shah", "desai", "mehta", "joshi", "parmar", "chauhan", "solanki", "rathod",
  "chaudhary", "thakor", "prajapati", "modi", "trivedi", "pandya", "bhatt", "vaghela",
  "makwana", "gohil", "jadeja", "zala", "dave", "vyas", "raval", "panchal", "soni",
  "mistry", "barot", "rabari", "bharwad",
]);

const TITLES: ReadonlySet<string> = new Set([
  "shri", "shree", "smt", "shrimati", "kum", "kumari", "mr", "mrs", "ms", "kumar", "dr",
]);

const LATE_MARKERS: ReadonlySet<string> = new Set(["late", "swargiya", "sw"]);

// Attached honorifics, longest first. Attached `kumar` (Sureshkumar) is never stripped; only a
// standalone `kumar` token is dropped, as a title (see TITLES; this deviates from DESIGN.md 7.1).
const HONORIFIC_SUFFIXES = ["behn", "bhai", "ben"] as const;
const MIN_STEM = 3;

/**
 * Indic phonetic key rules, applied in order to each lowercase name part.
 *
 * Two deviations from DESIGN.md, both found by running the seed generator's spelling noise
 * through this table (scripts/seed/__tests__/noise-resolvable.test.ts):
 *  - `ou->o` instead of `ou->u`: the doc's own example (chaudhary, choudhari and chaudhari must
 *    share a key) only holds when `ou` and `au` both map to `o`.
 *  - `y at end -> i` runs first, not last: otherwise vijay ("vijai") and vijai ("vije", since
 *    `ai->e` fires) get different keys.
 */
export const PHONETIC_RULES: readonly (readonly [RegExp, string])[] = [
  [/y$/, "i"],
  [/aa/g, "a"], [/ee/g, "i"], [/ii/g, "i"], [/oo/g, "u"], [/uu/g, "u"],
  [/ou/g, "o"], [/au/g, "o"], [/ai/g, "e"],
  [/bh/g, "b"], [/dh/g, "d"], [/kh/g, "k"], [/gh/g, "g"], [/th/g, "t"], [/ph/g, "f"],
  [/jh/g, "j"], [/ch/g, "c"], [/sh/g, "s"],
  [/w/g, "v"], [/z/g, "j"], [/q/g, "k"],
];

export function phoneticKey(word: string): string {
  let key = word.toLowerCase().replace(/[^a-z]/g, "");
  for (const [pattern, replacement] of PHONETIC_RULES) key = key.replace(pattern, replacement);
  key = key.replace(/(.)\1+/g, "$1");
  if (key.length > 3 && key.endsWith("a")) key = key.slice(0, -1);
  return key;
}

// Known surnames also match by phonetic key, so a misspelled surname (rabaree, chaudary, sah) is still
// recognised when a name is written surname-first.
const KNOWN_SURNAME_KEYS: ReadonlySet<string> = new Set([...KNOWN_SURNAMES].map(phoneticKey));
const isKnownSurname = (token: string) =>
  KNOWN_SURNAMES.has(token) || KNOWN_SURNAME_KEYS.has(phoneticKey(token));

function stripHonorific(token: string): string {
  for (const suffix of HONORIFIC_SUFFIXES) {
    if (token.length >= suffix.length + MIN_STEM && token.endsWith(suffix)) {
      return token.slice(0, -suffix.length);
    }
  }
  return token;
}

const isHonorificWord = (token: string) => (HONORIFIC_SUFFIXES as readonly string[]).includes(token);

/** Split a raw name into first, middle (father's or husband's name) and last. */
export function normalizeName(raw: string): NormalizedName {
  // Lowercase; `.` separates initials ("r.k." -> "r k"); other punctuation is dropped.
  const cleaned = raw.toLowerCase().replace(/[.,]/g, " ").replace(/[^a-z\s]/g, "");
  const words = cleaned.split(/\s+/).filter(Boolean);

  const lateMarker = words.some((w) => LATE_MARKERS.has(w));
  const tokens = words
    .filter((w) => !LATE_MARKERS.has(w) && !TITLES.has(w))
    .map(stripHonorific)
    .filter((w) => w.length > 0 && !isHonorificWord(w));

  if (tokens.length === 0) {
    return { first: null, middle: null, last: null, middleIsInitial: false, lateMarker };
  }
  if (tokens.length === 1) {
    return { first: tokens[0], middle: null, last: null, middleIsInitial: false, lateMarker };
  }

  const n = tokens.length;
  // Surname-first when the first token is a known surname (and the last is not).
  const surnameFirst = isKnownSurname(tokens[0]) && !isKnownSurname(tokens[n - 1]);
  const last = surnameFirst ? tokens[0] : tokens[n - 1];
  const rest = surnameFirst ? tokens.slice(1) : tokens.slice(0, n - 1);

  const first = rest[0];
  const middle = rest.length > 1 ? rest.slice(1).join(" ") : null;
  return { first, middle, last, middleIsInitial: middle !== null && middle.length === 1, lateMarker };
}

export function phoneticName(name: NormalizedName): PhoneticName {
  return {
    first: name.first === null ? null : phoneticKey(name.first),
    middle: name.middle === null ? null : phoneticKey(name.middle),
    last: name.last === null ? null : phoneticKey(name.last),
  };
}

// ---- dates -------------------------------------------------------------------------------

const daysInMonth = (year: number, month: number): number =>
  [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

function fullDate(year: number, month: number, day: number): ParsedDob | null {
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day, approximate: false };
}

/**
 * Accepts dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, a bare year, and `age N` (approximate,
 * converted with `asOf`, given as yyyy-mm-dd).
 */
export function parseDob(raw: string | null, asOf: string): ParsedDob | null {
  if (raw === null) return null;
  const s = raw.trim().toLowerCase();

  const age = /^age\s*(\d{1,3})$/.exec(s);
  if (age) {
    return { year: Number(asOf.slice(0, 4)) - Number(age[1]), month: null, day: null, approximate: true };
  }
  if (/^\d{4}$/.test(s)) return { year: Number(s), month: null, day: null, approximate: false };

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) return fullDate(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  const ymd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (ymd) return fullDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  return null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** yyyy-mm-dd for a full date, the bare year for a year-only date. */
export function formatDob(dob: ParsedDob): string {
  return dob.month !== null && dob.day !== null
    ? `${dob.year}-${pad(dob.month)}-${pad(dob.day)}`
    : String(dob.year);
}

/** ISO date from any accepted full-date format, or null. */
export function parseFullDateToIso(raw: string | null, asOf: string): string | null {
  const dob = parseDob(raw, asOf);
  return dob !== null && dob.month !== null && dob.day !== null ? formatDob(dob) : null;
}

// ---- places ------------------------------------------------------------------------------

export function normalizePlace(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z]/g, "");
}

/** First numeric token in an address ("H.No 21 Shivnagar", "21, Shivnagar"), if any. */
export function extractHouseNumber(address: string): string | null {
  const match = /\d+/.exec(address);
  return match ? String(Number(match[0])) : null;
}

// ---- records -----------------------------------------------------------------------------

export function normalizeRecord(record: SourceRecord, asOf: string): NormalizedRecord {
  const name = normalizeName(record.full_name);
  const guardian = record.guardian_name === null ? null : normalizeName(record.guardian_name).first;
  const village = normalizePlace(record.village);
  const taluka = normalizePlace(record.taluka);
  return {
    id: record.id,
    source: record.source,
    householdRef: record.household_ref,
    name,
    phonetic: phoneticName(name),
    guardianFirst: guardian,
    dob: parseDob(record.dob, asOf),
    gender: record.gender,
    relation: record.relation_to_head,
    marital: record.marital_status,
    uidHash: record.uid_hash,
    uidLast4: record.uid_last4,
    district: normalizePlace(record.district),
    taluka,
    village,
    villageKey: village === "" ? "" : phoneticKey(village),
    talukaKey: taluka === "" ? "" : phoneticKey(taluka),
    houseNo: extractHouseNumber(record.address),
    incomeDeclared: record.income_declared,
    schemeCode: record.scheme_code,
    benefitAmount: record.benefit_amount,
    isStudent: record.is_student,
    dateOfDeath: parseFullDateToIso(record.date_of_death, asOf),
    raw: record,
  };
}
