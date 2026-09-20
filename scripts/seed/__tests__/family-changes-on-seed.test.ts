import { describe, expect, it } from "vitest";
import schemesJson from "../../../config/schemes.json";
import { parseSchemesConfig } from "../../../lib/engine/eligibility";
import { manualFamilyId } from "../../../lib/engine/family-changes";
import { runEngine, type EngineResult } from "../../../lib/engine/run";
import type { FamilyChange, SourceRecord } from "../../../lib/engine/types";
import { generateSeed } from "../generate";

const config = parseSchemesConfig(schemesJson);
const seed = generateSeed();
const truth = new Map(seed.records.map((r) => [r.id, r.true_person_id]));
const records: SourceRecord[] = seed.records.map((r) => {
  const { true_person_id: hidden, ...row } = r;
  void hidden;
  return row;
});

const run = (extra: SourceRecord[] = [], changes: FamilyChange[] = []): EngineResult =>
  runEngine({ records: [...records, ...extra], decisions: [], events: [], familyChanges: changes, asOfDate: "2026-09-20", config, truth });

const base = run();

// A real anchored family with a head and at least three living members.
const membersByFamily = new Map<string, string[]>();
for (const m of base.familyMembers) membersByFamily.set(m.familyId, [...(membersByFamily.get(m.familyId) ?? []), m.personId]);
const anchorOf = new Map(base.persons.map((p) => [p.id, p.anchorRecordId]));
const deceased = new Set(base.persons.filter((p) => p.isDeceased).map((p) => p.id));
const source = base.families.find(
  (f) => f.isAnchored && f.status === "active" &&
    (membersByFamily.get(f.id) ?? []).length >= 4 && (membersByFamily.get(f.id) ?? []).every((p) => !deceased.has(p)),
);
if (!source) throw new Error("no suitable seeded family");
const sourceMembers = membersByFamily.get(source.id) ?? [];
const mover = sourceMembers.find((p) => p !== source.headPersonId) ?? "";
const anchor = (personId: string) => anchorOf.get(personId) ?? "";

describe("family changes on the seeded data", () => {
  const move: FamilyChange = {
    kind: "family_move", eventId: 11, effectiveDate: "2026-08-01",
    members: [{ recordId: anchor(mover), relation: "head" }],
    to: { kind: "new", headRecordId: anchor(mover), district: source.district, taluka: source.taluka, village: source.village, income: 70_000 },
  };
  const after = run([], [move]);

  it("creates one new family and leaves every other person and family ID untouched", () => {
    expect(after.persons.map((p) => [p.id, p.anchorRecordId])).toEqual(base.persons.map((p) => [p.id, p.anchorRecordId]));
    const baseIds = base.families.map((f) => f.id);
    expect(after.families.map((f) => f.id)).toEqual([...baseIds, manualFamilyId(11)]);
    expect(after.stats.families).toBe(base.stats.families + 1);
  });

  it("changes only the two families involved", () => {
    const changed = after.families.filter((f) => JSON.stringify(f) !== JSON.stringify(base.families.find((b) => b.id === f.id)));
    expect(changed.map((f) => f.id).sort()).toEqual([source.id, manualFamilyId(11)].sort());
  });

  it("moves exactly one person, with history", () => {
    expect((after.familyMembers.find((m) => m.personId === mover))?.familyId).toBe(manualFamilyId(11));
    expect(after.memberHistory).toHaveLength(1);
    expect(after.familyMembers.filter((m) => m.familyId === source.id)).toHaveLength(sourceMembers.length - 1);
    expect(after.familyMembers.length).toBe(base.familyMembers.length);
  });

  it("is deterministic", () => {
    expect(run([], [move])).toEqual(after);
  });
});

describe("adding a member on the seeded data", () => {
  const baby: SourceRecord = {
    id: "USR-000001", source: "officer_entry", source_ref: "USR-000001", household_ref: null,
    full_name: "Aarav Rakesh Patel", guardian_name: null, dob: "2026-06-01", gender: "M", relation_to_head: "grandson",
    marital_status: "unmarried", uid_hash: null, uid_last4: null, district: source.district, taluka: source.taluka,
    village: source.village, address: source.village, income_declared: null, scheme_code: null, benefit_amount: null,
    is_student: false, date_of_death: null,
  };
  const add: FamilyChange = {
    kind: "member_add", eventId: 12, recordId: baby.id, to: { recordId: anchor(source.headPersonId ?? "") },
    relation: "grandson", effectiveDate: "2026-09-01",
  };
  const before = run([baby]);
  const after = run([baby], [add]);

  it("adds the person to the family and does not disturb the numbering of anyone else", () => {
    expect(after.persons.length).toBe(base.persons.length + 1);
    expect(after.persons.slice(0, base.persons.length).map((p) => p.id)).toEqual(base.persons.map((p) => p.id));
    expect(after.familyMembers.filter((m) => m.familyId === source.id)).toHaveLength(sourceMembers.length + 1);
    expect(before.families.map((f) => f.id).slice(0, base.families.length)).toEqual(base.families.map((f) => f.id));
  });

  it("closes the placeholder family, so the active count is unchanged from the baseline", () => {
    expect(before.stats.families).toBe(base.stats.families + 1);
    expect(after.stats.families).toBe(base.stats.families);
  });
});
