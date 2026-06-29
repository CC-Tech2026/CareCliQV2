import { useState, useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { jsonFetch } from "@/services/http";
import {
  Bell, X, CheckCheck, AlertTriangle, Info, CheckCircle2,
  Search, Filter, Send, ChevronRight, Zap, AlertCircle,
} from "lucide-react";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

const SEVERITY_LEVELS = {
  urgent: { color: "#DC2626", key: "notifications.panel.urgent", bg: "#FEE2E2" },
  high: { color: "#F97316", key: "notifications.panel.high", bg: "#FFF7ED" },
  medium: { color: "#3B82F6", key: "notifications.panel.medium", bg: "#EFF6FF" },
  low: { color: "#10B981", key: "notifications.panel.low", bg: "#F0FDF4" },
};

export interface MessageAction {
  id: string;
  type: "link" | "action" | "reply";
  label: string;
  icon?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  variant?: "primary" | "secondary";
}

export interface WorkerMessage {
  id: string;
  alert_type: string;
  title: string;
  message: string;
  severity: "urgent" | "high" | "medium" | "low";
  is_read: boolean;
  created_at: string;
  patient_id?: string;
  session_id?: string;
  actions?: MessageAction[];
}

async function fetchWorkerMessages(unread_only = false): Promise<{ messages: WorkerMessage[]; count: number }> {
  const params = new URLSearchParams();
  if (unread_only) params.append("unread_only", "true");
  
  try {
    const data = await jsonFetch<{ messages: any[]; count: number }>(`/api/worker/messages?${params}`);
        
    const transformed = {
      messages: (data.messages || []).map((msg: any) => ({
        id: msg.id,
        alert_type: msg.alert_type,
        title: msg.title,
        message: msg.message,
        severity: msg.severity || "low",
        is_read: msg.is_read || false,
        created_at: msg.created_at,
        patient_id: msg.patient_id,
        session_id: msg.session_id,
      })),
      count: data.count || 0,
    };
    
    return transformed;
  } catch (error) {
    throw error;
  }
}

async function markMessageRead(messageId: string): Promise<void> {  
  try {
    await jsonFetch(`/api/worker/messages/${messageId}/read`, {
      method: "POST",
    });
  } catch (error) {
    throw error;
  }
}

async function replyToMessage(messageId: string, replyText: string): Promise<void> {  
  try {
    await jsonFetch(`/api/worker/messages/${messageId}/reply`, {
      method: "POST",
      body: JSON.stringify({ message: replyText }),
    });
  } catch (error) {
    throw error;
  }
}

function generateMessageActions(message: WorkerMessage, translate: (key: string) => string): MessageAction[] {
  const actions: MessageAction[] = [];

  if (message.alert_type === "credential_expiry") {
    actions.push({
      id: "update-credential",
      type: "link",
      label: translate("notifications.panel.updateCredential"),
      icon: <CheckCircle2 size={16} />,
      href: "/settings?tab=credentials",
      variant: "primary",
    });
  } else if (message.alert_type === "missing_credential") {
    actions.push({
      id: "add-credential",
      type: "link",
      label: translate("notifications.panel.addCredential"),
      icon: <Zap size={16} />,
      href: "/settings?tab=credentials",
      variant: "primary",
    });
  } else if (message.alert_type === "coordinator_message") {
    actions.push({
      id: "reply",
      type: "reply",
      label: translate("notifications.panel.replyCoordinator"),
      icon: <Send size={16} />,
      variant: "primary",
    });
  }

  return actions;
}

function useRelativeTime() {
  const { translate, translateParams } = useAccessibility();
  return (iso?: string) => {
    if (!iso) return "";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return translate("messages.justNow");
    if (mins < 60) return translateParams("messages.minutesAgo", { count: String(mins) });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return translateParams("messages.hoursAgo", { count: String(hrs) });
    return translateParams("messages.daysAgo", { count: String(Math.floor(hrs / 24)) });
  };
}

function getSeverityMeta(severity: string) {
  return (
    SEVERITY_LEVELS[severity as keyof typeof SEVERITY_LEVELS] ||
    SEVERITY_LEVELS.low
  );
}

// ── Message Detail Modal ──────────────────────────────────────────────────────────
function MessageDetailModal({
  message,
  onClose,
  onRead,
  onRefresh,
}: {
  message: WorkerMessage;
  onClose: () => void;
  onRead: () => void;
  onRefresh?: () => void;
}) {
  const { translate } = useAccessibility();
  const relativeTime = useRelativeTime();
  const meta = getSeverityMeta(message.severity);
  const [replyText, setReplyText] = useState("");
  const [isReplying, setIsReplying] = useState(false);
  const [replySent, setReplySent] = useState(false);
  
  const actions = generateMessageActions(message, translate);
  const qc = useQueryClient();
  
  const icon =
    message.severity === "urgent" ? (
      <AlertTriangle size={24} />
    ) : message.severity === "high" ? (
      <AlertTriangle size={24} />
    ) : (
      <Info size={24} />
    );

  const handleMarkRead = () => {
    if (!message.is_read) {
      onRead();
    }
  };

  const handleAction = (action: MessageAction) => {
    if (action.type === "link" && action.href) {
      window.location.href = action.href;
    } else if (action.type === "reply") {
      setIsReplying(!isReplying);
    } else if (action.onClick) {
      action.onClick();
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    
    try {
      await replyToMessage(message.id, replyText);
      setReplySent(true);
      setReplyText("");
      setTimeout(() => {
        setIsReplying(false);
        setReplySent(false);
        if (onRefresh) onRefresh();
      }, 2000);
    } catch (error) {
      console.error("Failed to send reply:", error);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        style={{ zIndex: 40 }}
      />

      {/* Modal */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
        style={{ zIndex: 50 }}
      >
        <div
          className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div
            className="px-5 py-4 border-b flex items-start justify-between"
            style={{ borderColor: BORDER }}
          >
            <div className="flex items-start gap-3 flex-1">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 flex-shrink-0"
                style={{ background: meta.bg, color: meta.color }}
              >
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-[15px] font-bold" style={{ color: TEXT }}>
                  {message.title}
                </h3>
                <p className="text-[12px] mt-0.5" style={{ color: MUTED }}>
                  {relativeTime(message.created_at)}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              title={translate("notifications.panel.close")}
            >
              <X size={18} style={{ color: MUTED }} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {/* Severity & Type */}
            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <span
                className="inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase"
                style={{ background: meta.bg, color: meta.color }}
              >
                {translate(meta.key)}
              </span>
              <span
                className="inline-block px-2.5 py-1 rounded-full text-[11px] font-semibold uppercase"
                style={{ background: SOFT, color: PLUM }}
              >
                {message.alert_type === "coordinator_message" ? translate("messages.coordinator") : message.alert_type}
              </span>
            </div>

            {/* Message Body */}
            <div className="mb-4">
              <p
                className="text-[14px] leading-relaxed whitespace-pre-wrap"
                style={{ color: TEXT }}
              >
                {message.message}
              </p>
            </div>

            {/* Actions */}
            {actions.length > 0 && (
              <div className="mb-4 flex flex-col gap-2">
                {actions.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => handleAction(action)}
                    className="w-full px-4 py-2.5 rounded-lg text-[13px] font-semibold transition-all flex items-center justify-center gap-2"
                    style={{
                      background: action.variant === "primary" ? PLUM : SOFT,
                      color: action.variant === "primary" ? "#fff" : TEXT,
                    }}
                  >
                    {action.icon}
                    {action.label}
                  </button>
                ))}
              </div>
            )}

            {/* Reply Form */}
            {isReplying && message.alert_type === "coordinator_message" && (
              <div
                className="mb-4 p-3 rounded-lg border"
                style={{ background: SOFT, borderColor: BORDER }}
              >
                <p className="text-[11px] font-semibold mb-2" style={{ color: TEXT }}>
                  {translate("notifications.panel.replyTitle")}
                </p>
                <textarea
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={translate("notifications.panel.replyPlaceholder")}
                  className="w-full p-2.5 rounded border text-[13px] resize-none focus:outline-none focus:ring-2"
                  style={{
                    borderColor: BORDER,
                    "--tw-ring-color": `${PLUM}20`,
                  } as any}
                  rows={3}
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => setIsReplying(false)}
                    className="flex-1 px-3 py-2 rounded text-[12px] font-semibold transition-colors"
                    style={{ background: BORDER, color: TEXT }}
                  >
                    {translate("common.cancel")}
                  </button>
                  <button
                    onClick={handleSendReply}
                    disabled={!replyText.trim()}
                    className="flex-1 px-3 py-2 rounded text-[12px] font-semibold transition-colors text-white disabled:opacity-50"
                    style={{ background: PLUM }}
                  >
                    {replySent ? translate("notifications.panel.sent") : translate("notifications.panel.sendReply")}
                  </button>
                </div>
              </div>
            )}

            {/* Meta Information */}
            <div
              className="p-3 rounded-lg"
              style={{ background: SOFT, borderLeft: `3px solid ${meta.color}` }}
            >
              <p className="text-[11px] font-semibold" style={{ color: MUTED }}>
                {translate("notifications.panel.details")}
              </p>
              <div className="mt-2 space-y-1 text-[12px]" style={{ color: TEXT }}>
                <div className="flex justify-between">
                  <span>{translate("notifications.panel.status")}</span>
                  <span className="font-semibold">
                    {message.is_read ? translate("notifications.panel.read") : translate("notifications.panel.unread")}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{translate("notifications.panel.received")}</span>
                  <span className="font-semibold">
                    {new Date(message.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{translate("notifications.panel.messageId")}</span>
                  <span
                    className="font-mono text-[10px] truncate"
                    title={message.id}
                  >
                    {message.id.slice(0, 8)}...
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            className="px-5 py-3 border-t flex gap-2 justify-end"
            style={{ borderColor: BORDER }}
          >
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors"
              style={{
                background: BORDER,
                color: TEXT,
              }}
            >
              {translate("notifications.panel.close")}
            </button>
            {!message.is_read && !isReplying && (
              <button
                onClick={handleMarkRead}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold transition-colors text-white"
                style={{ background: PLUM }}
              >
                {translate("notifications.panel.markRead")}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function MessageRow({
  message,
  onRead,
  onSelectMessage,
}: {
  message: WorkerMessage;
  onRead: (id: string) => void;
  onSelectMessage: () => void;
}) {
  const { translate } = useAccessibility();
  const relativeTime = useRelativeTime();
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
      className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-gray-50 cursor-pointer border-b"
      style={{ opacity: message.is_read ? 0.6 : 1, borderColor: BORDER }}
      onClick={onSelectMessage}
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
        <p className="text-[12px] text-[#6B7280] mt-0.5 line-clamp-2 whitespace-pre-wrap">
          {message.message}
        </p>
        <div className="flex items-center gap-2 mt-2">
          <span
            className="text-[10px] font-semibold uppercase"
            style={{ color: meta.color }}
          >
            {translate(meta.key)}
          </span>
          <span className="text-[10px]" style={{ color: MUTED }}>
            {relativeTime(message.created_at)}
          </span>
          <span className="text-[10px] ml-auto" style={{ color: MUTED }}>
            {translate("notifications.panel.clickToView")}
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
  const { translate } = useAccessibility();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const qc = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<WorkerMessage | null>(null);

  const { data: response, isLoading, error, refetch } = useOrgQuery(
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
      style={{ background: "var(--cc-bg)", borderLeft: `1px solid ${BORDER}` }}
    >
      {/* Header */}
      <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <Bell size={18} style={{ color: PLUM }} />
            <h2 className="text-[15px] font-black" style={{ color: TEXT }}>
              {translate("notifications.panel.title")}
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
                <CheckCheck size={13} /> {translate("notifications.panel.markAllRead")}
              </button>
            )}
            <button
              aria-label={translate("notifications.panel.closeAria")}
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
              placeholder={translate("notifications.panel.search")}
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
            title={translate("notifications.panel.filterBySeverity")}
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
              {translate("notifications.panel.all")}
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
                {translate(config.key)}
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
              {translate("notifications.panel.errorLoading")}
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
              {messages.length === 0 ? translate("notifications.panel.empty") : translate("notifications.panel.noMatch")}
            </p>
          </div>
        )}

        {!isLoading && !error &&
          filteredMessages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              onRead={(id) => readMut.mutate(id)}
              onSelectMessage={() => setSelectedMessage(message)}
            />
          ))}
      </div>

      {/* Message Detail Modal */}
      {selectedMessage && (
        <MessageDetailModal
          message={selectedMessage}
          onClose={() => setSelectedMessage(null)}
          onRead={() => {
            readMut.mutate(selectedMessage.id);
            setSelectedMessage(null);
          }}
          onRefresh={() => refetch()}
        />
      )}
    </div>
  );
}

// ── Bell icon with badge (for header) ──────────────────────────────────────────
export function WorkerNotificationBell({ onClick }: { onClick: () => void }) {
  const { translate } = useAccessibility();
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
      title={translate("notifications.panel.bellTitle")}
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
