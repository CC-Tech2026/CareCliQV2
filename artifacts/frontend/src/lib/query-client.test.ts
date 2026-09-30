import { afterEach, expect, it } from "vitest";
import { isSummaryQuery, queryClient, setQueryOrgId } from "./query-client";

afterEach(() => {
  queryClient.clear();
  setQueryOrgId(null);
});

it("treats org-scoped and plain dashboard keys as summaries", () => {
  setQueryOrgId("org-1");
  expect(isSummaryQuery({ queryKey: ["org-1", "md", "dashboard", "all"] })).toBe(true);
  expect(isSummaryQuery({ queryKey: ["org-1", "incident-stats", "nav-badge"] })).toBe(true);
  expect(isSummaryQuery({ queryKey: ["compliance-centre", "overview"] })).toBe(true);
  expect(isSummaryQuery({ queryKey: ["org-1", "incidents"] })).toBe(false);
  expect(isSummaryQuery({ queryKey: ["org-1", "participant", "p-1"] })).toBe(false);
});

it("marks summary queries stale after any successful mutation, leaving others alone", async () => {
  setQueryOrgId("org-1");
  queryClient.setQueryData(["org-1", "md", "dashboard", "all"], { active_staff: 8 });
  queryClient.setQueryData(["org-1", "participant", "p-1"], { name: "A" });

  await queryClient.getMutationCache().build(queryClient, { mutationFn: async () => "ok" }).execute(undefined);

  expect(queryClient.getQueryState(["org-1", "md", "dashboard", "all"])?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(["org-1", "participant", "p-1"])?.isInvalidated).toBe(false);
});

it("doesn't retry requests that can't succeed", () => {
  const retry = queryClient.getDefaultOptions().queries!.retry as (n: number, e: unknown) => boolean;
  const withStatus = (status: number) => Object.assign(new Error("x"), { status });
  expect(retry(0, withStatus(404))).toBe(false);
  expect(retry(0, withStatus(403))).toBe(false);
  expect(retry(0, new Error("Request failed with 404"))).toBe(false);
  // Worth another try: server errors, timeouts, rate limits, network drops.
  expect(retry(0, withStatus(500))).toBe(true);
  expect(retry(0, withStatus(429))).toBe(true);
  expect(retry(0, new TypeError("Failed to fetch"))).toBe(true);
  expect(retry(2, withStatus(500))).toBe(false);
});
