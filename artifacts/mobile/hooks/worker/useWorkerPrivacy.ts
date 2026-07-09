import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getPrivacyOverview,
  listPrivacyPolicyVersions,
  requestAccountDeletion,
  requestDataExport,
  setAnalyticsOptOut,
} from "@/lib/privacy-api";

const PRIVACY_KEY = ["worker", "privacy"] as const;

export function usePrivacyOverview() {
  return useQuery({
    queryKey: [...PRIVACY_KEY, "overview"],
    queryFn: getPrivacyOverview,
    staleTime: 30_000,
  });
}

export function usePrivacyPolicyVersions() {
  return useQuery({
    queryKey: [...PRIVACY_KEY, "policy-versions"],
    queryFn: listPrivacyPolicyVersions,
    staleTime: 60_000,
  });
}

export function useSetAnalyticsOptOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setAnalyticsOptOut,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [...PRIVACY_KEY, "overview"] });
    },
  });
}

export function useRequestDataExport() {
  return useMutation({ mutationFn: requestDataExport });
}

export function useRequestAccountDeletion() {
  return useMutation({ mutationFn: requestAccountDeletion });
}
