import { describe, expect, it } from "vitest";
import { deriveEnrollments } from "../enrollments";
import { findMatches } from "../match";
import { normalizeRecord } from "../normalize";
import { resolve } from "../resolve";
import type { SourceRecord } from "../types";
import { AS_OF, card, rec } from "./fixtures";

function derive(records: SourceRecord[]) {
  const normalized = records.map((r) => normalizeRecord(r, AS_OF));
  const resolved = resolve(normalized, findMatches(normalized));
  return {
    resolved,
    enrollments: deriveEnrollments(normalized, resolved.personIdByRecord, resolved.familyIdByPerson, resolved.families),
  };
}

describe("deriveEnrollments", () => {
  it("makes one enrollment per pension or scholarship record, on the person and family it resolved to", () => {
    const { enrollments, resolved } = derive([
      ...card("RC-1", "1"),
      rec({
        id: "PEN-1", source: "pension", full_name: "Rameshbhai Kantilal Patel", dob: "14/03/1959", gender: "M",
        scheme_code: "OLD_AGE_PENSION", benefit_amount: 1000,
      }),
    ]);
    const pension = enrollments.find((e) => e.sourceRecordId === "PEN-1");
    expect(pension).toEqual({
      basis: "record", personId: resolved.personIdByRecord.get("PEN-1"), familyId: "GJ-FID-000001",
      schemeCode: "OLD_AGE_PENSION", sourceRecordId: "PEN-1", monthlyAmount: 1000,
    });
  });

  it("gives every anchored family one family-scope NFSA_RATION enrollment on its head", () => {
    const { enrollments, resolved } = derive(card("RC-1", "1"));
    expect(enrollments).toEqual([
      {
        basis: "record", personId: resolved.families[0].headPersonId, familyId: "GJ-FID-000001", schemeCode: "NFSA_RATION",
        sourceRecordId: "RAT-11", monthlyAmount: null,
      },
    ]);
  });

  it("adds none for a merged duplicate card or an unanchored family", () => {
    const { enrollments } = derive([
      ...card("RC-1", "1"), ...card("RC-2", "2"),
      rec({
        id: "PEN-9", source: "pension", full_name: "Kanta Mohan Rabari", dob: "1950", gender: "F",
        scheme_code: "WIDOW_ASSIST", benefit_amount: 1250,
      }),
    ]);
    const nfsa = enrollments.filter((e) => e.schemeCode === "NFSA_RATION");
    expect(nfsa).toHaveLength(1);
    expect(nfsa[0].familyId).toBe("GJ-FID-000001");
    expect(enrollments.find((e) => e.sourceRecordId === "PEN-9")?.familyId).toBe("GJ-FID-000003");
  });

  it("is sorted by source record id", () => {
    const { enrollments } = derive([
      ...card("RC-1", "1"),
      rec({ id: "PEN-2", source: "pension", full_name: "Kanta Mohan Rabari", dob: "1950", gender: "F", scheme_code: "WIDOW_ASSIST" }),
      rec({ id: "PEN-1", source: "pension", full_name: "Lata Naresh Bharwad", dob: "1948", gender: "F", scheme_code: "WIDOW_ASSIST" }),
    ]);
    const ids = enrollments.map((e) => e.sourceRecordId);
    expect(ids).toEqual([...ids].sort());
  });
});
