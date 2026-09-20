// Manual family changes made by an officer: a new member, members leaving for a new family, or
// moving into an existing one. Pure: the changes are inputs, re-applied on every run, so they
// survive every rebuild of the derived data.
//
// Runs right after resolve(): families and memberships already exist, and this step reshapes them
// before enrollments and eligibility are derived (so benefits follow the person).
import type {
  Family, FamilyChange, FamilyMember, FamilyRef, IncomeSource, MultiHousehold, NormalizedRecord, Person,
} from "./types";

const pad = (n: number, width = 6) => String(n).padStart(width, "0");
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** IDs of families an officer created. Their own namespace, so they never collide with numbered ones. */
export const manualFamilyId = (eventId: number): string => `GJ-FID-M${pad(eventId)}`;

export interface ChangeInput {
  persons: readonly Person[];
  families: readonly Family[];
  familyMembers: readonly FamilyMember[];
  familyIdByPerson: ReadonlyMap<string, string>;
  personIdByRecord: ReadonlyMap<string, string>;
  records: readonly NormalizedRecord[];
  multiHousehold: readonly MultiHousehold[];
  changes: readonly FamilyChange[];
}

export interface ChangeResult {
  families: Family[];
  /** Current memberships only: one per person */
  familyMembers: FamilyMember[];
  /** Memberships that ended because an officer moved the person, oldest change first */
  memberHistory: FamilyMember[];
  familyIdByPerson: Map<string, string>;
  multiHousehold: MultiHousehold[];
}

export function applyFamilyChanges(input: ChangeInput): ChangeResult {
  const { persons, records, personIdByRecord } = input;
  const families = new Map(
    input.families.map((f) => [f.id, { ...f, incomeSources: [...f.incomeSources], cardRefs: [...f.cardRefs] }]),
  );
  const familyOrder = input.families.map((f) => f.id);
  const current = new Map(input.familyMembers.map((m) => [m.personId, { ...m }]));
  const familyIdByPerson = new Map(input.familyIdByPerson);
  const history: FamilyMember[] = [];

  const personById = new Map(persons.map((p) => [p.id, p]));
  const recordsByPerson = new Map<string, NormalizedRecord[]>();
  for (const r of records) {
    const pid = personIdByRecord.get(r.id);
    if (pid !== undefined) recordsByPerson.set(pid, [...(recordsByPerson.get(pid) ?? []), r]);
  }

  // A ration card names the family that holds it (a merged duplicate card names the kept family).
  const familyOfCard = new Map<string, string>();
  for (const f of input.families) {
    if (f.status === "active") for (const ref of f.cardRefs) familyOfCard.set(ref, f.id);
  }

  const placed = new Set<string>(); // people an officer has placed
  const arrivedIn = new Map<string, string>(); // person -> family they arrived in by a change
  const manualIncome = new Map<string, IncomeSource[]>();
  const touched = new Set<string>();

  const resolveRef = (ref: FamilyRef): string | null => {
    let id: string | null | undefined;
    if ("cardRef" in ref) id = familyOfCard.get(ref.cardRef);
    else if ("recordId" in ref) {
      const pid = personIdByRecord.get(ref.recordId);
      id = pid === undefined ? undefined : familyIdByPerson.get(pid);
    } else id = families.has(ref.manual) ? ref.manual : undefined;
    return id !== undefined && id !== null && families.get(id)?.status === "active" ? id : null;
  };

  const membersOf = (familyId: string): string[] =>
    [...current.values()].filter((m) => m.familyId === familyId).map((m) => m.personId).sort(cmp);

  /** Close the person's current membership (recording history unless silent) and open a new one. */
  const place = (
    personId: string, targetId: string, relation: FamilyMember["relationToHead"], eventId: number,
    date: string | null, silent: boolean,
  ) => {
    const old = current.get(personId);
    if (old) {
      if (!silent) history.push({ ...old, validTo: date, closedByEvent: eventId });
      touched.add(old.familyId);
    }
    current.set(personId, {
      familyId: targetId, personId, relationToHead: relation, validFrom: date, validTo: null,
      openedByEvent: eventId, closedByEvent: null,
    });
    familyIdByPerson.set(personId, targetId);
    placed.add(personId);
    arrivedIn.set(personId, targetId);
    touched.add(targetId);
  };

  for (const change of [...input.changes].sort((a, b) => a.eventId - b.eventId)) {
    if (change.kind === "member_add") {
      const pid = personIdByRecord.get(change.recordId);
      const target = resolveRef(change.to);
      if (pid === undefined || target === null) continue;
      const oldId = familyIdByPerson.get(pid);
      if (oldId === target) continue;
      // The placeholder family a lone new person starts in was never a real membership.
      const oldFamily = oldId === undefined ? undefined : families.get(oldId);
      const silent = oldFamily !== undefined && !oldFamily.isAnchored && membersOf(oldId ?? "").length === 1;
      place(pid, target, change.relation, change.eventId, change.effectiveDate, silent);
      continue;
    }

    // family_move
    const movers = [
      ...new Map(
        change.members
          .flatMap((m) => {
            const pid = personIdByRecord.get(m.recordId);
            return pid !== undefined && current.has(pid) ? [[pid, m.relation] as const] : [];
          }),
      ),
    ];
    if (movers.length === 0) continue;

    let targetId: string | null;
    let headPersonId: string | null = null;
    if (change.to.kind === "existing") {
      targetId = resolveRef(change.to.family);
      if (targetId === null) continue;
    } else {
      headPersonId = personIdByRecord.get(change.to.headRecordId) ?? null;
      if (headPersonId === null || !movers.some(([pid]) => pid === headPersonId)) continue;
      targetId = manualFamilyId(change.eventId);
      if (families.has(targetId)) continue;
      const incomeSources: IncomeSource[] = [
        { recordId: `EVT-${pad(change.eventId)}`, source: "officer_entry", value: change.to.income },
      ];
      families.set(targetId, {
        id: targetId,
        headPersonId,
        district: change.to.district,
        taluka: change.to.taluka,
        village: change.to.village,
        resolvedIncome: change.to.income,
        incomeSources,
        isAnchored: false,
        status: "active",
        mergedInto: null,
        parentFamilyId: familyIdByPerson.get(headPersonId) ?? null,
        cardRefs: [],
      });
      familyOrder.push(targetId);
      manualIncome.set(targetId, incomeSources);
    }

    for (const [pid, relation] of movers) {
      if (familyIdByPerson.get(pid) === targetId) continue;
      place(pid, targetId, pid === headPersonId ? "head" : relation, change.eventId, change.effectiveDate, false);
    }
  }

  // Tidy every family a change touched: closed if empty, a head if the head left, own income.
  const incomeOf = (personIds: readonly string[]): IncomeSource[] =>
    personIds
      .flatMap((pid) => recordsByPerson.get(pid) ?? [])
      .filter((r): r is NormalizedRecord & { incomeDeclared: number } => r.incomeDeclared !== null)
      .map((r) => ({ recordId: r.id, source: r.source, value: r.incomeDeclared }))
      .sort((a, b) => cmp(a.recordId, b.recordId));

  for (const id of familyOrder) {
    const family = families.get(id);
    if (!family || !touched.has(id)) continue;
    const members = membersOf(id);
    if (members.length === 0) {
      Object.assign(family, { status: "closed" as const, headPersonId: null, incomeSources: [], resolvedIncome: null });
      continue;
    }
    if (family.headPersonId === null || !members.includes(family.headPersonId)) {
      // Same fallback as family building: the eldest remaining member leads.
      const eldest = [...members].sort(
        (a, b) => (personById.get(a)?.dob ?? "9999").localeCompare(personById.get(b)?.dob ?? "9999") || cmp(a, b),
      )[0];
      family.headPersonId = eldest;
      const row = current.get(eldest);
      if (row) row.relationToHead = "head";
    }
    // A person who arrived by a change brings no income: their old records describe another household.
    const own = manualIncome.get(id) ?? incomeOf(members.filter((pid) => arrivedIn.get(pid) !== id));
    family.incomeSources = own;
    family.resolvedIncome = own.length === 0 ? null : Math.max(...own.map((s) => s.value));
  }

  return {
    families: familyOrder.flatMap((id) => families.get(id) ?? []),
    familyMembers: [...current.values()].sort((a, b) => cmp(a.familyId, b.familyId) || cmp(a.personId, b.personId)),
    memberHistory: history,
    familyIdByPerson,
    // An officer has settled where these people belong, so the "on two cards" flag no longer applies.
    multiHousehold: input.multiHousehold.filter((m) => !placed.has(m.personId)),
  };
}
