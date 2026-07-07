import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheckInPromptModal } from "@/components/worker/CheckInPromptModal";
import { OfflineBanner } from "@/components/OfflineBanner";
import { WorkerMobileShiftView } from "@/components/worker/WorkerMobileShiftView";
import { useShiftCheckinStatus } from "@/hooks/worker/useShiftCheckin";
import { useSessionNotes } from "@/hooks/worker/useSessionNotes";
import { useWorkerShift } from "@/hooks/worker/useWorkerShift";
import { useColors } from "@/hooks/useColors";
import {
  recordShiftViewed,
  submitLongShiftCheckin,
  type CheckinStatus,
} from "@/lib/worker-api";

export default function ShiftDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id, checkin } = useLocalSearchParams<{ id: string; checkin?: string }>();

  const { data: shift, isLoading, error, refetch } = useWorkerShift(id);
  const sessionId = shift?.session_id ?? undefined;
  const isSessionActive = shift?.visual_state === "session_active" || shift?.visual_state === "clocked_in";

  const { data: sessionNotes = [], refetch: refetchNotes } = useSessionNotes(sessionId);
  const { data: checkinStatus, refetch: refetchCheckin } = useShiftCheckinStatus(
    id,
    isSessionActive,
  );

  const [checkinOpen, setCheckinOpen] = useState(false);
  const [checkinBusy, setCheckinBusy] = useState(false);

  useEffect(() => {
    if (id) void recordShiftViewed(id);
  }, [id]);

  useEffect(() => {
    if (checkin === "pending") {
      setCheckinOpen(true);
      return;
    }
    if (checkinStatus?.can_submit_checkin || checkinStatus?.checkin_overdue) {
      setCheckinOpen(true);
    }
  }, [checkin, checkinStatus?.can_submit_checkin, checkinStatus?.checkin_overdue]);

  const handleRefresh = () => {
    void refetch();
    void refetchNotes();
    void refetchCheckin();
    void queryClient.invalidateQueries({ queryKey: ["worker", "shift", id] });
  };

  const handleComplete = () => {
    router.replace("/(tabs)" as never);
  };

  const handleCheckinSubmit = useCallback(
    async (status: CheckinStatus) => {
      if (!sessionId) return;
      setCheckinBusy(true);
      try {
        await submitLongShiftCheckin(sessionId, { status });
        setCheckinOpen(false);
        void refetchCheckin();
        if (status === "INCIDENT_REPORTED") {
          Alert.alert("Incident noted", "Please document the incident in your shift notes.");
        }
      } catch (err) {
        Alert.alert("Check-in failed", err instanceof Error ? err.message : "Please try again.");
      } finally {
        setCheckinBusy(false);
      }
    },
    [sessionId, refetchCheckin],
  );

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !shift) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
          {(error as Error)?.message ?? "Shift not found"}
        </Text>
        <Pressable onPress={() => router.back()} style={[styles.backLink, { borderColor: colors.border }]}>
          <Feather name="arrow-left" size={16} color={colors.primary} />
          <Text style={[styles.backLinkText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
            Go back
          </Text>
        </Pressable>
      </View>
    );
  }

  const gapMinutes = checkinStatus?.checkin_gap_secs
    ? Math.round(checkinStatus.checkin_gap_secs / 60)
    : undefined;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />

      <WorkerMobileShiftView
        shift={shift}
        sessionNotes={sessionNotes}
        onRefresh={handleRefresh}
        onShiftComplete={handleComplete}
        onBack={() => router.back()}
        canCheckin={isSessionActive && Boolean(checkinStatus?.can_submit_checkin)}
        onCheckin={() => setCheckinOpen(true)}
      />

      <CheckInPromptModal
        visible={checkinOpen && Boolean(sessionId)}
        onClose={() => setCheckinOpen(false)}
        onSubmit={handleCheckinSubmit}
        busy={checkinBusy}
        gapMinutes={gapMinutes}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  errorText: { fontSize: 15, textAlign: "center", paddingHorizontal: 32 },
  backLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  backLinkText: { fontSize: 14 },
});
