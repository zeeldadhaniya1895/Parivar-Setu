// Clustering and families (DESIGN.md 7.4). Pure: same inputs give the same persons, families and IDs.
//
// Not included here: the P10 relationship-attaching rule (7.4 rule 5) and family events (P8).
import { formatDob } from "./normalize";
import { isMatch, toCandidate } from "./match";
import type {
  CardMerge, Family, FamilyMember, IncomeSource, MatchCandidate, MultiHousehold, NormalizedRecord,
  ParsedDob, Person, ResolveResult, SourceName,
} from "./types";

const MAX_DOB_YEAR_GAP = 5;
const CARD_MERGE_RATIO = 0.5;
const SOURCE_PRIORITY: Record<SourceName, number> = {
  ration: 0, pension: 1, scholarship: 2, death_registry: 3, officer_entry: 4,
};

const pad = (n: number, width = 6) => String(n).padStart(width, "0");
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Union-find whose root is always the smallest index in the set, so results are deterministic. */
class UnionFind {
  private parent: number[];
  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }
  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[x] !== root) {
      const next = this.parent[x];
      this.parent[x] = root;
      x = next;
    }
    return root;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (ra < rb) this.parent[rb] = ra;
    else this.parent[ra] = rb;
  }
}

/** Records that cannot be the same person: different uid, different gender, or DOBs over 5 years apart. */
function contradicts(a: NormalizedRecord, b: NormalizedRecord): boolean {
  if (a.uidHash !== null && b.uidHash !== null && a.uidHash !== b.uidHash) return true;
  if (a.gender !== null && b.gender !== null && a.gender !== b.gender) return true;
  return a.dob !== null && b.dob !== null && Math.abs(a.dob.year - b.dob.year) > MAX_DOB_YEAR_GAP;
}

function mostCommon<T>(items: readonly T[], key: (t: T) => string): T | null {
  if (items.length === 0) return null;
  const counts = new Map<string, { item: T; n: number }>();
  for (const item of items) {
    const k = key(item);
    const entry = counts.get(k);
    if (entry) entry.n++;
    else counts.set(k, { item, n: 1 });
  }
  let best: { item: T; n: number; k: string } | null = null;
  for (const [k, v] of counts) {
    if (best === null || v.n > best.n || (v.n === best.n && k < best.k)) best = { ...v, k };
  }
  return best === null ? null : best.item;
}

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

// ---- survivorship ------------------------------------------------------------------------

function survivingDob(members: readonly NormalizedRecord[]): ParsedDob | null {
  const withDob = members.filter((r): r is NormalizedRecord & { dob: ParsedDob } => r.dob !== null);
  const rank = (r: NormalizedRecord & { dob: ParsedDob }) =>
    r.dob.month !== null && r.dob.day !== null ? 0 : r.dob.approximate ? 2 : 1;
  const bestRank = Math.min(...withDob.map(rank), 3);
  if (bestRank === 3) return null;

  // Prefer a full date; among candidates take the most common value, then the best source.
  const pool = withDob.filter((r) => rank(r) === bestRank);
  const ordered = [...pool].sort(
    (a, b) => SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source] || cmp(a.id, b.id),
  );
  return mostCommon(ordered, (r) => formatDob(r.dob))?.dob ?? null;
}

function buildPerson(id: string, members: readonly NormalizedRecord[]): Person {
  const rationRecords = members.filter((r) => r.source === "ration");
  const nameLength = (r: NormalizedRecord) =>
    [r.name.first, r.name.middle, r.name.last].filter(Boolean).join(" ").length;
  const nameSource =
    rationRecords[0] ??
    [...members].sort((a, b) => nameLength(b) - nameLength(a) || cmp(a.id, b.id))[0];
  const canonicalName = titleCase(
    [nameSource.name.first, nameSource.name.middle, nameSource.name.last].filter(Boolean).join(" "),
  );

  const dob = survivingDob(members);
  const gender = mostCommon(members.filter((r) => r.gender !== null), (r) => r.gender ?? "")?.gender ?? null;
  const marital =
    rationRecords.find((r) => r.marital !== null)?.marital ??
    members.find((r) => r.marital !== null)?.marital ?? null;
  const deathRecord = members.find((r) => r.source === "death_registry");

  return {
    id,
    anchorRecordId: members[0].id,
    canonicalName,
    dob: dob === null ? null : formatDob(dob),
    gender,
    uidLast4: members.find((r) => r.uidLast4 !== null)?.uidLast4 ?? null,
    maritalStatus: marital,
    isDeceased: deathRecord !== undefined,
    deceasedOn: deathRecord?.dateOfDeath ?? null,
    recordIds: members.map((r) => r.id),
  };
}

// ---- resolve -----------------------------------------------------------------------------

interface Card {
  ref: string;
  personIds: Set<string>;
  records: NormalizedRecord[];
}

export function resolve(
  input: readonly NormalizedRecord[], inputCandidates: readonly MatchCandidate[],
): ResolveResult {
  const records = [...input].sort((a, b) => cmp(a.id, b.id));
  const indexById = new Map(records.map((r, i) => [r.id, i]));
  const candidateByKey = new Map(inputCandidates.map((c) => [c.pairKey, c]));

  // 1. Group records by matched pairs.
  const matched = new UnionFind(records.length);
  for (const c of inputCandidates) {
    const i = indexById.get(c.recordAId);
    const j = indexById.get(c.recordBId);
    if (i !== undefined && j !== undefined && isMatch(c)) matched.union(i, j);
  }
  const groups = new Map<number, number[]>();
  records.forEach((_, i) => {
    const root = matched.find(i);
    const list = groups.get(root);
    if (list) list.push(i);
    else groups.set(root, [i]);
  });

  // 2. Chaining guard: a cluster that contradicts itself is not merged. It splits back into its
  //    records and every pair inside goes to review. Officer decisions survive: approved pairs stay
  //    merged, rejected pairs stay distinct.
  const final = new UnionFind(records.length);
  for (const members of groups.values()) {
    let bad = false;
    for (let x = 0; x < members.length && !bad; x++) {
      for (let y = x + 1; y < members.length && !bad; y++) {
        bad = contradicts(records[members[x]], records[members[y]]);
      }
    }
    if (!bad) {
      for (const m of members) final.union(members[0], m);
      continue;
    }
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const a = records[members[x]];
        const b = records[members[y]];
        const key = toCandidate(a, b, undefined).pairKey;
        const existing = candidateByKey.get(key) ?? toCandidate(a, b, undefined);
        if (existing.reviewStatus === "approved") {
          final.union(members[x], members[y]);
        } else if (existing.reviewStatus !== "rejected") {
          candidateByKey.set(key, {
            ...existing,
            decision: "review",
            reviewStatus: "pending",
            breakdown: {
              ...existing.breakdown,
              rules: [...existing.breakdown.rules, "chaining_guard: cluster contradicts itself, sent to review"],
            },
          });
        }
      }
    }
  }

  // 3. Persons, numbered in order of anchor record id.
  const clusters = new Map<number, NormalizedRecord[]>();
  records.forEach((r, i) => {
    const root = final.find(i);
    const list = clusters.get(root);
    if (list) list.push(r);
    else clusters.set(root, [r]);
  });
  const persons: Person[] = [];
  const personIdByRecord = new Map<string, string>();
  const recordsByPerson = new Map<string, NormalizedRecord[]>();
  [...clusters.keys()].sort((a, b) => a - b).forEach((root, n) => {
    const members = clusters.get(root) ?? [];
    const id = `P-${pad(n + 1)}`;
    persons.push(buildPerson(id, members));
    recordsByPerson.set(id, members);
    for (const m of members) personIdByRecord.set(m.id, id);
  });
  const personOf = (recordId: string): string => {
    const id = personIdByRecord.get(recordId);
    if (id === undefined) throw new Error(`No person for record ${recordId}`);
    return id;
  };

  // 4. Ration cards are candidate families.
  const cards = new Map<string, Card>();
  for (const r of records) {
    if (r.source !== "ration" || r.householdRef === null) continue;
    const card = cards.get(r.householdRef) ?? { ref: r.householdRef, personIds: new Set<string>(), records: [] };
    card.personIds.add(personOf(r.id));
    card.records.push(r);
    cards.set(r.householdRef, card);
  }
  const refs = [...cards.keys()].sort(cmp);
  const refIndex = new Map(refs.map((ref, i) => [ref, i]));
  const familyIdOfRef = new Map(refs.map((ref, i) => [ref, `GJ-FID-${pad(i + 1)}`]));

  // Two cards are the same family when shared persons / size of the smaller card >= 0.5.
  const cardsOfPerson = new Map<string, string[]>();
  for (const ref of refs) {
    for (const pid of cards.get(ref)?.personIds ?? []) {
      cardsOfPerson.set(pid, [...(cardsOfPerson.get(pid) ?? []), ref]);
    }
  }
  const sharedCount = new Map<string, number>();
  for (const list of cardsOfPerson.values()) {
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const key = `${list[x]}|${list[y]}`;
        sharedCount.set(key, (sharedCount.get(key) ?? 0) + 1);
      }
    }
  }
  const cardUf = new UnionFind(refs.length);
  const size = (ref: string) => cards.get(ref)?.personIds.size ?? 0;
  for (const [key, shared] of sharedCount) {
    const [a, b] = key.split("|");
    if (shared / Math.min(size(a), size(b)) >= CARD_MERGE_RATIO) {
      cardUf.union(refIndex.get(a) ?? 0, refIndex.get(b) ?? 0);
    }
  }
  const cardGroups = new Map<number, string[]>();
  refs.forEach((ref, i) => {
    const root = cardUf.find(i);
    cardGroups.set(root, [...(cardGroups.get(root) ?? []), ref]);
  });

  // Keep the card with more members (tie: smaller ref); merge the others into it.
  const keptRefOf = new Map<string, string>();
  const groupRefs = new Map<string, string[]>(); // kept ref -> all refs in the group
  const cardMerges: CardMerge[] = [];
  for (const group of cardGroups.values()) {
    const kept = [...group].sort((a, b) => size(b) - size(a) || cmp(a, b))[0];
    groupRefs.set(kept, group);
    for (const ref of group) keptRefOf.set(ref, kept);
    for (const ref of group.filter((g) => g !== kept)) {
      const keptPersons = cards.get(kept)?.personIds ?? new Set<string>();
      const shared = [...(cards.get(ref)?.personIds ?? [])].filter((p) => keptPersons.has(p)).length;
      cardMerges.push({
        keptRef: kept,
        mergedRef: ref,
        keptFamilyId: familyIdOfRef.get(kept) ?? "",
        mergedFamilyId: familyIdOfRef.get(ref) ?? "",
        sharedPersons: shared,
        ratio: shared / Math.min(size(kept), size(ref)),
      });
    }
  }
  cardMerges.sort((a, b) => cmp(a.mergedRef, b.mergedRef));

  // A person on two unmerged families stays in the one with the larger (more recent) card ref.
  const cardOfPerson = new Map<string, string>(); // person -> the card they are kept on
  const multiHousehold: MultiHousehold[] = [];
  for (const pid of [...cardsOfPerson.keys()].sort(cmp)) {
    const personCards = cardsOfPerson.get(pid) ?? [];
    const familyRefs = new Set(personCards.map((c) => keptRefOf.get(c) ?? c));
    const keptCard = [...personCards].sort(cmp)[personCards.length - 1];
    cardOfPerson.set(pid, keptCard);
    if (familyRefs.size > 1) {
      const keptFamilyRef = keptRefOf.get(keptCard) ?? keptCard;
      const others = personCards.filter((c) => (keptRefOf.get(c) ?? c) !== keptFamilyRef);
      multiHousehold.push({
        personId: pid,
        keptFamilyId: familyIdOfRef.get(keptFamilyRef) ?? "",
        keptCardRef: keptCard,
        otherCardRefs: others,
        otherFamilyIds: [...new Set(others.map((c) => familyIdOfRef.get(keptRefOf.get(c) ?? c) ?? ""))],
      });
    }
  }

  // Members of each anchored family.
  const membersOfFamilyRef = new Map<string, string[]>();
  for (const [pid, card] of cardOfPerson) {
    const famRef = keptRefOf.get(card) ?? card;
    membersOfFamilyRef.set(famRef, [...(membersOfFamilyRef.get(famRef) ?? []), pid]);
  }

  const personById = new Map(persons.map((p) => [p.id, p]));
  const families: Family[] = [];
  const familyMembers: FamilyMember[] = [];
  const familyIdByPerson = new Map<string, string>();

  const incomeOf = (memberIds: readonly string[]): IncomeSource[] =>
    memberIds
      .flatMap((pid) => recordsByPerson.get(pid) ?? [])
      .filter((r): r is NormalizedRecord & { incomeDeclared: number } => r.incomeDeclared !== null)
      .map((r) => ({ recordId: r.id, source: r.source, value: r.incomeDeclared }))
      .sort((a, b) => cmp(a.recordId, b.recordId));

  const locationOf = (rs: readonly NormalizedRecord[]) => ({
    district: mostCommon(rs, (r) => r.raw.district)?.raw.district ?? "",
    taluka: mostCommon(rs, (r) => r.raw.taluka)?.raw.taluka ?? "",
    village: mostCommon(rs, (r) => r.raw.village)?.raw.village ?? "",
  });

  for (const ref of refs) {
    const familyId = familyIdOfRef.get(ref) ?? "";
    const keptRef = keptRefOf.get(ref) ?? ref;
    if (keptRef !== ref) {
      // Merged duplicate card: keep the row for lineage, members live in the kept family.
      families.push({
        id: familyId, headPersonId: null, ...locationOf(cards.get(ref)?.records ?? []),
        resolvedIncome: null, incomeSources: [], isAnchored: true, status: "merged",
        mergedInto: familyIdOfRef.get(keptRef) ?? null, parentFamilyId: null, cardRefs: [ref],
      });
      continue;
    }

    const memberIds = (membersOfFamilyRef.get(ref) ?? []).sort(cmp);
    const groupCards = (groupRefs.get(ref) ?? [ref]).map((r) => cards.get(r)).filter((c): c is Card => c !== undefined);

    // A member's relation comes from their record on the card they are kept on (kept card first).
    const relationRecord = (pid: string): NormalizedRecord | undefined => {
      const onCards = groupCards
        .flatMap((c) => c.records)
        .filter((r) => personIdByRecord.get(r.id) === pid);
      const preferred = cardOfPerson.get(pid);
      return (
        onCards.find((r) => r.householdRef === preferred) ??
        onCards.find((r) => r.householdRef === ref) ??
        onCards[0]
      );
    };
    const headRecord =
      [ref, ...(groupRefs.get(ref) ?? []).filter((r) => r !== ref)]
        .flatMap((r) => cards.get(r)?.records ?? [])
        .find((r) => r.relation === "head" && memberIds.includes(personOf(r.id)));
    const eldest = [...memberIds].sort(
      (a, b) => (personById.get(a)?.dob ?? "9999").localeCompare(personById.get(b)?.dob ?? "9999") || cmp(a, b),
    )[0];
    const headPersonId = headRecord ? personOf(headRecord.id) : (eldest ?? null);

    const incomeSources = incomeOf(memberIds);
    families.push({
      id: familyId,
      headPersonId,
      ...locationOf(cards.get(ref)?.records ?? []),
      resolvedIncome: incomeSources.length === 0 ? null : Math.max(...incomeSources.map((s) => s.value)),
      incomeSources,
      isAnchored: true,
      status: "active",
      mergedInto: null,
      parentFamilyId: null,
      cardRefs: [...(groupRefs.get(ref) ?? [ref])].sort(cmp),
    });
    for (const pid of memberIds) {
      familyIdByPerson.set(pid, familyId);
      familyMembers.push({
        familyId, personId: pid,
        relationToHead: pid === headPersonId ? "head" : (relationRecord(pid)?.relation ?? null),
        validFrom: null, validTo: null, openedByEvent: null, closedByEvent: null,
      });
    }
  }

  // Anyone not on a ration card gets a single-person, unanchored family.
  let nextFamily = refs.length;
  for (const person of persons) {
    if (familyIdByPerson.has(person.id)) continue;
    nextFamily++;
    const familyId = `GJ-FID-${pad(nextFamily)}`;
    const own = recordsByPerson.get(person.id) ?? [];
    const incomeSources = incomeOf([person.id]);
    families.push({
      id: familyId,
      headPersonId: person.id,
      ...locationOf(own.filter((r) => r.id === person.anchorRecordId)),
      resolvedIncome: incomeSources.length === 0 ? null : Math.max(...incomeSources.map((s) => s.value)),
      incomeSources,
      isAnchored: false,
      status: "active",
      mergedInto: null,
      parentFamilyId: null,
      cardRefs: [],
    });
    familyIdByPerson.set(person.id, familyId);
    familyMembers.push({
      familyId, personId: person.id, relationToHead: "head", validFrom: null, validTo: null,
      openedByEvent: null, closedByEvent: null,
    });
  }

  return {
    persons,
    personIdByRecord,
    familyIdByPerson,
    candidates: [...candidateByKey.values()].sort((a, b) => cmp(a.pairKey, b.pairKey)),
    families,
    familyMembers,
    cardMerges,
    multiHousehold,
  };
}
