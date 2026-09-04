import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabaseClient, isSupabaseRealtimeConfigured } from "@/lib/supabase";

/**
 * Pushes coordinator/MD live-shift monitoring updates the moment a worker's
 * documentation reaches the database (task completed, note/photo/voice saved,
 * an alert fires) instead of waiting for coordinator-live.tsx's 30s poll.
 * Requires 153_coordinator_live_realtime_rls.sql (coordinator/MD SELECT
 * policies + realtime publication membership for these tables).
 */
export function useLiveShiftsRealtime(enabled: boolean) {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled || !orgId || !isSupabaseRealtimeConfigured()) return;
    const sb = getSupabaseClient();
    if (!sb) return;

    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: [orgId, "live-shifts"] });
    };

    const channel = sb
      .channel(`live-shifts:${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shifts", filter: `organization_id=eq.${orgId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shift_tasks", filter: `organization_id=eq.${orgId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shift_visit_notes", filter: `organization_id=eq.${orgId}` },
        invalidate,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts", filter: `organization_id=eq.${orgId}` },
        invalidate,
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [enabled, orgId, qc]);
}

/** Same pattern for the coordinator/MD incident register. */
export function useIncidentsRealtime(enabled: boolean) {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled || !orgId || !isSupabaseRealtimeConfigured()) return;
    const sb = getSupabaseClient();
    if (!sb) return;

    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: [orgId, "incidents"] });
      void qc.invalidateQueries({ queryKey: [orgId, "incident-stats"] });
    };

    const channel = sb
      .channel(`incidents:${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "incidents", filter: `organization_id=eq.${orgId}` },
        invalidate,
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [enabled, orgId, qc]);
}
