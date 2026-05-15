import { Feather } from "@expo/vector-icons";
import { useGetParticipants, type Participant } from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

function planStatusColor(
  status: string,
  colors: ReturnType<typeof useColors>
): string {
  switch (status) {
    case "active":
      return "#22C55E";
    case "expired":
      return colors.destructive;
    case "pending":
      return colors.warning;
    default:
      return colors.mutedForeground;
  }
}

function planStatusLabel(status: string): string {
  switch (status) {
    case "active":
      return "Active";
    case "expired":
      return "Expired";
    case "pending":
      return "Pending";
    default:
      return status;
  }
}

function budgetProgress(participant: Participant): number {
  if (!participant.total_budget || participant.total_budget === 0) return 0;
  return Math.min(
    ((participant.used_budget ?? 0) / participant.total_budget) * 100,
    100
  );
}

interface ParticipantCardProps {
  participant: Participant;
  onPress: () => void;
}

function ParticipantCard({ participant, onPress }: ParticipantCardProps) {
  const colors = useColors();
  const initials = participant.full_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const progress = budgetProgress(participant);
  const statusColor = planStatusColor(participant.plan_status, colors);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      testID={`participant-card-${participant.id}`}
    >
      <View style={styles.cardRow}>
        <View
          style={[styles.avatar, { backgroundColor: colors.primary + "20" }]}
        >
          <Text
            style={[
              styles.avatarText,
              { color: colors.primary, fontFamily: "Inter_700Bold" },
            ]}
          >
            {initials}
          </Text>
        </View>
        <View style={styles.cardContent}>
          <View style={styles.nameRow}>
            <Text
              style={[
                styles.name,
                { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
              ]}
              numberOfLines={1}
            >
              {participant.full_name}
            </Text>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: statusColor + "20" },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  { color: statusColor, fontFamily: "Inter_600SemiBold" },
                ]}
              >
                {planStatusLabel(participant.plan_status)}
              </Text>
            </View>
          </View>
          <Text
            style={[
              styles.ndisNumber,
              { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
            ]}
          >
            NDIS: {participant.ndis_number}
          </Text>
          {participant.total_budget != null && (
            <View style={styles.budgetRow}>
              <View style={[styles.budgetBar, { backgroundColor: colors.muted }]}>
                <View
                  style={[
                    styles.budgetFill,
                    {
                      width: `${progress}%`,
                      backgroundColor:
                        progress > 90
                          ? colors.destructive
                          : progress > 70
                          ? colors.warning
                          : colors.success,
                    },
                  ]}
                />
              </View>
              <Text
                style={[
                  styles.budgetText,
                  { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                ]}
              >
                {Math.round(progress)}% used
              </Text>
            </View>
          )}
        </View>
        <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

export default function ParticipantsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState("");

  const { data: participants, isLoading, refetch, isRefetching } = useGetParticipants();

  const filtered = React.useMemo(() => {
    if (!participants) return [];
    const q = search.toLowerCase();
    return participants.filter(
      (p) =>
        !q ||
        p.full_name.toLowerCase().includes(q) ||
        p.ndis_number.toLowerCase().includes(q)
    );
  }, [participants, search]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 12,
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Text
          style={[
            styles.headerTitle,
            { color: colors.foreground, fontFamily: "Inter_700Bold" },
          ]}
        >
          Participants
        </Text>
      </View>

      <View
        style={[
          styles.searchContainer,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <View
          style={[
            styles.searchBar,
            { backgroundColor: colors.muted, borderColor: colors.border },
          ]}
        >
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={[
              styles.searchInput,
              { color: colors.foreground, fontFamily: "Inter_400Regular" },
            ]}
            placeholder="Search by name or NDIS number..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            testID="participants-search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + 100 },
          ]}
          scrollEnabled={!!filtered.length}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          renderItem={({ item }) => (
            <ParticipantCard
              participant={item}
              onPress={() => router.push(`/participant/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="users" size={40} color={colors.mutedForeground} />
              <Text
                style={[
                  styles.emptyText,
                  { color: colors.mutedForeground, fontFamily: "Inter_500Medium" },
                ]}
              >
                No participants found
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 28, letterSpacing: -0.5 },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  searchInput: { flex: 1, fontSize: 15, padding: 0 },
  list: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 17 },
  cardContent: { flex: 1, gap: 3 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  name: { fontSize: 15, flex: 1 },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
  },
  statusText: { fontSize: 11 },
  ndisNumber: { fontSize: 12 },
  budgetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  budgetBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
  },
  budgetFill: { height: "100%", borderRadius: 2 },
  budgetText: { fontSize: 11, minWidth: 52 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 80,
    gap: 10,
  },
  emptyText: { fontSize: 17 },
});
