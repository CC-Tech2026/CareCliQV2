import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { dismissNotification, fetchNotifications } from "@/lib/worker-api";

export const NOTIFICATIONS_PAGE_SIZE = 10;

export function useWorkerNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: ["worker", "notifications", unreadOnly],
    queryFn: async () => {
      const res = await fetchNotifications({ days: 90, unread_only: unreadOnly, limit: 50 });
      return res.notifications;
    },
    staleTime: 30_000,
  });
}

export function useWorkerNotificationsInfinite() {
  return useInfiniteQuery({
    queryKey: ["worker", "notifications", "infinite"],
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
      void queryClient.invalidateQueries({ queryKey: ["worker", "notifications"] });
    },
  });
}
