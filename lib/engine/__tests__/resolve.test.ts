import { describe, expect, it } from "vitest";
import { findMatches } from "../match";
import { normalizeRecord } from "../normalize";
import { resolve } from "../resolve";
import type { ReviewDecision, SourceRecord } from "../types";
import { AS_OF, PEOPLE, card, rec, type PersonSpec } from "./fixtures";

function run(records: SourceRecord[], decisions: ReviewDecision[] = []) {
  const normalized = records.map((r) => normalizeRecord(r, AS_OF));
  return resolve(normalized, findMatches(normalized, decisions));
}

const RAMESH = { full_name: "Ramesh Kantilal Patel", dob: "14/03/1959", gender: "M" as const };

const personCount = (result: ReturnType<typeof run>) => result.persons.length;
const personOf = (result: ReturnType<typeof run>, recordId: string) => {
  const id = result.personIdByRecord.get(recordId);
  if (!id) throw new Error(`no person for ${recordId}`);
  return id;
};

describe("person clustering", () => {
  it("merges records of the same person across sources and numbers persons by anchor record", () => {
    const result = run([
      rec({ id: "RAT-2", ...RAMESH }),
      rec({ id: "PEN-1", source: "pension", ...RAMESH, full_name: "Rameshbhai Kantilaal Patel" }),
      rec({ id: "RAT-1", full_name: "Savita Ramesh Patel", dob: "02/08/1962", gender: "F" }),
    ]);
    expect(personCount(result)).toBe(2);
    // PEN-1 < RAT-1 < RAT-2, so the Ramesh cluster (anchor PEN-1) gets P-000001
    expect(result.persons.map((p) => [p.id, p.anchorRecordId])).toEqual([
      ["P-000001", "PEN-1"],
      ["P-000002", "RAT-1"],
    ]);
    expect(personOf(result, "RAT-2")).toBe(personOf(result, "PEN-1"));
  });

  it("leaves a pair in the review band unmerged until an officer approves it", () => {
    const records = [
      rec({ id: "A", ...RAMESH }),
      rec({ id: "B", ...RAMESH, dob: "20/09/1959", address: "99, Other Road, Kansa" }),
    ];
    expect(personCount(run(records))).toBe(2);
    expect(personCount(run(records, [{ pairKey: "A|B", decision: "approved" }]))).toBe(1);
    expect(personCount(run(records, [{ pairKey: "A|B", decision: "rejected" }]))).toBe(2);
  });

  describe("chaining guard", () => {
    // A and C carry different uids; B carries none, so A~B and B~C both look like auto merges.
    const chain = [
      rec({ id: "A", ...RAMESH, uid_hash: "uid-a" }),
      rec({ id: "B", ...RAMESH }),
      rec({ id: "C", ...RAMESH, uid_hash: "uid-c" }),
    ];

    it("does not merge a cluster whose records contradict each other", () => {
      const result = run(chain);
      expect(personCount(result)).toBe(3);
    });

    it("sets every pair inside the split cluster to review", () => {
      const result = run(chain);
      const byKey = new Map(result.candidates.map((c) => [c.pairKey, c]));
      for (const key of ["A|B", "A|C", "B|C"]) {
        const c = byKey.get(key);
        expect(c?.decision).toBe("review");
        expect(c?.reviewStatus).toBe("pending");
        expect(c?.breakdown.rules.join(" ")).toContain("chaining_guard");
      }
    });

    it("also catches a contradiction in gender or a DOB gap over 5 years", () => {
      const byGender = run([
        rec({ id: "A", ...RAMESH, uid_hash: "same" }),
        rec({ id: "B", ...RAMESH, uid_hash: "same", gender: "F" }),
      ]);
      expect(personCount(byGender)).toBe(2);

      const byDob = run([
        rec({ id: "A", ...RAMESH, uid_hash: "same" }),
        rec({ id: "B", ...RAMESH, uid_hash: "same", dob: "14/03/1970" }),
      ]);
      expect(personCount(byDob)).toBe(2);
    });

    it("keeps officer-approved pairs merged and officer-rejected pairs distinct", () => {
      const approved = run(chain, [{ pairKey: "A|B", decision: "approved" }]);
      expect(personCount(approved)).toBe(2);
      expect(personOf(approved, "A")).toBe(personOf(approved, "B"));
      expect(personOf(approved, "C")).not.toBe(personOf(approved, "A"));
      const bc = approved.candidates.find((c) => c.pairKey === "B|C");
      expect(bc?.decision).toBe("review");

      const rejected = run(chain, [{ pairKey: "B|C", decision: "rejected" }]);
      expect(rejected.candidates.find((c) => c.pairKey === "B|C")?.decision).toBe("distinct");
      expect(personOf(rejected, "A")).toBe(personOf(rejected, "B"));
    });

    it("does not split a consistent cluster", () => {
      const result = run([
        rec({ id: "A", ...RAMESH, uid_hash: "uid-a" }),
        rec({ id: "B", ...RAMESH }),
        rec({ id: "C", ...RAMESH, uid_hash: "uid-a" }),
      ]);
      expect(personCount(result)).toBe(1);
    });
  });

  describe("survivorship", () => {
    const records = [
      rec({ id: "RAT-1", ...RAMESH, full_name: "Shri Ramesh K. Patel", uid_hash: "same", uid_last4: "4321", marital_status: "married" }),
      rec({ id: "PEN-1", source: "pension", ...RAMESH, dob: "1959", uid_hash: "same", uid_last4: "4321" }),
      rec({ id: "DTH-1", source: "death_registry", ...RAMESH, full_name: "Late Rameshbhai Kantilal Patel", dob: "age 67", uid_hash: "same", date_of_death: "02/07/2026" }),
    ];

    it("takes the name from the ration record, the DOB from a full date, and flags the dead", () => {
      // The ration record carries an initial and the others only a year, so a shared uid ties them together.
      const result = run(records);
      expect(personCount(result)).toBe(1);
      const [person] = result.persons;
      expect(person.canonicalName).toBe("Ramesh K Patel");
      expect(person.dob).toBe("1959-03-14");
      expect(person.gender).toBe("M");
      expect(person.uidLast4).toBe("4321");
      expect(person.maritalStatus).toBe("married");
      expect(person.isDeceased).toBe(true);
      expect(person.deceasedOn).toBe("2026-07-02");
    });

    it("uses the longest name when there is no ration record", () => {
      const result = run([
        rec({ id: "PEN-1", source: "pension", ...RAMESH, full_name: "Ramesh K Patel", uid_hash: "u" }),
        rec({ id: "SCH-1", source: "scholarship", ...RAMESH, full_name: "Ramesh Kantilal Patel", uid_hash: "u" }),
      ]);
      expect(result.persons[0].canonicalName).toBe("Ramesh Kantilal Patel");
    });

    it("falls back to a year, then to an approximate year, when there is no full date", () => {
      const yearOnly = run([rec({ id: "A", full_name: "Ramesh Kantilal Patel", dob: "1959" })]);
      expect(yearOnly.persons[0].dob).toBe("1959");
      const approx = run([rec({ id: "A", full_name: "Ramesh Kantilal Patel", dob: "age 67" })]);
      expect(approx.persons[0].dob).toBe("1959");
      const none = run([rec({ id: "A", full_name: "Ramesh Kantilal Patel" })]);
      expect(none.persons[0].dob).toBeNull();
    });
  });
});

describe("families", () => {
  it("builds one family per ration card with the head from the card", () => {
    const result = run(card("RC-1", "1"));
    expect(result.families).toHaveLength(1);
    const [family] = result.families;
    expect(family).toMatchObject({
      id: "GJ-FID-000001", isAnchored: true, status: "active", mergedInto: null, cardRefs: ["RC-1"],
      district: "Mehsana", taluka: "Kadi", village: "Kansa",
    });
    const head = result.persons.find((p) => p.id === family.headPersonId);
    expect(head?.canonicalName).toBe("Ramesh Kantilal Patel");
    expect(result.familyMembers).toHaveLength(4);
    expect(result.familyMembers.find((m) => m.personId === family.headPersonId)?.relationToHead).toBe("head");
    expect(result.familyMembers.map((m) => m.relationToHead).sort()).toEqual(
      ["daughter_in_law", "head", "son", "spouse"],
    );
    expect(result.familyMembers.every((m) => m.validFrom === null && m.validTo === null)).toBe(true);
  });

  it("attaches pension and scholarship records to the family of the ration member they matched", () => {
    const result = run([
      ...card("RC-1", "1"),
      rec({ id: "PEN-1", source: "pension", ...RAMESH, full_name: "Rameshbhai Kantilal Patel", scheme_code: "OLD_AGE_PENSION" }),
    ]);
    expect(result.families).toHaveLength(1);
    expect(result.familyIdByPerson.get(personOf(result, "PEN-1"))).toBe("GJ-FID-000001");
    expect(result.persons).toHaveLength(4);
  });

  it("resolves income as the highest declared value and keeps every value with its record", () => {
    const records: SourceRecord[] = card("RC-1", "1").map((r) => ({ ...r, income_declared: 90_000 }));
    records.push(
      rec({ id: "PEN-1", source: "pension", ...RAMESH, income_declared: 200_000, scheme_code: "OLD_AGE_PENSION" }),
    );
    const [family] = run(records).families;
    expect(family.resolvedIncome).toBe(200_000);
    expect(family.incomeSources).toHaveLength(5);
    expect(family.incomeSources).toContainEqual({ recordId: "PEN-1", source: "pension", value: 200_000 });
  });

  it("gives anyone without a ration card a single-person unanchored family, numbered after the cards", () => {
    const result = run([
      rec({ id: "PEN-9", source: "pension", full_name: "Kanta Mohan Rabari", dob: "1950", gender: "F", income_declared: 50_000 }),
      ...card("RC-1", "1"),
    ]);
    const unanchored = result.families.find((f) => !f.isAnchored);
    expect(unanchored).toMatchObject({ id: "GJ-FID-000002", status: "active", cardRefs: [], resolvedIncome: 50_000 });
    expect(result.familyMembers.filter((m) => m.familyId === "GJ-FID-000002")).toHaveLength(1);
    expect(result.families.find((f) => f.id === "GJ-FID-000001")?.isAnchored).toBe(true);
  });

  describe("duplicate ration cards", () => {
    it("merges a card into another when shared persons / smaller card is at least 0.5, keeping the larger card", () => {
      const result = run([...card("RC-1", "1"), ...card("RC-2", "2", PEOPLE.slice(0, 3))]);
      expect(result.cardMerges).toEqual([
        { keptRef: "RC-1", mergedRef: "RC-2", keptFamilyId: "GJ-FID-000001", mergedFamilyId: "GJ-FID-000002", sharedPersons: 3, ratio: 1 },
      ]);
      const merged = result.families.find((f) => f.id === "GJ-FID-000002");
      expect(merged).toMatchObject({ status: "merged", mergedInto: "GJ-FID-000001", headPersonId: null });
      const kept = result.families.find((f) => f.id === "GJ-FID-000001");
      expect(kept?.cardRefs).toEqual(["RC-1", "RC-2"]);
      expect(result.familyMembers).toHaveLength(4);
      expect(new Set(result.familyMembers.map((m) => m.familyId))).toEqual(new Set(["GJ-FID-000001"]));
      expect(result.multiHousehold).toHaveLength(0);
    });

    it("keeps the card with more members even when it has the larger ref", () => {
      const result = run([...card("RC-1", "1", PEOPLE.slice(0, 3)), ...card("RC-2", "2")]);
      expect(result.cardMerges[0]).toMatchObject({ keptRef: "RC-2", mergedRef: "RC-1" });
      expect(result.families.find((f) => f.id === "GJ-FID-000001")).toMatchObject({ status: "merged", mergedInto: "GJ-FID-000002" });
    });

    it("breaks a tie by keeping the smaller ref", () => {
      const result = run([...card("RC-2", "2"), ...card("RC-1", "1")]);
      expect(result.cardMerges[0]).toMatchObject({ keptRef: "RC-1", mergedRef: "RC-2" });
    });

    it("does not merge cards that share fewer than half of the smaller card", () => {
      const other = [
        PEOPLE[2],
        { name: "Kiran Jayesh Patel", dob: "10/10/1990", gender: "F", relation: "spouse" },
        { name: "Dev Jayesh Patel", dob: "01/02/2012", gender: "M", relation: "son" },
        { name: "Riya Jayesh Patel", dob: "03/04/2015", gender: "F", relation: "daughter" },
      ] satisfies PersonSpec[];
      const result = run([...card("RC-1", "1"), ...card("RC-2", "2", other)]);
      expect(result.cardMerges).toHaveLength(0);
      expect(result.families.filter((f) => f.status === "active")).toHaveLength(2);
    });
  });

  describe("person on two unmerged ration cards", () => {
    const other = [
      { name: "Jayesh Ramesh Patel", dob: "05/11/1984", gender: "M", relation: "head" },
      { name: "Kiran Jayesh Patel", dob: "10/10/1990", gender: "F", relation: "spouse" },
      { name: "Dev Jayesh Patel", dob: "01/02/2012", gender: "M", relation: "son" },
      { name: "Riya Jayesh Patel", dob: "03/04/2015", gender: "F", relation: "daughter" },
    ] satisfies PersonSpec[];

    it("keeps the person on the card with the larger ref and reports multi_household", () => {
      const result = run([...card("RC-1", "1"), ...card("RC-2", "2", other)]);
      expect(result.multiHousehold).toHaveLength(1);
      const jayesh = personOf(result, "RAT-13");
      expect(personOf(result, "RAT-21")).toBe(jayesh);
      const [flag] = result.multiHousehold;
      expect(flag).toEqual({
        personId: jayesh, keptFamilyId: "GJ-FID-000002", keptCardRef: "RC-2",
        otherCardRefs: ["RC-1"], otherFamilyIds: ["GJ-FID-000001"],
      });
      expect(result.familyIdByPerson.get(jayesh)).toBe("GJ-FID-000002");
      const members = (id: string) => result.familyMembers.filter((m) => m.familyId === id).map((m) => m.personId);
      expect(members("GJ-FID-000001")).not.toContain(jayesh);
      expect(members("GJ-FID-000002")).toContain(jayesh);
      expect(result.familyMembers.filter((m) => m.personId === jayesh)).toHaveLength(1);
      // his relation comes from the card he is kept on
      expect(result.familyMembers.find((m) => m.personId === jayesh)?.relationToHead).toBe("head");
    });

    it("falls back to the eldest member when the head moved to another family", () => {
      const result = run([...card("RC-2", "2"), ...card("RC-1", "1", other)]);
      // Jayesh heads RC-1 (smaller ref) but is kept on RC-2 (larger ref), so RC-1 loses its head.
      const family = result.families.find((f) => f.id === "GJ-FID-000001");
      const head = result.persons.find((p) => p.id === family?.headPersonId);
      expect(head?.canonicalName).toBe("Kiran Jayesh Patel");
      expect(result.multiHousehold).toHaveLength(1);
    });
  });
});

describe("determinism", () => {
  const world = [
    ...card("RC-1", "1"),
    ...card("RC-2", "2", PEOPLE.slice(0, 3)),
    rec({ id: "PEN-1", source: "pension", ...RAMESH, full_name: "Rameshbhai Kantilal Patel", scheme_code: "OLD_AGE_PENSION" }),
    rec({ id: "PEN-2", source: "pension", full_name: "Kanta Mohan Rabari", dob: "1950", gender: "F" }),
    rec({ id: "DTH-1", source: "death_registry", full_name: "Late Kanta Mohan Rabari", dob: "1950", gender: "F", date_of_death: "2026-01-05" }),
  ];

  const summary = (records: SourceRecord[]) => {
    const r = run(records);
    return JSON.stringify({
      persons: r.persons, families: r.families, members: r.familyMembers,
      merges: r.cardMerges, multi: r.multiHousehold, candidates: r.candidates,
      map: [...r.personIdByRecord].sort(),
    });
  };

  it("gives identical persons, families and IDs on repeated runs", () => {
    expect(summary(world)).toBe(summary(world));
  });

  it("does not depend on the order of the input", () => {
    expect(summary([...world].reverse())).toBe(summary(world));
    const shuffled = [world[4], world[0], world[6], world[2], world[5], world[1], world[3], ...world.slice(7)];
    expect(summary(shuffled)).toBe(summary(world));
  });
});
