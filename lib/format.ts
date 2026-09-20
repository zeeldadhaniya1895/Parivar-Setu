// Display helpers shared by pages. IDs are always masked; nothing here sees a full national ID.

/** "XXXX XXXX 1234" from the last four digits, or a dash when unknown. */
export function maskUid(last4: string | null): string {
  return last4 ? `XXXX XXXX ${last4}` : "—";
}

const inr = new Intl.NumberFormat("en-IN");

export function rupees(value: number | null): string {
  return value === null ? "—" : `₹${inr.format(value)}`;
}

export function number(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : inr.format(value);
}

export function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

/** yyyy-mm-dd as dd/mm/yyyy; a bare year and anything else pass through. */
export function displayDob(dob: string | null): string {
  if (dob === null) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : `${dob} (year only)`;
}

export function displayDateTime(iso: string | null): string {
  if (iso === null) return "—";
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export const RELATION_LABELS: Record<string, string> = {
  head: "Head", spouse: "Spouse", son: "Son", daughter: "Daughter", son_in_law: "Son-in-law",
  daughter_in_law: "Daughter-in-law", grandson: "Grandson", granddaughter: "Granddaughter",
  father: "Father", mother: "Mother", other: "Other",
};

export const RELATION_LABELS_GU: Record<string, string> = {
  head: "મુખ્ય વ્યક્તિ", spouse: "જીવનસાથી", son: "પુત્ર", daughter: "પુત્રી", son_in_law: "જમાઈ",
  daughter_in_law: "પુત્રવધૂ", grandson: "પૌત્ર", granddaughter: "પૌત્રી", father: "પિતા", mother: "માતા", other: "અન્ય",
};

export const FLAG_LABELS: Record<string, string> = {
  deceased_beneficiary: "Deceased beneficiary",
  duplicate_enrollment: "Duplicate enrollment",
  multi_household: "Multiple households",
  income_mismatch: "Income mismatch",
  unanchored_beneficiary: "No ration card",
};

export const SOURCE_LABELS: Record<string, string> = {
  ration: "Ration", pension: "Pension", scholarship: "Scholarship", death_registry: "Death registry", officer_entry: "Officer entry",
};
