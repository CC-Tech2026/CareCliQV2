import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/context/AuthContext";
import {
  disableMfa,
  getMfaStatus,
  listSessions,
  listTrustedDevices,
  logoutOtherSessions,
  renameSession,
  renameTrustedDevice,
  revokeTrustedDevice,
  startTotpEnrollment,
  verifyTotpEnrollment,
} from "@/lib/security-api";

const SECURITY_KEY = ["worker", "security"] as const;

export function useMfaStatus() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: [...SECURITY_KEY, "mfa"],
    queryFn: getMfaStatus,
    staleTime: 30_000,
    enabled: isAuthenticated,
  });
}

export function useTrustedDevices() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: [...SECURITY_KEY, "devices"],
    queryFn: listTrustedDevices,
    staleTime: 30_000,
    enabled: isAuthenticated,
  });
}

export function useActiveSessions() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: [...SECURITY_KEY, "sessions"],
    queryFn: listSessions,
    staleTime: 30_000,
    enabled: isAuthenticated,
  });
}

function useInvalidateSecurity() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: [...SECURITY_KEY] });
  };
}

export function useStartTotpEnrollment() {
  return useMutation({ mutationFn: startTotpEnrollment });
}

export function useVerifyTotpEnrollment() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: verifyTotpEnrollment,
    onSuccess: () => invalidate(),
  });
}

export function useDisableMfa() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: disableMfa,
    onSuccess: () => invalidate(),
  });
}

export function useRenameTrustedDevice() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameTrustedDevice(id, name),
    onSuccess: () => invalidate(),
  });
}

export function useRevokeTrustedDevice() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: revokeTrustedDevice,
    onSuccess: () => invalidate(),
  });
}

export function useRenameSession() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => renameSession(id, name),
    onSuccess: () => invalidate(),
  });
}

export function useLogoutOtherSessions() {
  const invalidate = useInvalidateSecurity();
  return useMutation({
    mutationFn: logoutOtherSessions,
    onSuccess: () => invalidate(),
  });
}
