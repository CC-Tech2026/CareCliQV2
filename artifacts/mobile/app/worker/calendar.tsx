import { Feather } from "@expo/vector-icons";
import { useLocalSearchParams } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EventRow, kindColor } from "@/components/worker/home/HomeCards";
import { localDayKey } from "@/components/worker/WeekCalendar";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import {
  formatDayKey,
  useWorkerCalendar,
  type CalendarEventKind,
} from "@/hooks/worker/useWorkerCalendar";
import type { TranslationKey } from "@/lib/i18n/translations";

type Filter = "all" | CalendarEventKind;

const FILTERS: { key: Filter; label: TranslationKey }[] = [
  { key: "all", label: "calendar.filter.all" },
  { key: "shift", label: "calendar.filter.shifts" },
  { key: "credential", label: "calendar.filter.credentials" },
  { key: "training", label: "calendar.filter.training" },
];

function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7) cells.push(null);
  return cells;
}

/**
 * A worker's own calendar: shifts, the days credentials expire and training
 * is due, on one month view. Tap a day to see what's on it.
 */
export default function WorkerCalendarScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const params = useLocalSearchParams<{ day?: string }>();
  const { byDay, events, isLoading, refetch } = useWorkerCalendar();

  const initial =
    params.day && /^\d{4}-\d{2}-\d{2}$/.test(params.day)
      ? params.day
      : localDayKey(new Date());
  const [selected, setSelected] = useState(initial);
  const [cursor, setCursor] = useState(() => {
    const [y, m] = initial.split("-").map(Number);
    return { year: y, month: m - 1 };
  });
  const [filter, setFilter] = useState<Filter>("all");

  const todayKey = localDayKey(new Date());
  const cells = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const visible = (kind: CalendarEventKind) =>
    filter === "all" || filter === kind;
  const dayEvents = (byDay.get(selected) ?? []).filter((e) => visible(e.kind));
  const monthLabel = formatDayKey(
    `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-01`,
    { month: "long", year: "numeric" },
  );
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    formatDayKey(localDayKey(new Date(2024, 0, 1 + i)), { weekday: "narrow" }),
  );

  // Upcoming credential and training dates for this filter, so a worker can
  // see what's ahead without paging through months.
  const ahead = events.filter(
    (e) => e.kind !== "shift" && e.dayKey >= todayKey && visible(e.kind),
  );

  const shiftMonth = (by: number) => {
    setCursor(({ year, month }) => {
      const next = new Date(year, month + by, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  return (
    <WorkerStackScreen
      guide="calendar"
      headerTitle={t("calendar.title")}
      cardsOnBackground
      showBack
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 32 },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={refetch}
            tintColor={colors.primary}
          />
        }
      >
        <View style={styles.filters}>
          {FILTERS.map((item) => {
            const active = filter === item.key;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setFilter(item.key)}
                style={[
                  styles.filter,
                  {
                    backgroundColor: active ? colors.foreground : colors.card,
                    borderColor: active ? colors.foreground : colors.border,
                  },
                ]}
              >
                {item.key !== "all" ? (
                  <View
                    style={[
                      styles.filterDot,
                      { backgroundColor: kindColor(item.key, colors) },
                    ]}
                  />
                ) : null}
                <Text
                  style={[
                    styles.filterText,
                    {
                      color: active ? colors.background : colors.foreground,
                      fontFamily: FontFamily.interSemiBold,
                    },
                  ]}
                >
                  {t(item.label)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.monthHead}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("calendar.prevMonth")}
              hitSlop={10}
              onPress={() => shiftMonth(-1)}
              style={styles.navBtn}
            >
              <Feather
                name="chevron-left"
                size={22}
                color={colors.foreground}
              />
            </Pressable>
            <Text
              accessibilityRole="header"
              style={[
                styles.month,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {monthLabel}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("calendar.nextMonth")}
              hitSlop={10}
              onPress={() => shiftMonth(1)}
              style={styles.navBtn}
            >
              <Feather
                name="chevron-right"
                size={22}
                color={colors.foreground}
              />
            </Pressable>
          </View>
          <View style={styles.row}>
            {weekdays.map((name, i) => (
              <Text
                key={i}
                style={[
                  styles.weekday,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interMedium,
                  },
                ]}
              >
                {name}
              </Text>
            ))}
          </View>
          <View style={styles.grid}>
            {cells.map((date, i) => {
              if (!date) return <View key={`e${i}`} style={styles.cell} />;
              const key = localDayKey(date);
              const kinds = Array.from(
                new Set((byDay.get(key) ?? []).map((e) => e.kind)),
              ).filter(visible);
              const isSelected = key === selected;
              const isToday = key === todayKey;
              const hasDanger = (byDay.get(key) ?? []).some(
                (e) => e.tone === "danger" && visible(e.kind),
              );
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSelected }}
                  accessibilityLabel={`${formatDayKey(key, { weekday: "long", day: "numeric", month: "long" })}, ${kinds.length}`}
                  onPress={() => setSelected(key)}
                  style={styles.cell}
                >
                  <View
                    style={[
                      styles.dayCircle,
                      isSelected && { backgroundColor: colors.primary },
                      !isSelected &&
                        isToday && {
                          borderWidth: 1.5,
                          borderColor: colors.primary,
                        },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayNum,
                        {
                          color: isSelected
                            ? colors.primaryForeground
                            : colors.foreground,
                          fontFamily:
                            isToday || isSelected
                              ? FontFamily.interBold
                              : FontFamily.interMedium,
                        },
                      ]}
                    >
                      {date.getDate()}
                    </Text>
                  </View>
                  <View style={styles.dots}>
                    {kinds.slice(0, 3).map((kind) => (
                      <View
                        key={kind}
                        style={[
                          styles.dot,
                          {
                            backgroundColor:
                              hasDanger && kind !== "shift"
                                ? colors.destructive
                                : kindColor(kind, colors),
                          },
                        ]}
                      />
                    ))}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text
          style={[
            styles.section,
            { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {selected === todayKey
            ? t("calendar.today")
            : formatDayKey(selected, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
        </Text>
        <View
          style={[
            styles.card,
            styles.listCard,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {dayEvents.length === 0 ? (
            <Text
              style={[
                styles.empty,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            >
              {isLoading ? t("calendar.loading") : t("calendar.nothingThisDay")}
            </Text>
          ) : (
            dayEvents.map((event) => <EventRow key={event.id} event={event} />)
          )}
        </View>

        {filter !== "shift" && ahead.length > 0 ? (
          <>
            <Text
              style={[
                styles.section,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {t("calendar.keyDates")}
            </Text>
            <View
              style={[
                styles.card,
                styles.listCard,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              {ahead.slice(0, 8).map((event) => (
                <EventRow key={event.id} event={event} showDate />
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 12 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  filter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  filterDot: { width: 8, height: 8, borderRadius: 4 },
  filterText: { fontSize: 14 },
  card: { borderRadius: 20, borderWidth: 1, padding: 14 },
  listCard: { paddingVertical: 6 },
  monthHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  navBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  month: { fontSize: 17 },
  row: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontSize: 12, paddingVertical: 4 },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: {
    width: `${100 / 7}%`,
    alignItems: "center",
    paddingVertical: 3,
    minHeight: 48,
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  dayNum: { fontSize: 15 },
  dots: { flexDirection: "row", gap: 3, height: 6, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  section: { fontSize: 17, marginTop: 8 },
  empty: { fontSize: 15, paddingVertical: 14, textAlign: "center" },
});
