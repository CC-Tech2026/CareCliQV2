import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { fetchNotifications } from "@/services/notificationService";
import { getSupabaseClient, isSupabaseRealtimeConfigured } from "@/lib/supabase";
import { syncDeviceNotifications } from "@/lib/web-push";
import { invalidateInbox } from "@/components/notifications/NotificationInbox";
import {
  parseRealtimeNotificationRow,
  presentPushedNotification,
  presentWorkerNotification,
  seedPresentedNotificationIds,
  type NotificationAudience,
} from "@/lib/worker-notification-presenter";

/**
 * Toast + desktop alerts for new notifications (Slack-style), for every role.
 * Also keeps React Query caches in sync via Supabase Realtime, and keeps this
 * browser's push subscription registered for whoever turned it on.
 */
export function useWorkerNotificationPresenter() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const orgId = user?.organizationId ?? "__no_org__";
  const seededRef = useRef(false);
  const isWorker = user?.role === "support_worker";
  const audience: NotificationAudience = isWorker ? "worker" : "office";

  // Banner polling fallback is worker-only (the endpoint is too).
  const { data } = useOrgQuery(["notification-banners"], {
    queryFn: () => fetchNotifications({ banners_only: true }),
    refetchInterval: isSupabaseRealtimeConfigured() ? false : 60_000,
    enabled: !!user && isWorker,
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
    if (user?.id) void syncDeviceNotifications(user.id);
  }, [user?.id]);

  // Messages from public/sw.js: a push that arrived while this tab was
  // visible, or a tap on an OS notification that should route in-app.
  useEffect(() => {
    if (!user || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; url?: string; payload?: Record<string, unknown> } | null;
      if (message?.type === "carecliq:navigate" && message.url?.startsWith("/")) {
        navigate(message.url);
      } else if (message?.type === "carecliq:push" && message.payload) {
        presentPushedNotification(message.payload, navigate);
        invalidateInbox(qc, orgId);
        void qc.invalidateQueries({ queryKey: [orgId, "coordinator-notifications"] });
      }
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [user?.id, orgId, qc, navigate]);

  useEffect(() => {
    if (!user || !isSupabaseRealtimeConfigured()) {
      return;
    }

    const sb = getSupabaseClient();
    if (!sb) return;

    const invalidate = () => {
      invalidateInbox(qc, orgId);
      void qc.invalidateQueries({ queryKey: [orgId, "coordinator-notifications"] });
    };

    const channel = sb
      .channel(`user-notifications:${user.id}`)
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
            presentWorkerNotification(notification, navigate, audience);
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
  }, [user?.id, audience, orgId, qc, navigate]);

  useEffect(() => {
    if (!user) seededRef.current = false;
  }, [user?.id]);
}
