import { describe, expect, it } from "vitest";
import schemesJson from "../../../config/schemes.json";
import { parseSchemesConfig } from "../eligibility";
import { manualFamilyId } from "../family-changes";
import { runEngine, type EngineResult } from "../run";
import type { FamilyChange, SourceRecord } from "../types";
import { rec } from "./fixtures";

const config = parseSchemesConfig(schemesJson);
const RC1 = "GJ-FID-000001";
const RC2 = "GJ-FID-000002";

const person = (
  id: string, card: string, income: number,
  o: Partial<SourceRecord> & Pick<SourceRecord, "full_name" | "dob" | "gender" | "relation_to_head">,
) => rec({ id, household_ref: card, income_declared: income, marital_status: "married", ...o });

/** Two ration cards: the Patels (RC-1, poorer or richer as needed) and the Shahs (RC-2). */
function world(income1 = 400_000, income2 = 300_000): SourceRecord[] {
  return [
    person("RAT-11", "RC-1", income1, { full_name: "Ramesh Kantilal Patel", dob: "14/03/1959", gender: "M", relation_to_head: "head" }),
    person("RAT-12", "RC-1", income1, { full_name: "Savita Ramesh Patel", dob: "02/08/1962", gender: "F", relation_to_head: "spouse" }),
    person("RAT-13", "RC-1", income1, { full_name: "Jayesh Ramesh Patel", dob: "05/11/1984", gender: "M", relation_to_head: "son", uid_hash: "u-jay" }),
    person("RAT-14", "RC-1", income1, { full_name: "Meera Ramesh Patel", dob: "20/07/1990", gender: "F", relation_to_head: "daughter", marital_status: "unmarried" }),
    person("RAT-21", "RC-2", income2, { full_name: "Dinesh Mohan Shah", dob: "10/01/1980", gender: "M", relation_to_head: "head" }),
    person("RAT-22", "RC-2", income2, { full_name: "Kiran Dinesh Shah", dob: "15/06/1985", gender: "F", relation_to_head: "spouse" }),
    person("RAT-23", "RC-2", income2, { full_name: "Riya Dinesh Shah", dob: "03/04/2012", gender: "F", relation_to_head: "daughter", marital_status: "unmarried" }),
  ];
}

const baby = () =>
  rec({
    id: "USR-000001", source: "officer_entry", full_name: "Aarav Jayesh Patel", dob: "2026-06-01", gender: "M",
    marital_status: "unmarried", relation_to_head: "grandson",
  });

const run = (records: SourceRecord[], changes: FamilyChange[] = []): EngineResult =>
  runEngine({ records, decisions: [], events: [], familyChanges: changes, asOfDate: "2026-09-20", config });

const personOf = (out: EngineResult, recordId: string): string => {
  const id = out.personIdByRecord.get(recordId);
  if (!id) throw new Error(`no person for ${recordId}`);
  return id;
};
const familyOf = (out: EngineResult, recordId: string) =>
  out.familyMembers.find((m) => m.personId === personOf(out, recordId))?.familyId;
const membersOf = (out: EngineResult, familyId: string) =>
  out.familyMembers.filter((m) => m.familyId === familyId).map((m) => m.personId).sort();
const family = (out: EngineResult, id: string) => out.families.find((f) => f.id === id);

const moveNew = (
  eventId: number, recordIds: string[], head: string, income: number, date = "2026-08-01",
): FamilyChange => ({
  kind: "family_move", eventId, effectiveDate: date,
  members: recordIds.map((recordId) => ({ recordId, relation: recordId === head ? "head" : "spouse" })),
  to: { kind: "new", headRecordId: head, district: "Mehsana", taluka: "Kadi", village: "Kansa", income },
});

describe("adding a member", () => {
  const change: FamilyChange = {
    kind: "member_add", eventId: 5, recordId: "USR-000001", to: { cardRef: "RC-1" }, relation: "grandson", effectiveDate: "2026-09-01",
  };
  const before = run([...world(), baby()]);
  const after = run([...world(), baby()], [change]);

  it("puts the new person in the family with the given relation and an opening event", () => {
    const babyPerson = personOf(after, "USR-000001");
    expect(familyOf(after, "USR-000001")).toBe(RC1);
    expect(after.familyMembers.find((m) => m.personId === babyPerson)).toMatchObject({
      relationToHead: "grandson", validFrom: "2026-09-01", validTo: null, openedByEvent: 5, closedByEvent: null,
    });
    expect(membersOf(after, RC1)).toHaveLength(5);
    expect(after.persons.find((p) => p.id === babyPerson)?.canonicalName).toBe("Aarav Jayesh Patel");
  });

  it("closes the placeholder family a lone new person starts in, and records no history for it", () => {
    const placeholder = before.families.find((f) => f.id !== RC1 && f.id !== RC2);
    expect(placeholder?.status).toBe("active");
    expect(family(after, placeholder?.id ?? "")?.status).toBe("closed");
    expect(after.memberHistory).toEqual([]);
  });

  it("leaves every other Family ID and person ID exactly as they were", () => {
    expect(after.persons.map((p) => p.id)).toEqual(before.persons.map((p) => p.id));
    expect(after.families.map((f) => f.id)).toEqual(before.families.map((f) => f.id));
    expect(family(after, RC1)?.headPersonId).toBe(family(before, RC1)?.headPersonId);
  });

  it("does not count the closed family, and the baby is judged with the family they joined", () => {
    expect(after.stats.families).toBe(before.stats.families - 1);
    const babyId = personOf(after, "USR-000001");
    const results = after.eligibility.filter((r) => r.personId === babyId);
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.familyId === RC1)).toBe(true);
    // the closed placeholder has no eligibility results at all
    const placeholder = before.families.find((f) => f.id !== RC1 && f.id !== RC2)?.id;
    expect(after.eligibility.some((r) => r.familyId === placeholder)).toBe(false);
    expect(before.eligibility.some((r) => r.familyId === placeholder)).toBe(true);
  });

  it("ignores an unknown family or record", () => {
    expect(run([...world(), baby()], [{ ...change, to: { cardRef: "NOPE" } }]).families).toEqual(before.families);
    expect(run([...world(), baby()], [{ ...change, recordId: "USR-999999" }]).familyMembers).toEqual(before.familyMembers);
  });
});

describe("separating members into a new family", () => {
  const out = run(world(), [moveNew(7, ["RAT-13"], "RAT-13", 60_000)]);
  const newId = manualFamilyId(7);

  it("creates a family with its own stable ID, the chosen head, place and parent", () => {
    expect(newId).toBe("GJ-FID-M000007");
    const created = family(out, newId);
    expect(created).toMatchObject({
      id: newId, headPersonId: personOf(out, "RAT-13"), district: "Mehsana", taluka: "Kadi", village: "Kansa",
      isAnchored: false, status: "active", parentFamilyId: RC1, cardRefs: [],
    });
    expect(membersOf(out, newId)).toEqual([personOf(out, "RAT-13")]);
  });

  it("removes the person from the old family and keeps the history of that membership", () => {
    expect(membersOf(out, RC1)).not.toContain(personOf(out, "RAT-13"));
    expect(membersOf(out, RC1)).toHaveLength(3);
    expect(out.memberHistory).toEqual([
      expect.objectContaining({
        familyId: RC1, personId: personOf(out, "RAT-13"), validTo: "2026-08-01", closedByEvent: 7,
      }),
    ]);
    expect(out.familyMembers.find((m) => m.personId === personOf(out, "RAT-13"))).toMatchObject({
      familyId: newId, relationToHead: "head", validFrom: "2026-08-01", openedByEvent: 7,
    });
  });

  it("gives the new family its own income, and recomputes the old one without the leaver", () => {
    expect(family(out, newId)).toMatchObject({
      resolvedIncome: 60_000,
      incomeSources: [{ recordId: "EVT-000007", source: "officer_entry", value: 60_000 }],
    });
    expect(family(out, RC1)?.incomeSources.map((s) => s.recordId)).toEqual(["RAT-11", "RAT-12", "RAT-14"]);
  });

  it("is applied to eligibility: the person is judged on the new household's income", () => {
    const poorMove = run(world(), [moveNew(7, ["RAT-11", "RAT-12"], "RAT-11", 200_000)]);
    const ramesh = poorMove.eligibility.find((r) => r.personId === personOf(poorMove, "RAT-11") && r.schemeCode === "OLD_AGE_PENSION");
    expect(ramesh?.familyId).toBe(newId);
    expect(ramesh?.eligible).toBe(false);
    expect(ramesh?.reasons.find((r) => r.rule.startsWith("family.resolved_income"))?.actual).toBe(200_000);
  });

  it("makes the eldest remaining member head when the head leaves", () => {
    const headLeaves = run(world(), [moveNew(3, ["RAT-11", "RAT-12"], "RAT-11", 50_000)]);
    const old = family(headLeaves, RC1);
    expect(old?.headPersonId).toBe(personOf(headLeaves, "RAT-13")); // Jayesh, 1984, older than Meera
    expect(headLeaves.familyMembers.find((m) => m.personId === old?.headPersonId)?.relationToHead).toBe("head");
  });

  it("closes a family when everyone leaves", () => {
    const allLeave = run(world(), [moveNew(3, ["RAT-11", "RAT-12", "RAT-13", "RAT-14"], "RAT-11", 50_000)]);
    expect(family(allLeave, RC1)).toMatchObject({ status: "closed", headPersonId: null, resolvedIncome: null });
    expect(allLeave.stats.families).toBe(2); // the new family and RC-2
  });

  it("ignores a move whose head is not among the people moving, or with nobody to move", () => {
    const base = run(world());
    const badHead = moveNew(7, ["RAT-13"], "RAT-11", 60_000);
    expect(run(world(), [badHead]).familyMembers).toEqual(base.familyMembers);
    expect(run(world(), [moveNew(7, ["RAT-404"], "RAT-404", 60_000)]).familyMembers).toEqual(base.familyMembers);
  });
});

describe("moving into an existing family", () => {
  const change: FamilyChange = {
    kind: "family_move", eventId: 4, effectiveDate: "2026-07-15",
    members: [{ recordId: "RAT-14", relation: "daughter_in_law" }],
    to: { kind: "existing", family: { cardRef: "RC-2" } },
  };
  const out = run(world(), [change]);

  it("moves her, with the relation to the new family's head, and no family is created", () => {
    expect(familyOf(out, "RAT-14")).toBe(RC2);
    expect(out.familyMembers.find((m) => m.personId === personOf(out, "RAT-14"))?.relationToHead).toBe("daughter_in_law");
    expect(membersOf(out, RC2)).toHaveLength(4);
    expect(out.families.map((f) => f.id)).toEqual([RC1, RC2]);
    expect(out.memberHistory).toHaveLength(1);
  });

  it("does not import her parents' household income into her new family", () => {
    // Her ration record declares 400,000; the Shah family declares 300,000.
    expect(family(out, RC2)?.resolvedIncome).toBe(300_000);
    expect(family(out, RC2)?.incomeSources.map((s) => s.recordId)).toEqual(["RAT-21", "RAT-22", "RAT-23"]);
    expect(family(out, RC1)?.resolvedIncome).toBe(400_000);
  });

  it("refuses a target that is not an active family", () => {
    const bad = { ...change, to: { kind: "existing" as const, family: { cardRef: "RC-NONE" } } };
    expect(familyOf(run(world(), [bad]), "RAT-14")).toBe(RC1);
  });
});

describe("benefits follow the person", () => {
  const records = [
    ...world(90_000),
    rec({
      id: "PEN-1", source: "pension", full_name: "Savita Ramesh Patel", dob: "02/08/1962", gender: "F",
      scheme_code: "OLD_AGE_PENSION", benefit_amount: 1000, income_declared: 90_000,
    }),
  ];
  const out = run(records, [moveNew(9, ["RAT-11", "RAT-12"], "RAT-11", 50_000)]);
  const newId = manualFamilyId(9);
  const savita = personOf(out, "RAT-12");

  it("moves a person's pension record enrollment to their new family", () => {
    const pension = out.enrollments.find((e) => e.schemeCode === "OLD_AGE_PENSION" && e.personId === savita);
    expect(pension).toMatchObject({ basis: "record", familyId: newId, sourceRecordId: "PEN-1" });
  });

  it("leaves the ration card's enrollment with the old family and gives the new family an automatic ration", () => {
    const nfsa = out.enrollments.filter((e) => e.schemeCode === "NFSA_RATION");
    expect(nfsa.filter((e) => e.familyId === RC1).map((e) => e.basis)).toEqual(["record"]);
    expect(nfsa.filter((e) => e.familyId === newId).map((e) => e.basis)).toEqual(["auto"]);
    expect(new Set(nfsa.map((e) => e.familyId)).size).toBe(nfsa.length);
  });

  it("starts the head's pension automatically in the new family", () => {
    const ramesh = out.enrollments.find((e) => e.schemeCode === "OLD_AGE_PENSION" && e.personId === personOf(out, "RAT-11"));
    expect(ramesh).toMatchObject({ basis: "auto", familyId: newId });
  });
});

describe("flags and chained changes", () => {
  it("drops the multiple-households flag for a person an officer has placed", () => {
    const stale = person("RAT-33", "RC-2", 300_000, {
      full_name: "Jayesh Ramesh Patel", dob: "05/11/1984", gender: "M", relation_to_head: "son", uid_hash: "u-jay",
    });
    const records = [...world(), stale];
    expect(run(records).flags.map((f) => f.type)).toContain("multi_household");
    const settled = run(records, [moveNew(4, ["RAT-13"], "RAT-13", 80_000)]);
    expect(settled.flags.map((f) => f.type)).not.toContain("multi_household");
    expect(settled.multiHousehold).toEqual([]);
  });

  it("lets a later change refer to a family an earlier change created", () => {
    const changes: FamilyChange[] = [
      moveNew(1, ["RAT-13"], "RAT-13", 60_000),
      { kind: "member_add", eventId: 2, recordId: "USR-000001", to: { manual: manualFamilyId(1) }, relation: "son", effectiveDate: "2026-09-02" },
    ];
    const out = run([...world(), baby()], changes);
    expect(familyOf(out, "USR-000001")).toBe(manualFamilyId(1));
    expect(membersOf(out, manualFamilyId(1))).toHaveLength(2);
    // the baby brings no income of his own; the family keeps the officer-entered figure
    expect(family(out, manualFamilyId(1))?.resolvedIncome).toBe(60_000);
  });
});

describe("determinism", () => {
  const changes: FamilyChange[] = [
    moveNew(1, ["RAT-13"], "RAT-13", 60_000),
    { kind: "member_add", eventId: 2, recordId: "USR-000001", to: { manual: manualFamilyId(1) }, relation: "son", effectiveDate: null },
    { kind: "family_move", eventId: 3, effectiveDate: "2026-09-05", members: [{ recordId: "RAT-14", relation: "daughter_in_law" }], to: { kind: "existing", family: { cardRef: "RC-2" } } },
  ];
  const records = [...world(), baby()];

  it("gives identical results on repeated runs", () => {
    expect(run(records, changes)).toEqual(run(records, changes));
  });

  it("applies changes in event order, whatever order they arrive in", () => {
    expect(run(records, [...changes].reverse())).toEqual(run(records, changes));
    expect(run([...records].reverse(), [changes[2], changes[0], changes[1]])).toEqual(run(records, changes));
  });

  it("changes nothing when there are no changes", () => {
    const base = run(records);
    expect(run(records, [])).toEqual(base);
    expect(base.memberHistory).toEqual([]);
  });
});
