import type { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { localDayKey } from "@/components/worker/WeekCalendar";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { formatDayKey } from "@/hooks/worker/useWorkerCalendar";
import { useShiftReviews } from "@/hooks/worker/useShiftReviews";
import { useWorkerLandingDashboard } from "@/hooks/worker/useWorkerLandingDashboard";
import { getTrainingRecommendations } from "@/lib/resource-api";

export type TodoItem = {
  id: string;
  icon: keyof typeof Feather.glyphMap;
  title: string;
  detail: string;
  href: string;
  /** danger: do it now. warning: do it soon. */
  tone: "danger" | "warning";
};

const RANK = { danger: 0, warning: 1 } as const;

/** The server sends "Name · 2026-11-06"; show the date as "6 Nov 2026". */
function readableDetail(detail?: string): string {
  return (detail ?? "").replace(/(\d{4}-\d{2}-\d{2})/g, (iso) => formatDayKey(iso));
}

/**
 * What a worker needs to act on, most urgent first: participant risks to
 * acknowledge before a shift, changes the office asked for, unfinished or
 * weak notes, credentials that expired or are about to, and overdue or
 * soon-due training.
 */
export function useWorkerTodo() {
  const t = useT();
  const { isAuthenticated } = useAuth();
  const landing = useWorkerLandingDashboard();
  const reviews = useShiftReviews();
  const training = useQuery({
    queryKey: ["training", "recommendations"],
    queryFn: getTrainingRecommendations,
    enabled: isAuthenticated,
  });

  const items = useMemo<TodoItem[]>(() => {
    const list: TodoItem[] = [];
    const changeRequested = new Set<string>();

    for (const review of reviews.data?.shifts ?? []) {
      if (review.review_status !== "changes_requested") continue;
      if (review.session_id) changeRequested.add(review.session_id);
      list.push({
        id: `review:${review.shift_id}`,
        icon: "message-square",
        title: t("todo.changesRequested"),
        detail: review.participant_name || "",
        href: `/shift/${review.shift_id}/record`,
        tone: "danger",
      });
    }

    for (const action of landing.data?.action_items ?? []) {
      const ref = action.reference_id;
      if (!ref) continue;
      if (action.kind === "risk_acknowledgement") {
        list.push({
          id: action.id,
          icon: "alert-triangle",
          title: t("todo.acknowledgeRisks"),
          detail: action.detail?.split(" · ")[0] ?? "",
          href: `/shift/${ref}/briefing`,
          tone: "danger",
        });
      } else if (
        action.kind === "incomplete_session" ||
        (action.kind === "compliance_fix" && !changeRequested.has(ref))
      ) {
        // Notes are written in one place: the shift's own screen. A shift
        // that's still going opens there. A finished shift is closed: the
        // office reviews it and, if it needs more, asks for changes, which
        // shows here as "The office asked for changes" and opens that shift's
        // notes. So a finished shift isn't a to-do the worker can act on.
        if (!action.shift_id || action.shift_finished) continue;
        list.push({
          id: action.id,
          icon: action.kind === "incomplete_session" ? "edit-3" : "file-text",
          title: t(action.kind === "incomplete_session" ? "todo.finishNotes" : "todo.improveNotes"),
          detail: readableDetail(action.detail),
          href: `/shift/${action.shift_id}`,
          tone: "warning",
        });
      }
    }

    for (const alert of landing.data?.compliance_alerts ?? []) {
      if (alert.source !== "credentials") continue;
      const credentialId = alert.id.replace(/^cred-/, "");
      const expired = alert.severity === "critical";
      list.push({
        id: alert.id,
        icon: "award",
        title: expired
          ? t("todo.credentialExpired", { name: alert.title })
          : alert.severity === "medium"
            ? t("todo.credentialInReview", { name: alert.title })
            : t("todo.credentialExpiring", { name: alert.title }),
        detail: alert.due_date
          ? t("todo.expiryDate", { date: formatDayKey(alert.due_date) })
          : "",
        href: credentialId
          ? `/worker/credentials/${credentialId}/update`
          : "/credentials",
        tone: expired ? "danger" : "warning",
      });
    }

    const today = localDayKey(new Date());
    const soon = localDayKey(new Date(Date.now() + 7 * 86_400_000));
    for (const item of training.data?.recommendations ?? []) {
      const due = item.due_at?.slice(0, 10);
      if (!due || due > soon) continue;
      list.push({
        id: `training:${item.id}`,
        icon: "book-open",
        title:
          due < today
            ? t("todo.trainingOverdue", { name: item.title })
            : t("todo.trainingDue", { name: item.title }),
        detail: t("todo.dueDate", { date: formatDayKey(due) }),
        href: "/training",
        tone: due < today ? "danger" : "warning",
      });
    }

    // The same session can be both unfinished and weak: keep the first.
    const seen = new Set<string>();
    return list
      .filter((item) => {
        const key = item.href;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => RANK[a.tone] - RANK[b.tone]);
  }, [reviews.data, landing.data, training.data, t]);

  return {
    items,
    isLoading: landing.isLoading,
    refetch: () => {
      void landing.refetch();
      void reviews.refetch();
      void training.refetch();
    },
  };
}
