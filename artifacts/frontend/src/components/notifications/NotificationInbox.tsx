import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  AlertTriangle, ArrowLeft, ArrowRight, Bell, CalendarDays, CheckCheck, ClipboardCheck, GraduationCap,
  MessageSquare, Settings2, Star, UserPlus, UserRound, X,
} from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import {
  acknowledgeNotification,
  dismissNotification,
  fetchNotifications,
  markAllInboxNotificationsRead,
  markInboxNotificationRead,
  replyToOfficeMessage,
  type UserNotification,
} from "@/services/notificationService";
import {
  getCoordinatorNotifications,
  markAllNotificationsRead as markAllTeamAlertsRead,
  markNotificationRead as markTeamAlertRead,
  type CoordinatorAlert,
} from "@/services/coordinatorService";
import { acceptShiftOffer, declineShiftOffer } from "@/services/shiftService";
import { audienceForRole, notificationDestination, type NotificationAudience } from "@/lib/notification-destination";
import { formatNotificationShiftTime } from "@/lib/notification-copy";

const INBOX_KEY = ["notification-inbox"] as const;
const TEAM_KEY = ["coordinator-notifications", "team-feed"] as const;
const URGENT = new Set(["critical", "emergency", "urgent", "high"]);

type Tab = "all" | "unread" | "team";

/** Everything that shows a count or list of the personal inbox. */
export function invalidateInbox(qc: QueryClient, orgId: string) {
  for (const key of ["notification-inbox", "worker-notifications-unread", "notification-history", "notification-banners"]) {
    void qc.invalidateQueries({ queryKey: [orgId, key] });
  }
}

function eventIcon(event: string): ReactNode {
  const size = 15;
  if (event === "safety_alert" || event.startsWith("incident") || event === "worker_cannot_attend" || event === "medication_alert" || event === "shift_cancel") {
    return <AlertTriangle size={size} />;
  }
  if (event === "coordinator_message" || event.includes("message")) return <MessageSquare size={size} />;
  if (["task_reminder", "medication_dose_reminder", "long_shift_checkin"].includes(event)) return <ClipboardCheck size={size} />;
  if (event.includes("feedback")) return <Star size={size} />;
  if (event.startsWith("training") || event === "certification_expiry" || event === "ndis_screening_recheck_due") return <GraduationCap size={size} />;
  if (event.startsWith("shift") || event === "buddy_assigned") return <CalendarDays size={size} />;
  if (event.startsWith("account")) return <UserRound size={size} />;
  if (/invite|applicant|onboarding|offer_letter|hire|availability/.test(event)) return <UserPlus size={size} />;
  return <Bell size={size} />;
}

const TEAM_LABELS: Record<string, string> = {
  emergency: "inbox.team.emergency",
  coordinator_flag: "inbox.team.flagged",
  no_session_started: "inbox.team.notStarted",
  no_notes_recorded: "inbox.team.noNotes",
  worker_reply: "inbox.team.workerReply",
  long_shift_gap_amber: "inbox.team.longShift",
  long_shift_gap_red: "inbox.team.longShift",
  long_shift_checkin_attention: "inbox.team.longShift",
  coordinator_message: "inbox.team.message",
};

function teamLabel(alert: CoordinatorAlert, translate: (k: string) => string): string {
  const labelKey = alert.alert_type ? TEAM_LABELS[alert.alert_type] : undefined;
  const raw = (alert.alert_type ?? "").replace(/_/g, " ");
  return labelKey ? translate(labelKey) : raw.charAt(0).toUpperCase() + raw.slice(1);
}

function dayLabel(iso: string, translate: (k: string) => string): string {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return translate("inbox.today");
  if (date.toDateString() === yesterday.toDateString()) return translate("inbox.yesterday");
  return date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

function groupByDay<T>(items: T[], createdAt: (item: T) => string | undefined, translate: (k: string) => string) {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of items) {
    const label = dayLabel(createdAt(item) ?? new Date().toISOString(), translate);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function useWhen() {
  const { translate, translateParams } = useAccessibility();
  return (iso?: string) => {
    if (!iso) return "";
    const date = new Date(iso);
    const mins = Math.floor((Date.now() - date.getTime()) / 60000);
    if (date.toDateString() !== new Date().toDateString()) {
      return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
    if (mins < 1) return translate("messages.justNow");
    if (mins < 60) return translateParams("messages.minutesAgo", { count: String(mins) });
    return translateParams("messages.hoursAgo", { count: String(Math.floor(mins / 60)) });
  };
}

function fullTime(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function RowIcon({ urgent, children }: { urgent: boolean; children: ReactNode }) {
  return (
    <span
      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
      style={urgent ? { background: "#FEE2E2", color: "#B91C1C" } : { background: "var(--cc-soft)", color: "var(--cc-plum)" }}
      aria-hidden
    >
      {children}
    </span>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-4 px-4 py-4" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-black/5" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-black/5" />
            <div className="h-3 w-full animate-pulse rounded bg-black/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--cc-soft)", color: "var(--cc-plum)" }}>
        <CheckCheck size={20} />
      </span>
      <p className="text-[14px] font-semibold" style={{ color: "var(--cc-text)" }}>{title}</p>
      {hint && <p className="mt-1 max-w-xs text-[12px]" style={{ color: "var(--cc-muted)" }}>{hint}</p>}
    </div>
  );
}

/** Accept/decline an offer, acknowledge a change, reply to the office. Shared
 *  by the list row and the full view. */
function NotificationActions({ item, audience, className }: { item: UserNotification; audience: NotificationAudience; className?: string }) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");

  const done = (title: string) => {
    toast({ title });
    invalidateInbox(qc, orgId);
    void qc.invalidateQueries({ queryKey: [orgId, "worker"] });
  };
  const failed = (error: unknown) =>
    toast({ variant: "destructive", title: translate("inbox.actionFailed"), description: error instanceof Error ? error.message : undefined });

  const accept = useMutation({
    mutationFn: async () => {
      await acceptShiftOffer(item.shift_id!);
      await markInboxNotificationRead(item.id);
    },
    onSuccess: () => done(translate("inbox.offerAccepted")),
    onError: failed,
  });
  const decline = useMutation({
    mutationFn: async () => {
      await declineShiftOffer(item.shift_id!);
      await markInboxNotificationRead(item.id);
    },
    onSuccess: () => done(translate("inbox.offerDeclined")),
    onError: failed,
  });
  const acknowledge = useMutation({
    mutationFn: () => acknowledgeNotification(item.id),
    onSuccess: () => done(translate("inbox.acknowledged")),
    onError: failed,
  });
  const sendReply = useMutation({
    mutationFn: () => replyToOfficeMessage(item.id, reply.trim()),
    onSuccess: () => {
      setReply("");
      setReplying(false);
      void markInboxNotificationRead(item.id);
      done(translate("inbox.replySent"));
    },
    onError: failed,
  });

  const isWorker = audience === "worker";
  // Opening a notification marks it read, so read state can't gate the offer
  // buttons; the API refuses an offer that's been answered or has expired.
  const canRespondToOffer = isWorker && item.event_type === "shift_offer" && Boolean(item.shift_id);
  const needsAck = Boolean(item.requires_ack) && !item.acknowledged_at;
  const canReply = isWorker && item.event_type === "coordinator_message";
  const busy = accept.isPending || decline.isPending || acknowledge.isPending;
  if (!canRespondToOffer && !needsAck && !canReply) return null;

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        {canRespondToOffer && (
          <>
            <button type="button" disabled={busy} onClick={() => accept.mutate()} className="min-h-9 rounded-full px-4 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: "var(--cc-plum)" }}>
              {translate("notifications.panel.acceptShift")}
            </button>
            <button type="button" disabled={busy} onClick={() => decline.mutate()} className="min-h-9 rounded-full border px-4 text-[12px] font-semibold disabled:opacity-50" style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)" }}>
              {translate("notifications.panel.declineShift")}
            </button>
          </>
        )}
        {needsAck && (
          <button type="button" disabled={busy} onClick={() => acknowledge.mutate()} className="min-h-9 rounded-full px-4 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: "var(--cc-plum)" }}>
            {translate("inbox.acknowledge")}
          </button>
        )}
        {canReply && !replying && (
          <button type="button" onClick={() => setReplying(true)} className="min-h-9 rounded-full border px-4 text-[12px] font-semibold" style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)" }}>
            {translate("inbox.reply")}
          </button>
        )}
      </div>
      {replying && (
        <form
          className="mt-2 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (reply.trim()) sendReply.mutate();
          }}
        >
          <textarea
            autoFocus
            rows={3}
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            maxLength={1000}
            aria-label={translate("notifications.panel.replyTitle")}
            placeholder={translate("notifications.panel.replyPlaceholder")}
            className="w-full resize-none rounded-xl border bg-white p-2.5 text-[13px] focus:outline-none focus:ring-2"
            style={{ borderColor: "var(--cc-border)" }}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={!reply.trim() || sendReply.isPending} className="min-h-9 rounded-full px-4 text-[12px] font-semibold text-white disabled:opacity-50" style={{ background: "var(--cc-plum)" }}>
              {translate("notifications.panel.sendReply")}
            </button>
            <button type="button" onClick={() => { setReplying(false); setReply(""); }} className="min-h-9 rounded-full px-3 text-[12px] font-semibold" style={{ color: "var(--cc-muted)" }}>
              {translate("common.cancel")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function InboxRow({
  item,
  audience,
  onOpen,
  onDismiss,
}: {
  item: UserNotification;
  audience: NotificationAudience;
  onOpen: (item: UserNotification) => void;
  onDismiss: (item: UserNotification) => void;
}) {
  const { translate } = useAccessibility();
  const when = useWhen();
  const unread = !item.read_at;
  const urgent = URGENT.has(item.severity) || item.banner_style === "red";

  return (
    <li className="group relative px-4 py-3 transition-colors hover:bg-black/[0.03]" style={unread ? { background: "var(--cc-soft)" } : undefined}>
      <div className="flex items-start gap-3">
        <RowIcon urgent={urgent}>{eventIcon(item.event_type)}</RowIcon>
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(item)}>
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-[13px] leading-snug" style={{ color: "var(--cc-text)", fontWeight: unread ? 700 : 500 }}>
              {item.title}
            </span>
            {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--cc-coral)" }} aria-label={translate("inbox.unread")} />}
          </span>
          {item.body && (
            <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed" style={{ color: "var(--cc-muted)" }}>{item.body}</span>
          )}
          <span className="mt-1 block text-[11px]" style={{ color: "var(--cc-muted)" }}>{when(item.created_at)}</span>
        </button>
        <button
          type="button"
          className="-mr-1 shrink-0 rounded-full p-1.5 opacity-60 transition hover:bg-black/5 hover:opacity-100 focus-visible:opacity-100"
          aria-label={translate("inbox.dismiss")}
          title={translate("inbox.dismiss")}
          onClick={() => onDismiss(item)}
        >
          <X size={14} style={{ color: "var(--cc-muted)" }} />
        </button>
      </div>
      <NotificationActions item={item} audience={audience} className="ml-11 mt-2" />
    </li>
  );
}

function TeamRow({ alert, onOpen }: { alert: CoordinatorAlert; onOpen: (alert: CoordinatorAlert) => void }) {
  const { translate } = useAccessibility();
  const when = useWhen();
  const label = teamLabel(alert, translate);
  const urgent = URGENT.has(alert.severity ?? "") || alert.alert_type === "emergency";
  const unread = !alert.is_read;
  return (
    <li className="px-4 py-3 transition-colors hover:bg-black/[0.03]" style={unread ? { background: "var(--cc-soft)" } : undefined}>
      <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => onOpen(alert)}>
        <RowIcon urgent={urgent}>{urgent ? <AlertTriangle size={15} /> : alert.alert_type === "worker_reply" ? <MessageSquare size={15} /> : <Bell size={15} />}</RowIcon>
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span className="min-w-0 flex-1 text-[13px] leading-snug" style={{ color: "var(--cc-text)", fontWeight: unread ? 700 : 500 }}>
              {alert.title || alert.message || translate("coordinator.notifications.default")}
            </span>
            {unread && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: "var(--cc-coral)" }} aria-label={translate("inbox.unread")} />}
          </span>
          {alert.title && alert.message && (
            <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed" style={{ color: "var(--cc-muted)" }}>{alert.message}</span>
          )}
          <span className="mt-1 block text-[11px]" style={{ color: "var(--cc-muted)" }}>
            <span className="font-semibold">{label}</span> · {when(alert.created_at)}
          </span>
        </span>
      </button>
    </li>
  );
}

/** "Was / Now" for a shift change, from the values the backend stored. */
function ShiftChangeDetails({ payload }: { payload?: Record<string, unknown> }) {
  const { translate } = useAccessibility();
  const before = (payload?.old ?? {}) as Record<string, unknown>;
  const after = (payload?.new ?? {}) as Record<string, unknown>;
  const rows = ([
    ["scheduled_start", "inbox.change.start"],
    ["scheduled_end", "inbox.change.end"],
    ["location", "inbox.change.location"],
  ] as const).filter(([key]) => before[key] !== undefined || after[key] !== undefined);
  if (!rows.length) return null;
  const show = (key: string, value: unknown) =>
    typeof value === "string" && value ? (key === "location" ? value : formatNotificationShiftTime(value)) : "N/A";
  return (
    <dl className="mt-4 overflow-hidden rounded-xl border text-[13px]" style={{ borderColor: "var(--cc-border)" }}>
      {rows.map(([key, labelKey]) => (
        <div key={key} className="grid grid-cols-[5.5rem_1fr] gap-x-3 border-b px-3 py-2.5 last:border-b-0" style={{ borderColor: "var(--cc-border)" }}>
          <dt className="row-span-2 font-semibold" style={{ color: "var(--cc-muted)" }}>{translate(labelKey)}</dt>
          <dd style={{ color: "var(--cc-muted)" }}>
            <span className="sr-only">{translate("inbox.change.was")} </span>
            <span className="line-through">{show(key, before[key])}</span>
          </dd>
          <dd className="font-semibold" style={{ color: "var(--cc-text)" }}>
            <span className="sr-only">{translate("inbox.change.now")} </span>
            {show(key, after[key])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DetailShell({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  const { translate } = useAccessibility();
  return (
    <div className="px-4 py-3">
      <button type="button" onClick={onBack} className="-ml-2 mb-3 flex min-h-9 items-center gap-1.5 rounded-full px-2 text-[12px] font-semibold transition hover:bg-black/5" style={{ color: "var(--cc-muted)" }}>
        <ArrowLeft size={14} /> {translate("inbox.back")}
      </button>
      {children}
    </div>
  );
}

function GoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="mt-5 flex min-h-11 w-full items-center justify-center gap-2 rounded-full px-5 text-[14px] font-semibold text-white" style={{ background: "var(--cc-plum)" }}>
      {label} <ArrowRight size={15} aria-hidden />
    </button>
  );
}

/** Everything about one notification: the full message, what changed, and
 *  the way to act on it. Opens when a row is tapped. */
function NotificationDetail({
  item,
  audience,
  onBack,
  onGo,
  onDismiss,
}: {
  item: UserNotification;
  audience: NotificationAudience;
  onBack: () => void;
  onGo: (path: string) => void;
  onDismiss: (item: UserNotification) => void;
}) {
  const { translate, translateParams } = useAccessibility();
  const when = useWhen();
  const urgent = URGENT.has(item.severity) || item.banner_style === "red";
  const destination = notificationDestination(item, audience);
  return (
    <DetailShell onBack={onBack}>
      <article aria-labelledby="notification-detail-title">
        <div className="flex items-start gap-3">
          <RowIcon urgent={urgent}>{eventIcon(item.event_type)}</RowIcon>
          <div className="min-w-0 flex-1">
            <h3 id="notification-detail-title" className="text-[17px] font-bold leading-snug" style={{ color: "var(--cc-text)" }}>{item.title}</h3>
            <p className="mt-1 text-[12px]" style={{ color: "var(--cc-muted)" }}>
              {fullTime(item.created_at)} · {when(item.created_at)}
            </p>
          </div>
        </div>
        {item.body && (
          <p className="mt-4 whitespace-pre-wrap text-[14px] leading-relaxed" style={{ color: "var(--cc-text)" }}>{item.body}</p>
        )}
        {item.event_type === "shift_change" && <ShiftChangeDetails payload={item.payload} />}
        {item.requires_ack && item.acknowledged_at && (
          <p className="mt-4 text-[12px] font-semibold" style={{ color: "var(--cc-muted)" }}>
            {translateParams("inbox.acknowledgedAt", { time: fullTime(item.acknowledged_at) })}
          </p>
        )}
        <NotificationActions item={item} audience={audience} className="mt-5" />
        {destination && <GoButton label={translate(destination.labelKey)} onClick={() => onGo(destination.path)} />}
        <button
          type="button"
          onClick={() => onDismiss(item)}
          className="mt-3 flex min-h-10 w-full items-center justify-center rounded-full text-[13px] font-semibold transition hover:bg-black/5"
          style={{ color: "var(--cc-muted)" }}
        >
          {translate("inbox.dismiss")}
        </button>
      </article>
    </DetailShell>
  );
}

function TeamAlertDetail({ alert, audience, onBack, onGo }: { alert: CoordinatorAlert; audience: NotificationAudience; onBack: () => void; onGo: (path: string) => void }) {
  const { translate } = useAccessibility();
  const when = useWhen();
  const urgent = URGENT.has(alert.severity ?? "") || alert.alert_type === "emergency";
  const destination = notificationDestination(
    { event_type: alert.alert_type ?? "", action_url: null, shift_id: alert.shift_id ?? null, conversation_id: null },
    audience,
  );
  return (
    <DetailShell onBack={onBack}>
      <article aria-labelledby="team-alert-detail-title">
        <div className="flex items-start gap-3">
          <RowIcon urgent={urgent}>{urgent ? <AlertTriangle size={15} /> : <Bell size={15} />}</RowIcon>
          <div className="min-w-0 flex-1">
            <h3 id="team-alert-detail-title" className="text-[17px] font-bold leading-snug" style={{ color: "var(--cc-text)" }}>
              {alert.title || teamLabel(alert, translate)}
            </h3>
            <p className="mt-1 text-[12px]" style={{ color: "var(--cc-muted)" }}>
              {teamLabel(alert, translate)} · {fullTime(alert.created_at)} · {when(alert.created_at)}
            </p>
          </div>
        </div>
        {alert.message && (
          <p className="mt-4 whitespace-pre-wrap text-[14px] leading-relaxed" style={{ color: "var(--cc-text)" }}>{alert.message}</p>
        )}
        <p className="mt-4 text-[12px]" style={{ color: "var(--cc-muted)" }}>{translate("inbox.team.hint")}</p>
        {destination && <GoButton label={translate(destination.labelKey)} onClick={() => onGo(destination.path)} />}
      </article>
    </DetailShell>
  );
}

/**
 * The notifications inbox for every role: the person's own notifications
 * (user_notifications), plus, for office staff, the organisation's shared
 * alert feed. Used in the bell's side panel and on /notifications.
 */
export function NotificationInbox({
  onClose,
  variant = "panel",
  initialOpenId,
}: {
  onClose?: () => void;
  variant?: "panel" | "page";
  /** Open this notification's full view straight away (email and pop-up links). */
  initialOpenId?: string | null;
}) {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const orgId = user?.organizationId ?? "__no_org__";
  const audience = audienceForRole(user?.role);
  const isOffice = audience !== "worker";
  const [tab, setTab] = useState<Tab>("all");
  const [selected, setSelected] = useState<{ kind: "inbox" | "team"; id: string } | null>(
    initialOpenId ? { kind: "inbox", id: initialOpenId } : null,
  );

  const inbox = useOrgQuery([...INBOX_KEY], { queryFn: () => fetchNotifications({ days: 90 }), enabled: !!user });
  const team = useOrgQuery<CoordinatorAlert[]>([...TEAM_KEY], {
    queryFn: () => getCoordinatorNotifications({ limit: 80 }),
    enabled: !!user && isOffice,
    refetchInterval: 60_000,
  });

  // Dismissed items are cleared from the list; they're gone for good.
  const items = useMemo(() => (inbox.data?.notifications ?? []).filter((n) => !n.dismissed_at), [inbox.data]);
  const unreadCount = items.filter((n) => !n.read_at).length;
  const teamUnread = (team.data ?? []).filter((a) => !a.is_read).length;
  const visible = tab === "unread" ? items.filter((n) => !n.read_at) : items;

  function patchInbox(id: string | null, patch: Partial<UserNotification>) {
    qc.setQueryData<{ notifications: UserNotification[]; count: number }>([orgId, ...INBOX_KEY], (current) =>
      current && {
        ...current,
        notifications: current.notifications.map((n) => (id === null || n.id === id ? { ...n, ...patch } : n)),
      },
    );
  }

  const readOne = useMutation({
    mutationFn: markInboxNotificationRead,
    onMutate: (id) => patchInbox(id, { read_at: new Date().toISOString() }),
    onSettled: () => invalidateInbox(qc, orgId),
  });
  const dismissOne = useMutation({
    mutationFn: dismissNotification,
    onMutate: (id) => patchInbox(id, { dismissed_at: new Date().toISOString(), read_at: new Date().toISOString() }),
    onError: () => toast({ variant: "destructive", title: translate("inbox.actionFailed") }),
    onSettled: () => invalidateInbox(qc, orgId),
  });
  const readAll = useMutation({
    mutationFn: markAllInboxNotificationsRead,
    onMutate: () => patchInbox(null, { read_at: new Date().toISOString() }),
    onError: () => toast({ variant: "destructive", title: translate("inbox.actionFailed") }),
    onSettled: () => invalidateInbox(qc, orgId),
  });
  const readTeam = useMutation({
    mutationFn: markTeamAlertRead,
    onSettled: () => qc.invalidateQueries({ queryKey: [orgId, "coordinator-notifications"] }),
  });
  const readAllTeam = useMutation({
    mutationFn: markAllTeamAlertsRead,
    onError: () => toast({ variant: "destructive", title: translate("inbox.actionFailed") }),
    onSettled: () => qc.invalidateQueries({ queryKey: [orgId, "coordinator-notifications"] }),
  });

  const selectedItem = selected?.kind === "inbox" ? items.find((n) => n.id === selected.id) : undefined;
  const selectedAlert = selected?.kind === "team" ? team.data?.find((a) => a.id === selected.id) : undefined;
  const inDetail = Boolean(selectedItem || selectedAlert);

  // Opened from a link (email, pop-up): mark it read once it has loaded.
  const selectedUnreadId = selectedItem && !selectedItem.read_at ? selectedItem.id : null;
  useEffect(() => {
    if (selectedUnreadId) readOne.mutate(selectedUnreadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnreadId]);

  function openItem(item: UserNotification) {
    setSelected({ kind: "inbox", id: item.id });
  }

  function openTeamAlert(alert: CoordinatorAlert) {
    if (!alert.is_read) readTeam.mutate(alert.id);
    setSelected({ kind: "team", id: alert.id });
  }

  function go(path: string) {
    navigate(path);
    onClose?.();
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "all", label: translate("inbox.tab.all") },
    { id: "unread", label: translate("inbox.tab.unread"), count: unreadCount },
    ...(isOffice ? [{ id: "team" as Tab, label: translate("inbox.tab.team"), count: teamUnread }] : []),
  ];
  const showReadAll = !inDetail && (tab === "team" ? teamUnread > 0 : unreadCount > 0);

  let body: ReactNode;
  if (selectedItem) {
    body = (
      <NotificationDetail
        item={selectedItem}
        audience={audience}
        onBack={() => setSelected(null)}
        onGo={go}
        onDismiss={(n) => {
          dismissOne.mutate(n.id);
          setSelected(null);
        }}
      />
    );
  } else if (selectedAlert) {
    body = <TeamAlertDetail alert={selectedAlert} audience={audience} onBack={() => setSelected(null)} onGo={go} />;
  } else if (tab === "team") {
    if (team.isLoading) body = <SkeletonRows />;
    else if (team.isError) body = <LoadError onRetry={() => void team.refetch()} />;
    else if (!team.data?.length) body = <EmptyState title={translate("inbox.team.empty")} hint={translate("inbox.team.hint")} />;
    else body = (
      <>
        <p className="px-4 pt-3 text-[11px]" style={{ color: "var(--cc-muted)" }}>{translate("inbox.team.hint")}</p>
        {groupByDay(team.data, (a) => a.created_at, translate).map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h3 className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--cc-muted)" }}>{group.label}</h3>
            <ul>{group.items.map((alert) => <TeamRow key={alert.id} alert={alert} onOpen={openTeamAlert} />)}</ul>
          </section>
        ))}
      </>
    );
  } else if (inbox.isLoading) {
    body = <SkeletonRows />;
  } else if (inbox.isError) {
    body = <LoadError onRetry={() => void inbox.refetch()} />;
  } else if (visible.length === 0) {
    body = tab === "unread"
      ? <EmptyState title={translate("inbox.emptyUnread")} />
      : <EmptyState title={translate("inbox.empty")} hint={translate("inbox.emptyHint")} />;
  } else {
    body = groupByDay(visible, (n) => n.created_at, translate).map((group) => (
      <section key={group.label} aria-label={group.label}>
        <h3 className="px-4 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--cc-muted)" }}>{group.label}</h3>
        <ul>
          {group.items.map((item) => (
            <InboxRow key={item.id} item={item} audience={audience} onOpen={openItem} onDismiss={(n) => dismissOne.mutate(n.id)} />
          ))}
        </ul>
      </section>
    ));
  }

  const isPanel = variant === "panel";
  const tabBar = (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={translate("inbox.title")}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={tab === t.id}
          onClick={() => setTab(t.id)}
          className="flex min-h-8 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition"
          style={tab === t.id ? { background: "var(--cc-text)", color: "#fff" } : { background: "var(--cc-soft)", color: "var(--cc-text)" }}
        >
          {t.label}
          {!!t.count && <span className="text-[11px] opacity-80">{t.count > 99 ? "99+" : t.count}</span>}
        </button>
      ))}
    </div>
  );

  // The page has its own heading, so it only needs this bar for the tabs.
  const showHeader = isPanel || !inDetail;

  return (
    <div className={isPanel ? "flex min-h-0 flex-1 flex-col" : "flex flex-col rounded-2xl border bg-white"} style={isPanel ? { background: "var(--cc-bg)" } : { borderColor: "var(--cc-border)" }}>
      {showHeader && (
        <div className="px-4 pb-3 pt-4" style={{ borderBottom: "1px solid var(--cc-border)" }}>
          <div className={isPanel ? "flex items-center justify-between gap-2" : "flex flex-wrap items-center justify-between gap-2"}>
            {isPanel ? (
              <h2 className="text-[16px] font-bold" style={{ color: "var(--cc-text)" }}>{translate("inbox.title")}</h2>
            ) : (
              tabBar
            )}
            <div className="flex items-center gap-1">
              {showReadAll && (
                <button
                  type="button"
                  className="flex min-h-9 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition hover:bg-black/5"
                  style={{ color: "var(--cc-plum)" }}
                  onClick={() => (tab === "team" ? readAllTeam.mutate() : readAll.mutate())}
                >
                  <CheckCheck size={14} /> {translate("inbox.markAllRead")}
                </button>
              )}
              {isPanel && (
                <Link href="/notifications/settings">
                  <a
                    className="flex min-h-9 min-w-9 items-center justify-center rounded-full transition hover:bg-black/5"
                    aria-label={translate("inbox.settings")}
                    title={translate("inbox.settings")}
                    onClick={() => onClose?.()}
                  >
                    <Settings2 size={16} style={{ color: "var(--cc-muted)" }} />
                  </a>
                </Link>
              )}
              {onClose && (
                <button type="button" className="flex min-h-9 min-w-9 items-center justify-center rounded-full transition hover:bg-black/5" aria-label={translate("inbox.close")} onClick={onClose}>
                  <X size={16} style={{ color: "var(--cc-muted)" }} />
                </button>
              )}
            </div>
          </div>
          {isPanel && !inDetail && <div className="mt-3">{tabBar}</div>}
        </div>
      )}

      <div className={isPanel ? "min-h-0 flex-1 overflow-y-auto pb-2" : "pb-2"}>{body}</div>

      {isPanel && !inDetail && (
        // Left-aligned: the floating assistant button sits bottom-right.
        <div className="flex items-center gap-5 px-4 py-3 text-[12px] font-semibold" style={{ borderTop: "1px solid var(--cc-border)" }}>
          <Link href="/notifications">
            <a className="py-1" style={{ color: "var(--cc-plum)" }} onClick={() => onClose?.()}>{translate("inbox.seeAll")}</a>
          </Link>
          <Link href="/notifications/settings">
            <a className="py-1" style={{ color: "var(--cc-muted)" }} onClick={() => onClose?.()}>{translate("inbox.settings")}</a>
          </Link>
        </div>
      )}
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const { translate } = useAccessibility();
  return (
    <div role="alert" className="px-4 py-10 text-center text-[13px]" style={{ color: "var(--cc-muted)" }}>
      {translate("inbox.loadFailed")}{" "}
      <button type="button" className="font-semibold underline" style={{ color: "var(--cc-plum)" }} onClick={onRetry}>
        {translate("inbox.tryAgain")}
      </button>
    </div>
  );
}

/** Bell with the number of unread notifications. Office staff also count the
 *  team alert feed, which shares the panel. */
export function NotificationBell({ onClick }: { onClick: () => void }) {
  const { translate, translateParams } = useAccessibility();
  const { user } = useAuth();
  const isOffice = !!user && user.role !== "support_worker";

  const personal = useOrgQuery(["worker-notifications-unread"], {
    queryFn: () => fetchNotifications({ unread_only: true }),
    enabled: !!user,
    refetchInterval: 120_000,
  });
  const team = useOrgQuery<CoordinatorAlert[]>(["coordinator-notifications", "unread"], {
    queryFn: () => getCoordinatorNotifications({ limit: 100, unread_only: true }),
    enabled: isOffice,
    refetchInterval: 60_000,
  });

  const unread = (personal.data?.count ?? 0) + (isOffice ? team.data?.length ?? 0 : 0);

  useAppIconBadge(unread);

  const label = unread > 0 ? translateParams("inbox.bellUnread", { count: String(unread) }) : translate("inbox.title");
  return (
    <button type="button" aria-label={label} title={label} className="relative min-h-11 min-w-11 rounded-full p-2 transition-colors hover:bg-black/5" onClick={onClick}>
      <Bell size={20} style={{ color: "var(--cc-muted)" }} />
      {unread > 0 && (
        <span className="absolute right-0.5 top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-black" style={{ background: "var(--cc-coral)", color: "#fff" }}>
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </button>
  );
}

/** Number on the Home Screen / dock icon when CareCliQ is installed as an app. */
function useAppIconBadge(count: number) {
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    try {
      if (count > 0) void nav.setAppBadge?.(count)?.catch(() => undefined);
      else void nav.clearAppBadge?.()?.catch(() => undefined);
    } catch {
      /* not supported */
    }
  }, [count]);
}
