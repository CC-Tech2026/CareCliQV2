import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { fetchNotifications } from "@/services/notificationService";
import { getSupabaseClient, isSupabaseRealtimeConfigured } from "@/lib/supabase";
import {
  parseRealtimeNotificationRow,
  presentWorkerNotification,
  seedPresentedNotificationIds,
} from "@/lib/worker-notification-presenter";

/**
 * Toast + desktop alerts for new worker notifications (Slack-style).
 * Also keeps React Query caches in sync via Supabase Realtime.
 */
export function useWorkerNotificationPresenter() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const orgId = user?.organizationId ?? "__no_org__";
  const seededRef = useRef(false);

  const { data } = useOrgQuery(["notification-banners", orgId], {
    queryFn: () => fetchNotifications({ banners_only: true }),
    refetchInterval: isSupabaseRealtimeConfigured() ? false : 30_000,
    enabled: !!user && user.role === "support_worker",
  });

  useEffect(() => {
    const items = (data?.notifications ?? []).filter((n) => !n.dismissed_at);

    if (!seededRef.current) {
      seedPresentedNotificationIds(items.map((n) => n.id));
      seededRef.current = true;
      return;
    }

    for (const item of items) {
      presentWorkerNotification(item, navigate);
    }
  }, [data, navigate]);

  useEffect(() => {
    if (!user || user.role !== "support_worker" || !isSupabaseRealtimeConfigured()) {
      return;
    }

    const sb = getSupabaseClient();
    if (!sb) return;

    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: [orgId, "notification-banners"] });
      void qc.invalidateQueries({ queryKey: [orgId, "worker-notifications"] });
      void qc.invalidateQueries({ queryKey: [orgId, "worker-notifications-unread"] });
      void qc.invalidateQueries({ queryKey: [orgId, "notification-history"] });
      void qc.invalidateQueries({ queryKey: [orgId, "worker-messages-unread"] });
      void qc.invalidateQueries({ queryKey: [orgId, "worker-messages"] });
    };

    const channel = sb
      .channel(`worker-notifications:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const notification = parseRealtimeNotificationRow(
            payload.new as Record<string, unknown>,
          );
          if (notification) {
            presentWorkerNotification(notification, navigate);
          }
          invalidate();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "user_notifications",
          filter: `user_id=eq.${user.id}`,
        },
        invalidate,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "alerts",
          filter: `recipient_user_id=eq.${user.id}`,
        },
        invalidate,
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [user?.id, user?.role, orgId, qc, navigate]);

  useEffect(() => {
    if (!user) seededRef.current = false;
  }, [user?.id]);
}
