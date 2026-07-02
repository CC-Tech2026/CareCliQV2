import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

const REFRESH_MS = 60_000;
const INITIAL_LOAD_GRACE_MS = 5_000;

/**
 * Keeps support-worker dashboard data fresh via periodic invalidation and lifecycle events.
 * Invalidates worker dashboard, landing (next shift), and compliance queries.
 */
export function useDashboardRealtime(enabled: boolean) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;

  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    if (!enabled || !orgId) return;
    mountedAtRef.current = Date.now();

    const invalidate = () => {
      if (Date.now() - mountedAtRef.current < INITIAL_LOAD_GRACE_MS) return;
      void queryClient.invalidateQueries({ queryKey: [orgId, "dashboard"] });
      void queryClient.invalidateQueries({ queryKey: [orgId, "worker", "compliance-detail"] });
    };

    const interval = window.setInterval(invalidate, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") invalidate();
    };

    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, orgId, queryClient]);
}
