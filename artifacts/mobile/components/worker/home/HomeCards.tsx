import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { localDayKey, moveDay } from "@/components/worker/WeekCalendar";
import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import {
  formatDayKey,
  type CalendarEvent,
  type CalendarEventKind,
} from "@/hooks/worker/useWorkerCalendar";
import type { TodoItem } from "@/hooks/worker/useWorkerTodo";

type Colors = ReturnType<typeof useColors>;

/** One colour per kind of calendar item, used for dots, chips and legends. */
export function kindColor(kind: CalendarEventKind, colors: Colors): string {
  if (kind === "credential") return colors.warning;
  if (kind === "training") return colors.pink;
  return colors.primary;
}

export const KIND_ICON: Record<
  CalendarEventKind,
  keyof typeof Feather.glyphMap
> = {
  shift: "briefcase",
  credential: "award",
  training: "book-open",
};

/** A to-do as a tappable row: coloured icon, what to do, for whom or when. */
export function TodoRow({
  item,
  compact = false,
}: {
  item: TodoItem;
  compact?: boolean;
}) {
  const colors = useColors();
  const router = useRouter();
  const tone = item.tone === "danger" ? colors.destructive : colors.warning;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(item.href as never)}
      style={({ pressed }) => [
        styles.todoRow,
        compact && styles.todoRowCompact,
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View
        style={[
          styles.todoIcon,
          {
            backgroundColor:
              item.tone === "danger"
                ? colors.dangerBg
                : colors.statusProgressBg,
          },
        ]}
      >
        <Feather name={item.icon} size={16} color={tone} />
      </View>
      <View style={styles.todoCopy}>
        <Text
          numberOfLines={2}
          style={[
            styles.todoTitle,
            { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {item.title}
        </Text>
        {item.detail ? (
          <Text
            numberOfLines={1}
            style={[
              styles.todoDetail,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interRegular,
              },
            ]}
          >
            {item.detail}
          </Text>
        ) : null}
      </View>
      <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

/** A calendar item as a row: date chip (optional), kind colour, title, time. */
export function EventRow({
  event,
  showDate = false,
}: {
  event: CalendarEvent;
  showDate?: boolean;
}) {
  const colors = useColors();
  const router = useRouter();
  const color =
    event.tone === "danger"
      ? colors.destructive
      : kindColor(event.kind, colors);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push(event.href as never)}
      style={({ pressed }) => [styles.eventRow, { opacity: pressed ? 0.7 : 1 }]}
    >
      {showDate ? (
        <View style={[styles.dateChip, { backgroundColor: colors.soft }]}>
          <Text
            style={[
              styles.dateChipDay,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {formatDayKey(event.dayKey, { month: "short" })}
          </Text>
          <Text
            style={[
              styles.dateChipNum,
              { color: colors.foreground, fontFamily: FontFamily.interBold },
            ]}
          >
            {formatDayKey(event.dayKey, { day: "numeric" })}
          </Text>
        </View>
      ) : (
        <View style={[styles.kindIcon, { backgroundColor: colors.soft }]}>
          <Feather name={KIND_ICON[event.kind]} size={15} color={color} />
        </View>
      )}
      <View style={[styles.eventBar, { backgroundColor: color }]} />
      <View style={styles.todoCopy}>
        <Text
          numberOfLines={1}
          style={[
            styles.todoTitle,
            {
              color:
                event.tone === "done"
                  ? colors.mutedForeground
                  : colors.foreground,
              fontFamily: FontFamily.interSemiBold,
              textDecorationLine: "none",
            },
          ]}
        >
          {event.title}
        </Text>
        <Text
          numberOfLines={1}
          style={[
            styles.todoDetail,
            {
              color:
                event.tone === "danger"
                  ? colors.destructive
                  : colors.mutedForeground,
              fontFamily: FontFamily.interRegular,
            },
          ]}
        >
          {event.detail}
        </Text>
      </View>
    </Pressable>
  );
}

function CardShell({
  title,
  action,
  onAction,
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  children: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.cardHead}>
        <Text
          style={[
            styles.cardTitle,
            { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {title}
        </Text>
        {action && onAction ? (
          <Pressable accessibilityRole="link" hitSlop={10} onPress={onAction}>
            <Text
              style={[
                styles.cardAction,
                { color: colors.primary, fontFamily: FontFamily.interSemiBold },
              ]}
            >
              {action}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** Fixed spots for the card's little confetti, so it looks the same each time. */
const CARD_CONFETTI = [
  // Kept to the card's corners and edges so none land on the words.
  { top: 18, left: 22, size: 8, colour: "#E8457A" },
  { top: 44, left: 64, size: 6, colour: "#4B3F91" },
  { top: 22, right: 40, size: 9, colour: "#F2B84B" },
  { top: 60, right: 18, size: 7, colour: "#2E7D5B" },
  { bottom: 22, left: 26, size: 6, colour: "#6E79C2" },
  { bottom: 30, right: 30, size: 8, colour: "#E8457A" },
  { bottom: 16, left: 110, size: 7, colour: "#F2B84B" },
] as const;

/** Birthday card: first in the carousel on the worker's birthday. */
export function BirthdayCard({ firstName }: { firstName: string }) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();
  return (
    <View
      style={[
        styles.card,
        styles.birthdayCard,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {CARD_CONFETTI.map((dot, i) => (
        <View
          key={i}
          importantForAccessibility="no-hide-descendants"
          style={{
            position: "absolute",
            ...("top" in dot ? { top: dot.top } : { bottom: dot.bottom }),
            ...("left" in dot ? { left: dot.left } : { right: dot.right }),
            width: dot.size,
            height: dot.size,
            borderRadius: dot.size / 2,
            backgroundColor: dot.colour,
            opacity: 0.85,
          }}
        />
      ))}
      <View style={[styles.birthdayIcon, { backgroundColor: colors.soft }]}>
        <MaterialCommunityIcons
          name="cake-variant"
          size={40}
          color={colors.pink}
        />
      </View>
      <Text
        style={[
          styles.birthdayTitle,
          { color: colors.foreground, fontFamily: FontFamily.display },
        ]}
      >
        {firstName
          ? t("birthday.titleName", { name: firstName })
          : t("birthday.title")}
      </Text>
      <Text
        style={[
          styles.birthdayBody,
          {
            color: colors.mutedForeground,
            fontFamily: FontFamily.interRegular,
          },
        ]}
      >
        {t("birthday.cardBody")}
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push("/birthday" as never)}
        style={({ pressed }) => [
          styles.birthdayButton,
          { borderColor: colors.primary, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Text
          style={[
            styles.cardAction,
            { color: colors.primary, fontFamily: FontFamily.interSemiBold },
          ]}
        >
          {t("birthday.replay")}
        </Text>
      </Pressable>
    </View>
  );
}

/** Card 2: the most urgent to-dos, or a calm "all caught up". */
export function TodoCard({ items }: { items: TodoItem[] }) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();
  const shown = items.slice(0, 3);
  return (
    <CardShell
      title={t("home.todo.title")}
      action={
        items.length > 0
          ? t("home.seeAll", { count: String(items.length) })
          : undefined
      }
      onAction={() => router.push("/worker/todo" as never)}
    >
      {shown.length === 0 ? (
        <View style={styles.caughtUp}>
          <View
            style={[
              styles.caughtUpIcon,
              { backgroundColor: colors.statusDocumentedBg },
            ]}
          >
            <Feather name="check" size={24} color={colors.success} />
          </View>
          <Text
            style={[
              styles.caughtUpTitle,
              {
                color: colors.foreground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {t("home.todo.clearTitle")}
          </Text>
          <Text
            style={[
              styles.caughtUpBody,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interRegular,
              },
            ]}
          >
            {t("home.todo.clearBody")}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {shown.map((item, i) => (
            <View key={item.id}>
              {i > 0 ? (
                <View
                  style={[styles.divider, { backgroundColor: colors.border }]}
                />
              ) : null}
              <TodoRow item={item} compact />
            </View>
          ))}
        </View>
      )}
    </CardShell>
  );
}

/** Card 3: this week at a glance, then what's coming up next. */
export function CalendarCard({
  byDay,
  upcoming,
}: {
  byDay: Map<string, CalendarEvent[]>;
  upcoming: CalendarEvent[];
}) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();
  const today = new Date();
  const monday = moveDay(today, -((today.getDay() + 6) % 7));
  const todayKey = localDayKey(today);
  const days = Array.from({ length: 7 }, (_, i) => moveDay(monday, i));
  const next = upcoming.slice(0, 3);

  return (
    <CardShell
      title={t("home.calendar.title")}
      action={t("home.calendar.open")}
      onAction={() => router.push("/worker/calendar" as never)}
    >
      <View style={styles.week}>
        {days.map((date) => {
          const key = localDayKey(date);
          const events = byDay.get(key) ?? [];
          const kinds = Array.from(new Set(events.map((e) => e.kind))).slice(
            0,
            3,
          );
          const isToday = key === todayKey;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={`${formatDayKey(key, { weekday: "long", day: "numeric", month: "long" })}, ${events.length}`}
              onPress={() =>
                router.push(`/worker/calendar?day=${key}` as never)
              }
              style={[
                styles.weekDay,
                isToday && { backgroundColor: colors.primary },
              ]}
            >
              <Text
                style={[
                  styles.weekDayName,
                  {
                    color: isToday
                      ? colors.primaryForeground
                      : colors.mutedForeground,
                    fontFamily: FontFamily.interMedium,
                  },
                ]}
              >
                {formatDayKey(key, { weekday: "narrow" })}
              </Text>
              <Text
                style={[
                  styles.weekDayNum,
                  {
                    color: isToday
                      ? colors.primaryForeground
                      : colors.foreground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {date.getDate()}
              </Text>
              <View style={styles.weekDots}>
                {kinds.map((kind) => (
                  <View
                    key={kind}
                    style={[
                      styles.weekDot,
                      {
                        backgroundColor: isToday
                          ? colors.primaryForeground
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
      <Text
        style={[
          styles.subhead,
          {
            color: colors.mutedForeground,
            fontFamily: FontFamily.interSemiBold,
          },
        ]}
      >
        {t("home.calendar.comingUp")}
      </Text>
      {next.length === 0 ? (
        <Text
          style={[
            styles.todoDetail,
            {
              color: colors.mutedForeground,
              fontFamily: FontFamily.interRegular,
            },
          ]}
        >
          {t("home.calendar.nothing")}
        </Text>
      ) : (
        <View style={styles.list}>
          {next.map((event) => (
            <EventRow key={event.id} event={event} showDate />
          ))}
        </View>
      )}
    </CardShell>
  );
}

const styles = StyleSheet.create({
  birthdayCard: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    overflow: "hidden",
  },
  birthdayIcon: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  birthdayTitle: { fontSize: 26, lineHeight: 32, textAlign: "center" },
  birthdayBody: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    maxWidth: 260,
  },
  birthdayButton: {
    borderWidth: 1.5,
    borderRadius: 999,
    paddingHorizontal: 18,
    minHeight: 44,
    justifyContent: "center",
    marginTop: 4,
  },
  card: { flexGrow: 1, borderRadius: 20, borderWidth: 1, padding: 18, minHeight: 330 },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  cardTitle: { fontSize: 18 },
  cardAction: { fontSize: 14 },
  list: { gap: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 50 },
  todoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  todoRowCompact: { paddingVertical: 10 },
  todoIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  todoCopy: { flex: 1, minWidth: 0, gap: 2 },
  todoTitle: { fontSize: 15, lineHeight: 20 },
  todoDetail: { fontSize: 13, lineHeight: 18 },
  caughtUp: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 24,
  },
  caughtUpIcon: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  caughtUpTitle: { fontSize: 17 },
  caughtUpBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 260,
  },
  week: { flexDirection: "row", justifyContent: "space-between", marginTop: 4 },
  weekDay: {
    alignItems: "center",
    gap: 3,
    width: 38,
    paddingVertical: 8,
    borderRadius: 14,
  },
  weekDayName: { fontSize: 12 },
  weekDayNum: { fontSize: 16 },
  weekDots: { flexDirection: "row", gap: 3, height: 6 },
  weekDot: { width: 5, height: 5, borderRadius: 3 },
  subhead: { fontSize: 13, marginTop: 16, marginBottom: 4 },
  eventRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
  },
  dateChip: {
    width: 42,
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 4,
  },
  dateChipDay: { fontSize: 11 },
  dateChipNum: { fontSize: 16 },
  kindIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  eventBar: { width: 3, alignSelf: "stretch", borderRadius: 2 },
});
