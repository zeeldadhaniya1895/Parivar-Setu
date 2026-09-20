import { describe, expect, it } from "vitest";
import { evaluatePairs } from "../evaluate";

const map = (entries: [string, string][]) => new Map(entries);

describe("evaluatePairs", () => {
  const ids = ["A", "B", "C", "D", "E", "F"];
  const truth = map([["A", "t1"], ["B", "t1"], ["C", "t1"], ["D", "t2"], ["E", "t2"], ["F", "t3"]]);

  it("scores a perfect clustering 1 / 1 / 1", () => {
    const predicted = map([["A", "p1"], ["B", "p1"], ["C", "p1"], ["D", "p2"], ["E", "p2"], ["F", "p3"]]);
    expect(evaluatePairs(ids, predicted, truth)).toEqual({
      precision: 1, recall: 1, f1: 1, truePairs: 4, predictedPairs: 4, correctPairs: 4,
    });
  });

  it("lowers recall when records of one person are split", () => {
    // t1 split into {A,B} and {C}: 1 of 3 t1 pairs found
    const predicted = map([["A", "p1"], ["B", "p1"], ["C", "p9"], ["D", "p2"], ["E", "p2"], ["F", "p3"]]);
    const r = evaluatePairs(ids, predicted, truth);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(2 / 4);
    expect(r.f1).toBeCloseTo((2 * 1 * 0.5) / 1.5, 10);
  });

  it("lowers precision when different people are merged", () => {
    // everyone in one person: 15 predicted pairs, 4 correct
    const predicted = map(ids.map((id): [string, string] => [id, "p1"]));
    const r = evaluatePairs(ids, predicted, truth);
    expect(r.predictedPairs).toBe(15);
    expect(r.precision).toBe(4 / 15);
    expect(r.recall).toBe(1);
  });

  it("returns null instead of dividing by zero", () => {
    const singletons = map(ids.map((id): [string, string] => [id, `p-${id}`]));
    const r = evaluatePairs(ids, singletons, truth);
    expect(r.precision).toBeNull();
    expect(r.recall).toBe(0);
    expect(r.f1).toBeNull();
    expect(evaluatePairs([], new Map(), new Map())).toMatchObject({ precision: null, recall: null, f1: null });
  });

  it("only scores the records it is given (the death registry is left out by the caller)", () => {
    const predicted = map([["A", "p1"], ["B", "p1"], ["C", "p1"], ["D", "p2"], ["E", "p2"], ["F", "p3"]]);
    const r = evaluatePairs(["A", "B", "D", "E"], predicted, truth);
    expect(r).toMatchObject({ truePairs: 2, predictedPairs: 2, correctPairs: 2 });
  });
});
