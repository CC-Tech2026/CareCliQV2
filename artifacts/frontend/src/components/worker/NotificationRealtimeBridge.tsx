import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { isSupabaseRealtimeConfigured, restoreSupabaseSession } from "@/lib/supabase";
import { useWorkerNotificationPresenter } from "@/hooks/useWorkerNotificationPresenter";

/** Mounts Supabase Realtime + toast/desktop notification presenter for workers. */
export function NotificationRealtimeBridge() {
  const { user, isAuthenticated } = useAuth();

  useEffect(() => {
    if (!isAuthenticated || !isSupabaseRealtimeConfigured()) return;
    void restoreSupabaseSession();
  }, [isAuthenticated, user?.id]);

  useWorkerNotificationPresenter();
  return null;
}

export { storeAndApplySupabaseSession } from "@/lib/supabase";
