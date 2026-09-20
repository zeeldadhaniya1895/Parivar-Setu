import { describe, expect, it } from "vitest";
import { runEngine, type EngineInput } from "../run";
import type { SourceRecord, SchemesConfig } from "../types";

const dummyConfig: SchemesConfig = {
  version: "1.0",
  notice: "",
  schemes: [],
};

const baseRecord: SourceRecord = {
  id: "RAT-1",
  source: "ration",
  source_ref: "C1",
  household_ref: "HH1",
  full_name: "Test Person",
  guardian_name: null,
  dob: "1980-01-01",
  gender: "M",
  relation_to_head: "head",
  marital_status: "married",
  uid_hash: "hash1",
  uid_last4: "1234",
  district: "mehsana",
  taluka: "visnagar",
  village: "delvada",
  address: "123 main st",
  income_declared: 50000,
  scheme_code: null,
  benefit_amount: null,
  is_student: false,
  date_of_death: null,
};

describe("runEngine events (P8)", () => {
  it("applies death and marital status change events", () => {
    const input: EngineInput = {
      records: [
        baseRecord,
        {
          ...baseRecord,
          id: "RAT-2",
          full_name: "Test Spouse",
          gender: "F",
          relation_to_head: "spouse",
          uid_hash: "hash2",
          uid_last4: "5678",
        },
      ],
      decisions: [],
      events: [
        {
          type: "death",
          subjectRecordId: "RAT-1",
          date: "2026-05-15",
          newMaritalStatus: null,
        },
        {
          type: "marital_status_change",
          subjectRecordId: "RAT-2",
          date: null,
          newMaritalStatus: "widowed",
        },
      ],
      asOfDate: "2026-09-20",
      config: dummyConfig,
    };

    const result = runEngine(input);
    const head = result.persons.find((p) => p.anchorRecordId === "RAT-1");
    const spouse = result.persons.find((p) => p.anchorRecordId === "RAT-2");

    expect(head?.isDeceased).toBe(true);
    expect(head?.deceasedOn).toBe("2026-05-15");

    expect(spouse?.maritalStatus).toBe("widowed");
  });
});

describe("runEngine decisions (P9)", () => {
  it("forces a merge when a decision is approved", () => {
    const input: EngineInput = {
      records: [
        baseRecord,
        {
          ...baseRecord,
          id: "RAT-2",
          uid_hash: null,
          uid_last4: null,
          address: "different address", // Normally wouldn't auto-merge without UID
        },
      ],
      decisions: [{ pairKey: "RAT-1|RAT-2", decision: "approved" }],
      events: [],
      asOfDate: "2026-09-20",
      config: dummyConfig,
    };

    const result = runEngine(input);
    // Should be merged into exactly 1 person
    expect(result.persons).toHaveLength(1);
    expect(result.candidates[0].reviewStatus).toBe("approved");
  });

  it("forces distinct when a decision is rejected even if they would auto-merge", () => {
    const input: EngineInput = {
      records: [
        baseRecord,
        {
          ...baseRecord,
          id: "RAT-2",
          // Identical records would normally auto-merge
        },
      ],
      decisions: [{ pairKey: "RAT-1|RAT-2", decision: "rejected" }],
      events: [],
      asOfDate: "2026-09-20",
      config: dummyConfig,
    };

    const result = runEngine(input);
    // Should be split into 2 persons
    expect(result.persons).toHaveLength(2);
    expect(result.candidates[0].reviewStatus).toBe("rejected");
  });
});
