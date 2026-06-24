import { useMemo } from "react";
import { Link } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { Bell, Loader2 } from "lucide-react";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import {
  dismissNotification,
  fetchNotifications,
  type UserNotification,
} from "@/services/notificationService";

function groupByDate(notifications: UserNotification[]) {
  const groups: Record<string, UserNotification[]> = {};
  for (const n of notifications) {
    const key = new Date(n.created_at).toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    if (!groups[key]) groups[key] = [];
    groups[key].push(n);
  }
  return groups;
}

function NotificationRow({
  item,
  onDismiss,
}: {
  item: UserNotification;
  onDismiss: (id: string) => void;
}) {
  const unread = !item.read_at && !item.dismissed_at;
  return (
    <div
      className="rounded-2xl border bg-white p-4"
      style={{
        borderColor: unread ? PLUM : BORDER,
        borderLeftWidth: unread ? 4 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold" style={{ color: TEXT }}>
            {item.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: MUTED }}>
            {item.body}
          </p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
            {new Date(item.created_at).toLocaleTimeString()}
          </p>
        </div>
        {!item.dismissed_at && (
          <button
            type="button"
            className="shrink-0 text-xs font-bold"
            style={{ color: PLUM }}
            onClick={() => onDismiss(item.id)}
          >
            Dismiss
          </button>
        )}
      </div>
      {item.action_url && (
        <Link href={item.shift_id ? `/my-shifts/${item.shift_id}` : "/my-shifts"}>
          <a className="mt-2 inline-block text-xs font-bold" style={{ color: CORAL }}>
            View details →
          </a>
        </Link>
      )}
    </div>
  );
}

export default function WorkerNotificationsPage() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";

  const { data, isLoading, refetch } = useOrgQuery(["notification-history", orgId], {
    queryFn: () => fetchNotifications({ days: 90 }),
  });

  const notifications = data?.notifications ?? [];
  const grouped = useMemo(() => groupByDate(notifications), [notifications]);

  async function handleDismiss(id: string) {
    await dismissNotification(id);
    await refetch();
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 pb-10">
      <header>
        <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: CORAL }}>
          Notifications
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight" style={{ color: TEXT }}>
          History
        </h1>
        <p className="mt-0.5 text-sm font-semibold" style={{ color: MUTED }}>
          Last 90 days
        </p>
      </header>

      {isLoading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: PLUM }} />
        </div>
      )}

      {!isLoading && notifications.length === 0 && (
        <div className="rounded-2xl border bg-white px-6 py-10 text-center" style={{ borderColor: BORDER }}>
          <Bell size={32} className="mx-auto mb-3 opacity-40" style={{ color: MUTED }} />
          <p className="text-sm font-bold" style={{ color: TEXT }}>
            No notifications yet
          </p>
        </div>
      )}

      {Object.entries(grouped).map(([date, items]) => (
        <section key={date} className="space-y-3">
          <h2 className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
            {date}
          </h2>
          {items.map((item) => (
            <NotificationRow key={item.id} item={item} onDismiss={handleDismiss} />
          ))}
        </section>
      ))}

      <div className="flex justify-center pt-2">
        <Link href="/my-shifts">
          <a className="text-sm font-semibold" style={{ color: PLUM }}>
            ← Back to shifts
          </a>
        </Link>
      </div>
    </div>
  );
}
