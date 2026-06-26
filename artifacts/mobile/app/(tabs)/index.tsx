import { Feather } from "@expo/vector-icons";
import {
  useGetParticipants,
  useGetRecentSessions,
  type Session,
} from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import {
  cacheSessions,
  cacheParticipants,
  getCachedSessions,
  getCachedParticipants,
} from "@/hooks/useOfflineCache";

type FilterType = "all" | "live" | "done";

const FILTERS: { id: FilterType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "live", label: "Live" },
  { id: "done", label: "Done" },
];

function statusColor(status: string, colors: ReturnType<typeof useColors>): string {
  switch (status) {
    case "in_progress": return colors.accent;
    case "completed": return "#22C55E";
    case "draft": return colors.mutedForeground;
    default: return colors.mutedForeground;
  }
}

function complianceBadgeColor(score: number | null | undefined, colors: ReturnType<typeof useColors>): string {
  if (score == null) return colors.mutedForeground;
  if (score >= 85) return "#22C55E";
  if (score >= 60) return colors.warning;
  return colors.destructive;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function FilterPills({ filter, onChange }: { filter: FilterType; onChange: (f: FilterType) => void }) {
  const colors = useColors();
  return (
    <View style={[styles.filterRow, { borderBottomColor: colors.border }]}>
      {FILTERS.map((f) => {
        const active = filter === f.id;
        return (
          <Pressable
            key={f.id}
            onPress={() => onChange(f.id)}
            style={[
              styles.filterPill,
              { backgroundColor: active ? colors.primary : colors.muted },
            ]}
          >
            <Text
              style={[
                styles.filterPillText,
                { color: active ? "#FFFFFF" : colors.mutedForeground, fontFamily: "Inter_600SemiBold" },
              ]}
            >
              {f.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface SessionRowProps {
  session: Session;
  participantName?: string;
  onPress: () => void;
  isLast?: boolean;
}

function SessionRow({ session, participantName, onPress, isLast }: SessionRowProps) {
  const colors = useColors();
  const isLive = session.status === "in_progress";
  const isDone = session.status === "completed";
  const dotColor = statusColor(session.status, colors);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: colors.card,
          borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
          borderBottomColor: colors.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
      testID={`session-row-${session.id}`}
    >
      <View style={[styles.rowDot, { backgroundColor: dotColor }]} />

      <View style={styles.rowContent}>
        <Text
          style={[styles.rowName, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}
          numberOfLines={1}
        >
          {participantName ?? (session as Record<string, unknown>)?.participants?.full_name as string ?? "Unknown"}
        </Text>
        <Text
          style={[styles.rowMeta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}
          numberOfLines={1}
        >
          {formatDate(session.session_date)} · {session.session_type}
        </Text>
      </View>

      <View style={styles.rowRight}>
        {isLive ? (
          <View style={[styles.livePill, { backgroundColor: colors.accent + "20" }]}>
            <View style={[styles.liveDot, { backgroundColor: colors.accent }]} />
            <Text style={[styles.livePillText, { color: colors.accent, fontFamily: "Inter_700Bold" }]}>
              LIVE
            </Text>
          </View>
        ) : isDone && session.compliance_score != null ? (
          <Text
            style={[
              styles.complianceScore,
              { color: complianceBadgeColor(session.compliance_score, colors), fontFamily: "Inter_600SemiBold" },
            ]}
          >
            {Math.round(session.compliance_score)}%
          </Text>
        ) : (
          <Text style={[styles.draftLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Draft
          </Text>
        )}
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
      </View>
    </Pressable>
  );
}

export default function SessionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [filter, setFilter] = useState<FilterType>("all");
  const { isOnline } = useOffline();

  const [cachedSessions, setCachedSessions] = useState<Session[] | null>(null);
  const [cachedParticipantMap, setCachedParticipantMap] = useState<Record<string, string>>({});

  const {
    data: sessions,
    isLoading,
    refetch,
    isRefetching,
  } = useGetRecentSessions({ limit: 50 });
  const { data: participants } = useGetParticipants();

  useEffect(() => {
    if (sessions && sessions.length > 0) {
      cacheSessions(sessions);
    } else if (!isOnline) {
      getCachedSessions<Session>().then((cached) => {
        if (cached) setCachedSessions(cached);
      });
    }
  }, [sessions, isOnline]);

  useEffect(() => {
    if (!sessions && !isOnline) {
      getCachedSessions<Session>().then((cached) => {
        if (cached) setCachedSessions(cached);
      });
    }
  }, [isOnline]);

  useEffect(() => {
    if (participants && participants.length > 0) {
      cacheParticipants(participants);
    } else if (!isOnline) {
      getCachedParticipants<{ id: string; full_name: string }>().then((cached) => {
        if (cached) {
          const map: Record<string, string> = {};
          cached.forEach((p) => { map[p.id] = p.full_name; });
          setCachedParticipantMap(map);
        }
      });
    }
  }, [participants, isOnline]);

  const activeSessions = sessions ?? (isOnline ? undefined : cachedSessions ?? undefined);

  const participantMap = useMemo(() => {
    if (participants) {
      const map: Record<string, string> = {};
      participants.forEach((p) => { map[p.id] = p.full_name; });
      return map;
    }
    return cachedParticipantMap;
  }, [participants, cachedParticipantMap]);

  const filtered = useMemo(() => {
    if (!activeSessions) return [];
    return activeSessions.filter((s) => {
      if (filter === "live") return s.status === "in_progress";
      if (filter === "done") return s.status === "completed";
      return true;
    });
  }, [activeSessions, filter]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const showLoading = isLoading && !cachedSessions;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />

      {/* Header */}
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            My Shifts
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {isOnline ? "Live data" : "Offline — cached"}
          </Text>
        </View>
        <Pressable
          onPress={() => router.push("/sessions/new")}
          style={[styles.newShiftBtn, { backgroundColor: colors.primary }]}
        >
          <Feather name="plus" size={18} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Filter pills */}
      <FilterPills filter={filter} onChange={setFilter} />

      {showLoading ? (
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
          showsVerticalScrollIndicator={false}
          refreshControl={
            isOnline ? (
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={refetch}
                tintColor={colors.primary}
              />
            ) : undefined
          }
          renderItem={({ item, index }) => (
            <SessionRow
              session={item}
              participantName={participantMap[item.participant_id]}
              onPress={() => router.push(`/session/${item.id}`)}
              isLast={index === filtered.length - 1}
            />
          )}
          ListHeaderComponent={
            filtered.length > 0 ? (
              <View style={[styles.listCard, { borderColor: colors.border }]} />
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyIconWrap, { backgroundColor: colors.muted }]}>
                <Feather name="clipboard" size={28} color={colors.mutedForeground} />
              </View>
              <Text style={[styles.emptyText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {filter === "live" ? "No live shifts" : filter === "done" ? "No completed shifts" : "No shifts found"}
              </Text>
              <Text style={[styles.emptySubtext, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {isOnline
                  ? "Start a session from a participant's profile"
                  : "No cached sessions available"}
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 28, letterSpacing: -0.5 },
  headerSub: { fontSize: 12, marginTop: 1 },
  newShiftBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  filterRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  filterPill: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 20,
  },
  filterPillText: { fontSize: 13 },

  list: { paddingHorizontal: 16, paddingTop: 12, gap: 0 },

  listCard: {
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: "hidden",
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
    minHeight: 68,
  },
  rowDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    flexShrink: 0,
  },
  rowContent: { flex: 1, gap: 3 },
  rowName: { fontSize: 15 },
  rowMeta: { fontSize: 13 },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
  },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  livePillText: { fontSize: 11 },
  complianceScore: { fontSize: 13 },
  draftLabel: { fontSize: 13 },

  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 12 },
  emptyIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: { fontSize: 17 },
  emptySubtext: { fontSize: 14, textAlign: "center", paddingHorizontal: 40 },
});
