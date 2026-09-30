import { expect, it } from "vitest";
import { bucketRevenue, monthKeysEnding } from "./MDHubView";

const month = (m: string, billed: number, paid = 0) => ({ month: m, billed, paid, outstanding: billed - paid, count: 1 });

it("lists the months ending now, oldest first, across a year boundary", () => {
  expect(monthKeysEnding("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
});

it("charts the latest 12 months left to right, with empty months kept", () => {
  // The report is newest first and skips months without invoices.
  const report = [month("2026-09", 500_00, 200_00), month("2026-07", 300_00), month("2024-01", 999_00)];
  const data = bucketRevenue(report, "monthly", "2026-09");
  expect(data).toHaveLength(12);
  expect(data[0].key).toBe("Oct 25");
  expect(data.at(-1)).toEqual({ key: "Sep", billed: 500, paid: 200 });
  expect(data.at(-2)).toEqual({ key: "Aug", billed: 0, paid: 0 });
  expect(data.at(-3)?.billed).toBe(300);
  // Nothing from 2024 leaks into the last 12 months.
  expect(data.reduce((sum, d) => sum + d.billed, 0)).toBe(800);
});

it("groups quarters and years ending with the current one", () => {
  const report = [month("2026-09", 100_00), month("2026-07", 50_00), month("2026-06", 25_00)];
  const quarters = bucketRevenue(report, "quarterly", "2026-09");
  expect(quarters).toHaveLength(8);
  expect(quarters.at(-1)).toEqual({ key: "Q3 2026", billed: 150, paid: 0 });
  expect(quarters.at(-2)?.key).toBe("Q2 2026");
  const years = bucketRevenue(report, "yearly", "2026-09");
  expect(years.map((y) => y.key)).toEqual(["2022", "2023", "2024", "2025", "2026"]);
  expect(years.at(-1)?.billed).toBe(175);
});
