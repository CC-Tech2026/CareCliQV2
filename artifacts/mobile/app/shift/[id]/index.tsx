import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";

import { LongShiftCheckInForm } from "@/components/worker/LongShiftCheckInForm";
import { OfflineBanner } from "@/components/OfflineBanner";
import { WorkerMobileShiftView } from "@/components/worker/WorkerMobileShiftView";
import { useSessionNotes } from "@/hooks/worker/useSessionNotes";
import { useWorkerShift } from "@/hooks/worker/useWorkerShift";
import { useColors } from "@/hooks/useColors";
import {
  clearLocalCheckinNotification,
  syncLocalCheckinNotifications,
} from "@/lib/local-checkin-notifications";
import { recordShiftViewed, submitLongShiftCheckInForm } from "@/lib/worker-api";
import { goBackOrHome } from "@/lib/go-back";
import { isShiftCompletedForList } from "@/lib/shift-utils";
import type { LongShiftCheckInFormData } from "@workspace/worker-compliance";

export default function ShiftDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { id, checkin, scheduled_checkin_id } = useLocalSearchParams<{
    id: string;
    checkin?: string;
    scheduled_checkin_id?: string;
  }>();
  // Sticky for this mount — query param is stripped after open, but form must stay immediate.
  const [fromCheckinNotif] = useState(() => checkin === "pending");
  const [scheduledCheckinId] = useState(
    () => (typeof scheduled_checkin_id === "string" ? scheduled_checkin_id : undefined),
  );

  const { data: shift, isLoading, error } = useWorkerShift(id);
  const sessionId = shift?.session_id ?? undefined;
  const isSessionActive = shift?.visual_state === "session_active" || shift?.visual_state === "clocked_in";
  const checkinStatus = shift?.checkin_status;

  const { data: sessionNotes = [] } = useSessionNotes(sessionId);

  // Open check-in form immediately from push — don't wait for backend eligibility flags.
  const [checkinOpen, setCheckinOpen] = useState(fromCheckinNotif);
  const [checkinBusy, setCheckinBusy] = useState(false);

  useEffect(() => {
    if (id) void recordShiftViewed(id);
  }, [id]);

  // Schedule device-local check-in alarms (works offline after schedule is known).
  // Re-sync when backgrounding so overdue/prompted check-ins still hit the tray
  // if FCM was missed.
  useEffect(() => {
    if (!id || !shift) return;
    const run = () => {
      void syncLocalCheckinNotifications({
        shiftId: id,
        sessionId,
        checkinStatus,
        shiftActive: isSessionActive && !isShiftCompletedForList(shift),
      });
    };
    run();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "background" || state === "inactive") run();
    });
    return () => sub.remove();
  }, [id, sessionId, isSessionActive, checkinStatus, shift]);

  useEffect(() => {
    if (!fromCheckinNotif) return;
    setCheckinOpen(true);
    const upcomingId = scheduledCheckinId ?? checkinStatus?.upcoming_checkins?.[0]?.id;
    void clearLocalCheckinNotification(upcomingId);
  }, [fromCheckinNotif, scheduledCheckinId, checkinStatus?.upcoming_checkins]);

  useEffect(() => {
    if (!shift) return;

    const completed = isShiftCompletedForList(shift);
    const active = isSessionActive;

    if (completed || !active) {
      setCheckinOpen(false);
      if (fromCheckinNotif || checkin === "pending") {
        router.replace(`/shift/${id}` as never);
      }
      return;
    }

    if (fromCheckinNotif || checkin === "pending") {
      setCheckinOpen(true);
      if (checkin === "pending") {
        router.replace(`/shift/${id}` as never);
      }
      return;
    }

    if (checkinStatus?.can_submit_checkin || checkinStatus?.checkin_overdue) {
      setCheckinOpen(true);
    }
  }, [
    shift,
    fromCheckinNotif,
    checkin,
    id,
    isSessionActive,
    checkinStatus?.can_submit_checkin,
    checkinStatus?.checkin_overdue,
    router,
  ]);

  const invalidateShiftQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["worker", "shift", id] });
  }, [queryClient, id]);

  const invalidateNotesQuery = useCallback(() => {
    if (!sessionId) return;
    void queryClient.invalidateQueries({ queryKey: ["worker", "session", sessionId, "notes"] });
  }, [queryClient, sessionId]);

  const handleRefresh = useCallback(() => {
    invalidateShiftQueries();
    invalidateNotesQuery();
  }, [invalidateShiftQueries, invalidateNotesQuery]);

  const handleComplete = () => {
    void queryClient.invalidateQueries({ queryKey: ["worker", "my-compliance"] });
    void queryClient.invalidateQueries({ queryKey: ["worker", "compliance-detail"] });
    void queryClient.invalidateQueries({ queryKey: ["worker", "shifts"] });
    router.replace("/(tabs)/shifts" as never);
  };

  const handleCheckinSubmit = useCallback(
    async (form: LongShiftCheckInFormData) => {
      if (!sessionId) return;
      setCheckinBusy(true);
      try {
        const result = await submitLongShiftCheckInForm(sessionId, form);
        setCheckinOpen(false);
        void clearLocalCheckinNotification(
          scheduledCheckinId ?? checkinStatus?.upcoming_checkins?.[0]?.id,
        );
        invalidateShiftQueries();
        invalidateNotesQuery();
        if (result.status === "INCIDENT_REPORTED") {
          Alert.alert("Incident noted", "Please document the incident in your shift notes.");
        }
      } catch (err) {
        Alert.alert("Check-in failed", err instanceof Error ? err.message : "Please try again.");
      } finally {
        setCheckinBusy(false);
      }
    },
    [
      sessionId,
      scheduledCheckinId,
      checkinStatus?.upcoming_checkins,
      invalidateShiftQueries,
      invalidateNotesQuery,
    ],
  );

  if (isLoading && !fromCheckinNotif) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if ((error || !shift) && !fromCheckinNotif) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
          {(error as Error)?.message ?? "Shift not found"}
        </Text>
        <Pressable onPress={() => goBackOrHome(router)} style={[styles.backLink, { borderColor: colors.border }]}>
          <Feather name="arrow-left" size={16} color={colors.primary} />
          <Text style={[styles.backLinkText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
            Go back
          </Text>
        </Pressable>
      </View>
    );
  }

  const activeTasks = (shift?.tasks ?? []).filter((t) => !t.marked_na);
  const shiftCompleted = shift ? isShiftCompletedForList(shift) : false;
  // From notification: show form immediately (no backend can_submit wait).
  const canShowCheckinModal =
    checkinOpen &&
    !shiftCompleted &&
    (fromCheckinNotif || (Boolean(sessionId) && isSessionActive));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />

      {shift ? (
        <WorkerMobileShiftView
          shift={shift}
          sessionNotes={sessionNotes}
          onRefresh={handleRefresh}
          onNotesRefresh={invalidateNotesQuery}
          onShiftComplete={handleComplete}
          onBack={() => goBackOrHome(router)}
          canCheckin={isSessionActive && Boolean(checkinStatus?.can_submit_checkin)}
          onCheckin={() => setCheckinOpen(true)}
          checkinStatus={checkinStatus}
          breakStatus={shift.break_status}
        />
      ) : (
        <View style={[styles.center, { flex: 1 }]}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      )}

      <LongShiftCheckInForm
        visible={canShowCheckinModal}
        onClose={() => setCheckinOpen(false)}
        onSubmit={handleCheckinSubmit}
        busy={checkinBusy || (fromCheckinNotif && !sessionId)}
        tasks={activeTasks}
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
