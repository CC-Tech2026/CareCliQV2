import { useEffect, useState } from "react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { Bell, Check, CheckCircle2, AlertCircle, Info, CheckCheck, MessageCircle, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/lib/utils";
import {
  BORDER,
  CORAL,
  MUTED,
  PLUM,
  TEXT,
} from "@/lib/shift-utils";

const SEVERITY_CONFIG = {
  urgent: { icon: AlertCircle, color: "#EF4444", bg: "#FEE2E2" },
  high: { icon: AlertCircle, color: "#F97316", bg: "#FFF7ED" },
  medium: { icon: Info, color: "#3B82F6", bg: "#EFF6FF" },
  low: { icon: Info, color: "#10B981", bg: "#F0FDF4" },
};

interface WorkerMessage {
  id: string;
  alert_type: string;
  title: string;
  message: string;
  severity: "urgent" | "high" | "medium" | "low";
  is_read: boolean;
  created_at: string;
  patient_id?: string;
}

interface MessagesResponse {
  messages: WorkerMessage[];
  count: number;
}

async function fetchWorkerMessages(unread_only = false): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  if (unread_only) params.append("unread_only", "true");
  
  const response = await fetch(`/api/worker/messages?${params}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`Failed to fetch messages: ${response.statusText}`);
  return response.json();
}

async function markMessageRead(messageId: string): Promise<void> {
  const response = await fetch(`/api/worker/messages/${messageId}/read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`Failed to mark message as read`);
}

function formatDate(isoDate: string) {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  
  return date.toLocaleDateString();
}

function MessageCard({ message, onMarkRead }: { message: WorkerMessage; onMarkRead: (id: string) => void }) {
  const severityConfig = SEVERITY_CONFIG[message.severity] || SEVERITY_CONFIG.medium;
  const IconComponent = severityConfig.icon;

  return (
    <button
      type="button"
      onClick={() => !message.is_read && onMarkRead(message.id)}
      className={cn(
        "w-full text-left rounded-2xl border transition-all p-4 sm:p-5",
        message.is_read ? "bg-white opacity-75" : "bg-white border-l-4 hover:shadow-md",
      )}
      style={{
        borderColor: message.is_read ? BORDER : severityConfig.color,
        borderLeftColor: message.is_read ? undefined : severityConfig.color,
      }}
    >
      <div className="flex gap-3 sm:gap-4">
        <div
          className="shrink-0 p-2.5 sm:p-3 rounded-2xl flex items-center justify-center"
          style={{ background: severityConfig.bg }}
        >
          <IconComponent size={18} className="sm:h-5 sm:w-5" style={{ color: severityConfig.color }} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="text-sm sm:text-base font-bold text-[#1E1640] line-clamp-1">
              {message.title}
            </h3>
            {!message.is_read && (
              <div className="shrink-0 h-2.5 w-2.5 rounded-full mt-1.5" style={{ background: PLUM }} />
            )}
          </div>

          <p className="text-xs sm:text-sm text-[#7A6A9E] mb-2 line-clamp-2">
            {message.message}
          </p>

          <p className="text-xs text-[#A39AAE]">{formatDate(message.created_at)}</p>
        </div>

        {message.is_read && (
          <div className="shrink-0 pt-1">
            <Check size={16} className="text-[#10B981]" />
          </div>
        )}
      </div>
    </button>
  );
}

export default function WorkerMessages() {
  const { user } = useAuth();
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  
  const { data, isLoading, error, refetch } = useOrgQuery(
    ["worker", "messages", filter],
    {
      queryFn: () => fetchWorkerMessages(filter === "unread"),
      refetchInterval: 15000, // Refetch every 15 seconds
    }
  );

  const messages = data?.messages ?? [];
  const unreadCount = messages.filter((m) => !m.is_read).length;

  async function handleMarkRead(messageId: string) {
    try {
      await markMessageRead(messageId);
      await refetch();
    } catch (error) {
      console.error("Failed to mark message as read:", error);
    }
  }

  async function handleMarkAllRead() {
    try {
      await Promise.all(
        messages
          .filter((m) => !m.is_read)
          .map((m) => markMessageRead(m.id))
      );
      await refetch();
    } catch (error) {
      console.error("Failed to mark messages as read:", error);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-10">
      {/* Header */}
      <header className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: CORAL }}>
            Communications
          </p>
          <h1 className="mt-1 text-2xl sm:text-3xl font-black tracking-tight" style={{ color: TEXT }}>
            Messages
          </h1>
          <p className="mt-0.5 text-sm font-semibold" style={{ color: MUTED }}>
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </p>
        </div>
        <div className="shrink-0 relative">
          <div
            className="h-12 sm:h-14 w-12 sm:w-14 rounded-2xl flex items-center justify-center"
            style={{ background: "#F5F3FC" }}
          >
            <MessageCircle className="h-6 w-6 sm:h-7 sm:w-7" style={{ color: PLUM }} />
          </div>
          {unreadCount > 0 && (
            <div
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-black text-white"
              style={{ background: CORAL }}
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </div>
          )}
        </div>
      </header>

      {/* Filter Tabs */}
      <div className="rounded-full bg-[#F0EDF8] p-1 flex gap-1">
        {["all", "unread"].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f as "all" | "unread")}
            className={cn(
              "flex-1 rounded-full px-3 py-2.5 text-xs sm:text-sm font-black transition capitalize",
              filter === f
                ? "bg-white text-[#1E1640] shadow-sm"
                : "text-[#7A6A9E]"
            )}
          >
            {f}
            {f === "unread" && ` (${unreadCount})`}
          </button>
        ))}
      </div>

      {/* Mark All Read Button */}
      {unreadCount > 0 && (
        <button
          type="button"
          onClick={handleMarkAllRead}
          className="w-full sm:w-auto rounded-full px-4 py-2 text-xs font-black text-white transition hover:opacity-90"
          style={{ background: PLUM }}
        >
          <CheckCheck className="inline h-4 w-4 mr-2" />
          Mark all as read
        </button>
      )}

      {/* Loading State */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border bg-white p-4 animate-pulse" style={{ borderColor: BORDER }}>
              <div className="flex gap-3">
                <div className="h-10 w-10 rounded-2xl bg-slate-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 rounded bg-slate-200" />
                  <div className="h-3 w-1/2 rounded bg-slate-100" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="rounded-2xl border-l-4 border-red-500 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-900">Failed to load messages</p>
          <p className="text-xs text-red-700 mt-1">{(error as Error).message}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 rounded-full bg-red-500 px-4 py-2 text-xs font-black text-white"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty State */}
      {!isLoading && !error && messages.length === 0 && (
        <div
          className="rounded-2xl border bg-white px-6 py-10 text-center shadow-sm"
          style={{ borderColor: BORDER }}
        >
          <Bell size={36} className="mx-auto mb-3 opacity-40" style={{ color: MUTED }} />
          <p className="text-base font-black" style={{ color: TEXT }}>
            {filter === "unread" ? "No new messages" : "No messages"}
          </p>
          <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>
            {filter === "unread"
              ? "Check back later for updates from your coordinator."
              : "You haven't received any messages yet."}
          </p>
        </div>
      )}

      {/* Messages List */}
      {!isLoading && !error && messages.length > 0 && (
        <div className="space-y-3">
          {messages.map((message) => (
            <MessageCard
              key={message.id}
              message={message}
              onMarkRead={handleMarkRead}
            />
          ))}
        </div>
      )}

      {/* Back Link */}
      <div className="flex justify-center pt-4">
        <Link href="/my-shifts">
          <a className="text-sm font-semibold" style={{ color: PLUM }}>
            ← Back to shifts
          </a>
        </Link>
      </div>
    </div>
  );
}
