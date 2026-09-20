// Deterministic synthetic data generator (DESIGN.md Section 9).
//
// Two phases:
//   1. Build a "true world": households, people, and plans for which people appear in which
//      source (ration, pension, scholarship, death registry), plus all planted cases.
//   2. Emit messy source records from that world, with noise that depends on the source.
//
// Everything is driven by one seeded Rng. There is no Math.random and no clock.
import { createHash } from "node:crypto";
import {
  AS_OF, addDays, ageOn, dobForAge, formatDate, pad,
  type DateFormat, type YMD,
} from "./dates";
import {
  MALE_OLD, STREETS, SURNAMES, TALUKAS, VILLAGE_POOL, firstNamePool,
  type Gender, type Geo,
} from "./names";
import {
  PROFILES, noisyDob, noisyName, noisyPlace, spellVariant,
  type NameParts, type NoiseProfile, type NoiseTag,
} from "./noise";
import { Rng } from "./rng";

export const SEED = 20260920;
export const HOUSEHOLD_COUNT = 200;
const UID_PRESENT_RATE = 0.7;
const NO_CARD_RATE_COUNT = 20; // 10 percent of households have no ration card

export const BENEFIT_AMOUNTS = {
  OLD_AGE_PENSION: 1000,
  WIDOW_ASSIST: 1250,
  SCHOLARSHIP: 500,
} as const;

export type Relation =
  | "head" | "spouse" | "son" | "daughter" | "son_in_law" | "daughter_in_law"
  | "grandson" | "granddaughter" | "father" | "mother" | "other";
export type Marital = "married" | "unmarried" | "widowed";
export type SourceName = "ration" | "pension" | "scholarship" | "death_registry";
export type SchemeCode = "OLD_AGE_PENSION" | "WIDOW_ASSIST" | "SCHOLARSHIP";

/** One row of `source_records`, exactly as inserted. */
export interface SourceRecordRow {
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
  true_person_id: string;
}

type Draft = Omit<SourceRecordRow, "id">;

interface Person {
  id: string;
  firstName: string;
  surname: string;
  gender: Gender;
  dob: YMD;
  uid: string;
  forceUid: boolean;
  fatherId: string | null;
  fatherFirst: string | null;
  spouseId: string | null;
  husbandFirst: string | null;
  hhIdx: number;
  relation: Relation;
  marital: Marital;
  isStudent: boolean;
  onRation: boolean;
  pension: SchemeCode | null;
  pensionDuplicate: boolean;
  scholarship: boolean;
  deathOn: YMD | null;
  lateMarker: boolean;
}

/** An extra ration row on a household's card for someone who really lives elsewhere. */
interface StaleCopy {
  personId: string;
  relation: Relation;
  marital: Marital;
  name: NameParts | null;
  forceUid: boolean;
}

interface Household {
  idx: number;
  kind: "random" | "showcase";
  district: string;
  taluka: string;
  village: string;
  houseNo: number;
  street: string;
  income: number;
  hasCard: boolean;
  cardRef: string | null;
  memberIds: string[];
  /** When set, non-ration sources declare income * factor (the planted income mismatch). */
  incomeFactor: number | null;
  dupCard: { ref: string; skipPersonId: string | null } | null;
  staleCopies: StaleCopy[];
}

export interface Planted {
  /** true_person_id of people who are dead but still drawing a pension */
  deceasedPension: string[];
  /** true_person_id of people enrolled twice in the same scheme */
  doubleEnrollment: string[];
  /** ration card refs: the original card and its later duplicate */
  duplicateCards: { original: string; duplicate: string }[];
  /** people listed on two different ration cards */
  twoCards: { personId: string; cards: [string, string] }[];
  /** ration card refs of families whose sources disagree on income */
  incomeMismatch: string[];
  /** true_person_id of people with a benefit record but no ration card */
  noCardBenefit: string[];
  /** near-identical names, different people, same household */
  fatherSon: { fatherId: string; sonId: string; householdRef: string }[];
  /** identical names, different people, same village */
  sameName: { aId: string; bId: string; village: string }[];
  showcase: { householdRef: string; headId: string; motherId: string; grandsonId: string };
}

export interface SeedResult {
  records: SourceRecordRow[];
  planted: Planted;
  /** ground truth for queries and tests only */
  truth: Record<string, { name: string; dob: string }>;
  stats: {
    households: number;
    persons: number;
    recordsBySource: Record<SourceName, number>;
    noiseTags: Record<string, number>;
  };
}

const ID_PREFIX: Record<SourceName, string> = {
  ration: "RAT",
  pension: "PEN",
  scholarship: "SCH",
  death_registry: "DTH",
};

const FATHER_SON_NAME_PAIRS: readonly (readonly [father: string, son: string])[] = [
  ["Ramesh", "Rakesh"], ["Mahesh", "Mukesh"], ["Dinesh", "Dilip"], ["Jayesh", "Jitesh"],
  ["Suresh", "Sureshkumar"], ["Bharat", "Bharatkumar"], ["Kirit", "Kiran"], ["Naresh", "Nilesh"],
];

const round1000 = (n: number) => Math.round(n / 1000) * 1000;
const hashUid = (uid: string) =>
  createHash("sha256").update(`parivar-setu-demo:${uid}`).digest("hex");

export function generateSeed(seed: number = SEED): SeedResult {
  const rng = new Rng(seed);
  const persons = new Map<string, Person>();
  const households: Household[] = [];
  let personSeq = 0;

  const P = (id: string): Person => {
    const p = persons.get(id);
    if (!p) throw new Error(`Unknown person ${id}`);
    return p;
  };
  const membersOf = (h: Household): Person[] => h.memberIds.map(P);
  const headOf = (h: Household): Person => P(h.memberIds[0]);

  // ---- geography -----------------------------------------------------------------------
  const villagePool = rng.shuffle(VILLAGE_POOL);
  const geos: Geo[] = TALUKAS.map(([district, taluka]) => ({ district, taluka, villages: [] }));
  let villageCursor = 0;
  for (const geo of geos) {
    geo.villages = villagePool.slice(villageCursor, villageCursor + rng.int(4, 6));
    villageCursor += geo.villages.length;
  }
  if (villageCursor > VILLAGE_POOL.length) throw new Error("Village pool too small");

  // ---- people --------------------------------------------------------------------------
  interface NewPerson {
    hhIdx: number;
    gender: Gender;
    surname: string;
    relation: Relation;
    marital: Marital;
    age?: number;
    dob?: YMD;
    firstName?: string;
    fatherId?: string | null;
    fatherFirst?: string | null;
    spouseId?: string | null;
    husbandFirst?: string | null;
  }

  function makePerson(o: NewPerson, taken: Set<string>): Person {
    const dob = o.dob ?? dobForAge(rng, o.age ?? 0);
    let firstName = o.firstName;
    if (!firstName) {
      const pool = firstNamePool(o.gender, dob.y);
      const free = pool.filter((n) => !taken.has(n));
      firstName = rng.pick(free.length > 0 ? free : pool);
    }
    taken.add(firstName);
    const age = ageOn(dob);
    const isStudent = age >= 6 && (age <= 17 ? rng.chance(0.9) : age <= 24 ? rng.chance(0.5) : false);
    personSeq += 1;
    const uid = `${rng.int(2, 9)}${String(Math.floor(rng.next() * 1e11)).padStart(11, "0")}`;
    const person: Person = {
      id: `T-${pad(personSeq, 5)}`,
      firstName,
      surname: o.surname,
      gender: o.gender,
      dob,
      uid,
      forceUid: false,
      fatherId: o.fatherId ?? null,
      fatherFirst: o.fatherFirst ?? null,
      spouseId: o.spouseId ?? null,
      husbandFirst: o.husbandFirst ?? null,
      hhIdx: o.hhIdx,
      relation: o.relation,
      marital: o.marital,
      isStudent,
      onRation: true,
      pension: null,
      pensionDuplicate: false,
      scholarship: false,
      deathOn: null,
      lateMarker: false,
    };
    persons.set(person.id, person);
    return person;
  }

  /** Gujarati naming: first name + father's (or husband's, once married) name + surname. */
  function middleOf(p: Person): string | null {
    if (p.gender === "F") {
      if (p.spouseId) return P(p.spouseId).firstName;
      if (p.husbandFirst) return p.husbandFirst;
    }
    if (p.fatherId) return P(p.fatherId).firstName;
    return p.fatherFirst;
  }
  const fatherFirstOf = (p: Person): string | null =>
    p.fatherId ? P(p.fatherId).firstName : p.fatherFirst;
  const nameParts = (p: Person): NameParts => ({
    first: p.firstName,
    middle: middleOf(p),
    last: p.surname,
  });
  const canonicalName = (p: Person) => {
    const n = nameParts(p);
    return [n.first, n.middle, n.last].filter(Boolean).join(" ");
  };

  // ---- households ----------------------------------------------------------------------
  function pickIncome(): number {
    const band = rng.weighted<[number, number]>([
      [[40_000, 115_000], 55],
      [[120_000, 240_000], 25],
      [[250_000, 450_000], 15],
      [[500_000, 800_000], 5],
    ]);
    return Math.round(rng.int(band[0], band[1]) / 5000) * 5000;
  }

  function newHousehold(idx: number, kind: Household["kind"], geo: Geo, village: string): Household {
    return {
      idx, kind, district: geo.district, taluka: geo.taluka, village,
      houseNo: rng.int(1, 299), street: rng.pick(STREETS), income: pickIncome(),
      hasCard: true, cardRef: null, memberIds: [],
      incomeFactor: null, dupCard: null, staleCopies: [],
    };
  }

  function buildRandomHousehold(idx: number): Household {
    const geo = rng.pick(geos);
    const h = newHousehold(idx, "random", geo, rng.pick(geo.villages));
    const surname = rng.weighted(SURNAMES);
    const taken = new Set<string>();
    const add = (o: Omit<NewPerson, "hhIdx" | "surname">): Person => {
      const p = makePerson({ ...o, hhIdx: idx, surname }, taken);
      h.memberIds.push(p.id);
      return p;
    };

    const headMale = rng.chance(0.85);
    const headAge = rng.int(30, 78);
    const head = add({ gender: headMale ? "M" : "F", relation: "head", marital: "married", age: headAge });
    head.fatherFirst = rng.pick(MALE_OLD.filter((n) => n !== head.firstName));
    if (!headMale) head.husbandFirst = rng.pick(MALE_OLD.filter((n) => n !== head.firstName));
    head.marital = headMale
      ? (rng.chance(0.9) ? "married" : "widowed")
      : (rng.chance(0.85) ? "widowed" : "married");

    if (headMale && head.marital === "married") {
      const wife = add({
        gender: "F", relation: "spouse", marital: "married",
        age: Math.max(18, headAge - rng.int(0, 7)), spouseId: head.id,
      });
      head.spouseId = wife.id;
    }

    // Children (and, in older households, a married son's family)
    const kidCount = headAge < 32 ? rng.int(0, 1) : headAge <= 65 ? rng.int(1, 4) : rng.int(1, 3);
    const fatherRef = headMale ? { fatherId: head.id } : { fatherFirst: head.husbandFirst };
    for (let k = 0; k < kidCount; k++) {
      const age = headAge - rng.int(20, 36);
      if (age < 0) continue;
      const gender: Gender = rng.chance(0.5) ? "M" : "F";
      if (gender === "F" && age >= 22 && rng.chance(0.5)) continue; // married and moved away
      const child = add({
        gender, relation: gender === "M" ? "son" : "daughter", marital: "unmarried", age, ...fatherRef,
      });
      if (gender === "M" && age >= 24 && rng.chance(0.65)) {
        child.marital = "married";
        const wife = add({
          gender: "F", relation: "daughter_in_law", marital: "married",
          age: Math.max(18, age - rng.int(0, 5)), spouseId: child.id,
        });
        child.spouseId = wife.id;
        if (age >= 20) {
          for (let g = rng.int(1, 3); g > 0; g--) {
            const grandGender: Gender = rng.chance(0.5) ? "M" : "F";
            add({
              gender: grandGender, relation: grandGender === "M" ? "grandson" : "granddaughter",
              marital: "unmarried", age: rng.int(0, age - 20), fatherId: child.id,
            });
          }
        }
      }
    }

    // A widowed parent of the head
    if (headMale && headAge >= 36 && headAge <= 56 && rng.chance(0.22)) {
      const parentAge = headAge + rng.int(20, 30);
      if (rng.chance(0.6)) {
        add({ gender: "F", relation: "mother", marital: "widowed", age: parentAge, husbandFirst: head.fatherFirst });
      } else {
        add({
          gender: "M", relation: "father", marital: "widowed", age: parentAge,
          firstName: head.fatherFirst ?? undefined, fatherFirst: rng.pick(MALE_OLD),
        });
      }
    }

    while (h.memberIds.length > 7) {
      const removed = h.memberIds.pop();
      if (removed === undefined) break;
      persons.delete(removed);
    }
    if (h.memberIds.length < 2) {
      const age = Math.max(0, headAge - rng.int(20, 30));
      const gender: Gender = rng.chance(0.5) ? "M" : "F";
      add({ gender, relation: gender === "M" ? "son" : "daughter", marital: "unmarried", age, ...fatherRef });
    }
    return h;
  }

  /** Hand-built family for the demo story (DESIGN.md Section 9, last planted case). */
  function buildShowcase(idx: number): { household: Household; patches: Map<string, Partial<Draft>> } {
    const geo = geos.find((g) => g.taluka === "Kadi");
    if (!geo) throw new Error("Kadi taluka missing");
    const h = newHousehold(idx, "showcase", geo, geo.villages[0]);
    h.houseNo = 21;
    h.street = "Shivnagar";
    h.income = 96_000;
    const taken = new Set<string>();
    const mk = (o: Omit<NewPerson, "hhIdx" | "surname">): Person => {
      const p = makePerson({ ...o, hhIdx: idx, surname: "Patel" }, taken);
      h.memberIds.push(p.id);
      return p;
    };
    const head = mk({
      gender: "M", relation: "head", marital: "married", firstName: "Ramesh",
      dob: { y: 1959, m: 3, d: 14 }, fatherFirst: "Kantilal",
    });
    const spouse = mk({
      gender: "F", relation: "spouse", marital: "married", firstName: "Savita",
      dob: { y: 1962, m: 8, d: 2 }, spouseId: head.id,
    });
    head.spouseId = spouse.id;
    const mother = mk({
      gender: "F", relation: "mother", marital: "widowed", firstName: "Kokila",
      dob: { y: 1938, m: 6, d: 10 }, husbandFirst: "Kantilal",
    });
    const son = mk({
      gender: "M", relation: "son", marital: "married", firstName: "Jayesh",
      dob: { y: 1984, m: 11, d: 5 }, fatherId: head.id,
    });
    const daughterInLaw = mk({
      gender: "F", relation: "daughter_in_law", marital: "married", firstName: "Hetal",
      dob: { y: 1988, m: 2, d: 17 }, spouseId: son.id,
    });
    son.spouseId = daughterInLaw.id;
    mk({
      gender: "F", relation: "granddaughter", marital: "unmarried", firstName: "Krisha",
      dob: { y: 2021, m: 5, d: 12 }, fatherId: son.id,
    });
    // Not on the ration card: only a scholarship record, linked by the father's name alone.
    const grandson = mk({
      gender: "M", relation: "grandson", marital: "unmarried", firstName: "Dhruv",
      dob: { y: 2013, m: 6, d: 20 }, fatherId: son.id,
    });
    grandson.onRation = false;
    grandson.isStudent = true;
    grandson.scholarship = true;
    head.forceUid = true;
    son.forceUid = true;
    head.pension = "OLD_AGE_PENSION";
    mother.pension = "OLD_AGE_PENSION";
    mother.deathOn = { y: 2026, m: 7, d: 2 };
    mother.lateMarker = true;

    const patches = new Map<string, Partial<Draft>>([
      [`${head.id}|pension`, {
        full_name: "Rameshbhai Kantilaal Patel", dob: "14-03-1959",
        uid_hash: null, uid_last4: null, income_declared: 96_000,
      }],
      [`${mother.id}|pension`, {
        full_name: "Kokilaben Kantilal Patel", dob: "10-06-1938", income_declared: 96_000,
      }],
      [`${mother.id}|death_registry`, {
        full_name: "Late Kokila Kantilal Patel", dob: "10/06/1938", date_of_death: "2026-07-02",
      }],
      [`${grandson.id}|scholarship`, {
        full_name: "Dhruv Patel", guardian_name: "Jayesh", dob: "2013-06-20",
        uid_hash: null, uid_last4: null, income_declared: 96_000,
      }],
    ]);
    return { household: h, patches };
  }

  const showcase = buildShowcase(0);
  households.push(showcase.household);
  for (let idx = 1; idx < HOUSEHOLD_COUNT; idx++) households.push(buildRandomHousehold(idx));
  const patches = showcase.patches;

  const randomHouseholds = households.filter((h) => h.kind === "random");
  const used = new Set<number>(); // households already claimed by a structural planted case
  const planted: Planted = {
    deceasedPension: [], doubleEnrollment: [], duplicateCards: [], twoCards: [],
    incomeMismatch: [], noCardBenefit: [], fatherSon: [], sameName: [],
    showcase: { householdRef: "", headId: "", motherId: "", grandsonId: "" },
  };
  const need = <T>(label: string, items: T[], count: number): T[] => {
    if (items.length < count) throw new Error(`Seed: only ${items.length} candidates for ${label}, need ${count}`);
    return items.slice(0, count);
  };

  // ---- ration coverage: 10 percent of households have no card ---------------------------
  // 10 of them are elder-headed with a pension: "benefits but no ration card".
  const elderHouseholds = rng.shuffle(
    randomHouseholds.filter((h) => membersOf(h).some((p) => ageOn(p.dob) >= 62)),
  );
  for (const h of need("no-card elder households", elderHouseholds, 10)) {
    h.hasCard = false;
    used.add(h.idx);
    const elder = membersOf(h).filter((p) => ageOn(p.dob) >= 62).sort((a, b) => ageOn(b.dob) - ageOn(a.dob))[0];
    elder.pension = "OLD_AGE_PENSION";
  }
  for (const h of need("other no-card households", rng.shuffle(randomHouseholds.filter((x) => x.hasCard)), NO_CARD_RATE_COUNT - 10)) {
    h.hasCard = false;
    used.add(h.idx);
  }

  let cardSeq = 0;
  const nextCardRef = () => `GJRC${pad(++cardSeq, 7)}`;
  for (const h of households) if (h.hasCard) h.cardRef = nextCardRef();
  const cardHouseholds = randomHouseholds.filter((h) => h.hasCard);
  const allPeople = () => households.flatMap(membersOf);

  // ---- deaths ---------------------------------------------------------------------------
  const deathDate = () => addDays(AS_OF, -rng.int(20, 300));
  const deadlyHouseholds = new Set<number>();
  const seniors = rng.shuffle(
    cardHouseholds.flatMap(membersOf).filter((p) => ageOn(p.dob) >= 60 && !p.pension),
  );
  for (const p of seniors) {
    if (planted.deceasedPension.length === 10) break;
    if (deadlyHouseholds.has(p.hhIdx)) continue;
    deadlyHouseholds.add(p.hhIdx);
    p.pension = "OLD_AGE_PENSION";
    p.deathOn = deathDate();
    p.lateMarker = rng.chance(0.35);
    planted.deceasedPension.push(p.id);
  }
  need("deceased pensioners", planted.deceasedPension, 10);

  const otherDeaths = rng.shuffle(
    cardHouseholds.flatMap(membersOf).filter(
      (p) => ageOn(p.dob) >= 35 && ageOn(p.dob) <= 92 && !p.pension && !p.deathOn,
    ),
  ).slice(0, 8);
  for (const p of otherDeaths) {
    p.deathOn = deathDate();
    p.lateMarker = rng.chance(0.35);
  }

  // ---- natural enrollments (some are ineligible, some eligible people are missed) --------
  for (const h of randomHouseholds) {
    for (const p of membersOf(h)) {
      if (p.deathOn) continue;
      const age = ageOn(p.dob);
      const lowIncome = h.income <= 120_000;
      if (!p.pension) {
        const widow = p.gender === "F" && p.marital === "widowed" && age >= 18;
        if (widow && rng.chance(0.7)) p.pension = "WIDOW_ASSIST";
        else if (age >= 60 && rng.chance(lowIncome ? 0.8 : 0.5)) p.pension = "OLD_AGE_PENSION";
      }
      if (p.isStudent && age >= 10 && age <= 22 && rng.chance(h.income <= 250_000 ? 0.85 : 0.5)) {
        p.scholarship = true;
      }
    }
  }

  // ---- planted: enrolled twice in the same scheme (6) -----------------------------------
  const pensioners = rng.shuffle(
    allPeople().filter((p) => p.pension && !p.deathOn && households[p.hhIdx].kind === "random"),
  );
  for (const p of need("double pensions", pensioners, 6)) {
    p.pensionDuplicate = true;
    planted.doubleEnrollment.push(p.id);
  }

  // ---- planted: duplicate ration cards (5) ----------------------------------------------
  const dupCandidates = rng.shuffle(
    cardHouseholds.filter((h) => !used.has(h.idx) && h.memberIds.length >= 3 && h.memberIds.length <= 6),
  );
  for (const [i, h] of need("duplicate ration cards", dupCandidates, 5).entries()) {
    used.add(h.idx);
    const skippable = membersOf(h).filter((p) => p.relation !== "head");
    const skipPersonId = i < 2 ? rng.pick(skippable).id : null; // two copies miss a member
    if (h.cardRef === null) throw new Error("card missing");
    h.dupCard = { ref: nextCardRef(), skipPersonId };
    planted.duplicateCards.push({ original: h.cardRef, duplicate: h.dupCard.ref });
  }

  // ---- planted: people on two ration cards (5): 3 sons, 2 married daughters --------------
  // The moved-out household needs 3+ members: with 2, one shared person is 0.5 of the smaller card,
  // which the card-merge rule (7.4 rule 2) correctly treats as a duplicate card instead.
  const relink = (h: Household, surname: string) => {
    for (const m of membersOf(h)) m.surname = surname;
  };
  const freeCardHouseholds = () => cardHouseholds.filter((h) => !used.has(h.idx));
  const pairUp = (
    isSecondHome: (h: Household) => boolean,
    isFirstHome: (h1: Household, h2: Household) => boolean,
  ): [Household, Household] => {
    for (const h2 of rng.shuffle(freeCardHouseholds().filter(isSecondHome))) {
      const h1 = rng.shuffle(freeCardHouseholds()).find((c) => c.idx !== h2.idx && isFirstHome(c, h2));
      if (h1) {
        used.add(h1.idx);
        used.add(h2.idx);
        return [h1, h2];
      }
    }
    throw new Error("Seed: no household pair for two-card case");
  };
  const cardOf = (h: Household): string => {
    if (h.cardRef === null) throw new Error("card missing");
    return h.cardRef;
  };
  const roomy = (h: Household) => h.memberIds.length + h.staleCopies.length <= 6;

  for (let i = 0; i < 3; i++) {
    const [h1, h2] = pairUp(
      (h) => {
        const head = headOf(h);
        return head.gender === "M" && head.spouseId !== null && h.memberIds.length >= 3 &&
          ageOn(head.dob) >= 25 && ageOn(head.dob) <= 42;
      },
      (c, h2) =>
        c.district === h2.district && roomy(c) && headOf(c).gender === "M" &&
        ageOn(headOf(c).dob) >= 50 && ageOn(headOf(c).dob) <= 75 &&
        ageOn(headOf(c).dob) - ageOn(headOf(h2).dob) >= 18,
    );
    const father = headOf(h1);
    const son = headOf(h2);
    son.fatherFirst = father.firstName;
    son.forceUid = true; // both cards carry his ID, which is how the duplicate is caught
    relink(h2, father.surname);
    h1.staleCopies.push({
      personId: son.id, relation: "son", marital: rng.chance(0.5) ? "married" : "unmarried",
      name: null, forceUid: false,
    });
    planted.twoCards.push({ personId: son.id, cards: [cardOf(h1), cardOf(h2)] });
  }
  for (let i = 0; i < 2; i++) {
    const [h1, h2] = pairUp(
      (h) => {
        const head = headOf(h);
        const wife = head.spouseId ? P(head.spouseId) : null;
        return head.gender === "M" && wife !== null && h.memberIds.length >= 3 &&
          ageOn(wife.dob) >= 22 && ageOn(wife.dob) <= 40;
      },
      (c, h2) => {
        const wife = P(headOf(h2).spouseId ?? "");
        return c.district === h2.district && roomy(c) && headOf(c).gender === "M" &&
          ageOn(headOf(c).dob) >= 48 && ageOn(headOf(c).dob) <= 75 &&
          ageOn(headOf(c).dob) - ageOn(wife.dob) >= 18;
      },
    );
    const father = headOf(h1);
    const wife = P(headOf(h2).spouseId ?? "");
    wife.fatherFirst = father.firstName;
    wife.forceUid = true; // she is matched by ID despite the surname change on marriage
    h1.staleCopies.push({
      personId: wife.id, relation: "daughter", marital: "unmarried",
      name: { first: wife.firstName, middle: father.firstName, last: father.surname },
      forceUid: true,
    });
    planted.twoCards.push({ personId: wife.id, cards: [cardOf(h1), cardOf(h2)] });
  }

  // ---- planted: income mismatch (10) ----------------------------------------------------
  const mismatchCandidates = rng.shuffle(
    freeCardHouseholds().filter(
      (h) => h.income >= 60_000 && h.income <= 150_000 && membersOf(h).some((p) => p.pension || p.scholarship),
    ),
  );
  for (const h of need("income mismatch", mismatchCandidates, 10)) {
    used.add(h.idx);
    h.incomeFactor = rng.int(18, 26) / 10;
    planted.incomeMismatch.push(cardOf(h));
  }

  // ---- planted hard negatives (15) ------------------------------------------------------
  // 8 x father and son with near-identical first names in one household.
  const fsCandidates = rng.shuffle(
    freeCardHouseholds().filter((h) => {
      const head = headOf(h);
      return head.gender === "M" && ageOn(head.dob) >= 45 &&
        membersOf(h).some((p) => p.relation === "son" && p.fatherId === head.id && ageOn(p.dob) >= 18);
    }),
  );
  for (const [i, h] of need("father-son pairs", fsCandidates, FATHER_SON_NAME_PAIRS.length).entries()) {
    used.add(h.idx);
    const [fatherName, sonName] = FATHER_SON_NAME_PAIRS[i];
    const father = headOf(h);
    const son = membersOf(h).find((p) => p.relation === "son" && p.fatherId === father.id && ageOn(p.dob) >= 18);
    if (!son) throw new Error("son missing");
    father.firstName = fatherName;
    son.firstName = sonName;
    if (father.fatherFirst === fatherName) {
      father.fatherFirst = rng.pick(MALE_OLD.filter((n) => n !== fatherName));
    }
    planted.fatherSon.push({ fatherId: father.id, sonId: son.id, householdRef: cardOf(h) });
  }

  // 7 x two different men with the same full name in the same village; birth years 0 to 4 apart.
  const heads = freeCardHouseholds()
    .filter((h) => headOf(h).gender === "M")
    .sort((a, b) => ageOn(headOf(a).dob) - ageOn(headOf(b).dob) || a.idx - b.idx);
  const pairs: [Household, Household][] = [];
  for (let i = 0; i + 1 < heads.length && pairs.length < 7; i++) {
    if (ageOn(headOf(heads[i + 1]).dob) - ageOn(headOf(heads[i]).dob) <= 4) {
      pairs.push([heads[i], heads[i + 1]]);
      i++;
    }
  }
  for (const [i, [ha, hb]] of need("same-name pairs", pairs, 7).entries()) {
    used.add(ha.idx);
    used.add(hb.idx);
    const a = headOf(ha);
    const b = headOf(hb);
    b.firstName = a.firstName;
    b.fatherFirst = a.fatherFirst;
    relink(hb, a.surname);
    hb.district = ha.district;
    hb.taluka = ha.taluka;
    hb.village = ha.village;
    if (i < 4) {
      // same birth year, different day: a genuine review-queue case
      b.dob = { y: a.dob.y, m: ((a.dob.m + rng.int(1, 10) - 1) % 12) + 1, d: rng.int(1, 28) };
    } else {
      const gap = rng.int(2, 4) * (rng.chance(0.5) ? 1 : -1);
      b.dob = { y: a.dob.y + gap, m: a.dob.m, d: Math.min(a.dob.d, 28) };
    }
    planted.sameName.push({ aId: a.id, bId: b.id, village: ha.village });
  }

  // ---- emit source records --------------------------------------------------------------
  const rows: Record<SourceName, Draft[]> = { ration: [], pension: [], scholarship: [], death_registry: [] };
  const noiseCounts = new Map<NoiseTag, number>();
  const countTags = (tags: NoiseTag[]) => {
    for (const t of tags) noiseCounts.set(t, (noiseCounts.get(t) ?? 0) + 1);
  };
  const refSeq: Record<Exclude<SourceName, "ration">, number> = { pension: 0, scholarship: 0, death_registry: 0 };
  const nextRef = (source: Exclude<SourceName, "ration">) => {
    refSeq[source] += 1;
    const prefix = source === "pension" ? "PSN" : source === "scholarship" ? "SCH" : "DR";
    return `${prefix}${pad(40_000 + refSeq[source] * 7, 6)}`;
  };

  const uidFields = (p: Person, forced: boolean, tags: NoiseTag[]) => {
    if (forced || p.forceUid || rng.chance(UID_PRESENT_RATE)) {
      return { uid_hash: hashUid(p.uid), uid_last4: p.uid.slice(-4) };
    }
    tags.push("missing_uid");
    return { uid_hash: null, uid_last4: null };
  };

  const location = (h: Household, profile: NoiseProfile, clean: boolean, tags: NoiseTag[]) => {
    const village = noisyPlace(rng, h.village, profile, tags);
    const style = clean ? 0 : rng.weighted<0 | 1 | 2>([[0, 5], [1, 3], [2, 2]]);
    const address = [
      `${h.houseNo}, ${h.street}, ${village}`,
      `H.No ${h.houseNo} ${h.street} ${village}`,
      `${h.street}, ${village}`,
    ][style];
    return { district: h.district, taluka: h.taluka, village, address };
  };

  const nonRationIncome = (h: Household): number => {
    if (h.incomeFactor !== null) return round1000(h.income * h.incomeFactor);
    if (rng.chance(0.7)) return h.income;
    return Math.max(12_000, round1000(h.income * (1 + rng.int(-10, 10) / 100)));
  };

  const push = (source: SourceName, draft: Draft, patchKey: string, tags: NoiseTag[]) => {
    countTags(tags);
    rows[source].push({ ...draft, ...patches.get(patchKey) });
  };

  function emitRation(
    p: Person, h: Household, ref: string, seq: number, profile: NoiseProfile,
    clean: boolean, stale: StaleCopy | null,
  ) {
    const tags: NoiseTag[] = [];
    const relation = stale?.relation ?? p.relation;
    const marital = stale?.marital ?? p.marital;
    const age = ageOn(p.dob);
    push("ration", {
      source: "ration",
      source_ref: `${ref}-${pad(seq, 2)}`,
      household_ref: ref,
      full_name: noisyName(
        rng, stale?.name ?? nameParts(p),
        { gender: p.gender, age, married: marital !== "unmarried" }, profile, tags,
      ),
      guardian_name: null,
      dob: noisyDob(rng, p.dob, profile, ["dmy/"], tags),
      gender: p.gender,
      relation_to_head: relation,
      marital_status: marital,
      ...uidFields(p, stale?.forceUid ?? false, tags),
      ...location(h, profile, clean, tags),
      income_declared: h.income,
      scheme_code: null,
      benefit_amount: null,
      is_student: p.isStudent,
      date_of_death: null,
      true_person_id: p.id,
    }, `${p.id}|ration`, tags);
  }

  for (const h of households) {
    const showcaseCard = h.kind === "showcase";
    const profile = showcaseCard
      ? ({ ...PROFILES.ration, spelling: 0, suffix: 0, title: 0, initial: 0, surnameFirst: 0, villageVar: 0 } as const)
      : PROFILES.ration;
    if (h.hasCard && h.cardRef) {
      let seq = 1;
      for (const p of membersOf(h)) if (p.onRation) emitRation(p, h, h.cardRef, seq++, profile, true, null);
      for (const stale of h.staleCopies) emitRation(P(stale.personId), h, h.cardRef, seq++, profile, true, stale);
    }
  }
  for (const h of households) {
    if (!h.dupCard) continue;
    let seq = 1;
    for (const p of membersOf(h)) {
      if (p.id !== h.dupCard.skipPersonId) emitRation(p, h, h.dupCard.ref, seq++, PROFILES.duplicateCard, false, null);
    }
  }

  function emitPension(p: Person, h: Household, scheme: SchemeCode) {
    const tags: NoiseTag[] = [];
    const age = ageOn(p.dob);
    push("pension", {
      source: "pension",
      source_ref: nextRef("pension"),
      household_ref: null,
      full_name: noisyName(rng, nameParts(p), { gender: p.gender, age, married: p.marital !== "unmarried" }, PROFILES.pension, tags),
      guardian_name: null,
      dob: noisyDob(rng, p.dob, PROFILES.pension, ["dmy-", "ymd", "dmy/"], tags),
      gender: p.gender,
      relation_to_head: null,
      marital_status: scheme === "WIDOW_ASSIST" ? "widowed" : null,
      ...uidFields(p, false, tags),
      ...location(h, PROFILES.pension, false, tags),
      income_declared: nonRationIncome(h),
      scheme_code: scheme,
      benefit_amount: BENEFIT_AMOUNTS[scheme],
      is_student: null,
      date_of_death: null,
      true_person_id: p.id,
    }, `${p.id}|pension`, tags);
  }

  function emitScholarship(p: Person, h: Household) {
    const tags: NoiseTag[] = [];
    const age = ageOn(p.dob);
    let guardian = fatherFirstOf(p);
    if (guardian && rng.chance(0.1)) guardian = spellVariant(rng, guardian) ?? guardian;
    if (guardian && rng.chance(0.2)) guardian += "bhai";
    push("scholarship", {
      source: "scholarship",
      source_ref: nextRef("scholarship"),
      household_ref: null,
      full_name: noisyName(rng, nameParts(p), { gender: p.gender, age, married: false }, PROFILES.scholarship, tags),
      guardian_name: guardian,
      dob: noisyDob(rng, p.dob, PROFILES.scholarship, ["ymd", "dmy/"], tags),
      gender: p.gender,
      relation_to_head: null,
      marital_status: null,
      ...uidFields(p, false, tags),
      ...location(h, PROFILES.scholarship, false, tags),
      income_declared: nonRationIncome(h),
      scheme_code: "SCHOLARSHIP",
      benefit_amount: BENEFIT_AMOUNTS.SCHOLARSHIP,
      is_student: true,
      date_of_death: null,
      true_person_id: p.id,
    }, `${p.id}|scholarship`, tags);
  }

  function emitDeath(p: Person, h: Household, died: YMD) {
    const tags: NoiseTag[] = [];
    const age = ageOn(p.dob);
    let name = noisyName(rng, nameParts(p), { gender: p.gender, age, married: p.marital !== "unmarried" }, PROFILES.death, tags);
    if (p.lateMarker) {
      name = `${rng.weighted([["Late", 6], ["Swargiya", 2.5], ["Sw.", 1.5]])} ${name}`;
      tags.push("late_marker");
    }
    push("death_registry", {
      source: "death_registry",
      source_ref: nextRef("death_registry"),
      household_ref: null,
      full_name: name,
      guardian_name: null,
      dob: noisyDob(rng, p.dob, PROFILES.death, ["dmy/", "dmy-"], tags),
      gender: p.gender,
      relation_to_head: null,
      marital_status: null,
      ...uidFields(p, false, tags),
      ...location(h, PROFILES.death, false, tags),
      income_declared: null,
      scheme_code: null,
      benefit_amount: null,
      is_student: null,
      date_of_death: formatDate(died, rng.pick<DateFormat>(["dmy/", "ymd"])),
      true_person_id: p.id,
    }, `${p.id}|death_registry`, tags);
  }

  for (const h of households) {
    for (const p of membersOf(h)) {
      if (p.pension) {
        emitPension(p, h, p.pension);
        if (p.pensionDuplicate) emitPension(p, h, p.pension);
      }
    }
  }
  for (const h of households) for (const p of membersOf(h)) if (p.scholarship) emitScholarship(p, h);
  for (const h of households) for (const p of membersOf(h)) if (p.deathOn) emitDeath(p, h, p.deathOn);

  // ---- finalize: ids, planted lists, truth ----------------------------------------------
  const records: SourceRecordRow[] = [];
  const recordsBySource = { ration: 0, pension: 0, scholarship: 0, death_registry: 0 };
  for (const source of ["ration", "pension", "scholarship", "death_registry"] as const) {
    rows[source].forEach((draft, i) => {
      records.push({ id: `${ID_PREFIX[source]}-${pad(i + 1, 6)}`, ...draft });
    });
    recordsBySource[source] = rows[source].length;
  }

  const rationIds = new Set(rows.ration.map((r) => r.true_person_id));
  const benefitIds = new Set(
    [...rows.pension, ...rows.scholarship].map((r) => r.true_person_id),
  );
  for (const id of benefitIds) if (!rationIds.has(id)) planted.noCardBenefit.push(id);
  need("benefits without a ration card", planted.noCardBenefit, 10);

  const sc = showcase.household;
  planted.showcase = {
    householdRef: cardOf(sc),
    headId: sc.memberIds[0],
    motherId: sc.memberIds[2],
    grandsonId: sc.memberIds[6],
  };

  const truth: SeedResult["truth"] = {};
  for (const p of persons.values()) {
    truth[p.id] = { name: canonicalName(p), dob: formatDate(p.dob, "ymd") };
  }

  return {
    records,
    planted,
    truth,
    stats: {
      households: households.length,
      persons: persons.size,
      recordsBySource,
      noiseTags: Object.fromEntries([...noiseCounts.entries()].sort()),
    },
  };
}
