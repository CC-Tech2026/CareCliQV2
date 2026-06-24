import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

const REFRESH_MS = 30_000;

/**
 * Keeps support-worker dashboard data fresh via polling and lifecycle events.
 * Invalidates worker dashboard, landing (next shift), and compliance queries.
 */
export function useDashboardRealtime(enabled: boolean) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId;

  useEffect(() => {
    if (!enabled || !orgId) return;

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: [orgId, "dashboard"] });
      void queryClient.invalidateQueries({ queryKey: [orgId, "worker", "compliance-detail"] });
    };

    const interval = window.setInterval(invalidate, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") invalidate();
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", invalidate);
    window.addEventListener("online", invalidate);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", invalidate);
      window.removeEventListener("online", invalidate);
    };
  }, [enabled, orgId, queryClient]);
}
