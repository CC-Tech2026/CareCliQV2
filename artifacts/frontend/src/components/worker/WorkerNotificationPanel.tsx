import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { jsonFetch } from "@/services/http";
import {
  Bell, X, CheckCheck, AlertTriangle, Info, CheckCircle2,
  Search, Filter,
} from "lucide-react";

const PLUM   = "#5533CC";
const CORAL  = "#F03060";
const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";

const SEVERITY_LEVELS = {
  urgent: { color: "#DC2626", label: "Urgent", bg: "#FEE2E2" },
  high: { color: "#F97316", label: "High", bg: "#FFF7ED" },
  medium: { color: "#3B82F6", label: "Medium", bg: "#EFF6FF" },
  low: { color: "#10B981", label: "Low", bg: "#F0FDF4" },
};

export interface WorkerMessage {
  id: string;
  alert_type: string;
  title: string;
  message: string;
  severity: "urgent" | "high" | "medium" | "low";
  is_read: boolean;
  created_at: string;
}

async function fetchWorkerMessages(unread_only = false): Promise<{ messages: WorkerMessage[]; count: number }> {
  const params = new URLSearchParams();
  if (unread_only) params.append("unread_only", "true");

  console.log("[WorkerNotificationPanel] Fetching messages with params:", Object.fromEntries(params));
  
  try {
    const data = await jsonFetch<{ messages: any[]; count: number }>(`/api/worker/messages?${params}`);
    
    console.log("[WorkerNotificationPanel] API returned:", data);
    
    const transformed = {
      messages: (data.messages || []).map((msg: any) => ({
        id: msg.id,
        alert_type: msg.alert_type,
        title: msg.title,
        message: msg.message,
        severity: msg.severity || "low",
        is_read: msg.is_read || false,
        created_at: msg.created_at,
      })),
      count: data.count || 0,
    };
    
    console.log("[WorkerNotificationPanel] Transformed messages:", transformed);
    return transformed;
  } catch (error) {
    console.error("[WorkerNotificationPanel] Fetch error:", error);
    throw error;
  }
}

async function markMessageRead(messageId: string): Promise<void> {
  console.log("[WorkerNotificationPanel] Marking message as read:", messageId);
  
  try {
    await jsonFetch(`/api/worker/messages/${messageId}/read`, {
      method: "POST",
    });
    console.log("[WorkerNotificationPanel] Message marked as read successfully");
  } catch (error) {
    console.error("[WorkerNotificationPanel] Failed to mark message as read:", error);
    throw error;
  }
}

function relativeTime(iso?: string) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function getSeverityMeta(severity: string) {
  return (
    SEVERITY_LEVELS[severity as keyof typeof SEVERITY_LEVELS] ||
    SEVERITY_LEVELS.low
  );
}

function MessageRow({
  message,
  onRead,
}: {
  message: WorkerMessage;
  onRead: (id: string) => void;
}) {
  const meta = getSeverityMeta(message.severity);
  const icon =
    message.severity === "urgent" ? (
      <AlertTriangle size={14} />
    ) : message.severity === "high" ? (
      <AlertTriangle size={14} />
    ) : (
      <Info size={14} />
    );

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 cursor-pointer"
      style={{ opacity: message.is_read ? 0.6 : 1 }}
      onClick={() => !message.is_read && onRead(message.id)}
    >
      {/* Icon */}
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: meta.bg, color: meta.color }}
      >
        {icon}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] leading-snug" style={{ color: TEXT, fontWeight: message.is_read ? 400 : 600 }}>
          {message.title}
        </p>
        <p className="text-[12px] text-[#7A6A9E] mt-0.5 line-clamp-1">
          {message.message}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          <span
            className="text-[10px] font-semibold uppercase"
            style={{ color: meta.color }}
          >
            {meta.label}
          </span>
          <span className="text-[10px]" style={{ color: MUTED }}>
            {relativeTime(message.created_at)}
          </span>
        </div>
      </div>

      {/* Unread dot */}
      {!message.is_read && (
        <div className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ background: PLUM }} />
      )}
    </div>
  );
}

// ── Main panel with filters and search ──────────────────────────────────────────
export function WorkerNotificationPanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const qc = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const { data: response, isLoading, error } = useOrgQuery(
    ["worker-messages", orgId],
    {
      queryFn: () => fetchWorkerMessages(),
      refetchInterval: 15000,
    }
  );

  // Log errors
  if (error) {
    console.error("[WorkerNotificationPanel] Query error:", error);
  }

  const messages = response?.messages ?? [];

  const filteredMessages = useMemo(() => {
    let result = messages;

    // Filter by severity
    if (severityFilter) {
      result = result.filter((m) => m.severity === severityFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((m) =>
        (m.title?.toLowerCase() ?? "").includes(query) ||
        (m.message?.toLowerCase() ?? "").includes(query)
      );
    }

    return result;
  }, [messages, searchQuery, severityFilter]);

  const unread = filteredMessages.filter((m) => !m.is_read).length;

  const readMut = useMutation({
    mutationFn: markMessageRead,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worker-messages", orgId] });
      qc.invalidateQueries({ queryKey: ["worker-messages-unread", orgId] });
    },
  });

  const readAllMut = useMutation({
    mutationFn: async () => {
      await Promise.all(
        messages
          .filter((m) => !m.is_read)
          .map((m) => markMessageRead(m.id))
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["worker-messages", orgId] });
      qc.invalidateQueries({ queryKey: ["worker-messages-unread", orgId] });
    },
  });

  return (
    <div
      className="fixed top-0 right-0 h-full w-[420px] max-w-full z-50 flex flex-col shadow-2xl"
      style={{ background: "#fff", borderLeft: `1px solid ${BORDER}` }}
    >
      {/* Header */}
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Bell size={18} style={{ color: PLUM }} />
            <h2 className="text-[15px] font-black" style={{ color: TEXT }}>
              Messages
            </h2>
            {unread > 0 && (
              <span
                className="min-w-[20px] h-5 px-1.5 rounded-full text-[10px] font-black flex items-center justify-center"
                style={{ background: CORAL, color: "#fff" }}
              >
                {unread}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unread > 0 && (
              <button
                className="text-[11px] font-semibold flex items-center gap-1 hover:opacity-75 transition"
                style={{ color: MUTED }}
                onClick={() => readAllMut.mutate()}
              >
                <CheckCheck size={13} /> Mark all read
              </button>
            )}
            <button
              className="p-1.5 rounded-full hover:bg-gray-100 transition-colors"
              onClick={onClose}
            >
              <X size={16} style={{ color: MUTED }} />
            </button>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-2.5" style={{ color: MUTED }} />
            <input
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 rounded-lg border text-sm focus:outline-none focus:ring-2"
              style={{ borderColor: BORDER, "--tw-ring-color": `${PLUM}20` } as any}
            />
          </div>
          <button
            className="p-2 rounded-lg border transition-colors"
            style={{ borderColor: BORDER, background: showFilters ? SOFT : "transparent" }}
            onClick={() => setShowFilters(!showFilters)}
            title="Filter by severity"
          >
            <Filter size={14} style={{ color: PLUM }} />
          </button>
        </div>

        {/* Severity Filter Tags */}
        {showFilters && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => setSeverityFilter(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                severityFilter === null ? "ring-2" : "opacity-60 hover:opacity-100"
              }`}
              style={{
                color: TEXT,
                background: SOFT,
                ...(severityFilter === null && { "--tw-ring-color": PLUM, "--tw-ring-width": "2px" } as any),
              }}
            >
              All
            </button>
            {Object.entries(SEVERITY_LEVELS).map(([level, config]) => (
              <button
                key={level}
                onClick={() => setSeverityFilter(level)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                  severityFilter === level ? "ring-2" : "opacity-60 hover:opacity-100"
                }`}
                style={{
                  color: config.color,
                  background: config.bg,
                  ...(severityFilter === level && { "--tw-ring-color": config.color, "--tw-ring-width": "2px" } as any),
                }}
              >
                {config.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-24">
            <div className="w-5 h-5 rounded-full border-2 border-transparent animate-spin" style={{ borderTopColor: PLUM }} />
          </div>
        )}

        {!isLoading && error && (
          <div className="m-4 p-4 rounded-lg" style={{ background: "#FEE2E2", borderLeft: `4px solid ${CORAL}` }}>
            <p className="text-[12px] font-semibold" style={{ color: TEXT }}>
              Error loading messages
            </p>
            <p className="text-[11px] mt-1" style={{ color: MUTED }}>
              {error instanceof Error ? error.message : String(error)}
            </p>
          </div>
        )}

        {!isLoading && !error && filteredMessages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <Bell size={32} style={{ color: BORDER }} />
            <p className="text-[13px] font-semibold" style={{ color: MUTED }}>
              {messages.length === 0 ? "No messages yet" : "No messages match your filters"}
            </p>
          </div>
        )}

        {!isLoading && !error &&
          filteredMessages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              onRead={(id) => readMut.mutate(id)}
            />
          ))}
      </div>
    </div>
  );
}

// ── Bell icon with badge (for header) ──────────────────────────────────────────
export function WorkerNotificationBell({ onClick }: { onClick: () => void }) {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  const { data: response } = useOrgQuery(
    ["worker-messages-unread", orgId],
    {
      queryFn: () => fetchWorkerMessages(true),
      refetchInterval: 30000,
      enabled: !!user,
    }
  );

  const messages = response?.messages ?? [];
  const unread = messages.length;

  return (
    <button
      className="relative p-2 rounded-full hover:bg-black/5 transition-colors"
      onClick={onClick}
      title="Messages from your coordinator"
    >
      <Bell size={20} style={{ color: MUTED }} />
      {unread > 0 && (
        <span
          className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-black flex items-center justify-center"
          style={{ background: CORAL, color: "#fff" }}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}
