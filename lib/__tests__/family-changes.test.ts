import { describe, expect, it } from "vitest";
import {
  familyRefOf, parseFamilyChange, validateAddMember, validateMove, validDate, type FamilyContext,
} from "../family-changes";

const AS_OF = "2026-09-20";

const family = (o: Partial<FamilyContext> = {}): FamilyContext => ({
  id: "GJ-FID-000001", status: "active", district: "Mehsana", taluka: "Kadi", village: "Kansa", headPersonId: "P-1",
  members: [
    { personId: "P-1", anchorRecordId: "RAT-1", isDeceased: false, dob: "1970-01-01" },
    { personId: "P-2", anchorRecordId: "RAT-2", isDeceased: false, dob: "1995-05-05" },
    { personId: "P-3", anchorRecordId: "RAT-3", isDeceased: false, dob: "1998-08-08" },
    { personId: "P-4", anchorRecordId: "RAT-4", isDeceased: true, dob: "1940-01-01" },
  ],
  ...o,
});
const target = (o: Partial<FamilyContext> = {}): FamilyContext =>
  family({ id: "GJ-FID-000009", headPersonId: "P-9", members: [{ personId: "P-9", anchorRecordId: "RAT-9", isDeceased: false, dob: "1980-01-01" }], ...o });

describe("validDate", () => {
  it("accepts a real date up to today and rejects the rest", () => {
    expect(validDate("2026-09-20", AS_OF)).toBe("2026-09-20");
    expect(validDate("2026-09-21", AS_OF)).toBeNull();
    expect(validDate("2026-02-30", AS_OF)).toBeNull();
    expect(validDate("1899-12-31", AS_OF)).toBeNull();
    expect(validDate("20/09/2026", AS_OF)).toBeNull();
    expect(validDate(20260920, AS_OF)).toBeNull();
  });
});

describe("familyRefOf", () => {
  it("names a numbered family by its head's source record, and a manual family by its own ID", () => {
    expect(familyRefOf(family())).toEqual({ recordId: "RAT-1" });
    expect(familyRefOf(family({ headPersonId: null }))).toEqual({ recordId: "RAT-1" });
    expect(familyRefOf(family({ id: "GJ-FID-M000007" }))).toEqual({ manual: "GJ-FID-M000007" });
    expect(familyRefOf(family({ members: [] }))).toBeNull();
  });
});

describe("validateAddMember", () => {
  const ok = {
    name: "Aarav Jayesh Patel", dob: "2026-06-01", gender: "M", relation: "grandson", maritalStatus: "unmarried",
    reason: "birth", documentRef: "BC/2026/00123", note: "", isStudent: false,
  };

  it("accepts a complete request", () => {
    expect(validateAddMember(ok, family(), AS_OF)).toEqual({
      ok: true,
      value: {
        familyId: "GJ-FID-000001",
        person: { fullName: "Aarav Jayesh Patel", dob: "2026-06-01", gender: "M", relation: "grandson", marital: "unmarried", isStudent: false },
        reason: "birth", documentRef: "BC/2026/00123", note: null,
      },
    });
  });

  it("needs an active family that exists", () => {
    expect(validateAddMember(ok, null, AS_OF)).toMatchObject({ ok: false });
    expect(validateAddMember(ok, family({ status: "closed" }), AS_OF)).toMatchObject({ ok: false });
  });

  it("requires a supporting document reference, and a sensible one", () => {
    for (const documentRef of ["", "  ", "ab", "x".repeat(61), "bad<script>", undefined]) {
      expect(validateAddMember({ ...ok, documentRef }, family(), AS_OF)).toMatchObject({ ok: false });
    }
  });

  it("checks the person's details", () => {
    for (const bad of [
      { name: "Aarav" }, { name: "A1 Patel" }, { name: "" }, { dob: "2027-01-01" }, { dob: "not a date" },
      { gender: "X" }, { relation: "head" }, { relation: "cousin" }, { maritalStatus: "engaged" }, { reason: "fun" },
    ]) {
      expect(validateAddMember({ ...ok, ...bad }, family(), AS_OF)).toMatchObject({ ok: false });
    }
  });

  it("refuses a married child", () => {
    const r = validateAddMember({ ...ok, maritalStatus: "married" }, family(), AS_OF);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("under 18") });
    expect(validateAddMember({ ...ok, dob: "1990-01-01", maritalStatus: "married", relation: "daughter_in_law" }, family(), AS_OF)).toMatchObject({ ok: true });
  });

  it("keeps the note only when it is short enough", () => {
    expect(validateAddMember({ ...ok, note: "x".repeat(301) }, family(), AS_OF)).toMatchObject({ ok: false });
    expect(validateAddMember({ ...ok, note: "  born at home  " }, family(), AS_OF)).toMatchObject({ ok: true, value: { note: "born at home" } });
  });
});

describe("validateMove", () => {
  const newFamily = {
    confirmVerified: true, memberPersonIds: ["P-2", "P-3"], reason: "separation", effectiveDate: "2026-08-01",
    documentRef: "SEP-2026-44", note: "",
    destination: {
      kind: "new", headPersonId: "P-2", relations: { "P-3": "spouse" }, village: "Kansa", taluka: "Kadi",
      district: "Mehsana", income: 80000,
    },
  };
  const existing = {
    confirmVerified: true, memberPersonIds: ["P-3"], reason: "marriage", effectiveDate: "2026-08-01",
    documentRef: "MC-77/2026", destination: { kind: "existing", familyId: "GJ-FID-000009", relations: { "P-3": "daughter_in_law" } },
  };

  it("accepts a separation into a new family, with the head forced to 'head'", () => {
    const r = validateMove(newFamily, family(), null, AS_OF);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.value.movers).toEqual([
      { personId: "P-2", anchorRecordId: "RAT-2", relation: "head" },
      { personId: "P-3", anchorRecordId: "RAT-3", relation: "spouse" },
    ]);
    expect(r.value.destination).toMatchObject({ kind: "new", headPersonId: "P-2", income: 80000 });
    expect(r.value.markMarried).toBe(false);
  });

  it("accepts a marriage into an existing family and records the marriage for a single mover", () => {
    const r = validateMove(existing, family(), target(), AS_OF);
    expect(r).toMatchObject({ ok: true, value: { reason: "marriage", markMarried: true } });
    expect(validateMove({ ...existing, markMarried: false }, family(), target(), AS_OF)).toMatchObject({ ok: true, value: { markMarried: false } });
  });

  it("requires the officer to confirm the document was verified", () => {
    expect(validateMove({ ...newFamily, confirmVerified: false }, family(), null, AS_OF)).toMatchObject({ ok: false });
    expect(validateMove({ ...newFamily, confirmVerified: undefined }, family(), null, AS_OF)).toMatchObject({ ok: false });
  });

  it("requires a document reference, a reason and a real effective date", () => {
    expect(validateMove({ ...newFamily, documentRef: "" }, family(), null, AS_OF)).toMatchObject({ ok: false });
    expect(validateMove({ ...newFamily, reason: "vacation" }, family(), null, AS_OF)).toMatchObject({ ok: false });
    expect(validateMove({ ...newFamily, effectiveDate: "2027-01-01" }, family(), null, AS_OF)).toMatchObject({ ok: false });
  });

  it("only lets current, living members move, and never everyone", () => {
    expect(validateMove({ ...newFamily, memberPersonIds: [] }, family(), null, AS_OF)).toMatchObject({ ok: false });
    expect(validateMove({ ...newFamily, memberPersonIds: ["P-2", "P-99"] }, family(), null, AS_OF)).toMatchObject({ ok: false });
    expect(validateMove({ ...newFamily, memberPersonIds: ["P-2", "P-4"] }, family(), null, AS_OF)).toMatchObject({ ok: false, error: expect.stringContaining("deceased") });
    const everyone = { ...newFamily, memberPersonIds: ["P-1", "P-2", "P-3", "P-4"] };
    expect(validateMove(everyone, family(), null, AS_OF)).toMatchObject({ ok: false });
    // three living members plus one deceased: moving all three living ones still leaves the deceased one
    expect(validateMove({ ...newFamily, memberPersonIds: ["P-1", "P-2", "P-3"], destination: { ...newFamily.destination, relations: { "P-1": "father", "P-3": "spouse" } } }, family(), null, AS_OF)).toMatchObject({ ok: true });
  });

  it("checks the new family: head among the movers, place, income, and a relation for everyone else", () => {
    const dest = newFamily.destination;
    expect(validateMove({ ...newFamily, destination: { ...dest, headPersonId: "P-1" } }, family(), null, AS_OF)).toMatchObject({ ok: false });
    expect(validateMove({ ...newFamily, destination: { ...dest, village: "" } }, family(), null, AS_OF)).toMatchObject({ ok: false });
    for (const income of [-1, 1.5, "80000", 99_999_999, undefined]) {
      expect(validateMove({ ...newFamily, destination: { ...dest, income } }, family(), null, AS_OF)).toMatchObject({ ok: false });
    }
    expect(validateMove({ ...newFamily, destination: { ...dest, relations: {} } }, family(), null, AS_OF)).toMatchObject({ ok: false });
    expect(validateMove({ ...newFamily, destination: { ...dest, relations: { "P-3": "head" } } }, family(), null, AS_OF)).toMatchObject({ ok: false });
  });

  it("checks an existing target: it must exist, be active, and be a different family", () => {
    expect(validateMove(existing, family(), null, AS_OF)).toMatchObject({ ok: false });
    expect(validateMove(existing, family(), target({ status: "closed" }), AS_OF)).toMatchObject({ ok: false });
    expect(validateMove(existing, family(), target({ id: "GJ-FID-000001" }), AS_OF)).toMatchObject({ ok: false });
    expect(validateMove({ ...existing, destination: { kind: "existing", familyId: "x", relations: {} } }, family(), target(), AS_OF)).toMatchObject({ ok: false });
  });

  it("does not record a marriage for anyone under 18, or let a minor head a new family", () => {
    const withChild = family({
      members: [
        ...family().members,
        { personId: "P-5", anchorRecordId: "RAT-5", isDeceased: false, dob: "2018-03-07" },
      ],
    });
    const marriage = { ...existing, memberPersonIds: ["P-5"], destination: { kind: "existing", familyId: "GJ-FID-000009", relations: { "P-5": "daughter_in_law" } } };
    expect(validateMove(marriage, withChild, target(), AS_OF)).toMatchObject({ ok: false, error: expect.stringContaining("under 18") });
    // a year-only date of birth counts as the oldest the person could be
    const yearOnly = family({ members: [...family().members, { personId: "P-5", anchorRecordId: "RAT-5", isDeceased: false, dob: "2012" }] });
    expect(validateMove(marriage, yearOnly, target(), AS_OF)).toMatchObject({ ok: false });
    // a minor may join another family for other reasons, but cannot head a new one
    expect(validateMove({ ...marriage, reason: "other" }, withChild, target(), AS_OF)).toMatchObject({ ok: true });
    const minorHead = { ...newFamily, memberPersonIds: ["P-2", "P-5"], destination: { ...newFamily.destination, headPersonId: "P-5", relations: { "P-2": "father" } } };
    expect(validateMove(minorHead, withChild, null, AS_OF)).toMatchObject({ ok: false, error: expect.stringContaining("at least 18") });
    // an adult marrying is fine
    expect(validateMove(existing, family(), target(), AS_OF)).toMatchObject({ ok: true });
  });

  it("rejects an inactive source family and a missing destination", () => {
    expect(validateMove(newFamily, family({ status: "merged" }), null, AS_OF)).toMatchObject({ ok: false });
    expect(validateMove(newFamily, null, null, AS_OF)).toMatchObject({ ok: false });
    expect(validateMove({ ...newFamily, destination: undefined }, family(), null, AS_OF)).toMatchObject({ ok: false });
    expect(validateMove({ ...newFamily, destination: { kind: "somewhere" } }, family(), null, AS_OF)).toMatchObject({ ok: false });
  });
});

describe("parseFamilyChange", () => {
  it("reads a member_add event", () => {
    expect(parseFamilyChange({
      id: 5, type: "member_add", subject_record_id: "USR-000001",
      payload: { to: { recordId: "RAT-1" }, relation: "grandson", effectiveDate: "2026-09-01" },
    })).toEqual({
      kind: "member_add", eventId: 5, recordId: "USR-000001", to: { recordId: "RAT-1" }, relation: "grandson", effectiveDate: "2026-09-01",
    });
  });

  it("reads a family_move event to a new family and to an existing one", () => {
    const base = { id: 7, type: "family_move", subject_record_id: "RAT-2" };
    expect(parseFamilyChange({
      ...base,
      payload: {
        effectiveDate: "2026-08-01", members: [{ recordId: "RAT-2", relation: "head" }],
        to: { kind: "new", headRecordId: "RAT-2", district: "Mehsana", taluka: "Kadi", village: "Kansa", income: 80000 },
      },
    })).toMatchObject({ kind: "family_move", eventId: 7, to: { kind: "new", income: 80000 } });
    expect(parseFamilyChange({
      ...base,
      payload: { effectiveDate: "2026-08-01", members: [{ recordId: "RAT-3", relation: "daughter_in_law" }], to: { kind: "existing", family: { manual: "GJ-FID-M000001" } } },
    })).toMatchObject({ to: { kind: "existing", family: { manual: "GJ-FID-M000001" } } });
  });

  it("skips anything malformed instead of throwing", () => {
    expect(parseFamilyChange({ id: 1, type: "death", subject_record_id: "X", payload: {} })).toBeNull();
    expect(parseFamilyChange({ id: 1, type: "member_add", subject_record_id: "X", payload: null })).toBeNull();
    expect(parseFamilyChange({ id: 1, type: "member_add", subject_record_id: "X", payload: { to: {}, relation: "son" } })).toBeNull();
    expect(parseFamilyChange({ id: 1, type: "family_move", subject_record_id: "X", payload: { effectiveDate: "2026-01-01", members: [], to: { kind: "new" } } })).toBeNull();
    expect(parseFamilyChange({ id: 1, type: "family_move", subject_record_id: "X", payload: { members: [{ recordId: "R", relation: "son" }], to: { kind: "existing", family: { recordId: "R" } } } })).toBeNull();
  });
});
