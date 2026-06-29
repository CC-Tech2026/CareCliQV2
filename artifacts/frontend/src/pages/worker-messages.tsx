import { useState } from "react";
import { Link } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { Bell, Loader2, MessageCircle, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import {
  fetchConversationMessages,
  fetchConversations,
  sendConversationMessage,
  type Conversation,
  type ConversationMessage,
} from "@/services/notificationService";
import { useConversationRealtime } from "@/hooks/useNotificationRealtime";

function useFormatRelative() {
  const { translate, translateParams } = useAccessibility();
  return (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return translate("messages.justNow");
    if (mins < 60) return translateParams("messages.minutesAgo", { count: String(mins) });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return translateParams("messages.hoursAgo", { count: String(hrs) });
    return translateParams("messages.daysAgo", { count: String(Math.floor(hrs / 24)) });
  };
}

function ConversationList({
  conversations,
  selectedId,
  onSelect,
}: {
  conversations: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { translate } = useAccessibility();
  const formatRelative = useFormatRelative();

  if (!conversations.length) {
    return (
      <div className="rounded-2xl border bg-white px-6 py-10 text-center" style={{ borderColor: BORDER }}>
        <Bell size={32} className="mx-auto mb-3 opacity-40" style={{ color: MUTED }} />
        <p className="text-sm font-bold" style={{ color: TEXT }}>{translate("messages.noConversations")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {conversations.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSelect(c.id)}
          className={cn(
            "w-full rounded-2xl border bg-white p-4 text-left transition",
            selectedId === c.id && "ring-2",
          )}
          style={{
            borderColor: BORDER,
            ...(selectedId === c.id ? { ringColor: PLUM } : {}),
          }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold truncate" style={{ color: TEXT }}>
                {c.participant_name ?? translate("messages.coordinator")}
              </p>
              <p className="mt-0.5 text-xs truncate" style={{ color: MUTED }}>
                {c.last_message_preview || translate("messages.noMessages")}
              </p>
            </div>
            <div className="shrink-0 text-right">
              {c.last_message_at && (
                <p className="text-[10px]" style={{ color: MUTED }}>
                  {formatRelative(c.last_message_at)}
                </p>
              )}
              {(c.unread_count ?? 0) > 0 && (
                <span
                  className="mt-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-black text-white"
                  style={{ background: CORAL }}
                >
                  {c.unread_count}
                </span>
              )}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function ThreadView({
  conversation,
  messages,
  onSend,
  sending,
}: {
  conversation: Conversation;
  messages: ConversationMessage[];
  onSend: (text: string) => void;
  sending: boolean;
}) {
  const { user } = useAuth();
  const { translate } = useAccessibility();
  const [draft, setDraft] = useState("");
  const readOnly = conversation.status === "read_only";

  return (
    <div className="flex h-[min(70vh,640px)] flex-col rounded-2xl border bg-white" style={{ borderColor: BORDER }}>
      <div className="border-b px-4 py-3" style={{ borderColor: BORDER }}>
        <p className="text-sm font-black" style={{ color: TEXT }}>
          {conversation.participant_name ?? translate("messages.shiftConversation")}
        </p>
        {readOnly && (
          <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
            {translate("messages.readOnly")}
          </p>
        )}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => {
          const mine = m.sender_id === user?.id;
          return (
            <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
              <div
                className="max-w-[85%] rounded-2xl px-3 py-2 text-sm"
                style={{
                  background: mine ? PLUM : "#F8F8FE",
                  color: mine ? "#fff" : TEXT,
                }}
              >
                {m.body}
                {m.attachment_url && (
                  <img src={m.attachment_url} alt="" className="mt-2 max-h-40 rounded-lg" />
                )}
              </div>
            </div>
          );
        })}
      </div>
      {!readOnly && (
        <div className="flex gap-2 border-t p-3" style={{ borderColor: BORDER }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={translate("messages.placeholder")}
            maxLength={1000}
            className="flex-1 rounded-xl border px-3 py-2 text-sm"
            style={{ borderColor: BORDER }}
          />
          <button
            type="button"
            disabled={!draft.trim() || sending}
            className="rounded-xl px-3 py-2 text-white disabled:opacity-50"
            style={{ background: PLUM }}
            onClick={() => {
              onSend(draft.trim());
              setDraft("");
            }}
          >
            <Send size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function WorkerMessages() {
  const { translate, translateParams } = useAccessibility();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const params = new URLSearchParams(window.location.search);
  const queryConvId = params.get("conversation");

  const { data, isLoading, refetch } = useOrgQuery(["worker-conversations"], {
    queryFn: () => fetchConversations(),
  });

  const conversations = data?.conversations ?? [];
  const activeId = selectedId ?? queryConvId ?? conversations[0]?.id ?? null;
  const activeConv = conversations.find((c) => c.id === activeId);

  const { data: threadData, refetch: refetchThread } = useOrgQuery(
    ["conversation-thread", activeId ?? ""],
    {
      queryFn: () => fetchConversationMessages(activeId!),
      enabled: !!activeId,
    },
  );

  useConversationRealtime(activeId);

  async function handleSend(text: string) {
    if (!activeId) return;
    setSending(true);
    try {
      await sendConversationMessage(activeId, text);
      await refetchThread();
      await refetch();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-5 pb-10 lg:grid-cols-[320px_1fr]">
      <header className="lg:col-span-2">
        <p className="hidden" style={{ color: CORAL }}>
          {translate("messages.title")}
        </p>
        <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>
          {translate("messages.title")}
        </h1>
        <p className="mt-0.5 text-sm font-semibold" style={{ color: MUTED }}>
          {data?.unread_count
            ? translateParams("messages.unread", { count: String(data.unread_count) })
            : translate("messages.subtitle")}
        </p>
      </header>

      <section>
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: PLUM }} />
          </div>
        ) : (
          <ConversationList
            conversations={conversations}
            selectedId={activeId}
            onSelect={setSelectedId}
          />
        )}
      </section>

      <section>
        {activeConv && threadData ? (
          <ThreadView
            conversation={activeConv}
            messages={threadData.messages}
            onSend={handleSend}
            sending={sending}
          />
        ) : (
          <div
            className="flex h-64 items-center justify-center rounded-2xl border bg-white"
            style={{ borderColor: BORDER }}
          >
            <MessageCircle size={28} style={{ color: MUTED }} />
          </div>
        )}
      </section>

      <div className="lg:col-span-2 flex justify-center gap-4 pt-2">
        <Link href="/worker/notifications">
          <a className="text-sm font-semibold" style={{ color: PLUM }}>
            {translate("messages.notificationHistory")}
          </a>
        </Link>
        <Link href="/my-shifts">
          <a className="text-sm font-semibold" style={{ color: PLUM }}>
            {translate("notifications.backToShifts")}
          </a>
        </Link>
      </div>
    </div>
  );
}
