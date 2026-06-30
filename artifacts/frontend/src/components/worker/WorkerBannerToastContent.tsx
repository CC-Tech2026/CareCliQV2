import type { UserNotification } from "@/services/notificationService";
import { extractNotificationNewStart } from "@/lib/notification-copy";

type Props = {
  notification: UserNotification;
};

export function WorkerBannerToastContent({ notification }: Props) {
  const newStart = extractNotificationNewStart(notification);

  if (!newStart) {
    return (
      <p className="text-[13px] leading-snug text-slate-600">
        {notification.body}
      </p>
    );
  }

  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
        New start
      </p>
      <p className="text-[15px] font-semibold leading-snug text-slate-900">
        {newStart}
      </p>
    </div>
  );
}
