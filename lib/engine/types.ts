// Shared engine types. The engine is pure: no database, network, framework or clock.
// Source rows arrive as `SourceRecord` (the shape of the `source_records` table, without the
// ground-truth column: the engine never sees `true_person_id`).

export type Gender = "M" | "F";
export type Relation =
  | "head" | "spouse" | "son" | "daughter" | "son_in_law" | "daughter_in_law"
  | "grandson" | "granddaughter" | "father" | "mother" | "other";
export type Marital = "married" | "unmarried" | "widowed";
export type SourceName = "ration" | "pension" | "scholarship" | "death_registry";
export type SchemeCode = "OLD_AGE_PENSION" | "WIDOW_ASSIST" | "SCHOLARSHIP";

export interface SourceRecord {
  id: string;
  source: SourceName;
  source_ref: string;
  household_ref: string | null;
  full_name: string;
  guardian_name: string | null;
  dob: string | null;
  gender: Gender | null;
  relation_to_head: Relation | null;
  marital_status: Marital | null;
  uid_hash: string | null;
  uid_last4: string | null;
  district: string;
  taluka: string;
  village: string;
  address: string;
  income_declared: number | null;
  scheme_code: SchemeCode | null;
  benefit_amount: number | null;
  is_student: boolean | null;
  date_of_death: string | null;
}

// ---- normalization -----------------------------------------------------------------------

export interface NormalizedName {
  first: string | null;
  /** Father's or husband's name. A single letter means an initial. */
  middle: string | null;
  last: string | null;
  middleIsInitial: boolean;
  /** Name carried a `late`, `swargiya` or `sw.` marker (removed from the parts). */
  lateMarker: boolean;
}

export interface PhoneticName {
  first: string | null;
  middle: string | null;
  last: string | null;
}

export interface ParsedDob {
  year: number;
  month: number | null;
  day: number | null;
  /** True when derived from an age string, so the real year may be one off. */
  approximate: boolean;
}

export interface NormalizedRecord {
  id: string;
  source: SourceName;
  householdRef: string | null;
  name: NormalizedName;
  phonetic: PhoneticName;
  /** Guardian's first name, honorifics stripped (scholarship records). */
  guardianFirst: string | null;
  dob: ParsedDob | null;
  gender: Gender | null;
  relation: Relation | null;
  marital: Marital | null;
  uidHash: string | null;
  uidLast4: string | null;
  district: string;
  taluka: string;
  village: string;
  villageKey: string;
  talukaKey: string;
  houseNo: string | null;
  incomeDeclared: number | null;
  schemeCode: SchemeCode | null;
  benefitAmount: number | null;
  isStudent: boolean | null;
  /** ISO yyyy-mm-dd when parseable */
  dateOfDeath: string | null;
  raw: SourceRecord;
}

// ---- matching ----------------------------------------------------------------------------

export interface ScoreBreakdown {
  name: number | null;
  dob: number | null;
  address: number | null;
  /** 1 when both uid hashes are present and equal, 0 when both present and different */
  uid: 0 | 1 | null;
  nameParts: { first: number | null; middle: number | null; last: number | null };
  /** Weighted score before hard rules */
  weighted: number;
  /** Hard rules and guards that changed the outcome, in the order applied */
  rules: string[];
}

export type MatchDecision = "auto_merge" | "review" | "distinct";
export type ReviewStatus = "pending" | "approved" | "rejected";

export interface MatchCandidate {
  /** '<smaller record id>|<larger record id>' */
  pairKey: string;
  recordAId: string;
  recordBId: string;
  score: number;
  breakdown: ScoreBreakdown;
  decision: MatchDecision;
  reviewStatus: ReviewStatus | null;
}

export interface ReviewDecision {
  pairKey: string;
  decision: "approved" | "rejected";
}

// ---- resolution --------------------------------------------------------------------------

export interface FamilyEvent {
  type: "death" | "marital_status_change";
  subjectRecordId: string;
  date: string | null;
  newMaritalStatus: Marital | null;
}

export interface Person {
  id: string;
  anchorRecordId: string;
  canonicalName: string;
  /** yyyy-mm-dd when a full date is known, otherwise the year as yyyy */
  dob: string | null;
  gender: Gender | null;
  uidLast4: string | null;
  maritalStatus: Marital | null;
  isDeceased: boolean;
  deceasedOn: string | null;
  recordIds: string[];
}

export interface IncomeSource {
  recordId: string;
  source: SourceName;
  value: number;
}

export interface Family {
  id: string;
  headPersonId: string | null;
  district: string;
  taluka: string;
  village: string;
  resolvedIncome: number | null;
  incomeSources: IncomeSource[];
  isAnchored: boolean;
  status: "active" | "merged";
  mergedInto: string | null;
  parentFamilyId: string | null;
  /** Ration cards this family was built from (empty when unanchored) */
  cardRefs: string[];
}

export interface FamilyMember {
  familyId: string;
  personId: string;
  relationToHead: Relation | null;
  validFrom: string | null;
  validTo: string | null;
}

/** A ration card folded into another because they list mostly the same people. */
export interface CardMerge {
  keptRef: string;
  mergedRef: string;
  keptFamilyId: string;
  mergedFamilyId: string;
  sharedPersons: number;
  ratio: number;
}

/** A person listed on two ration cards that were not merged. */
export interface MultiHousehold {
  personId: string;
  keptFamilyId: string;
  keptCardRef: string;
  otherCardRefs: string[];
  otherFamilyIds: string[];
}

export interface ResolveResult {
  persons: Person[];
  personIdByRecord: Map<string, string>;
  familyIdByPerson: Map<string, string>;
  /** Input candidates, with the chaining guard applied and any guard-created pairs added */
  candidates: MatchCandidate[];
  families: Family[];
  familyMembers: FamilyMember[];
  cardMerges: CardMerge[];
  multiHousehold: MultiHousehold[];
}

// ---- enrollments, anomalies, eligibility --------------------------------------------------

export type JsonValue =
  | string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * A benefit a person or family receives. `record` enrollments come from a source record (a pension
 * or scholarship file, a ration card). `auto` benefits have no record: the rules found the person
 * eligible for a scheme that needs no manual verification, so the benefit starts by itself.
 */
export type Enrollment =
  | {
      basis: "record";
      personId: string;
      familyId: string;
      schemeCode: string;
      sourceRecordId: string;
      monthlyAmount: number | null;
    }
  | {
      basis: "auto";
      personId: string;
      familyId: string;
      schemeCode: string;
      sourceRecordId: null;
      monthlyAmount: number | null;
    };

export type RecordEnrollment = Extract<Enrollment, { basis: "record" }>;

export type AnomalyType =
  | "deceased_beneficiary" | "duplicate_enrollment" | "multi_household"
  | "income_mismatch" | "unanchored_beneficiary";
export type Severity = "high" | "medium" | "low";

export interface AnomalyFlag {
  id: string;
  type: AnomalyType;
  severity: Severity;
  familyId: string | null;
  personId: string | null;
  /** Source record ids and the values that triggered the flag */
  evidence: { [key: string]: JsonValue };
  estMonthlyLeakage: number | null;
  status: "open";
}

export type Operator =
  | "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "on_or_after" | "on_or_before";
export type ConditionValue = string | number | boolean | readonly (string | number)[];

export interface Condition {
  field: string;
  op: Operator;
  value: ConditionValue;
}
export type Rule = Condition | { all: readonly Rule[] } | { any: readonly Rule[] };

export type EnrollmentSource = "ration_card" | "pension_record" | "scholarship_record" | "none";

export interface SchemeConfig {
  code: string;
  name: string;
  nameGu: string;
  scope: "person" | "family";
  enrollment: EnrollmentSource;
  /** True: an officer must verify before the benefit starts. False: it starts automatically. */
  manualVerificationRequired: boolean;
  /** Demo monthly benefit in rupees, or null when the scheme pays no cash amount. */
  monthlyBenefit: number | null;
  rule: Rule;
}

export interface SchemesConfig {
  version: string;
  notice: string;
  schemes: readonly SchemeConfig[];
}

/** One evaluated condition: what was checked, the value found, and whether it passed. */
export interface Reason {
  rule: string;
  actual: string | number | boolean | null;
  passed: boolean;
}

export interface EligibilityResult {
  familyId: string;
  /** null for family-scope schemes */
  personId: string | null;
  schemeCode: string;
  eligible: boolean;
  reasons: Reason[];
  rulesVersion: string;
}

export interface GapAnalysis {
  eligibleNotEnrolled: { familyId: string; personId: string | null; schemeCode: string }[];
  enrolledNotEligible: {
    familyId: string; personId: string; schemeCode: string;
    sourceRecordId: string; monthlyAmount: number | null;
  }[];
}
