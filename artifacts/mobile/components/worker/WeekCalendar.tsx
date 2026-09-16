import { Feather } from "@expo/vector-icons";
import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import { FontFamily } from "@/constants/typography";
import { getAppTimezone } from "@/lib/shift-utils";

export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function moveDay(date: Date, amount: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

export function WeekCalendar({
  selected,
  onSelect,
  counts,
}: {
  selected: Date;
  onSelect: (date: Date) => void;
  counts: Record<string, number>;
}) {
  const colors = useColors();
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  const selectedKey = localDayKey(selected);
  const monday = moveDay(selected, -((selected.getDay() + 6) % 7));
  const today = localDayKey(new Date());
  useEffect(() => {
    scroll.current?.scrollTo({
      x: Math.max(0, (positions.current[selectedKey] ?? 0) - 80),
      animated: false,
    });
  }, [selectedKey]);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.header}>
        <Text
          accessibilityRole="header"
          style={[styles.month, { color: colors.foreground }]}
        >
          {selected.toLocaleDateString("en-AU", {
            timeZone: getAppTimezone(),
            month: "long",
            year: "numeric",
          })}
        </Text>
        <View style={styles.controls}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go to today"
            onPress={() => onSelect(new Date())}
            style={styles.control}
          >
            <Text
              style={{
                color: colors.primary,
                fontFamily: FontFamily.bodyStrong,
              }}
            >
              Today
            </Text>
          </Pressable>
          {([-7, 7] as const).map((amount) => (
            <Pressable
              key={amount}
              accessibilityRole="button"
              accessibilityLabel={amount < 0 ? "Previous week" : "Next week"}
              onPress={() => onSelect(moveDay(selected, amount))}
              style={styles.control}
            >
              <Feather
                name={amount < 0 ? "chevron-left" : "chevron-right"}
                size={20}
                color={colors.foreground}
              />
            </Pressable>
          ))}
        </View>
      </View>
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator
        contentContainerStyle={styles.week}
      >
        {Array.from({ length: 7 }, (_, index) => {
          const date = moveDay(monday, index);
          const key = localDayKey(date);
          const active = key === selectedKey;
          const foreground = active
            ? colors.primaryForeground
            : colors.foreground;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              aria-pressed={active}
              accessibilityLabel={`${date.toLocaleDateString("en-AU", { timeZone: getAppTimezone(), weekday: "long", day: "numeric", month: "long" })}${key === today ? ", today" : ""}${counts[key] ? `, ${counts[key]} shift${counts[key] === 1 ? "" : "s"}` : ""}`}
              onLayout={(event) => {
                positions.current[key] = event.nativeEvent.layout.x;
                if (active)
                  scroll.current?.scrollTo({
                    x: Math.max(0, event.nativeEvent.layout.x - 80),
                    animated: false,
                  });
              }}
              onPress={() => onSelect(date)}
              style={[
                styles.day,
                {
                  backgroundColor: active ? colors.primary : colors.background,
                  borderColor: key === today ? colors.primary : "transparent",
                },
              ]}
            >
              <Text style={[styles.weekday, { color: foreground }]}>
                {date.toLocaleDateString("en-AU", { timeZone: getAppTimezone(), weekday: "short" })}
              </Text>
              <Text style={[styles.date, { color: foreground }]}>
                {date.getDate()}
              </Text>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: counts[key] ? foreground : "transparent" },
                ]}
              />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}
const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 20, padding: 10, gap: 6 },
  header: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 2,
  },
  controls: { flexDirection: "row", alignItems: "center", marginStart: "auto" },
  month: {
    flexGrow: 1,
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FontFamily.interBold,
  },
  control: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  week: { flexGrow: 1, gap: 5 },
  day: {
    flex: 1,
    minWidth: 44,
    minHeight: 68,
    paddingHorizontal: 4,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  weekday: { fontFamily: FontFamily.label, fontSize: 12 },
  date: { fontFamily: FontFamily.interBold, fontSize: 20 },
  dot: { width: 5, height: 5, borderRadius: 3 },
});
