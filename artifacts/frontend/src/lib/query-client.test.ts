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
