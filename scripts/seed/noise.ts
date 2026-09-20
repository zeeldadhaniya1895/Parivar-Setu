import { ageOn, formatDate, type DateFormat, type YMD } from "./dates";
import type { Gender } from "./names";
import type { Rng } from "./rng";

/** Every kind of corruption we inject. Tags let evaluation be broken down by noise type later. */
export type NoiseTag =
  | "spelling_variant"
  | "suffix"
  | "title"
  | "initial_middle"
  | "missing_middle"
  | "surname_first"
  | "year_only_dob"
  | "age_string_dob"
  | "swapped_dob"
  | "missing_uid"
  | "village_spelling"
  | "late_marker";

export interface NoiseProfile {
  spelling: number;
  suffix: number;
  title: number;
  initial: number;
  dropMiddle: number;
  surnameFirst: number;
  yearOnly: number;
  ageString: number;
  swapped: number;
  villageVar: number;
}

export const PROFILES = {
  // Ration is the cleanest source: "a little" noise.
  ration: {
    spelling: 0.04, suffix: 0.06, title: 0.02, initial: 0.03, dropMiddle: 0,
    surnameFirst: 0.01, yearOnly: 0, ageString: 0, swapped: 0, villageVar: 0.02,
  },
  // A re-issued ration card is typed in again by someone else.
  duplicateCard: {
    spelling: 0.15, suffix: 0.15, title: 0.05, initial: 0.1, dropMiddle: 0.03,
    surnameFirst: 0.03, yearOnly: 0, ageString: 0, swapped: 0.04, villageVar: 0.1,
  },
  pension: {
    spelling: 0.25, suffix: 0.3, title: 0.15, initial: 0.2, dropMiddle: 0.05,
    surnameFirst: 0.08, yearOnly: 0.12, ageString: 0.08, swapped: 0.06, villageVar: 0.12,
  },
  scholarship: {
    spelling: 0.2, suffix: 0.1, title: 0, initial: 0.05, dropMiddle: 0.4,
    surnameFirst: 0.08, yearOnly: 0.03, ageString: 0.03, swapped: 0.06, villageVar: 0.12,
  },
  death: {
    spelling: 0.2, suffix: 0.25, title: 0.2, initial: 0.1, dropMiddle: 0.05,
    surnameFirst: 0.05, yearOnly: 0.08, ageString: 0.25, swapped: 0.05, villageVar: 0.1,
  },
} as const satisfies Record<string, NoiseProfile>;

export interface NameParts {
  first: string;
  middle: string | null;
  last: string;
}

const capitalize = (s: string) => (s.length === 0 ? s : s[0].toUpperCase() + s.slice(1));

// Transliteration variants seen in real records. Most keep the phonetic key equal
// (pooja/puja, bhavesh/bavesh, chaudhary/choudhari); a few (patel/patal) only survive
// on Jaro-Winkler, which is intentional.
const SPELL_RULES: readonly (readonly [RegExp, string])[] = [
  [/oo/, "u"], [/bh/, "b"], [/dh/, "d"], [/kh/, "k"], [/gh/, "g"], [/ph/, "f"],
  [/sh(?=.)/, "s"], [/v/, "w"], [/w/, "v"], [/ee/, "i"], [/au/, "ou"], [/ai/, "e"],
  [/y$/, "i"], [/a$/, "aa"], [/i/, "ee"], [/l(?=a)/, "ll"], [/e(?=l$)/, "a"],
];

/** Apply one random transliteration variant, or null when no rule applies. */
export function spellVariant(rng: Rng, word: string): string | null {
  const lower = word.toLowerCase();
  const applicable = SPELL_RULES.filter(([pattern]) => pattern.test(lower));
  if (applicable.length === 0) return null;
  const [pattern, replacement] = rng.pick(applicable);
  const changed = lower.replace(pattern, replacement);
  return changed === lower ? null : capitalize(changed);
}

export interface NameContext {
  gender: Gender;
  age: number;
  married: boolean;
}

/** Render a name the way a messy source system might write it. */
export function noisyName(
  rng: Rng,
  parts: NameParts,
  ctx: NameContext,
  profile: NoiseProfile,
  tags: NoiseTag[],
): string {
  let { first, middle, last } = parts;

  if (rng.chance(profile.spelling)) {
    const target = rng.weighted<"first" | "last" | "middle">([
      ["first", 5], ["last", 3], ["middle", middle ? 2 : 0],
    ]);
    if (target === "first") first = spellVariant(rng, first) ?? first;
    else if (target === "last") last = spellVariant(rng, last) ?? last;
    else if (middle) middle = spellVariant(rng, middle) ?? middle;
    if (first !== parts.first || last !== parts.last || middle !== parts.middle) {
      tags.push("spelling_variant");
    }
  }

  const adult = ctx.age >= 18;
  if (adult && rng.chance(profile.suffix)) {
    first += ctx.gender === "M" ? "bhai" : "ben";
    if (middle && rng.chance(0.4)) middle += "bhai";
    tags.push("suffix");
  }

  if (middle && rng.chance(profile.initial)) {
    middle = rng.chance(0.5) ? `${middle[0]}.` : middle[0];
    tags.push("initial_middle");
  } else if (middle && rng.chance(profile.dropMiddle)) {
    middle = null;
    tags.push("missing_middle");
  }

  let words: (string | null)[] = [first, middle, last];
  if (rng.chance(profile.surnameFirst)) {
    words = [last, first, middle];
    tags.push("surname_first");
  }
  let name = words.filter((w): w is string => Boolean(w)).join(" ");

  if (adult && rng.chance(profile.title)) {
    const title =
      ctx.gender === "M"
        ? rng.pick(["Shri", "Shree", "Mr"])
        : ctx.married
          ? rng.pick(["Smt", "Shrimati", "Mrs"])
          : rng.pick(["Kum", "Kumari", "Ms"]);
    name = `${title} ${name}`;
    tags.push("title");
  }
  return name;
}

/** Render a date of birth, sometimes degraded to a year, an age string or a swapped day/month. */
export function noisyDob(
  rng: Rng,
  dob: YMD,
  profile: NoiseProfile,
  formats: readonly DateFormat[],
  tags: NoiseTag[],
): string {
  if (rng.chance(profile.yearOnly)) {
    tags.push("year_only_dob");
    return String(dob.y);
  }
  if (rng.chance(profile.ageString)) {
    tags.push("age_string_dob");
    return `age ${ageOn(dob)}`;
  }
  const format = rng.pick(formats);
  if (rng.chance(profile.swapped) && dob.d <= 12 && dob.d !== dob.m) {
    tags.push("swapped_dob");
    return formatDate({ y: dob.y, m: dob.d, d: dob.m }, format);
  }
  return formatDate(dob, format);
}

/** Return a misspelled place name, or the original. */
export function noisyPlace(rng: Rng, name: string, profile: NoiseProfile, tags: NoiseTag[]): string {
  if (!rng.chance(profile.villageVar)) return name;
  const variant = spellVariant(rng, name);
  if (variant === null) return name;
  tags.push("village_spelling");
  return variant;
}
