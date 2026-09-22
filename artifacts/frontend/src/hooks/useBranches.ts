import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-fetch";
import { useOrgQuery } from "@/hooks/useOrgQuery";

/** An office of the organisation; the source of truth for timezones. */
export type Branch = {
  id: string;
  organization_id: string;
  name: string;
  state: string;
  timezone: string;
  is_head_office: boolean;
  member_count?: number;
  participant_count?: number;
};

export type BranchesResponse = {
  branches: Branch[];
  states: { code: string; timezone: string }[];
};

export const BRANCHES_QUERY_KEY = ["branches"] as const;

async function fetchBranches(): Promise<BranchesResponse> {
  const res = await apiFetch("/api/branches");
  if (!res.ok) throw new Error(`Failed to load branches (${res.status})`);
  return res.json();
}

/**
 * Branches of the current organisation, with helpers to look a branch's
 * name/zone up by id (e.g. from a participant's `branch_id`).
 */
export function useBranches() {
  const query = useOrgQuery<BranchesResponse>(BRANCHES_QUERY_KEY, {
    queryFn: fetchBranches,
    staleTime: 5 * 60 * 1000,
  });
  const branches = query.data?.branches ?? [];
  const states = query.data?.states ?? [];
  const byId = new Map(branches.map((b) => [b.id, b]));
  const headOffice = branches.find((b) => b.is_head_office) ?? null;

  const zoneFor = useCallback(
    (branchId?: string | null): string | undefined => (branchId ? byId.get(branchId)?.timezone : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [query.data],
  );

  return {
    ...query,
    branches,
    states,
    byId,
    headOffice,
    /** More than one office → show branch pickers and zone labels. */
    multiBranch: branches.length > 1,
    zoneFor,
  };
}

export function useInvalidateBranches() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: BRANCHES_QUERY_KEY, exact: false });
}
