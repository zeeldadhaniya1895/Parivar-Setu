// Grievance rules that need no database: what a valid question looks like, and its shape.
import type { BenefitStatus } from "./benefit-status";
import type { Reason, SchemesConfig } from "./engine/types";

export const MESSAGE_MIN = 5;
export const MESSAGE_MAX = 500;
export const ANSWER_MIN = 2;
export const ANSWER_MAX = 1000;

/** What the system said about the scheme when the citizen asked, so an officer sees the same view. */
export interface EligibilitySnapshot {
  status: BenefitStatus;
  eligible: boolean;
  rulesVersion: string;
  reasons: Reason[];
}

export interface GrievanceRow {
  id: number;
  family_id: string;
  person_id: string | null;
  scheme_code: string;
  message: string;
  eligibility_snapshot: EligibilitySnapshot | null;
  status: "pending" | "resolved";
  officer_response: string | null;
  answered_by: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface GrievanceInput {
  familyId: string;
  personId: string | null;
  schemeCode: string;
  message: string;
}

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const text = (v: unknown): string | null => (typeof v === "string" ? v.trim() : null);

/** Strip control characters (keep newlines) so a message cannot smuggle odd bytes into the audit log. */
const clean = (s: string) => s.replace(/[^\S\r\n]+/g, " ").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

export function validateGrievanceInput(raw: Record<string, unknown>, config: SchemesConfig): Validation<GrievanceInput> {
  const familyId = text(raw.familyId);
  const schemeCode = text(raw.schemeCode);
  const message = text(raw.message);
  const personRaw = raw.personId === undefined || raw.personId === null ? null : text(raw.personId);

  if (!familyId) return { ok: false, error: "familyId is required" };
  if (!schemeCode) return { ok: false, error: "schemeCode is required" };
  const scheme = config.schemes.find((s) => s.code === schemeCode);
  if (!scheme) return { ok: false, error: `Unknown scheme ${schemeCode}` };

  if (scheme.scope === "person" && !personRaw) return { ok: false, error: "personId is required for this scheme" };
  if (scheme.scope === "family" && personRaw) return { ok: false, error: "This scheme is for the whole family; leave personId empty" };

  if (message === null) return { ok: false, error: "message is required" };
  const cleaned = clean(message);
  if (cleaned.length < MESSAGE_MIN) return { ok: false, error: `Please write at least ${MESSAGE_MIN} characters` };
  if (cleaned.length > MESSAGE_MAX) return { ok: false, error: `Please keep the message under ${MESSAGE_MAX} characters` };

  return { ok: true, value: { familyId, personId: personRaw || null, schemeCode, message: cleaned } };
}

export function validateAnswer(raw: unknown): Validation<string> {
  const answer = text(raw);
  if (answer === null || answer === "") return { ok: false, error: "An answer is required" };
  const cleaned = clean(answer);
  if (cleaned.length < ANSWER_MIN) return { ok: false, error: `Please write at least ${ANSWER_MIN} characters` };
  if (cleaned.length > ANSWER_MAX) return { ok: false, error: `Please keep the answer under ${ANSWER_MAX} characters` };
  return { ok: true, value: cleaned };
}
