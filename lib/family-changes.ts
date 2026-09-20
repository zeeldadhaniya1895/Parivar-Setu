// Rules for an officer's family changes, with no database: what a valid request looks like, and how
// a stored event becomes an engine input. The routes gather the facts (who is in which family) and
// hand them in, so every rule here can be tested directly.
import type { FamilyChange, FamilyRef, Gender, Marital, Relation } from "./engine/types";
import type { Validation } from "./grievances";

export const REASONS_ADD = ["birth", "marriage", "other"] as const;
export const REASONS_MOVE = ["marriage", "separation", "other"] as const;
export type AddReason = (typeof REASONS_ADD)[number];
export type MoveReason = (typeof REASONS_MOVE)[number];

export const RELATIONS: readonly Relation[] = [
  "head", "spouse", "son", "daughter", "son_in_law", "daughter_in_law", "grandson", "granddaughter",
  "father", "mother", "other",
];
const MARITAL: readonly Marital[] = ["married", "unmarried", "widowed"];

export const DOCUMENT_MIN = 3;
export const DOCUMENT_MAX = 60;
export const NOTE_MAX = 300;
export const MAX_INCOME = 10_000_000;

// ---- what the routes tell the validators about a family ----------------------------------

export interface FamilyContext {
  id: string;
  status: "active" | "merged" | "closed";
  district: string;
  taluka: string;
  village: string;
  headPersonId: string | null;
  members: { personId: string; anchorRecordId: string; isDeceased: boolean; dob: string | null }[];
}

/**
 * How an event names a family so it still works after a rebuild. A Family ID built by numbering can
 * move, so a family is named by its head's source record; families an officer created have a
 * stable ID of their own.
 */
export function familyRefOf(family: FamilyContext): FamilyRef | null {
  if (family.id.startsWith("GJ-FID-M")) return { manual: family.id };
  const head = family.members.find((m) => m.personId === family.headPersonId) ?? family.members[0];
  return head ? { recordId: head.anchorRecordId } : null;
}

// ---- small checks ------------------------------------------------------------------------

const text = (v: unknown): string | null => (typeof v === "string" ? v.trim().replace(/\s+/g, " ") : null);
const has = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** A real calendar date, yyyy-mm-dd, from 1900 to `asOf` (no future dates). */
export function validDate(value: unknown, asOf: string): string | null {
  const s = text(value);
  const m = s === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m || s === null) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  return y >= 1900 && s <= asOf ? s : null;
}

const ageOn = (dob: string, asOf: string): number => {
  const age = Number(asOf.slice(0, 4)) - Number(dob.slice(0, 4));
  if (dob.length === 4) return age; // year only: the most they can be
  return asOf.slice(5) >= dob.slice(5) ? age : age - 1;
};

/** Legal age for marriage and for heading a household. */
export const ADULT_AGE = 18;

function documentRef(v: unknown): Validation<string> {
  const s = text(v);
  if (s === null || s === "") return { ok: false, error: "A supporting document reference is required" };
  if (s.length < DOCUMENT_MIN || s.length > DOCUMENT_MAX) {
    return { ok: false, error: `The document reference must be ${DOCUMENT_MIN} to ${DOCUMENT_MAX} characters` };
  }
  if (!/^[\p{L}\p{N}\-/. ]+$/u.test(s)) {
    return { ok: false, error: "The document reference may only contain letters, numbers, spaces and - / ." };
  }
  return { ok: true, value: s };
}

function note(v: unknown): Validation<string | null> {
  if (v === undefined || v === null || v === "") return { ok: true, value: null };
  const s = text(v);
  if (s === null) return { ok: false, error: "The note must be text" };
  return s.length > NOTE_MAX ? { ok: false, error: `Keep the note under ${NOTE_MAX} characters` } : { ok: true, value: s || null };
}

// ---- add a member ------------------------------------------------------------------------

export interface AddMemberCommand {
  familyId: string;
  person: {
    fullName: string; dob: string; gender: Gender; relation: Relation; marital: Marital; isStudent: boolean;
  };
  reason: AddReason;
  documentRef: string;
  note: string | null;
}

export function validateAddMember(
  raw: Record<string, unknown>, family: FamilyContext | null, asOf: string,
): Validation<AddMemberCommand> {
  if (family === null) return { ok: false, error: "Family not found" };
  if (family.status !== "active") return { ok: false, error: "That family is not active" };

  const fullName = text(raw.name);
  if (fullName === null || fullName.length < 3 || fullName.length > 80 || !/^[\p{L}][\p{L} .'-]*$/u.test(fullName)) {
    return { ok: false, error: "Enter the member's full name (letters only, at least first name and surname)" };
  }
  if (fullName.split(" ").length < 2) return { ok: false, error: "Enter the first name and the surname" };

  const dob = validDate(raw.dob, asOf);
  if (dob === null) return { ok: false, error: "Enter a valid date of birth that is not in the future" };
  if (!has(["M", "F"] as const, raw.gender)) return { ok: false, error: "Choose the gender" };
  if (!has(RELATIONS, raw.relation) || raw.relation === "head") return { ok: false, error: "Choose the relation to the head of the family" };
  if (!has(MARITAL, raw.maritalStatus)) return { ok: false, error: "Choose the marital status" };
  if (raw.maritalStatus !== "unmarried" && ageOn(dob, asOf) < 18) {
    return { ok: false, error: "A member under 18 must be recorded as unmarried" };
  }
  if (!has(REASONS_ADD, raw.reason)) return { ok: false, error: "Choose the reason for adding this member" };

  const doc = documentRef(raw.documentRef);
  if (!doc.ok) return doc;
  const n = note(raw.note);
  if (!n.ok) return n;

  return {
    ok: true,
    value: {
      familyId: family.id,
      person: {
        fullName, dob, gender: raw.gender, relation: raw.relation, marital: raw.maritalStatus,
        isStudent: raw.isStudent === true,
      },
      reason: raw.reason, documentRef: doc.value, note: n.value,
    },
  };
}

// ---- separate or move members ------------------------------------------------------------

export type MoveDestination =
  | { kind: "new"; headPersonId: string; district: string; taluka: string; village: string; income: number }
  | { kind: "existing"; family: FamilyContext };

export interface MoveCommand {
  sourceFamilyId: string;
  movers: { personId: string; anchorRecordId: string; relation: Relation }[];
  destination: MoveDestination;
  reason: MoveReason;
  effectiveDate: string;
  documentRef: string;
  note: string | null;
  /** Record a marriage on the (single) person who moves */
  markMarried: boolean;
}

export function validateMove(
  raw: Record<string, unknown>, source: FamilyContext | null, target: FamilyContext | null, asOf: string,
): Validation<MoveCommand> {
  if (source === null) return { ok: false, error: "Family not found" };
  if (source.status !== "active") return { ok: false, error: "That family is not active" };
  if (raw.confirmVerified !== true) return { ok: false, error: "Confirm that you have verified the document" };

  const ids = Array.isArray(raw.memberPersonIds) ? raw.memberPersonIds.filter((v): v is string => typeof v === "string") : [];
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { ok: false, error: "Choose at least one member to move" };
  const current = new Map(source.members.map((m) => [m.personId, m]));
  for (const id of unique) {
    const member = current.get(id);
    if (!member) return { ok: false, error: "One of the chosen people is not a current member of this family" };
    if (member.isDeceased) return { ok: false, error: "A deceased person cannot be moved" };
  }
  if (unique.length >= source.members.length) {
    return { ok: false, error: "At least one member must stay in the old family" };
  }

  if (!has(REASONS_MOVE, raw.reason)) return { ok: false, error: "Choose the reason for this change" };
  if (raw.reason === "marriage") {
    const minor = unique.some((id) => {
      const dob = current.get(id)?.dob;
      return dob !== null && dob !== undefined && ageOn(dob, asOf) < ADULT_AGE;
    });
    if (minor) return { ok: false, error: `A marriage cannot be recorded for someone under ${ADULT_AGE}` };
  }
  const effectiveDate = validDate(raw.effectiveDate, asOf);
  if (effectiveDate === null) return { ok: false, error: "Enter a valid effective date that is not in the future" };
  const doc = documentRef(raw.documentRef);
  if (!doc.ok) return doc;
  const n = note(raw.note);
  if (!n.ok) return n;

  const dest = typeof raw.destination === "object" && raw.destination !== null ? (raw.destination as Record<string, unknown>) : null;
  if (dest === null) return { ok: false, error: "Choose where the members are going" };
  const relationsRaw = typeof dest.relations === "object" && dest.relations !== null ? (dest.relations as Record<string, unknown>) : {};

  let destination: MoveDestination;
  let headId: string | null = null;
  if (dest.kind === "new") {
    headId = typeof dest.headPersonId === "string" ? dest.headPersonId : null;
    if (headId === null || !unique.includes(headId)) return { ok: false, error: "Choose the head of the new family from the people moving" };
    const headDob = current.get(headId)?.dob;
    if (headDob !== null && headDob !== undefined && ageOn(headDob, asOf) < ADULT_AGE) {
      return { ok: false, error: `The head of a new family must be at least ${ADULT_AGE}` };
    }
    const [village, taluka, district] = [text(dest.village), text(dest.taluka), text(dest.district)];
    for (const [label, value] of [["village", village], ["taluka", taluka], ["district", district]] as const) {
      if (value === null || value.length < 2 || value.length > 60) return { ok: false, error: `Enter the ${label} of the new family` };
    }
    const income = dest.income;
    if (typeof income !== "number" || !Number.isInteger(income) || income < 0 || income > MAX_INCOME) {
      return { ok: false, error: "Enter the new family's annual income in whole rupees" };
    }
    destination = {
      kind: "new", headPersonId: headId, village: village ?? "", taluka: taluka ?? "", district: district ?? "", income,
    };
  } else if (dest.kind === "existing") {
    if (target === null) return { ok: false, error: "The family you are moving them into was not found" };
    if (target.status !== "active") return { ok: false, error: "The family you are moving them into is not active" };
    if (target.id === source.id) return { ok: false, error: "Choose a different family to move them into" };
    destination = { kind: "existing", family: target };
  } else {
    return { ok: false, error: "Choose whether this is a new family or an existing one" };
  }

  const movers: MoveCommand["movers"] = [];
  for (const id of unique) {
    const member = current.get(id);
    if (!member) continue;
    if (id === headId) {
      movers.push({ personId: id, anchorRecordId: member.anchorRecordId, relation: "head" });
      continue;
    }
    const relation = relationsRaw[id];
    if (!has(RELATIONS, relation) || relation === "head") {
      return { ok: false, error: "Choose each moving member's relation to the head of their new family" };
    }
    movers.push({ personId: id, anchorRecordId: member.anchorRecordId, relation });
  }

  return {
    ok: true,
    value: {
      sourceFamilyId: source.id, movers, destination, reason: raw.reason, effectiveDate,
      documentRef: doc.value, note: n.value, markMarried: raw.reason === "marriage" && raw.markMarried !== false && movers.length === 1,
    },
  };
}

// ---- stored event -> engine input --------------------------------------------------------

export interface StoredFamilyEvent {
  id: number;
  type: string;
  subject_record_id: string;
  payload: unknown;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

function parseRef(v: unknown): FamilyRef | null {
  const o = obj(v);
  if (!o) return null;
  if (typeof o.cardRef === "string") return { cardRef: o.cardRef };
  if (typeof o.recordId === "string") return { recordId: o.recordId };
  if (typeof o.manual === "string") return { manual: o.manual };
  return null;
}

/** Turn a stored `member_add` or `family_move` event into an engine input. Malformed rows are skipped. */
export function parseFamilyChange(row: StoredFamilyEvent): FamilyChange | null {
  const p = obj(row.payload);
  if (!p) return null;

  if (row.type === "member_add") {
    const to = parseRef(p.to);
    if (!to || !has(RELATIONS, p.relation)) return null;
    return {
      kind: "member_add", eventId: row.id, recordId: row.subject_record_id, to, relation: p.relation,
      effectiveDate: typeof p.effectiveDate === "string" ? p.effectiveDate : null,
    };
  }

  if (row.type === "family_move") {
    const members = Array.isArray(p.members)
      ? p.members.flatMap((m) => {
          const o = obj(m);
          return o && typeof o.recordId === "string" && has(RELATIONS, o.relation) ? [{ recordId: o.recordId, relation: o.relation }] : [];
        })
      : [];
    const to = obj(p.to);
    if (!to || members.length === 0 || typeof p.effectiveDate !== "string") return null;
    if (to.kind === "existing") {
      const family = parseRef(to.family);
      return family ? { kind: "family_move", eventId: row.id, effectiveDate: p.effectiveDate, members, to: { kind: "existing", family } } : null;
    }
    if (
      to.kind === "new" && typeof to.headRecordId === "string" && typeof to.village === "string" &&
      typeof to.taluka === "string" && typeof to.district === "string" && typeof to.income === "number"
    ) {
      return {
        kind: "family_move", eventId: row.id, effectiveDate: p.effectiveDate, members,
        to: { kind: "new", headRecordId: to.headRecordId, district: to.district, taluka: to.taluka, village: to.village, income: to.income },
      };
    }
  }
  return null;
}
