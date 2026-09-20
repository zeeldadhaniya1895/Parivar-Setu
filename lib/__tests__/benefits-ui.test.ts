import { describe, expect, it } from "vitest";
import schemesJson from "../../config/schemes.json";
import { benefitStatus, isReceiving, STATUS_LABELS, type BenefitStatus } from "../benefit-status";
import { parseSchemesConfig } from "../engine/eligibility";
import { ANSWER_MAX, MESSAGE_MAX, validateAnswer, validateGrievanceInput } from "../grievances";
import { csvCell, pendingCsv, receivingCsv, toCsv, type SchemeFamilyRow } from "../reports";
import { describeRule } from "../rule-text";

const config = parseSchemesConfig(schemesJson);
const person = config.schemes.find((s) => s.code === "OLD_AGE_PENSION");
const family = config.schemes.find((s) => s.code === "PMJAY_MA");

describe("benefitStatus", () => {
  const enrol = (personId: string, schemeCode: string, basis: "record" | "auto") => ({ personId, schemeCode, basis });

  it("is receiving from records when a record covers the person", () => {
    const s = benefitStatus({ schemeCode: "OLD_AGE_PENSION", personId: "P-1", eligible: true }, [enrol("P-1", "OLD_AGE_PENSION", "record")], person);
    expect(s).toBe("receiving_record");
  });

  it("is started automatically when only an automatic grant covers the person", () => {
    const s = benefitStatus({ schemeCode: "OLD_AGE_PENSION", personId: "P-1", eligible: true }, [enrol("P-1", "OLD_AGE_PENSION", "auto")], person);
    expect(s).toBe("receiving_auto");
  });

  it("does not let one member's benefit cover another member", () => {
    const s = benefitStatus({ schemeCode: "OLD_AGE_PENSION", personId: "P-2", eligible: true }, [enrol("P-1", "OLD_AGE_PENSION", "auto")], person);
    expect(s).toBe("awaiting_verification");
  });

  it("lets any enrollment in the family cover a family-scope scheme", () => {
    const s = benefitStatus({ schemeCode: "PMJAY_MA", personId: null, eligible: true }, [enrol("P-9", "PMJAY_MA", "record")], family);
    expect(s).toBe("receiving_record");
  });

  it("is awaiting verification when eligible but not covered, and not eligible otherwise", () => {
    expect(benefitStatus({ schemeCode: "WIDOW_ASSIST", personId: "P-1", eligible: true }, [], undefined)).toBe("awaiting_verification");
    expect(benefitStatus({ schemeCode: "WIDOW_ASSIST", personId: "P-1", eligible: false }, [], undefined)).toBe("not_eligible");
  });

  it("has an English and a Gujarati label for every status", () => {
    const all: BenefitStatus[] = ["receiving_record", "receiving_auto", "awaiting_verification", "not_eligible"];
    for (const s of all) {
      expect(STATUS_LABELS[s].en.length).toBeGreaterThan(3);
      expect(STATUS_LABELS[s].gu).toMatch(/[઀-૿]/);
    }
    expect(all.filter(isReceiving)).toEqual(["receiving_record", "receiving_auto"]);
  });
});

describe("describeRule", () => {
  it("writes stored rules as sentences in English", () => {
    expect(describeRule("age gte 60", "en")).toBe("age 60 or above");
    expect(describeRule("family.resolved_income lte 120000", "en")).toBe("family income up to ₹1,20,000 a year");
    expect(describeRule("gender eq F", "en")).toBe("female");
    expect(describeRule("marital_status eq widowed", "en")).toBe("widowed");
    expect(describeRule("is_student eq true", "en")).toBe("is a student");
    expect(describeRule("dob on_or_after 2019-08-02", "en")).toBe("born on or after 02/08/2019");
    expect(describeRule("is_deceased eq false", "en")).toBe("is alive");
  });

  it("writes them in Gujarati script", () => {
    for (const rule of ["age gte 60", "family.resolved_income lte 120000", "gender eq F", "marital_status eq widowed", "is_student eq true", "dob on_or_after 2019-08-02"]) {
      expect(describeRule(rule, "gu")).toMatch(/[઀-૿]/);
    }
    expect(describeRule("age gte 60", "gu")).toContain("60");
  });

  it("passes an unknown rule through instead of hiding it", () => {
    expect(describeRule("something odd eq 1", "en")).toBe("something odd eq 1");
  });
});

describe("validateGrievanceInput", () => {
  const ok = { familyId: "GJ-FID-000001", personId: "P-000129", schemeCode: "WIDOW_ASSIST", message: "Why am I not getting widow assistance?" };

  it("accepts a well-formed question and trims it", () => {
    const r = validateGrievanceInput({ ...ok, message: "  Why is this not reaching us?  " }, config);
    expect(r).toEqual({ ok: true, value: { ...ok, message: "Why is this not reaching us?" } });
  });

  it("needs a person for a person-scheme and no person for a family-scheme", () => {
    expect(validateGrievanceInput({ ...ok, personId: null }, config)).toMatchObject({ ok: false });
    expect(validateGrievanceInput({ ...ok, schemeCode: "PMJAY_MA" }, config)).toMatchObject({ ok: false });
    expect(validateGrievanceInput({ ...ok, schemeCode: "PMJAY_MA", personId: null }, config)).toMatchObject({ ok: true });
  });

  it("rejects an unknown scheme, a missing family, and bad message lengths", () => {
    expect(validateGrievanceInput({ ...ok, schemeCode: "NOPE" }, config)).toMatchObject({ ok: false, error: expect.stringContaining("Unknown scheme") });
    expect(validateGrievanceInput({ ...ok, familyId: "" }, config)).toMatchObject({ ok: false });
    expect(validateGrievanceInput({ ...ok, message: "hi" }, config)).toMatchObject({ ok: false });
    expect(validateGrievanceInput({ ...ok, message: "x".repeat(MESSAGE_MAX + 1) }, config)).toMatchObject({ ok: false });
    expect(validateGrievanceInput({ ...ok, message: 42 }, config)).toMatchObject({ ok: false });
  });

  it("removes control characters", () => {
    const r = validateGrievanceInput({ ...ok, message: "Why\u0000 not\u0007 getting it?" }, config);
    expect(r).toMatchObject({ ok: true, value: { message: "Why not getting it?" } });
  });
});

describe("validateAnswer", () => {
  it("accepts a normal answer and rejects empty or oversized ones", () => {
    expect(validateAnswer("  Your case is being verified.  ")).toEqual({ ok: true, value: "Your case is being verified." });
    expect(validateAnswer("")).toMatchObject({ ok: false });
    expect(validateAnswer(undefined)).toMatchObject({ ok: false });
    expect(validateAnswer("x".repeat(ANSWER_MAX + 1))).toMatchObject({ ok: false });
  });
});

describe("CSV", () => {
  const row: SchemeFamilyRow = {
    familyId: "GJ-FID-000007", headName: 'Ramesh "Bhai" Patel', village: "Kansa", taluka: "Kadi", district: "Mehsana",
    people: ["Savita (Spouse)", "Ramesh (Head)"], peopleCount: 2, monthlyAmount: 2000, started: "automatic", rulesMet: "age 60 or above; family income up to ₹1,20,000 a year",
  };

  it("quotes cells with commas, quotes and line breaks, and leaves nulls empty", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(1000)).toBe("1000");
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
  });

  it("builds the receiving list with family, place, beneficiaries, amount and how it started", () => {
    const lines = receivingCsv("Old age pension", [row]).trim().split("\r\n");
    expect(lines[0]).toBe("Scheme,Family ID,Head of family,Village,Taluka,District,Beneficiaries,Beneficiary count,Monthly benefit (INR),How the benefit started");
    expect(lines[1]).toBe('Old age pension,GJ-FID-000007,"Ramesh ""Bhai"" Patel",Kansa,Kadi,Mehsana,Savita (Spouse); Ramesh (Head),2,2000,Started automatically');
  });

  it("builds the pending list with the reason and the rules met", () => {
    const lines = pendingCsv("Widow assistance", [{ ...row, started: null, monthlyAmount: 0 }]).trim().split("\r\n");
    expect(lines[0]).toContain("Why not receiving");
    expect(lines[1]).toContain("Manual verification required");
    expect(lines[1]).toContain("age 60 or above");
  });

  it("returns only the header for an empty list", () => {
    expect(receivingCsv("X", []).trim().split("\r\n")).toHaveLength(1);
  });
});
