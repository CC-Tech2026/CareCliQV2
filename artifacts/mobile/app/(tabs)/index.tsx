import { Feather } from "@expo/vector-icons";
import {
  useGetParticipants,
  useGetRecentSessions,
  type Session,
} from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
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

import { OfflineBanner } from "@/components/OfflineBanner";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import {
  cacheSessions,
  cacheParticipants,
  getCachedSessions,
  getCachedParticipants,
} from "@/hooks/useOfflineCache";

function statusColor(
  status: string,
  colors: ReturnType<typeof useColors>
): string {
  switch (status) {
    case "in_progress":
      return colors.accent;
    case "completed":
      return colors.success;
    case "draft":
      return colors.mutedForeground;
    default:
      return colors.mutedForeground;
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "in_progress":
      return "Live";
    case "completed":
      return "Done";
    case "draft":
      return "Draft";
    default:
      return status;
  }
}

function complianceBadgeColor(
  score: number | null | undefined,
  colors: ReturnType<typeof useColors>
): string {
  if (score == null) return colors.mutedForeground;
  if (score >= 85) return "#22C55E";
  if (score >= 60) return colors.warning;
  return colors.destructive;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

interface SessionCardProps {
  session: Session;
  participantName?: string;
  onPress: () => void;
}

function SessionCard({ session, participantName, onPress }: SessionCardProps) {
  const colors = useColors();
  const isLive = session.status === "in_progress";

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: isLive ? colors.accent : colors.border,
          borderWidth: isLive ? 2 : 1,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
      testID={`session-card-${session.id}`}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardLeft}>
          <Text
            style={[
              styles.participantName,
              { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
            ]}
            numberOfLines={1}
          >
            {participantName ?? session.participants?.full_name ?? "Unknown"}
          </Text>
          <Text
            style={[
              styles.sessionMeta,
              { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
            ]}
          >
            {formatDate(session.session_date)} · {session.session_type}
          </Text>
        </View>
        <View style={styles.cardRight}>
          <View
            style={[
              styles.statusBadge,
              { backgroundColor: statusColor(session.status, colors) + "20" },
            ]}
          >
            {isLive && (
              <View
                style={[
                  styles.liveDot,
                  { backgroundColor: statusColor(session.status, colors) },
                ]}
              />
            )}
            <Text
              style={[
                styles.statusText,
                {
                  color: statusColor(session.status, colors),
                  fontFamily: "Inter_600SemiBold",
                },
              ]}
            >
              {statusLabel(session.status)}
            </Text>
          </View>
          {session.compliance_score != null && (
            <Text
              style={[
                styles.complianceScore,
                {
                  color: complianceBadgeColor(session.compliance_score, colors),
                  fontFamily: "Inter_600SemiBold",
                },
              ]}
            >
              {Math.round(session.compliance_score)}%
            </Text>
          )}
        </View>
      </View>
      {session.notes ? (
        <Text
          style={[
            styles.notePreview,
            { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
          ]}
          numberOfLines={2}
        >
          {session.notes}
        </Text>
      ) : null}
      <View style={styles.cardFooter}>
        <Text
          style={[
            styles.duration,
            { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
          ]}
        >
          {session.duration_minutes} min
        </Text>
        {isLive && (
          <View
            style={[styles.resumeBtn, { backgroundColor: colors.accent + "20" }]}
          >
            <Feather name="play" size={12} color={colors.accent} />
            <Text
              style={[
                styles.resumeText,
                { color: colors.accent, fontFamily: "Inter_600SemiBold" },
              ]}
            >
              Resume
            </Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

export default function SessionsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState("");
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

  const participantMap = React.useMemo(() => {
    if (participants) {
      const map: Record<string, string> = {};
      participants.forEach((p) => { map[p.id] = p.full_name; });
      return map;
    }
    return cachedParticipantMap;
  }, [participants, cachedParticipantMap]);

  const filtered = React.useMemo(() => {
    if (!activeSessions) return [];
    const q = search.toLowerCase();
    return activeSessions.filter((s) => {
      const name = (participantMap[s.participant_id] ?? s.participants?.full_name ?? "").toLowerCase();
      return !q || name.includes(q) || s.session_type.toLowerCase().includes(q);
    });
  }, [activeSessions, search, participantMap]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const showLoading = isLoading && !cachedSessions;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <View
        style={[
          styles.header,
          { paddingTop: topPad + 12, backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <Text
          style={[
            styles.headerTitle,
            { color: colors.foreground, fontFamily: "Inter_700Bold" },
          ]}
        >
          Sessions
        </Text>
      </View>

      <View style={[styles.searchContainer, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
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
            placeholder="Search sessions..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
            testID="sessions-search"
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>
      </View>

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
          scrollEnabled={!!filtered.length}
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
          renderItem={({ item }) => (
            <SessionCard
              session={item}
              participantName={participantMap[item.participant_id]}
              onPress={() => router.push(`/session/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Feather name="clipboard" size={40} color={colors.mutedForeground} />
              <Text
                style={[
                  styles.emptyText,
                  { color: colors.mutedForeground, fontFamily: "Inter_500Medium" },
                ]}
              >
                No sessions found
              </Text>
              <Text
                style={[
                  styles.emptySubtext,
                  { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                ]}
              >
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
    padding: 14,
    gap: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardLeft: { flex: 1, marginRight: 8 },
  cardRight: { alignItems: "flex-end", gap: 4 },
  participantName: { fontSize: 15 },
  sessionMeta: { fontSize: 13, marginTop: 2 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11 },
  complianceScore: { fontSize: 13 },
  notePreview: { fontSize: 13, lineHeight: 18 },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  duration: { fontSize: 12 },
  resumeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  resumeText: { fontSize: 12 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 80, gap: 10 },
  emptyText: { fontSize: 17 },
  emptySubtext: { fontSize: 14, textAlign: "center", paddingHorizontal: 40 },
});
