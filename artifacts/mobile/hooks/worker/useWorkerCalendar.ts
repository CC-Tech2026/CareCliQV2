import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { localDayKey } from "@/components/worker/WeekCalendar";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useWorkerShifts } from "@/hooks/worker/useWorkerShifts";
import {
  getTrainingRecommendations,
  listMyCredentials,
} from "@/lib/resource-api";
import { formatTime, formatTimeWithZone } from "@/lib/shift-utils";

export type CalendarEventKind = "shift" | "credential" | "training";

export type CalendarEvent = {
  id: string;
  kind: CalendarEventKind;
  /** Local calendar day, YYYY-MM-DD. */
  dayKey: string;
  /** For ordering within a day (ISO time, or the day for all-day items). */
  sortKey: string;
  title: string;
  detail: string;
  href: string;
  /** "danger" when it's overdue or expired, "done" for finished shifts. */
  tone: "default" | "warning" | "danger" | "done";
};

const DAY_MS = 86_400_000;

function dayKeyOf(value?: string | null): string | null {
  if (!value) return null;
  // Date-only values ("2026-12-01") are calendar days, not instants.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : localDayKey(date);
}

/** "2026-12-01" as "1 Dec 2026" (or other parts), read as a local calendar day. */
export function formatDayKey(
  dayKey: string,
  opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  },
): string {
  const [y, m, d] = dayKey.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  return new Intl.DateTimeFormat("en-AU", opts).format(new Date(y, m - 1, d));
}

function daysUntil(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  return Math.round((target - today) / DAY_MS);
}

/**
 * Everything with a date in a worker's life, in one list: shifts, the day each
 * credential expires, and training due dates. Built from data the app already
 * loads, so the calendar needs nothing new from the server.
 */
export function useWorkerCalendar() {
  const t = useT();
  const { isAuthenticated } = useAuth();
  const shiftsQuery = useWorkerShifts("all");
  const credentialsQuery = useQuery({
    queryKey: ["credentials", "me"],
    queryFn: listMyCredentials,
    enabled: isAuthenticated,
  });
  const trainingQuery = useQuery({
    queryKey: ["training", "recommendations"],
    queryFn: getTrainingRecommendations,
    enabled: isAuthenticated,
  });

  const events = useMemo<CalendarEvent[]>(() => {
    const list: CalendarEvent[] = [];

    for (const shift of shiftsQuery.data?.shifts ?? []) {
      const when = shift.scheduled_start ?? shift.clocked_in_at ?? null;
      const dayKey = dayKeyOf(when);
      if (!dayKey || shift.status === "cancelled") continue;
      const tz = (shift as { timezone?: string | null }).timezone ?? null;
      // One zone label per range: "2:00 pm – 5:00 pm ACDT".
      const start = shift.scheduled_start
        ? formatTime(shift.scheduled_start, tz)
        : "";
      const end = shift.scheduled_end
        ? formatTimeWithZone(shift.scheduled_end, tz)
        : "";
      list.push({
        id: `shift:${shift.id}`,
        kind: "shift",
        dayKey,
        sortKey: when ?? dayKey,
        title: shift.participant_name || t("calendar.shift"),
        detail: end ? `${start} – ${end}` : start,
        href: `/shift/${shift.id}`,
        tone: shift.visual_state === "completed" ? "done" : "default",
      });
    }

    for (const credential of credentialsQuery.data ?? []) {
      const dayKey = dayKeyOf(credential.expiry_date);
      if (!dayKey) continue;
      const left = daysUntil(dayKey);
      list.push({
        id: `credential:${credential.id}`,
        kind: "credential",
        dayKey,
        sortKey: dayKey,
        title: t("calendar.credentialExpires", {
          name: credential.title || credential.credential_type,
        }),
        detail:
          left < 0
            ? t("calendar.expired")
            : left === 0
              ? t("calendar.expiresToday")
              : left <= 60
                ? t("calendar.expiresIn", { days: String(left) })
                : formatDayKey(dayKey),
        href: `/worker/credentials/${credential.id}/update`,
        tone: left < 0 ? "danger" : left <= 30 ? "warning" : "default",
      });
    }

    for (const item of trainingQuery.data?.recommendations ?? []) {
      const dayKey = dayKeyOf(item.due_at);
      if (!dayKey) continue;
      const left = daysUntil(dayKey);
      list.push({
        id: `training:${item.id}`,
        kind: "training",
        dayKey,
        sortKey: dayKey,
        title: t("calendar.trainingDue", { name: item.title }),
        detail:
          left < 0
            ? t("calendar.overdue")
            : left === 0
              ? t("calendar.dueToday")
              : left <= 60
                ? t("calendar.dueIn", { days: String(left) })
                : formatDayKey(dayKey),
        href: "/training",
        tone: left < 0 ? "danger" : left <= 7 ? "warning" : "default",
      });
    }

    return list.sort((a, b) =>
      a.dayKey === b.dayKey
        ? a.sortKey.localeCompare(b.sortKey)
        : a.dayKey.localeCompare(b.dayKey),
    );
  }, [shiftsQuery.data, credentialsQuery.data, trainingQuery.data, t]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of events)
      map.set(event.dayKey, [...(map.get(event.dayKey) ?? []), event]);
    return map;
  }, [events]);

  const upcoming = useMemo(() => {
    const today = localDayKey(new Date());
    return events.filter((e) => e.dayKey >= today && e.tone !== "done");
  }, [events]);

  return {
    events,
    byDay,
    upcoming,
    isLoading: shiftsQuery.isLoading,
    refetch: () => {
      void shiftsQuery.refetch();
      void credentialsQuery.refetch();
      void trainingQuery.refetch();
    },
  };
}
