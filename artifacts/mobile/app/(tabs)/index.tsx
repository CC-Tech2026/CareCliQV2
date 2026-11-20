import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { ShiftStatusBadge } from "@/components/worker/ShiftStatusBadge";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import {
  BirthdayCard,
  CalendarCard,
  TodoCard,
} from "@/components/worker/home/HomeCards";
import { useBirthday } from "@/hooks/worker/useBirthday";
import { HomeCarousel } from "@/components/worker/home/HomeCarousel";
import {
  formatDayKey,
  useWorkerCalendar,
} from "@/hooks/worker/useWorkerCalendar";
import { useWorkerTodo } from "@/hooks/worker/useWorkerTodo";
import { FontFamily } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useWorkerLandingDashboard } from "@/hooks/worker/useWorkerLandingDashboard";
import { useColors, type ThemeColors } from "@/hooks/useColors";
import type { DashboardShiftSummary } from "@/lib/dashboard-api";
import {
  getTrainingRecommendations,
  listMyCredentials,
} from "@/lib/resource-api";
import type { ShiftVisualState } from "@/lib/worker-api";
import {
  formatTime,
  findInProgressShift,
  formatHomeDateLabel,
  greetingForHour,
  isBlockedByInProgressShift,
  shiftInitials,
  shortLocationLabel,
} from "@/lib/shift-utils";
import { showBlockedByInProgressAlert } from "@/lib/shift-block-alert";
import { resolveWorkerDisplayName } from "@/lib/display-name";

type QuickAccessTileConfig = {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
  accent: string;
  href: string;
  /** A short status line under the label, e.g. "2 expiring". */
  badge?: string;
  /** Status line in the warning or danger colour instead of muted. */
  badgeTone?: "muted" | "warning" | "danger";
};

function QuickAccessTile({
  tile,
  colors,
  onPress,
}: {
  tile: QuickAccessTileConfig;
  colors: ThemeColors;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderWidth: 1,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <View style={[styles.tileIcon, { backgroundColor: tile.accent }]}>
        <Feather name={tile.icon} size={18} color="#FFFFFF" />
      </View>
      <View style={styles.tileCopy}>
        <Text
          style={[
            styles.tileLabel,
            { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {tile.label}
        </Text>
        {tile.badge ? (
          <Text
            numberOfLines={1}
            style={[
              styles.tileBadgeText,
              {
                color:
                  tile.badgeTone === "danger"
                    ? colors.destructive
                    : tile.badgeTone === "warning"
                      ? colors.warning
                      : colors.mutedForeground,
                fontFamily:
                  tile.badgeTone && tile.badgeTone !== "muted"
                    ? FontFamily.interSemiBold
                    : FontFamily.interRegular,
              },
            ]}
          >
            {tile.badge}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function HomeShiftCard({
  shift,
  inProgressShift,
}: {
  shift: DashboardShiftSummary;
  inProgressShift: DashboardShiftSummary | null;
}) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();
  const location = shortLocationLabel(shift.participant_address);
  const meta = [shift.time_label, location].filter(Boolean).join(" · ");
  const visualState = (shift.visual_state || "scheduled") as ShiftVisualState;

  const openShift = () => {
    if (isBlockedByInProgressShift(shift, inProgressShift)) {
      showBlockedByInProgressAlert(t, inProgressShift, (id) =>
        router.push(`/shift/${id}` as never),
      );
      return;
    }
    router.push(`/shift/${shift.id}` as never);
  };

  return (
    <Pressable
      accessibilityRole="button"
      onPress={openShift}
      style={[
        styles.shiftCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={[styles.shiftAvatar, { backgroundColor: colors.soft }]}>
        <Text
          style={[
            styles.shiftAvatarText,
            { color: colors.primary, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {shiftInitials(shift.participant_name)}
        </Text>
      </View>
      <View style={styles.shiftBody}>
        <Text
          style={[
            styles.shiftName,
            { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {shift.participant_name}
        </Text>
        <Text
          style={[
            styles.shiftMeta,
            {
              color: colors.mutedForeground,
              fontFamily: FontFamily.interRegular,
            },
          ]}
        >
          {meta || ""}
        </Text>
        <View style={{ alignSelf: "flex-start", marginTop: 6 }}>
          <ShiftStatusBadge visualState={visualState} />
        </View>
      </View>
      <Feather name="chevron-right" size={20} color={colors.mutedForeground} />
    </Pressable>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();
  const { user, isAuthenticated } = useAuth();

  const landing = useWorkerLandingDashboard();
  const { data: credentials } = useQuery({
    queryKey: ["credentials", "me"],
    queryFn: listMyCredentials,
    enabled: isAuthenticated,
  });
  const expiringCount = useMemo(
    () =>
      (credentials ?? []).filter((item) => item.status === "expiring").length,
    [credentials],
  );
  const expiredCount = useMemo(
    () =>
      (credentials ?? []).filter((item) => item.status === "expired").length,
    [credentials],
  );
  const { data: training } = useQuery({
    queryKey: ["training", "recommendations"],
    queryFn: getTrainingRecommendations,
    enabled: isAuthenticated,
  });
  const trainingToDo = (training?.recommendations ?? []).length;
  const todo = useWorkerTodo();
  const calendar = useWorkerCalendar();
  const urgentCount = todo.items.filter((i) => i.tone === "danger").length;
  const nextEvent = calendar.upcoming[0];
  const birthday = useBirthday();

  // First open on their birthday: the full-screen celebration, once a year.
  useEffect(() => {
    if (birthday.shouldCelebrate) router.push("/birthday" as never);
  }, [birthday.shouldCelebrate, router]);

  const displayName = resolveWorkerDisplayName({
    landingFullName: landing.data?.worker.full_name,
    landingFirstName: landing.data?.worker.first_name,
    authFullName: user?.full_name,
    fallback: "there",
  });
  // The greeting uses the first name when the profile has one (the full name
  // wraps onto two lines); we never guess it by splitting the full name.
  const greetingName = landing.data?.worker.first_name?.trim() || displayName;
  const greetingPeriod = greetingForHour();
  const greetingKey =
    greetingPeriod === "morning"
      ? "dashboard.greeting.morning"
      : greetingPeriod === "afternoon"
        ? "dashboard.greeting.afternoon"
        : "dashboard.greeting.evening";
  const greeting = t(greetingKey);

  const shifts = landing.data?.today_shifts ?? [];
  const total = landing.data?.stats.shifts_today ?? shifts.length;
  const done =
    landing.data?.stats.completed_today ??
    shifts.filter((s) => s.visual_state === "completed").length;
  const dateLabel =
    landing.data?.greeting_context.date_label || formatHomeDateLabel();

  const inProgressShift = useMemo(() => findInProgressShift(shifts), [shifts]);
  const featuredShift =
    inProgressShift ??
    shifts.find((shift) => shift.visual_state === "scheduled") ??
    null;
  // The hero card above already shows the featured shift's full detail —
  // repeating it again in this list right below is pure duplication when
  // it's the only shift today, and just noise when there are others.
  const remainingShifts = featuredShift
    ? shifts.filter((shift) => shift.id !== featuredShift.id)
    : shifts;
  const progress = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
  const nextShift = landing.data?.next_shift ?? null;

  // One plain line about today: on shift now, what's left, or a day off.
  const remainingToday = shifts.filter(
    (s) => s.visual_state !== "completed",
  ).length;
  const startsAt = featuredShift?.scheduled_start
    ? formatTime(featuredShift.scheduled_start, featuredShift.timezone)
    : "";
  const dayStatus: {
    icon: keyof typeof Feather.glyphMap;
    text: string;
    color: string;
    bg: string;
  } = inProgressShift
    ? {
        icon: "activity",
        text: t("home.status.onShift", {
          name: inProgressShift.participant_name,
        }),
        color: colors.success,
        bg: colors.statusDocumentedBg,
      }
    : featuredShift
      ? {
          icon: "clock",
          text:
            remainingToday === 1
              ? t("home.status.oneLeft", { time: startsAt })
              : t("home.status.manyLeft", {
                  count: String(remainingToday),
                  time: startsAt,
                }),
          color: colors.primary,
          bg: colors.activeBg,
        }
      : total > 0
        ? {
            icon: "check-circle",
            text: t("home.status.allDone"),
            color: colors.success,
            bg: colors.statusDocumentedBg,
          }
        : {
            icon: "sun",
            text: t("home.status.dayOff"),
            color: colors.primary,
            bg: colors.activeBg,
          };

  const handleRefresh = () => {
    todo.refetch();
    calendar.refetch();
    void landing.refetch();
    void queryClient.invalidateQueries({
      queryKey: ["dashboard", "worker-landing"],
    });
  };

  const openContinue = () => {
    if (featuredShift) {
      router.push(`/shift/${featuredShift.id}` as never);
      return;
    }
    router.push("/(tabs)/shifts" as never);
  };

  const quickAccessTiles: QuickAccessTileConfig[] = [
    {
      key: "participants",
      icon: "users",
      label: t("dashboard.myParticipants"),
      accent: colors.pink,
      href: "/(tabs)/participants",
    },
    {
      key: "calendar",
      icon: "calendar",
      label: t("home.calendar.tile"),
      accent: colors.primary,
      href: "/worker/calendar",
      badge: nextEvent
        ? t("home.calendar.next", {
            date: formatDayKey(nextEvent.dayKey, {
              day: "numeric",
              month: "short",
            }),
          })
        : undefined,
    },
    {
      key: "availability",
      icon: "clock",
      label: t("nav.availability"),
      accent: colors.navy,
      href: "/worker/availability",
    },
    {
      key: "training",
      icon: "book-open",
      label: t("nav.training"),
      accent: colors.success,
      href: "/training",
      badge:
        trainingToDo > 0
          ? t("home.training.toDo", { count: String(trainingToDo) })
          : undefined,
      badgeTone: "warning",
    },
    {
      key: "credentials",
      icon: "award",
      label: t("nav.credentials"),
      accent: colors.warning,
      href: "/credentials",
      badge:
        expiredCount > 0
          ? t("home.credentials.expired", { count: String(expiredCount) })
          : expiringCount > 0
            ? t("settings.credentialsExpiring", { count: expiringCount })
            : undefined,
      badgeTone: expiredCount > 0 ? "danger" : "warning",
    },
    {
      key: "travel",
      icon: "map",
      label: "Travel claims",
      accent: colors.success,
      href: "/worker/travel",
    },
    {
      key: "toolkit",
      icon: "briefcase",
      label: t("nav.toolkit"),
      accent: colors.blue,
      href: "/toolkit",
    },
    {
      key: "office",
      icon: "phone",
      label: t("office.tile"),
      accent: colors.pink,
      href: "/worker/contact-office",
    },
    {
      key: "guides",
      icon: "help-circle",
      label: t("guide.allTitle"),
      accent: colors.navy,
      href: "/worker/guides",
    },
  ];

  const todayCard = (
    <View style={[styles.hero, { backgroundColor: colors.heroCard }]}>
      <View style={styles.heroTop}>
        <View style={styles.heroIcon}>
          <Feather
            name={inProgressShift ? "activity" : "calendar"}
            size={22}
            color="#FFFFFF"
          />
        </View>
        <Text
          style={[
            styles.heroLabel,
            {
              color: colors.heroMuted,
              fontFamily: FontFamily.interSemiBold,
            },
          ]}
        >
          {t(
            inProgressShift
              ? "dashboard.homeActiveShift"
              : featuredShift
                ? "dashboard.homeNextShift"
                : "dashboard.todaysShifts",
          )}
        </Text>
      </View>
      <Text
        style={[
          styles.heroStat,
          { color: "#FFFFFF", fontFamily: FontFamily.h1 },
        ]}
      >
        {featuredShift?.participant_name ??
          t(
            total === 0
              ? "dashboard.noShiftsToday"
              : "dashboard.homeDayComplete",
          )}
      </Text>
      <Text style={[styles.heroDetail, { color: colors.heroMuted }]}>
        {featuredShift
          ? [
              featuredShift.time_label,
              shortLocationLabel(featuredShift.participant_address),
            ]
              .filter(Boolean)
              .join(" / ")
          : t(
              total === 0
                ? "dashboard.noShiftsDetail"
                : "dashboard.homeDayCompleteDetail",
            )}
      </Text>
      {/* Nothing left today: show what's next, so the card is still useful. */}
      {!featuredShift && nextShift ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/shift/${nextShift.id}` as never)}
          style={({ pressed }) => [
            styles.nextBox,
            { opacity: pressed ? 0.8 : 1 },
          ]}
        >
          <Text
            style={[
              styles.nextLabel,
              { color: colors.heroMuted, fontFamily: FontFamily.interSemiBold },
            ]}
          >
            {t("home.today.nextShift")}
          </Text>
          <Text
            style={[styles.nextName, { fontFamily: FontFamily.interSemiBold }]}
          >
            {nextShift.participant_name}
          </Text>
          <Text
            style={[
              styles.nextWhen,
              { color: colors.heroMuted, fontFamily: FontFamily.interRegular },
            ]}
          >
            {[nextShift.date_label, nextShift.time_label]
              .filter(Boolean)
              .join("  ·  ")}
          </Text>
        </Pressable>
      ) : null}
      <View style={styles.heroSpacer} />
      <Pressable
        onPress={openContinue}
        style={[styles.continueBtn, { backgroundColor: colors.primary }]}
        accessibilityRole="button"
      >
        <Text
          style={[
            styles.continueText,
            {
              color: colors.primaryForeground,
              fontFamily: FontFamily.interSemiBold,
            },
          ]}
        >
          {t(
            inProgressShift
              ? "dashboard.continueSession"
              : featuredShift
                ? "dashboard.homeReviewShift"
                : "dashboard.homeViewSchedule",
          )}
        </Text>
        <Feather
          name="arrow-right"
          size={20}
          color={colors.primaryForeground}
        />
      </Pressable>
      {total > 0 ? (
        <View style={styles.progressSummary}>
          <Text style={[styles.heroLabel, { color: colors.heroMuted }]}>
            {t("dashboard.homeCompleted", { done, total })}
          </Text>
          <View
            accessibilityRole="progressbar"
            accessibilityLabel={t("dashboard.todaysShifts")}
            accessibilityValue={{
              min: 0,
              max: total,
              now: Math.min(done, total),
            }}
            style={[
              styles.progressTrack,
              { backgroundColor: colors.progressTrack },
            ]}
          >
            <View
              style={[
                styles.progressFill,
                {
                  width: (progress * 100 + "%") as `${number}%`,
                  backgroundColor: colors.success,
                },
              ]}
            />
          </View>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("nav.home")} guide="home" />

      {landing.isLoading && !landing.data ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 120 },
          ]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={landing.isRefetching}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
            />
          }
        >
          {/* Date, greeting, then one line that says what today looks like. */}
          <Text
            style={[
              styles.dateLine,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interMedium,
              },
            ]}
          >
            {dateLabel}
          </Text>
          <Text
            accessibilityRole="header"
            style={[
              styles.greeting,
              { color: colors.foreground, fontFamily: FontFamily.display },
            ]}
          >
            {t("dashboard.greetingWithName", { greeting, name: greetingName })}
          </Text>
          {landing.data ? (
            <View
              style={[styles.statusPill, { backgroundColor: dayStatus.bg }]}
            >
              <Feather
                name={dayStatus.icon}
                size={15}
                color={dayStatus.color}
              />
              <Text
                style={[
                  styles.statusText,
                  {
                    color: dayStatus.color,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {dayStatus.text}
              </Text>
            </View>
          ) : null}

          {landing.isError ? (
            <View
              style={[
                styles.notice,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.bodyText, { color: colors.foreground }]}>
                {t("dashboard.homeLoadError")}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={handleRefresh}
                style={styles.retryButton}
              >
                <Text style={[styles.bodyText, { color: colors.primary }]}>
                  {t("common.retry")}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {landing.data ? (
            <HomeCarousel
              pages={[
                ...(birthday.isBirthday
                  ? [
                      {
                        key: "birthday",
                        label: t("birthday.tab"),
                        render: () => (
                          <BirthdayCard firstName={birthday.firstName} />
                        ),
                      },
                    ]
                  : []),
                {
                  key: "today",
                  label: t("home.tab.today"),
                  render: () => todayCard,
                },
                {
                  key: "todo",
                  label: t("home.tab.todo"),
                  badge: todo.items.length || undefined,
                  urgent: urgentCount > 0,
                  render: () => <TodoCard items={todo.items} />,
                },
                {
                  key: "calendar",
                  label: t("home.tab.calendar"),
                  render: () => (
                    <CalendarCard
                      byDay={calendar.byDay}
                      upcoming={calendar.upcoming}
                    />
                  ),
                },
              ]}
            />
          ) : null}

          {!landing.data || remainingShifts.length === 0 ? null : (
            <>
              <Text
                style={[
                  styles.sectionTitle,
                  {
                    color: colors.foreground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {t("dashboard.todaysShifts")}
              </Text>
              {shifts.length === 0 ? (
                <Text
                  style={[
                    styles.empty,
                    {
                      color: colors.mutedForeground,
                      fontFamily: FontFamily.interMedium,
                    },
                  ]}
                >
                  {t("dashboard.noShiftsToday")}
                </Text>
              ) : (
                remainingShifts.map((shift) => (
                  <HomeShiftCard
                    key={shift.id}
                    shift={shift}
                    inProgressShift={inProgressShift}
                  />
                ))
              )}
            </>
          )}
          <Text
            style={[
              styles.sectionTitle,
              styles.quickAccessTitle,
              {
                color: colors.foreground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {t("dashboard.quickAccess")}
          </Text>
          <View style={styles.quickGrid}>
            {quickAccessTiles.map((tile) => (
              <QuickAccessTile
                key={tile.key}
                tile={tile}
                colors={colors}
                onPress={() => router.push(tile.href as never)}
              />
            ))}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: {
    width: "100%",
    maxWidth: 800,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 24,
  },
  dateLine: { fontSize: 14, lineHeight: 20, marginBottom: 2 },
  greeting: { fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginTop: 12,
    marginBottom: 22,
  },
  statusText: { fontSize: 14 },
  heroSpacer: { flexGrow: 1, minHeight: 20 },
  subtitle: { fontSize: 14, lineHeight: 21, marginBottom: 20 },
  hero: {
    flexGrow: 1,
    borderRadius: 20,
    padding: 20,
    minHeight: 330,
  },
  heroLabel: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: FontFamily.interMedium,
  },
  heroStat: { fontSize: 26, lineHeight: 33, marginBottom: 8 },
  heroTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 20,
  },
  heroIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroDetail: { fontSize: 15, lineHeight: 23, fontFamily: FontFamily.body },
  progressSummary: { marginTop: 22, gap: 10 },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  notice: { padding: 16, borderWidth: 1, borderRadius: 20, marginBottom: 20 },
  bodyText: { fontSize: 15, lineHeight: 22, fontFamily: FontFamily.body },
  retryButton: {
    minHeight: 44,
    justifyContent: "center",
    alignSelf: "flex-start",
    paddingHorizontal: 12,
  },
  continueBtn: {
    marginTop: 0,
    minHeight: 56,
    justifyContent: "space-between",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  continueText: { flexShrink: 1, fontSize: 16, lineHeight: 22 },
  nextBox: {
    marginTop: 18,
    borderRadius: 16,
    padding: 14,
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  nextLabel: { fontSize: 13 },
  nextName: { fontSize: 18, color: "#FFFFFF" },
  nextWhen: { fontSize: 14 },
  quickAccessTitle: { marginTop: 28 },
  quickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 18,
  },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  tileIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  tileCopy: { flex: 1, minWidth: 0, gap: 1 },
  tileLabel: { fontSize: 15, lineHeight: 20 },
  tileBadgeText: { fontSize: 12, lineHeight: 16 },
  sectionTitle: { fontSize: 20, lineHeight: 26, marginBottom: 14 },
  shiftCard: {
    borderWidth: 1,
    borderRadius: 22,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  shiftAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  shiftAvatarText: { fontSize: 14 },
  shiftBody: { flex: 1, minWidth: 0, gap: 5 },
  shiftName: { fontSize: 16, lineHeight: 23 },
  shiftMeta: { fontSize: 13, lineHeight: 20 },
  empty: { fontSize: 15, lineHeight: 23, paddingVertical: 20 },
});
