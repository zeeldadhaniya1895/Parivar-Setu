// CSV downloads for officers: families receiving a scheme, and families eligible but waiting for
// manual verification. Pure: rows in, text out.

export type CsvCell = string | number | null;

/** RFC 4180 quoting: wrap in quotes when a cell has a comma, quote or line break; double quotes. */
export function csvCell(value: CsvCell): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** One family in a scheme list. Used by both the on-screen tables and the CSV. */
export interface SchemeFamilyRow {
  familyId: string;
  headName: string | null;
  village: string;
  taluka: string;
  district: string;
  /** Who benefits (or is eligible): first name and relation, or "Whole family" */
  people: string[];
  peopleCount: number;
  /** Total demo monthly benefit in rupees (receiving list only) */
  monthlyAmount: number;
  /** How the benefit started (receiving list) */
  started: "records" | "automatic" | "both" | null;
  /** The rules that pass (pending list) */
  rulesMet: string;
}

const STARTED_LABEL = { records: "From records", automatic: "Started automatically", both: "Records and automatic" } as const;

const PLACE_HEADER = ["Family ID", "Head of family", "Village", "Taluka", "District"] as const;
const place = (r: SchemeFamilyRow): CsvCell[] => [r.familyId, r.headName, r.village, r.taluka, r.district];

export function receivingCsv(schemeName: string, rows: readonly SchemeFamilyRow[]): string {
  return toCsv(
    ["Scheme", ...PLACE_HEADER, "Beneficiaries", "Beneficiary count", "Monthly benefit (INR)", "How the benefit started"],
    rows.map((r) => [
      schemeName, ...place(r), r.people.join("; "), r.peopleCount, r.monthlyAmount,
      r.started === null ? "" : STARTED_LABEL[r.started],
    ]),
  );
}

export function pendingCsv(schemeName: string, rows: readonly SchemeFamilyRow[]): string {
  return toCsv(
    ["Scheme", ...PLACE_HEADER, "Eligible people", "Eligible count", "Why not receiving", "Rules met"],
    rows.map((r) => [
      schemeName, ...place(r), r.people.join("; "), r.peopleCount, "Manual verification required", r.rulesMet,
    ]),
  );
}
