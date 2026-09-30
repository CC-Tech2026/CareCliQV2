import { expect, it } from "vitest";
import { lineTotal } from "./ServiceAgreementBuilder";

it("prices a line at the catalogue limit unless a rate is entered", () => {
  expect(lineTotal({ quantity: "312", rate: "" }, { price_national: 70.23 })).toBe(21911.76);
  expect(lineTotal({ quantity: "10", rate: "65" }, { price_national: 70.23 })).toBe(650);
  expect(lineTotal({ quantity: "", rate: "" }, { price_national: 70.23 })).toBeNull();
  // Quoted items have no limit: nothing to total until a rate is entered.
  expect(lineTotal({ quantity: "3", rate: "" }, { price_national: null })).toBeNull();
});
