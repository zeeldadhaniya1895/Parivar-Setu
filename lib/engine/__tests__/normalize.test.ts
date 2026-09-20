import { describe, expect, it } from "vitest";
import {
  extractHouseNumber, formatDob, normalizeName, normalizePlace, parseDob, parseFullDateToIso,
  phoneticKey,
} from "../normalize";
import { AS_OF, norm } from "./fixtures";

describe("phonetic key", () => {
  const equal: readonly (readonly string[])[] = [
    ["pooja", "puja"],
    ["bhavesh", "bavesh"],
    ["chaudhary", "choudhari", "chaudhari"],
    ["savita", "sawita"],
    ["kiran", "keeran"],
    ["dhaval", "daval"],
    ["khushi", "kushi"],
    ["rathod", "rathodd"],
    ["vasai", "vase"],
  ];
  for (const group of equal) {
    it(`gives ${group.join(" / ")} the same key`, () => {
      expect(new Set(group.map(phoneticKey)).size).toBe(1);
    });
  }

  it("does not guarantee patel / patal (Jaro-Winkler handles that pair)", () => {
    expect(phoneticKey("patel")).not.toBe(phoneticKey("patal"));
  });

  it("keeps clearly different names apart", () => {
    expect(phoneticKey("ramesh")).not.toBe(phoneticKey("rakesh"));
    expect(phoneticKey("mahesh")).not.toBe(phoneticKey("mukesh"));
  });

  it("drops a trailing a only from words longer than 3 letters", () => {
    expect(phoneticKey("savita")).toBe("savit");
    expect(phoneticKey("usha")).toBe("usa");
  });

  it("turns a trailing y into i and collapses repeated letters", () => {
    expect(phoneticKey("chaudhary")).toBe("codari");
    expect(phoneticKey("kanttilal")).toBe(phoneticKey("kantilal"));
  });
});

describe("name normalization", () => {
  it("splits first, middle (father's name) and last", () => {
    expect(normalizeName("Ramesh Kantilal Patel")).toMatchObject({
      first: "ramesh", middle: "kantilal", last: "patel", middleIsInitial: false, lateMarker: false,
    });
  });

  it("lowercases and drops punctuation, extra spaces and case", () => {
    expect(normalizeName("  RAMESH,   kantilal  PATEL. ")).toMatchObject({
      first: "ramesh", middle: "kantilal", last: "patel",
    });
  });

  it("strips titles", () => {
    for (const title of ["Shri", "Shree", "Smt.", "Shrimati", "Kum", "Kumari", "Mr", "Mrs", "Ms", "Dr."]) {
      expect(normalizeName(`${title} Ramesh Kantilal Patel`)).toMatchObject({
        first: "ramesh", middle: "kantilal", last: "patel",
      });
    }
  });

  it("strips attached bhai / ben / behn honorifics", () => {
    expect(normalizeName("Rameshbhai Kantilbhai Patel")).toMatchObject({ first: "ramesh", middle: "kantil" });
    expect(normalizeName("Savitaben Ramesh Patel").first).toBe("savita");
    expect(normalizeName("Savitabehn Ramesh Patel").first).toBe("savita");
    expect(normalizeName("Ramesh Bhai Patel")).toMatchObject({ first: "ramesh", middle: null, last: "patel" });
  });

  it("keeps kumar attached to a name but drops a standalone kumar token", () => {
    expect(normalizeName("Sureshkumar Ramesh Patel").first).toBe("sureshkumar");
    expect(normalizeName("Amit Kumar Shah")).toMatchObject({ first: "amit", middle: null, last: "shah" });
  });

  it("records and removes the late marker", () => {
    for (const marker of ["Late", "Swargiya", "Sw."]) {
      const name = normalizeName(`${marker} Ramesh Kantilal Patel`);
      expect(name.lateMarker).toBe(true);
      expect(name).toMatchObject({ first: "ramesh", middle: "kantilal", last: "patel" });
    }
    expect(normalizeName("Late Shri Ramesh Patel")).toMatchObject({ first: "ramesh", last: "patel", lateMarker: true });
  });

  it("recognises surname-first order from the known surname list", () => {
    expect(normalizeName("Patel Ramesh Kantilal")).toMatchObject({
      first: "ramesh", middle: "kantilal", last: "patel",
    });
    expect(normalizeName("Chaudhary Savita")).toMatchObject({ first: "savita", middle: null, last: "chaudhary" });
  });

  it("recognises a misspelled surname in surname-first order by its phonetic key", () => {
    expect(normalizeName("Rabaree Lataben Chandrakant")).toMatchObject({ first: "lata", middle: "chandrakant", last: "rabaree" });
    expect(normalizeName("Chaudary Aryan")).toMatchObject({ first: "aryan", last: "chaudary" });
    expect(normalizeName("Sah Bharatbhai")).toMatchObject({ first: "bharat", last: "sah" });
  });

  it("does not flip a name whose last token is also a known surname", () => {
    expect(normalizeName("Patel Kantilal Shah")).toMatchObject({ first: "patel", last: "shah" });
  });

  it("treats a single-letter middle token as an initial", () => {
    expect(normalizeName("Ramesh K. Patel")).toMatchObject({ middle: "k", middleIsInitial: true });
    expect(normalizeName("Ramesh K Patel")).toMatchObject({ middle: "k", middleIsInitial: true });
    expect(normalizeName("Ramesh Kantilal Patel").middleIsInitial).toBe(false);
  });

  it("handles missing parts without inventing them", () => {
    expect(normalizeName("Dhruv Patel")).toMatchObject({ first: "dhruv", middle: null, last: "patel" });
    expect(normalizeName("Ramesh")).toMatchObject({ first: "ramesh", middle: null, last: null });
    expect(normalizeName("Shri")).toMatchObject({ first: null, middle: null, last: null });
    expect(normalizeName("")).toMatchObject({ first: null, last: null });
  });

  it("normalizes the guardian's first name", () => {
    expect(norm({ id: "SCH-1", full_name: "Dhruv Patel", guardian_name: "Jayeshbhai" }).guardianFirst).toBe("jayesh");
    expect(norm({ id: "SCH-2", full_name: "Dhruv Patel", guardian_name: null }).guardianFirst).toBeNull();
  });
});

describe("date of birth", () => {
  it("parses dd/mm/yyyy, dd-mm-yyyy and yyyy-mm-dd", () => {
    for (const raw of ["14/03/1959", "14-03-1959", "1959-03-14"]) {
      expect(parseDob(raw, AS_OF)).toEqual({ year: 1959, month: 3, day: 14, approximate: false });
    }
  });

  it("parses a bare year as a year-only date", () => {
    expect(parseDob("1958", AS_OF)).toEqual({ year: 1958, month: null, day: null, approximate: false });
  });

  it("converts age strings with the supplied as-of date and marks them approximate", () => {
    expect(parseDob("age 67", AS_OF)).toEqual({ year: 1959, month: null, day: null, approximate: true });
    expect(parseDob("Age 5", "2030-01-01")).toEqual({ year: 2025, month: null, day: null, approximate: true });
  });

  it("returns null for missing or unparseable values, and rejects impossible dates", () => {
    expect(parseDob(null, AS_OF)).toBeNull();
    expect(parseDob("sometime in spring", AS_OF)).toBeNull();
    expect(parseDob("31/02/1990", AS_OF)).toBeNull();
    expect(parseDob("14/13/1990", AS_OF)).toBeNull();
  });

  it("formats full dates as ISO and year-only as the year", () => {
    expect(formatDob({ year: 1959, month: 3, day: 4, approximate: false })).toBe("1959-03-04");
    expect(formatDob({ year: 1959, month: null, day: null, approximate: false })).toBe("1959");
    expect(parseFullDateToIso("04/03/1959", AS_OF)).toBe("1959-03-04");
    expect(parseFullDateToIso("1959", AS_OF)).toBeNull();
  });
});

describe("places and addresses", () => {
  it("gives village spelling variants the same key", () => {
    expect(norm({ id: "A", full_name: "X Y Patel", village: "Kansa" }).villageKey).toBe(
      norm({ id: "B", full_name: "X Y Patel", village: "Kansaa" }).villageKey,
    );
    expect(normalizePlace(" Ambaliyasan ")).toBe("ambaliyasan");
  });

  it("extracts the house number token", () => {
    expect(extractHouseNumber("21, Shivnagar, Kansa")).toBe("21");
    expect(extractHouseNumber("H.No 21 Shivnagar Kansa")).toBe("21");
    expect(extractHouseNumber("Shivnagar, Kansa")).toBeNull();
  });
});
