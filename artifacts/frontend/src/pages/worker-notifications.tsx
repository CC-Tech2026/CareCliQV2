import { Link, Redirect, useSearch } from "wouter";
import { Settings2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { NotificationInbox } from "@/components/notifications/NotificationInbox";

/** Full-page notifications, for every role. The bell's side panel shows the
 *  same inbox; this is where "See all" and email links land. */
export default function NotificationsPage() {
  const { translate } = useAccessibility();
  // ?open=<id>: email buttons and pop-ups for notifications with no page of
  // their own land on that notification's full view.
  const openId = new URLSearchParams(useSearch()).get("open");
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-10">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight" style={{ color: "var(--cc-text)" }}>
            {translate("inbox.title")}
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--cc-muted)" }}>
            {translate("inbox.pageHint")}
          </p>
        </div>
        <Link href="/notifications/settings">
          <a className="flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold" style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)" }}>
            <Settings2 size={15} /> {translate("inbox.settings")}
          </a>
        </Link>
      </header>
      <NotificationInbox key={openId ?? "list"} variant="page" initialOpenId={openId} />
    </div>
  );
}

/** One link for "change your notification settings" (emails, the panel), sent
 *  to wherever this person's role keeps them. */
export function NotificationSettingsRedirect() {
  const { user } = useAuth();
  if (!user) return null;
  return <Redirect to={user.role === "support_worker" ? "/worker/profile#notification-settings" : "/settings?section=notifications"} />;
}
