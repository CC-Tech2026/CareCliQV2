import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import {
  getPrivacyOverview,
  listPrivacyPolicyVersions,
  requestAccountDeletion,
  requestDataExport,
  setAnalyticsOptOut,
} from "@/lib/privacy-api";

const PRIVACY_KEY = ["worker", "privacy"] as const;

export function usePrivacyOverview() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: [...PRIVACY_KEY, "overview"],
    queryFn: getPrivacyOverview,
    staleTime: 30_000,
    enabled: isAuthenticated,
  });
}

export function usePrivacyPolicyVersions() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: [...PRIVACY_KEY, "policy-versions"],
    queryFn: listPrivacyPolicyVersions,
    staleTime: 60_000,
    enabled: isAuthenticated,
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
