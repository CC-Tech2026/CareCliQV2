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

it("matches a typed number as one number, never in pieces", () => {
  const liam = ["Liam Carter", "431990001", "0400 100 201"];
  const zoe = ["Zoe Mitchell", "431990002", "0400 100 999", "Unit 201, 100 King St"];
  expect(matchesPerson("0400 100 201", liam)).toBe(true);
  expect(matchesPerson("0400 100 201", zoe)).toBe(false);
  expect(matchesPerson("0400-100-201", liam)).toBe(true);
  expect(matchesPerson("+61 400 100 201", liam)).toBe(true);
  expect(matchesPerson("4319 90001", liam)).toBe(true);
  expect(matchesPerson("liam 0400", liam)).toBe(true);
});

it("finds names held by more than one person, ignoring case", () => {
  expect([...sharedNames(["Jo Smith", "jo smith ", "Ben Ito"])]).toEqual(["jo smith"]);
});

import { rosterLabels, workerDetail, workerSearchText } from "./person-identity";

it("describes a worker by staff ID and suburb, else email, else phone", () => {
  expect(workerDetail({ full_name: "Sam Nguyen", employee_id: "1042", suburb: "Glenelg" })).toBe("ID 1042 · Glenelg");
  expect(workerDetail({ full_name: "Sam Nguyen", suburb: "Glenelg" })).toBe("Glenelg");
  expect(workerDetail({ full_name: "Sam Nguyen", email: "sam@x.example", phone: "0400 111 222" })).toBe("sam@x.example");
  expect(workerDetail({ full_name: "Sam Nguyen", phone: "0400 111 222" })).toBe("0400 111 222");
  expect(workerDetail({ full_name: "Sam Nguyen" })).toBeNull();
  expect(workerSearchText({ full_name: "Sam Nguyen", employee_id: "1042", phone: "0400 111 222" })).toBe("Sam Nguyen 1042 0400 111 222");
});

it("names roster staff in full and tells same-named staff apart", () => {
  const labels = rosterLabels([
    { id: "a", full_name: "Sam Nguyen", employee_id: "1042", suburb: "Glenelg" },
    { id: "b", full_name: "Sam Nguyen", employee_id: "2210", suburb: "Elizabeth" },
    { id: "c", full_name: "Sam Nash", employee_id: "3001" },
    { id: "d", full_name: "Alex Nguyen " },
    { id: "e", full_name: "Cher" },
  ]);
  expect(labels.get("a")).toEqual({ full: "Sam Nguyen", detail: "ID 1042 · Glenelg" });
  expect(labels.get("b")).toEqual({ full: "Sam Nguyen", detail: "ID 2210 · Elizabeth" });
  // Same first name or same surname: the full names already differ.
  expect(labels.get("c")).toEqual({ full: "Sam Nash", detail: null });
  expect(labels.get("d")).toEqual({ full: "Alex Nguyen", detail: null });
  expect(labels.get("e")).toEqual({ full: "Cher", detail: null });
});
