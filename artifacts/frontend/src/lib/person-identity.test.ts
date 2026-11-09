import { expect, it } from "vitest";
import { ageFrom, matchesPerson, sharedNames, suburbFromAddress } from "./person-identity";

it("works out age from a date of birth, turning over on the birthday", () => {
  expect(ageFrom("1941-01-15", new Date(2026, 0, 14))).toBe(84);
  expect(ageFrom("1941-01-15", new Date(2026, 0, 15))).toBe(85);
  expect(ageFrom("not a date")).toBeNull();
  expect(ageFrom(null)).toBeNull();
});

it("pulls the suburb out of a one-line address", () => {
  expect(suburbFromAddress("12 Smith St, Glenelg, SA 5045")).toBe("Glenelg");
  expect(suburbFromAddress("12 Smith St, Glenelg SA 5045")).toBe("Glenelg");
  expect(suburbFromAddress("12 Smith St")).toBeNull();
  expect(suburbFromAddress("")).toBeNull();
});

it("matches on any field, every word, birth date forms and spaced numbers", () => {
  const fields = ["Ralph Edwards", "430000001", "Glenelg"];
  expect(matchesPerson("ralph glenelg", fields)).toBe(true);
  expect(matchesPerson("ralph norwood", fields)).toBe(false);
  expect(matchesPerson("4300 00001", fields)).toBe(true);
  expect(matchesPerson("15/01/1941", fields, "1941-01-15")).toBe(true);
  expect(matchesPerson("15/1/1941", fields, "1941-01-15")).toBe(true);
  expect(matchesPerson("1941", fields, "1941-01-15")).toBe(true);
  expect(matchesPerson("", fields)).toBe(true);
});

it("finds names held by more than one person, ignoring case", () => {
  expect([...sharedNames(["Jo Smith", "jo smith ", "Ben Ito"])]).toEqual(["jo smith"]);
});
