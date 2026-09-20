import { describe, expect, it } from "vitest";
import { findMatches } from "../../../lib/engine/match";
import { normalizeRecord } from "../../../lib/engine/normalize";
import { resolve } from "../../../lib/engine/resolve";
import { generateSeed } from "../generate";

const AS_OF = "2026-09-20";
const seed = generateSeed();
const truth = new Map(seed.records.map((r) => [r.id, r.true_person_id]));

function runEngine() {
  // The engine never sees the ground-truth column.
  const records = seed.records.map((r) => {
    const { true_person_id: hidden, ...row } = r;
    void hidden;
    return normalizeRecord(row, AS_OF);
  });
  const candidates = findMatches(records);
  return { candidates, result: resolve(records, candidates) };
}

const { candidates, result } = runEngine();

const personOfTrue = (trueId: string): string => {
  const record = seed.records.find((r) => r.true_person_id === trueId);
  const person = record && result.personIdByRecord.get(record.id);
  if (!person) throw new Error(`no person for ${trueId}`);
  return person;
};

describe("engine on the seed data", () => {
  it("is deterministic, including person and family IDs", () => {
    const again = runEngine().result;
    expect(again.persons).toEqual(result.persons);
    expect(again.families).toEqual(result.families);
    expect(again.familyMembers).toEqual(result.familyMembers);
  });

  it("scores well but not perfectly on pairwise recall (evaluation excludes the death registry)", () => {
    const ids = seed.records.filter((r) => r.source !== "death_registry").map((r) => r.id);
    const groups = <K>(key: (id: string) => K) => {
      const map = new Map<K, string[]>();
      for (const id of ids) map.set(key(id), [...(map.get(key(id)) ?? []), id]);
      return [...map.values()];
    };
    const pairs = (g: string[]) => (g.length * (g.length - 1)) / 2;
    const truePairs = groups((id) => truth.get(id)).reduce((n, g) => n + pairs(g), 0);
    const predicted = groups((id) => result.personIdByRecord.get(id));
    const predictedPairs = predicted.reduce((n, g) => n + pairs(g), 0);
    let correct = 0;
    for (const g of predicted) {
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) if (truth.get(g[i]) === truth.get(g[j])) correct++;
      }
    }
    expect(correct / predictedPairs).toBeGreaterThanOrEqual(0.98);
    expect(correct / truePairs).toBeGreaterThanOrEqual(0.9);
    expect(correct / truePairs).toBeLessThan(1); // year-only DOBs etc. stay in the review queue
    expect(candidates.filter((c) => c.decision === "review").length).toBeGreaterThan(10);
  });

  it("never merges a father with his near-identically named son", () => {
    for (const { fatherId, sonId } of seed.planted.fatherSon) {
      expect(personOfTrue(fatherId)).not.toBe(personOfTrue(sonId));
    }
  });

  it("never auto-merges two different men who share a full name", () => {
    for (const { aId, bId } of seed.planted.sameName) {
      expect(personOfTrue(aId)).not.toBe(personOfTrue(bId));
    }
  });

  it("finds the 5 duplicate ration cards and nothing else", () => {
    expect(result.cardMerges).toHaveLength(seed.planted.duplicateCards.length);
    for (const { original, duplicate } of seed.planted.duplicateCards) {
      expect(
        result.cardMerges.some(
          (m) => [m.keptRef, m.mergedRef].sort().join() === [original, duplicate].sort().join(),
        ),
      ).toBe(true);
    }
  });

  it("finds the 5 people on two ration cards", () => {
    expect(result.multiHousehold).toHaveLength(seed.planted.twoCards.length);
    for (const { personId, cards } of seed.planted.twoCards) {
      const flag = result.multiHousehold.find((m) => m.personId === personOfTrue(personId));
      expect(flag).toBeDefined();
      expect([flag?.keptCardRef, ...(flag?.otherCardRefs ?? [])].sort()).toEqual([...cards].sort());
      expect(flag?.keptCardRef).toBe([...cards].sort()[1]); // the larger ref is the more recent card
    }
  });

  it("links the death registry to the 10 dead pensioners", () => {
    for (const id of seed.planted.deceasedPension) {
      const person = result.persons.find((p) => p.id === personOfTrue(id));
      expect(person?.isDeceased).toBe(true);
      expect(person?.deceasedOn).not.toBeNull();
    }
  });

  it("keeps the showcase family together, attaches the head's pension, and leaves the grandson unanchored", () => {
    const { headId, motherId, grandsonId, householdRef } = seed.planted.showcase;
    const family = result.families.find((f) => f.cardRefs.includes(householdRef));
    expect(family).toBeDefined();
    expect(result.familyIdByPerson.get(personOfTrue(headId))).toBe(family?.id);
    expect(family?.headPersonId).toBe(personOfTrue(headId));
    expect(family?.resolvedIncome).toBe(96_000);

    const head = result.persons.find((p) => p.id === personOfTrue(headId));
    expect(head?.recordIds.some((id) => id.startsWith("PEN-"))).toBe(true); // pension merged despite the spelling variant
    const mother = result.persons.find((p) => p.id === personOfTrue(motherId));
    expect(mother?.recordIds.map((id) => id.slice(0, 3)).sort()).toEqual(["DTH", "PEN", "RAT"]);
    expect(mother?.isDeceased).toBe(true);

    // Only a scholarship record with the father's name: no family until P10 attaches it.
    const grandsonFamily = result.families.find((f) => f.id === result.familyIdByPerson.get(personOfTrue(grandsonId)));
    expect(grandsonFamily?.isAnchored).toBe(false);
  });

  it("runs the full seed in well under a few seconds", () => {
    const started = performance.now();
    runEngine();
    expect(performance.now() - started).toBeLessThan(3000);
  });
});
