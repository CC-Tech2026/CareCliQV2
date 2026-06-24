import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getSupabaseClient, isSupabaseRealtimeConfigured } from "@/lib/supabase";

/** Live updates for coordinator ↔ worker messaging threads. */
export function useConversationRealtime(conversationId: string | null | undefined) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const orgId = user?.organizationId ?? "__no_org__";

  useEffect(() => {
    if (!user || !conversationId || !isSupabaseRealtimeConfigured()) {
      return;
    }

    const sb = getSupabaseClient();
    if (!sb) return;

    const invalidate = () => {
      void qc.invalidateQueries({ queryKey: ["worker-conversations", orgId] });
      void qc.invalidateQueries({ queryKey: ["conversation-thread", conversationId] });
    };

    const messagesChannel = sb
      .channel(`conversation-messages:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "conversation_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        invalidate,
      )
      .subscribe();

    const convChannel = sb
      .channel(`conversation-meta:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversations",
          filter: `id=eq.${conversationId}`,
        },
        invalidate,
      )
      .subscribe();

    return () => {
      void sb.removeChannel(messagesChannel);
      void sb.removeChannel(convChannel);
    };
  }, [user?.id, conversationId, orgId, qc]);
}
