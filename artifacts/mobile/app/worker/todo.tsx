import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TodoRow } from "@/components/worker/home/HomeCards";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { useWorkerTodo, type TodoItem } from "@/hooks/worker/useWorkerTodo";

/** Everything a worker needs to act on, split into "now" and "soon". */
export default function WorkerTodoScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { items, isLoading, refetch } = useWorkerTodo();
  const now = items.filter((i) => i.tone === "danger");
  const soon = items.filter((i) => i.tone === "warning");

  const group = (title: string, list: TodoItem[], color: string) =>
    list.length ? (
      <View style={styles.group}>
        <View style={styles.groupHead}>
          <View style={[styles.groupDot, { backgroundColor: color }]} />
          <Text
            style={[
              styles.groupTitle,
              {
                color: colors.foreground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {title} · {list.length}
          </Text>
        </View>
        <View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          {list.map((item, i) => (
            <View key={item.id}>
              {i > 0 ? (
                <View
                  style={[styles.divider, { backgroundColor: colors.border }]}
                />
              ) : null}
              <TodoRow item={item} />
            </View>
          ))}
        </View>
      </View>
    ) : null;

  return (
    <WorkerStackScreen
      guide="todo"
      headerTitle={t("home.todo.title")}
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
        {items.length === 0 && !isLoading ? (
          <View
            style={[
              styles.card,
              styles.clear,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View
              style={[
                styles.clearIcon,
                { backgroundColor: colors.statusDocumentedBg },
              ]}
            >
              <Feather name="check" size={26} color={colors.success} />
            </View>
            <Text
              style={[
                styles.clearTitle,
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
                styles.clearBody,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            >
              {t("home.todo.clearBody")}
            </Text>
          </View>
        ) : null}
        {group(t("todo.now"), now, colors.destructive)}
        {group(t("todo.soon"), soon, colors.warning)}
      </ScrollView>
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 20 },
  group: { gap: 10 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupTitle: { fontSize: 16 },
  card: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 14 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 50 },
  clear: { alignItems: "center", gap: 8, paddingVertical: 32 },
  clearIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  clearTitle: { fontSize: 18 },
  clearBody: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 280,
  },
});
