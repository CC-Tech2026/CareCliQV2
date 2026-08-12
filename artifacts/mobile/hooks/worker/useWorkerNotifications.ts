import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";

import {
  dismissNotification,
  fetchNotifications,
  markNotificationRead,
  type UserNotification,
} from "@/lib/worker-api";

export const NOTIFICATIONS_PAGE_SIZE = 10;

export const WORKER_NOTIFICATIONS_KEY = ["worker", "notifications"] as const;

type NotificationsPage = { notifications: UserNotification[]; count: number };

/** Prevents duplicate mark-read / cold-fetch work for the same shift in-session. */
const markedComplianceCheckinShiftIds = new Set<string>();

function isUnreadComplianceCheckin(n: UserNotification, shiftId: string): boolean {
  return (
    n.shift_id === shiftId &&
    n.event_type === "compliance_checkin" &&
    !n.read_at &&
    !n.dismissed_at
  );
}

function collectUnreadCheckinIds(queryClient: QueryClient, shiftId: string): string[] {
  const ids = new Set<string>();

  for (const unreadOnly of [true, false] as const) {
    const list = queryClient.getQueryData<UserNotification[]>([
      ...WORKER_NOTIFICATIONS_KEY,
      unreadOnly,
    ]);
    for (const n of list ?? []) {
      if (isUnreadComplianceCheckin(n, shiftId)) ids.add(n.id);
    }
  }

  const infinite = queryClient.getQueryData<InfiniteData<NotificationsPage>>([
    ...WORKER_NOTIFICATIONS_KEY,
    "infinite",
  ]);
  for (const page of infinite?.pages ?? []) {
    for (const n of page.notifications) {
      if (isUnreadComplianceCheckin(n, shiftId)) ids.add(n.id);
    }
  }

  return [...ids];
}

function applyReadToCaches(queryClient: QueryClient, ids: string[], readAt: string): void {
  if (!ids.length) return;
  const idSet = new Set(ids);

  queryClient.setQueryData<UserNotification[]>(
    [...WORKER_NOTIFICATIONS_KEY, true],
    (prev) => (prev ? prev.filter((n) => !idSet.has(n.id)) : prev),
  );

  queryClient.setQueryData<UserNotification[]>(
    [...WORKER_NOTIFICATIONS_KEY, false],
    (prev) =>
      prev
        ? prev.map((n) => (idSet.has(n.id) && !n.read_at ? { ...n, read_at: readAt } : n))
        : prev,
  );

  queryClient.setQueryData<InfiniteData<NotificationsPage>>(
    [...WORKER_NOTIFICATIONS_KEY, "infinite"],
    (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        pages: prev.pages.map((page) => ({
          ...page,
          notifications: page.notifications.map((n) =>
            idSet.has(n.id) && !n.read_at ? { ...n, read_at: readAt } : n,
          ),
        })),
      };
    },
  );
}

function syncReadToBackend(ids: string[]): void {
  for (const id of ids) {
    void markNotificationRead(id).catch(() => undefined);
  }
}

/**
 * Instantly clear unread highlight for Long Shift (compliance_checkin) notifications
 * for a shift, then sync read status to the backend in the background.
 */
export function markShiftComplianceCheckinNotificationsRead(
  queryClient: QueryClient,
  shiftId: string,
): string[] {
  if (markedComplianceCheckinShiftIds.has(shiftId)) {
    return collectUnreadCheckinIds(queryClient, shiftId);
  }
  markedComplianceCheckinShiftIds.add(shiftId);

  const ids = collectUnreadCheckinIds(queryClient, shiftId);
  if (ids.length) {
    applyReadToCaches(queryClient, ids, new Date().toISOString());
    syncReadToBackend(ids);
    return ids;
  }

  // Cache may be cold (e.g. opened from push). Fetch unread and mark matching ones.
  void fetchNotifications({ days: 90, unread_only: true, limit: 50 })
    .then((res) => {
      const fetchedIds = res.notifications
        .filter((n) => isUnreadComplianceCheckin(n, shiftId))
        .map((n) => n.id);
      if (!fetchedIds.length) return;
      applyReadToCaches(queryClient, fetchedIds, new Date().toISOString());
      syncReadToBackend(fetchedIds);
    })
    .catch(() => undefined);

  return [];
}

export function useWorkerNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: [...WORKER_NOTIFICATIONS_KEY, unreadOnly],
    queryFn: async () => {
      const res = await fetchNotifications({ days: 90, unread_only: unreadOnly, limit: 50 });
      return res.notifications;
    },
    staleTime: 30_000,
  });
}

export function useWorkerNotificationsInfinite() {
  return useInfiniteQuery({
    queryKey: [...WORKER_NOTIFICATIONS_KEY, "infinite"],
    queryFn: async ({ pageParam }) => {
      const offset = typeof pageParam === "number" ? pageParam : 0;
      return fetchNotifications({
        days: 90,
        limit: NOTIFICATIONS_PAGE_SIZE,
        offset,
      });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, _allPages, lastPageParam) => {
      if (lastPage.notifications.length < NOTIFICATIONS_PAGE_SIZE) return undefined;
      const offset = typeof lastPageParam === "number" ? lastPageParam : 0;
      return offset + NOTIFICATIONS_PAGE_SIZE;
    },
    staleTime: 30_000,
  });
}

export function useDismissNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: dismissNotification,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WORKER_NOTIFICATIONS_KEY });
    },
  });
}
