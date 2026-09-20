// One plain answer to "is this person or family getting this scheme?", shared by the citizen page,
// the assistant, grievance snapshots and the officer lists so they never disagree.
import type { SchemeConfig } from "./engine/types";

export type BenefitStatus =
  | "receiving_record"
  | "receiving_auto"
  | "awaiting_verification"
  | "not_eligible";

export interface StatusResult {
  schemeCode: string;
  personId: string | null;
  eligible: boolean;
}

export interface StatusEnrollment {
  personId: string;
  schemeCode: string;
  basis: "record" | "auto";
}

/**
 * - covered by a source record: receiving from records
 * - covered by an automatic grant: receiving, started automatically
 * - eligible but not covered: waiting for an officer (manual-verification and discovery schemes)
 * - otherwise: not eligible
 * A family-scope scheme is covered by any enrollment for that scheme in the family; a person-scope
 * scheme only by that person's own enrollment.
 */
export function benefitStatus(
  result: StatusResult, enrollments: readonly StatusEnrollment[], scheme: Pick<SchemeConfig, "scope"> | undefined,
): BenefitStatus {
  const scope = scheme?.scope ?? (result.personId === null ? "family" : "person");
  const covering = enrollments.filter(
    (e) => e.schemeCode === result.schemeCode && (scope === "family" || e.personId === result.personId),
  );
  if (covering.length > 0) return covering.some((e) => e.basis === "record") ? "receiving_record" : "receiving_auto";
  return result.eligible ? "awaiting_verification" : "not_eligible";
}

export type Lang = "en" | "gu";

export const STATUS_LABELS: Record<BenefitStatus, Record<Lang, string>> = {
  receiving_record: { en: "Receiving", gu: "લાભ મળે છે" },
  receiving_auto: { en: "Started automatically", gu: "આપોઆપ શરૂ થયો" },
  awaiting_verification: {
    en: "Eligible, waiting for officer verification",
    gu: "પાત્ર, અધિકારીની ચકાસણીની રાહ",
  },
  not_eligible: { en: "Not eligible", gu: "પાત્ર નથી" },
};

export const isReceiving = (s: BenefitStatus) => s === "receiving_record" || s === "receiving_auto";
