import { describe, expect, it } from "vitest";
import { generateSeed, type SourceRecordRow } from "../generate";

const seed = generateSeed();
const { records, planted, truth } = seed;

const byPerson = (id: string) => records.filter((r) => r.true_person_id === id);
const ofSource = (id: string, source: SourceRecordRow["source"]) =>
  byPerson(id).filter((r) => r.source === source);
const yearOf = (iso: string) => Number(iso.slice(0, 4));

describe("seed determinism and shape", () => {
  it("produces identical output on every run", () => {
    expect(generateSeed()).toEqual(seed);
  });

  it("has unique record ids and about the specified volume", () => {
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
    expect(seed.stats.households).toBe(200);
    expect(records.length).toBeGreaterThan(1000);
    expect(records.length).toBeLessThan(1250);
  });

  it("uses ids of the form RAT-000123", () => {
    expect(records.every((r) => /^(RAT|PEN|SCH|DTH)-\d{6}$/.test(r.id))).toBe(true);
  });

  it("carries a uid on about 70 percent of records, stored only as hash and last 4", () => {
    const withUid = records.filter((r) => r.uid_hash !== null);
    const rate = withUid.length / records.length;
    expect(rate).toBeGreaterThan(0.6);
    expect(rate).toBeLessThan(0.85);
    for (const r of withUid) {
      expect(r.uid_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(r.uid_last4).toMatch(/^\d{4}$/);
    }
  });

  it("only ration records have a household_ref, and the death registry never does", () => {
    for (const r of records) {
      expect(r.household_ref !== null).toBe(r.source === "ration");
    }
  });

  it("injects the different kinds of noise", () => {
    const tags = Object.keys(seed.stats.noiseTags);
    for (const tag of [
      "spelling_variant", "suffix", "title", "initial_middle", "surname_first",
      "year_only_dob", "age_string_dob", "swapped_dob", "missing_uid", "village_spelling",
    ]) {
      expect(tags).toContain(tag);
    }
    expect(records.some((r) => r.dob !== null && /^\d{4}$/.test(r.dob))).toBe(true);
    expect(records.some((r) => r.dob !== null && /^age \d+$/.test(r.dob))).toBe(true);
    expect(records.some((r) => r.dob !== null && /^\d{2}-\d{2}-\d{4}$/.test(r.dob))).toBe(true);
    expect(records.some((r) => r.dob !== null && /^\d{4}-\d{2}-\d{2}$/.test(r.dob))).toBe(true);
  });
});

describe("planted cases are present in the data", () => {
  it("10 dead people still have a pension", () => {
    expect(planted.deceasedPension).toHaveLength(10);
    for (const id of planted.deceasedPension) {
      expect(ofSource(id, "pension").length).toBeGreaterThanOrEqual(1);
      const death = ofSource(id, "death_registry");
      expect(death).toHaveLength(1);
      expect(death[0].date_of_death).not.toBeNull();
    }
  });

  it("6 people are enrolled twice in the same scheme", () => {
    expect(planted.doubleEnrollment).toHaveLength(6);
    for (const id of planted.doubleEnrollment) {
      const pensions = ofSource(id, "pension");
      expect(pensions).toHaveLength(2);
      expect(pensions[0].scheme_code).toBe(pensions[1].scheme_code);
      expect(pensions[0].source_ref).not.toBe(pensions[1].source_ref);
    }
  });

  it("5 ration cards are duplicated with different card numbers", () => {
    expect(planted.duplicateCards).toHaveLength(5);
    const members = (ref: string) =>
      new Set(records.filter((r) => r.household_ref === ref).map((r) => r.true_person_id));
    for (const { original, duplicate } of planted.duplicateCards) {
      expect(original).not.toBe(duplicate);
      const a = members(original);
      const b = members(duplicate);
      const shared = [...a].filter((id) => b.has(id)).length;
      expect(shared / Math.min(a.size, b.size)).toBeGreaterThanOrEqual(0.5);
      expect(duplicate > original).toBe(true); // the duplicate is the more recent card
    }
  });

  it("5 people are on two ration cards", () => {
    expect(planted.twoCards).toHaveLength(5);
    for (const { personId, cards } of planted.twoCards) {
      const ration = ofSource(personId, "ration");
      const refs = ration.map((r) => r.household_ref);
      expect(new Set(refs).size).toBe(2);
      expect(refs).toEqual(expect.arrayContaining(cards));
      // When the surname changed on marriage the two records can only be linked by ID.
      const surnames = new Set(ration.map((r) => r.full_name.split(" ").at(-1)));
      if (surnames.size > 1) {
        expect(ration.filter((r) => r.uid_hash !== null)).toHaveLength(2);
      }
    }
  });

  it("10 families declare conflicting incomes", () => {
    expect(planted.incomeMismatch).toHaveLength(10);
    for (const card of planted.incomeMismatch) {
      const people = new Set(records.filter((r) => r.household_ref === card).map((r) => r.true_person_id));
      const incomes = records
        .filter((r) => people.has(r.true_person_id) && r.income_declared !== null)
        .map((r) => r.income_declared as number);
      const high = Math.max(...incomes);
      const low = Math.min(...incomes);
      expect(high).toBeGreaterThan(1.5 * low);
      expect(high - low).toBeGreaterThan(50_000);
    }
  });

  it("at least 10 people have a benefit but no ration card", () => {
    expect(planted.noCardBenefit.length).toBeGreaterThanOrEqual(10);
    for (const id of planted.noCardBenefit) {
      expect(ofSource(id, "ration")).toHaveLength(0);
      expect(ofSource(id, "pension").length + ofSource(id, "scholarship").length).toBeGreaterThan(0);
    }
  });

  it("8 father and son pairs with near-identical names share a household", () => {
    expect(planted.fatherSon).toHaveLength(8);
    for (const { fatherId, sonId, householdRef } of planted.fatherSon) {
      expect(fatherId).not.toBe(sonId);
      const onCard = (id: string) => ofSource(id, "ration").some((r) => r.household_ref === householdRef);
      expect(onCard(fatherId)).toBe(true);
      expect(onCard(sonId)).toBe(true);
      expect(yearOf(truth[sonId].dob) - yearOf(truth[fatherId].dob)).toBeGreaterThanOrEqual(15);
      expect(truth[fatherId].name.split(" ")[0]).not.toBe(truth[sonId].name.split(" ")[0]);
      expect(truth[fatherId].name.split(" ").at(-1)).toBe(truth[sonId].name.split(" ").at(-1));
    }
  });

  it("7 pairs of different men share an identical name in one village", () => {
    expect(planted.sameName).toHaveLength(7);
    for (const { aId, bId } of planted.sameName) {
      expect(aId).not.toBe(bId);
      expect(truth[aId].name).toBe(truth[bId].name);
      expect(truth[aId].dob).not.toBe(truth[bId].dob);
      expect(Math.abs(yearOf(truth[aId].dob) - yearOf(truth[bId].dob))).toBeLessThanOrEqual(4);
      expect(ofSource(aId, "ration").length).toBeGreaterThan(0);
      expect(ofSource(bId, "ration").length).toBeGreaterThan(0);
    }
  });
});

describe("showcase family", () => {
  const { householdRef, headId, motherId, grandsonId } = planted.showcase;
  const card = records.filter((r) => r.household_ref === householdRef);

  it("has six people on the ration card, and the grandson is not one of them", () => {
    expect(card).toHaveLength(6);
    expect(card.some((r) => r.true_person_id === grandsonId)).toBe(false);
  });

  it("head is about 67 with a ration record and a pension record spelled differently", () => {
    expect(truth[headId].name).toBe("Ramesh Kantilal Patel");
    expect(2026 - yearOf(truth[headId].dob)).toBeGreaterThanOrEqual(66);
    expect(ofSource(headId, "ration")[0].full_name).toBe("Ramesh Kantilal Patel");
    expect(ofSource(headId, "pension")[0].full_name).toBe("Rameshbhai Kantilaal Patel");
  });

  it("spouse is alive, married and not enrolled in a pension", () => {
    const spouse = card.find((r) => r.relation_to_head === "spouse");
    expect(spouse?.marital_status).toBe("married");
    expect(ofSource(spouse?.true_person_id ?? "", "pension")).toHaveLength(0);
    expect(ofSource(spouse?.true_person_id ?? "", "death_registry")).toHaveLength(0);
  });

  it("has a granddaughter born after 2019", () => {
    const girl = card.find((r) => r.relation_to_head === "granddaughter");
    expect(girl).toBeDefined();
    expect(yearOf(truth[girl?.true_person_id ?? ""].dob)).toBeGreaterThanOrEqual(2020);
  });

  it("scholarship grandchild is linked only by the father's first name", () => {
    const [s] = ofSource(grandsonId, "scholarship");
    expect(ofSource(grandsonId, "ration")).toHaveLength(0);
    expect(s.guardian_name).toBe("Jayesh");
    expect(s.full_name).toBe("Dhruv Patel");
  });

  it("deceased mother is on the card, still has a pension, and is in the death registry", () => {
    expect(ofSource(motherId, "ration")).toHaveLength(1);
    expect(ofSource(motherId, "pension")).toHaveLength(1);
    expect(ofSource(motherId, "death_registry")).toHaveLength(1);
  });

  it("covers all four sources", () => {
    const people = new Set([...card.map((r) => r.true_person_id), grandsonId]);
    const sources = new Set(records.filter((r) => people.has(r.true_person_id)).map((r) => r.source));
    expect(sources).toEqual(new Set(["ration", "pension", "scholarship", "death_registry"]));
  });
});
