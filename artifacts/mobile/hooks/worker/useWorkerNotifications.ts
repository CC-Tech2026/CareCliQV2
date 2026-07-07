import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { dismissNotification, fetchNotifications } from "@/lib/worker-api";

export function useWorkerNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: ["worker", "notifications", unreadOnly],
    queryFn: async () => {
      const res = await fetchNotifications({ days: 14, unread_only: unreadOnly });
      return res.notifications;
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
