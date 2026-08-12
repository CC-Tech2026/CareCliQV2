import { jsonFetch } from "@/services/http";

export type UserNotification = {
  id: string;
  event_type: string;
  title: string;
  body: string;
  severity: string;
  shift_id?: string | null;
  conversation_id?: string | null;
  action_url?: string | null;
  banner_style?: "red" | "orange" | "yellow" | null;
  requires_ack?: boolean;
  acknowledged_at?: string | null;
  read_at?: string | null;
  dismissed_at?: string | null;
  payload?: Record<string, unknown>;
  created_at: string;
};

export type Conversation = {
  id: string;
  worker_id: string;
  coordinator_id?: string | null;
  shift_id?: string | null;
  participant_name?: string | null;
  status: string;
  last_message_at?: string | null;
  last_message_preview?: string;
  unread_count?: number;
};

export type ConversationMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  attachment_url?: string | null;
  message_type: string;
  requires_action?: boolean;
  actioned_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  created_at: string;
};

export async function fetchNotifications(params?: {
  days?: number;
  unread_only?: boolean;
  banners_only?: boolean;
}) {
  const q = new URLSearchParams();
  if (params?.days) q.set("days", String(params.days));
  if (params?.unread_only) q.set("unread_only", "true");
  if (params?.banners_only) q.set("banners_only", "true");
  return jsonFetch<{ notifications: UserNotification[]; count: number }>(
    `/api/worker/notifications?${q}`,
  );
}

export async function dismissNotification(id: string) {
  return jsonFetch<{ ok: boolean }>(`/api/worker/notifications/${id}/dismiss`, { method: "POST" });
}

export async function acknowledgeNotification(id: string, changeSnapshot?: Record<string, unknown>) {
  return jsonFetch<{ ok: boolean }>(`/api/worker/notifications/${id}/acknowledge`, {
    method: "POST",
    body: JSON.stringify({ change_snapshot: changeSnapshot ?? {} }),
  });
}

export async function recordShiftViewed(shiftId: string) {
  return jsonFetch<{ ok: boolean }>(`/api/worker/notifications/shifts/${shiftId}/viewed`, {
    method: "POST",
  });
}

export async function updateShiftReminderSettings(shiftId: string, silenceOptional: boolean) {
  return jsonFetch<{ ok: boolean; silence_optional_reminders: boolean }>(
    `/api/worker/notifications/shifts/${shiftId}/reminder-settings`,
    {
      method: "PUT",
      body: JSON.stringify({ silence_optional_reminders: silenceOptional }),
    },
  );
}

export async function snoozeTaskReminder(shiftId: string, taskId: string) {
  return jsonFetch<{ ok: boolean; snoozed_until: string }>(
    `/api/worker/notifications/shifts/${shiftId}/tasks/${encodeURIComponent(taskId)}/snooze`,
    { method: "POST" },
  );
}

export async function registerPushToken(
  deviceId: string,
  pushToken: string,
  platform = "web",
  tokenType: "expo" | "fcm" = "expo",
) {
  return jsonFetch<{ registered: boolean }>("/api/worker/notifications/push-token", {
    method: "POST",
    body: JSON.stringify({
      device_id: deviceId,
      push_token: pushToken,
      platform,
      token_type: tokenType,
    }),
  });
}

export async function fetchConversations() {
  return jsonFetch<{ conversations: Conversation[]; unread_count: number }>(
    "/api/worker/notifications/conversations",
  );
}

export async function fetchConversationMessages(conversationId: string) {
  return jsonFetch<{ messages: ConversationMessage[] }>(
    `/api/worker/notifications/conversations/${conversationId}/messages`,
  );
}

export async function sendConversationMessage(
  conversationId: string,
  body: string,
  opts?: { attachment_url?: string; message_type?: string; requires_action?: boolean },
) {
  return jsonFetch<ConversationMessage>(
    `/api/worker/notifications/conversations/${conversationId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        body,
        attachment_url: opts?.attachment_url,
        message_type: opts?.message_type ?? "text",
        requires_action: opts?.requires_action ?? false,
      }),
    },
  );
}

export async function actionConversationMessage(messageId: string) {
  return jsonFetch<{ ok: boolean }>(
    `/api/worker/notifications/conversations/messages/${messageId}/action`,
    { method: "POST" },
  );
}
