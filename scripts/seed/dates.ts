import type { Rng } from "./rng";

export interface YMD {
  y: number;
  m: number;
  d: number;
}

/** "Today" for the synthetic world. Matches AS_OF_DATE in .env.example. */
export const AS_OF: YMD = { y: 2026, m: 9, d: 20 };

const MS_PER_DAY = 86_400_000;

export function toDays(x: YMD): number {
  return Math.round(Date.UTC(x.y, x.m - 1, x.d) / MS_PER_DAY);
}

export function fromDays(n: number): YMD {
  const dt = new Date(n * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

export function addDays(x: YMD, n: number): YMD {
  return fromDays(toDays(x) + n);
}

export function ageOn(dob: YMD, on: YMD = AS_OF): number {
  let age = on.y - dob.y;
  if (on.m < dob.m || (on.m === dob.m && on.d < dob.d)) age--;
  return age;
}

/** A random birth date such that the person is exactly `age` years old on AS_OF. */
export function dobForAge(rng: Rng, age: number): YMD {
  const earliest = toDays({ y: AS_OF.y - age - 1, m: AS_OF.m, d: AS_OF.d }) + 1;
  const latest = toDays({ y: AS_OF.y - age, m: AS_OF.m, d: AS_OF.d });
  return fromDays(rng.int(earliest, latest));
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

export type DateFormat = "dmy/" | "dmy-" | "ymd";

export function formatDate(x: YMD, format: DateFormat): string {
  switch (format) {
    case "dmy/":
      return `${pad(x.d)}/${pad(x.m)}/${x.y}`;
    case "dmy-":
      return `${pad(x.d)}-${pad(x.m)}-${x.y}`;
    case "ymd":
      return `${x.y}-${pad(x.m)}-${pad(x.d)}`;
  }
}

export { pad };
