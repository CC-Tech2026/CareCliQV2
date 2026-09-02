import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import {
  useGetParticipant,
  useGetSession,
  useUpdateSession,
  useSaveSessionWithAI,
} from "@workspace/api-client-react";
import * as Haptics from "@/lib/haptics";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { ShiftCompliancePanel } from "@/components/ShiftCompliancePanel";
import { WorkerMobileIncidentSheet } from "@/components/worker/WorkerMobileIncidentSheet";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import { evaluateSessionTextCompliance, scoreColor } from "@workspace/worker-compliance";

const ACTIVITIES = [
  { id: "personal_care", label: "Personal Care", icon: "heart" },
  { id: "community_access", label: "Community", icon: "map-pin" },
  { id: "daily_living", label: "Daily Living", icon: "home" },
  { id: "social_skills", label: "Social Skills", icon: "users" },
  { id: "therapy", label: "Therapy", icon: "activity" },
  { id: "transport", label: "Transport", icon: "truck" },
  { id: "communication", label: "Communication", icon: "message-circle" },
  { id: "capacity_building", label: "Capacity", icon: "trending-up" },
] as const;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function formatTimer(seconds: number) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export default function LiveSessionScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: session, isLoading: sessionLoading } = useGetSession(id);
  const { data: participant, isLoading: participantLoading } = useGetParticipant(
    session?.participant_id ?? ""
  );

  const updateSession = useUpdateSession();
  const saveWithAI = useSaveSessionWithAI();
  const { isOnline, queueNoteUpdate } = useOffline();

  const [isRunning, setIsRunning] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [notes, setNotes] = useState("");
  const [activities, setActivities] = useState<string[]>([]);
  const [photos, setPhotos] = useState<string[]>([]);
  const [voiceNotes, setVoiceNotes] = useState<string[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => {
    if (session?.notes && !notes) {
      setNotes(session.notes);
    }
    if (session?.activities_performed && activities.length === 0) {
      setActivities(session.activities_performed.split(",").map((a) => a.trim()).filter(Boolean));
    }
  }, [session]);

  useEffect(() => {
    if (isRunning) {
      timerRef.current = setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRunning]);

  const handleStartStop = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsRunning((prev) => !prev);
  }, []);

  const handleToggleActivity = useCallback((activityId: string) => {
    Haptics.selectionAsync();
    setActivities((prev) =>
      prev.includes(activityId) ? prev.filter((a) => a !== activityId) : [...prev, activityId]
    );
  }, []);

  const handleTakePhoto = useCallback(async () => {
    if (Platform.OS === "web") {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (!result.canceled && result.assets[0]) {
        setPhotos((prev) => [...prev, result.assets[0].uri]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Camera access is required to take photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.8,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotos((prev) => [...prev, result.assets[0].uri]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, []);

  const handleVoiceRecord = useCallback(async () => {
    if (Platform.OS === "web") {
      const noteText = `Voice note ${voiceNotes.length + 1} — recorded at ${new Date().toLocaleTimeString()}`;
      setVoiceNotes((prev) => [...prev, noteText]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return;
    }
    if (isRecording) {
      setIsRecording(false);
      try {
        await audioRecorder.stop();
        await setAudioModeAsync({ allowsRecording: false });
        const uri = audioRecorder.uri;
        const noteText = `Voice note ${voiceNotes.length + 1} — ${new Date().toLocaleTimeString()} (${uri ? "recorded" : "failed"})`;
        setVoiceNotes((prev) => [...prev, noteText]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        setVoiceNotes((prev) => [...prev, `Voice note ${voiceNotes.length + 1}`]);
      }
    } else {
      try {
        const { granted } = await AudioModule.requestRecordingPermissionsAsync();
        if (!granted) {
          Alert.alert("Permission needed", "Microphone access is required for voice notes.");
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true });
        await audioRecorder.prepareToRecordAsync();
        audioRecorder.record();
        setIsRecording(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        Alert.alert("Error", "Could not start recording. Please try again.");
      }
    }
  }, [isRecording, voiceNotes.length, audioRecorder]);

  const handleComplete = useCallback(async () => {
    setIsSaving(true);
    const durationMins = Math.max(
      session?.duration_minutes ?? 0,
      Math.floor(elapsedSeconds / 60)
    );

    if (!isOnline) {
      try {
        await queueNoteUpdate({
          sessionId: id,
          notes,
          activities,
          durationMinutes: durationMins,
          completed: true,
          timestamp: Date.now(),
        });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setShowCompleteModal(false);
        Alert.alert(
          "Saved Offline",
          "Your notes have been saved locally and will sync automatically when you are back online.",
          [{ text: "OK", onPress: () => router.replace("/(tabs)/shifts") }]
        );
      } catch {
        Alert.alert("Error", "Failed to save notes offline. Please try again.");
      } finally {
        setIsSaving(false);
      }
      return;
    }

    try {
      await updateSession.mutateAsync({
        sessionId: id,
        data: {
          notes,
          activities_performed: activities.join(", "),
          duration_minutes: durationMins,
          status: "completed",
        },
      });
      await saveWithAI.mutateAsync({ sessionId: id });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setShowCompleteModal(false);
      router.replace("/(tabs)/shifts");
    } catch {
      Alert.alert("Error", "Failed to save session. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [id, notes, activities, elapsedSeconds, session, isOnline, queueNoteUpdate, updateSession, saveWithAI, router]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const endShiftCompliance = useMemo(
    () =>
      evaluateSessionTextCompliance(
        [notes, ...voiceNotes].filter(Boolean).join("\n"),
        participant?.full_name?.split(" ")[0],
        activities.length,
      ),
    [notes, voiceNotes, participant?.full_name, activities.length],
  );

  if (sessionLoading || participantLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  // Safe access to API fields that may vary by backend implementation
  const p = participant as Record<string, unknown> | undefined;
  const goals = (p?.goals as Array<{ goal_text: string; progress: number }>) ?? [];
  const participantAddress = (p?.address ?? p?.participant_address) as string | undefined;
  const hasHealthInfo = !!(p?.primary_disability || p?.health_alerts || p?.allergies || p?.restrictions);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />

      {/* Simple white header — participant name visible while scrolling */}
      <View
        style={[
          styles.simpleHeader,
          { paddingTop: topPad + 8, backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} testID="session-back">
          <Feather name="chevron-left" size={24} color={colors.foreground} />
        </Pressable>
        <Text
          style={[styles.headerName, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}
          numberOfLines={1}
        >
          {participant?.full_name ?? "Loading..."}
        </Text>
        <View style={styles.liveStatusRow}>
          <View style={[styles.statusDot, { backgroundColor: isRunning ? "#22C55E" : colors.mutedForeground }]} />
          <Text style={[styles.liveLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            {isRunning ? "LIVE" : "PAUSED"}
          </Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={{ paddingBottom: insets.bottom + 92 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* PARTICIPANT CONTEXT — hero block */}
        <View style={[styles.participantBlock, { borderBottomColor: colors.border }]}>
          <Text style={[styles.participantName, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {participant?.full_name ?? "Loading..."}
          </Text>
          {p?.ndis_number ? (
            <Text style={[styles.ndisNumber, { fontFamily: "Inter_400Regular" }]}>
              NDIS #{p.ndis_number as string}
            </Text>
          ) : null}
          <View style={styles.chipRow}>
            <View style={[styles.supportChip, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Text style={[styles.supportChipText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                {session?.session_type ?? "Core Support"}
              </Text>
            </View>
          </View>
          {participantAddress ? (
            <View style={styles.locationRow}>
              <Feather name="map-pin" size={13} color={colors.mutedForeground} />
              <Text style={[styles.locationText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {participantAddress}
              </Text>
            </View>
          ) : null}
        </View>

        {/* TIMER BAR — compact, not hero */}
        <View style={[styles.timerBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <View>
            <Text style={[styles.timerBarLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
              ELAPSED
            </Text>
            <Text style={[styles.timerCompact, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              {formatTimer(elapsedSeconds)}
            </Text>
          </View>
          <Pressable
            onPress={handleStartStop}
            style={[styles.timerToggleBtn, { backgroundColor: isRunning ? "#FEE2E2" : "#DCFCE7" }]}
            testID="session-start-stop"
          >
            <Feather name={isRunning ? "pause" : "play"} size={16} color={isRunning ? "#DC2626" : "#16A34A"} />
            <Text style={[styles.timerToggleText, { color: isRunning ? "#DC2626" : "#16A34A", fontFamily: "Inter_600SemiBold" }]}>
              {isRunning ? "Pause" : "Start"}
            </Text>
          </Pressable>
        </View>

        {/* HEALTH & RESTRICTIONS — prominent red block */}
        {hasHealthInfo && (
          <View style={styles.restrictionBlock}>
            <Text style={[styles.restrictionTitle, { fontFamily: "Inter_700Bold" }]}>
              ⚠ HEALTH & RESTRICTIONS
            </Text>
            {p?.primary_disability ? (
              <Text style={[styles.restrictionBody, { fontFamily: "Inter_500Medium" }]}>
                {p.primary_disability as string}
              </Text>
            ) : null}
            {p?.allergies ? (
              <Text style={[styles.restrictionBody, { fontFamily: "Inter_500Medium" }]}>
                Allergies: {p.allergies as string}
              </Text>
            ) : null}
            {p?.restrictions ? (
              <Text style={[styles.restrictionBody, { fontFamily: "Inter_500Medium" }]}>
                {p.restrictions as string}
              </Text>
            ) : null}
            {p?.health_alerts ? (
              <Text style={[styles.restrictionBody, { fontFamily: "Inter_500Medium" }]}>
                {p.health_alerts as string}
              </Text>
            ) : null}
          </View>
        )}

        {/* GOALS */}
        {goals.length > 0 && (
          <View style={[styles.sectionBlock, { borderBottomColor: colors.border }]}>
            <Text style={[styles.sectionLabel, { fontFamily: "Inter_600SemiBold" }]}>
              GOALS FOR THIS SHIFT
            </Text>
            {goals.slice(0, 5).map((goal, i) => (
              <View key={i} style={styles.goalRow}>
                <Text style={styles.goalBullet}>•</Text>
                <Text style={[styles.goalText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                  {goal.goal_text}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* ACTIVITIES */}
        <View style={[styles.sectionBlock, { borderBottomColor: colors.border }]}>
          <Text style={[styles.sectionLabel, { fontFamily: "Inter_600SemiBold" }]}>
            ACTIVITIES PERFORMED
          </Text>
          <View style={styles.activitiesGrid}>
            {ACTIVITIES.map((activity) => {
              const selected = activities.includes(activity.id);
              return (
                <Pressable
                  key={activity.id}
                  onPress={() => handleToggleActivity(activity.id)}
                  style={[
                    styles.activityChip,
                    {
                      backgroundColor: selected ? colors.primary + "20" : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  testID={`activity-${activity.id}`}
                >
                  <Feather
                    name={activity.icon as ComponentProps<typeof Feather>["name"]}
                    size={13}
                    color={selected ? colors.primary : colors.mutedForeground}
                  />
                  <Text
                    style={[
                      styles.activityLabel,
                      {
                        color: selected ? colors.primary : colors.foreground,
                        fontFamily: selected ? "Inter_600SemiBold" : "Inter_400Regular",
                      },
                    ]}
                  >
                    {activity.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* SHIFT NOTES — always open, no modal */}
        <View style={[styles.sectionBlock, { borderBottomColor: colors.border }]}>
          <ShiftCompliancePanel
            notes={[notes, ...voiceNotes].filter(Boolean).join("\n")}
            participantFirstName={participant?.full_name?.split(" ")[0]}
            activitiesCount={activities.length}
          />
          <Text style={[styles.sectionLabel, { fontFamily: "Inter_600SemiBold" }]}>
            SHIFT NOTES
          </Text>
          <TextInput
            style={[
              styles.notesInput,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.card,
                fontFamily: "Inter_400Regular",
              },
            ]}
            multiline
            placeholder="Describe the session — participant responses, goals addressed, observations..."
            placeholderTextColor={colors.mutedForeground}
            value={notes}
            onChangeText={setNotes}
            textAlignVertical="top"
            testID="shift-notes-input"
          />

          {/* Evidence capture */}
          <View style={styles.evidenceRow}>
            <Pressable
              onPress={handleVoiceRecord}
              style={[
                styles.evidenceBtn,
                {
                  backgroundColor: isRecording ? "#FEE2E2" : colors.muted,
                  borderColor: isRecording ? "#DC2626" : colors.border,
                },
              ]}
              testID="voice-record-btn"
            >
              <Feather
                name={isRecording ? "square" : "mic"}
                size={15}
                color={isRecording ? "#DC2626" : colors.mutedForeground}
              />
              <Text style={[styles.evidenceBtnText, { color: isRecording ? "#DC2626" : colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                {isRecording ? "Stop" : voiceNotes.length > 0 ? `Voice (${voiceNotes.length})` : "Voice note"}
              </Text>
            </Pressable>
            <Pressable
              onPress={handleTakePhoto}
              style={[styles.evidenceBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
              testID="photo-btn"
            >
              <Feather name="camera" size={15} color={colors.mutedForeground} />
              <Text style={[styles.evidenceBtnText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                {photos.length > 0 ? `Photos (${photos.length})` : "Add photo"}
              </Text>
            </Pressable>
          </View>

          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.photosRow}>
                {photos.map((uri, i) => (
                  <Image key={i} source={{ uri }} style={styles.photoThumb} contentFit="cover" />
                ))}
              </View>
            </ScrollView>
          )}

          {voiceNotes.length > 0 && (
            <View style={styles.voiceNotesList}>
              {voiceNotes.map((note, i) => (
                <View key={i} style={[styles.voiceNoteItem, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <Feather name="mic" size={13} color={colors.primary} />
                  <Text style={[styles.voiceNoteText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                    {note}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* STICKY FOOTER — Incident + End Shift */}
      <View
        style={[
          styles.stickyFooter,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 12,
          },
        ]}
      >
        <Pressable
          onPress={() => setIncidentOpen(true)}
          style={[styles.incidentBtn, { borderColor: "#DC2626" }]}
        >
          <Feather name="alert-triangle" size={15} color="#DC2626" />
          <Text style={[styles.incidentBtnText, { fontFamily: "Inter_600SemiBold" }]}>
            Report Incident
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            setShowCompleteModal(true);
          }}
          style={[styles.endShiftBtn, { backgroundColor: colors.foreground }]}
          testID="complete-session-btn"
        >
          <Feather name="check-circle" size={15} color="#FFFFFF" />
          <Text style={[styles.endShiftBtnText, { fontFamily: "Inter_700Bold" }]}>
            End Shift
          </Text>
        </Pressable>
      </View>

      {/* REPORT INCIDENT — in-place sheet, session stays live underneath */}
      <Modal
        visible={incidentOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setIncidentOpen(false)}
      >
        {incidentOpen && (
          <WorkerMobileIncidentSheet
            participantId={session?.participant_id}
            participantName={participant?.full_name}
            sessionId={id}
            onFiled={() => setIncidentOpen(false)}
            onClose={() => setIncidentOpen(false)}
          />
        )}
      </Modal>

      {/* END SHIFT CONFIRMATION MODAL */}
      <Modal
        visible={showCompleteModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCompleteModal(false)}
      >
        <View style={styles.completeOverlay}>
          <View style={[styles.completeModal, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="check-circle" size={40} color={colors.primary} />
            <Text style={[styles.completeTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              End Shift?
            </Text>
            <Text style={[styles.completeSummary, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {formatTimer(elapsedSeconds)} · {activities.length} activities
              {voiceNotes.length > 0 ? ` · ${voiceNotes.length} voice notes` : ""}
              {photos.length > 0 ? ` · ${photos.length} photos` : ""}
            </Text>
            <Text style={[styles.completeInfo, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              Compliance score: {endShiftCompliance.score}/100
              {endShiftCompliance.rules.some((r) => r.status === "fail")
                ? " — unresolved flags will notify your coordinator."
                : " — notes will be analysed automatically."}
            </Text>
            <View style={styles.completeActions}>
              <Pressable
                onPress={() => setShowCompleteModal(false)}
                style={[styles.cancelCompleteBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.cancelCompleteText, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                  Keep Going
                </Text>
              </Pressable>
              <Pressable
                onPress={handleComplete}
                disabled={isSaving}
                style={[styles.confirmCompleteBtn, { backgroundColor: colors.primary }]}
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text style={[styles.confirmCompleteText, { fontFamily: "Inter_700Bold" }]}>
                    Save & Analyse
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  container: { flex: 1 },

  simpleHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: 4, marginRight: 2 },
  headerName: { flex: 1, fontSize: 16 },
  liveStatusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  liveLabel: { fontSize: 11, letterSpacing: 0.5 },

  scrollView: { flex: 1 },

  participantBlock: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 20,
    gap: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  participantName: { fontSize: 28, letterSpacing: -0.5 },
  ndisNumber: { fontSize: 13, color: "#9CA3AF" },
  chipRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  supportChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  supportChipText: { fontSize: 12 },
  locationRow: { flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: 2 },
  locationText: { flex: 1, fontSize: 13 },

  timerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  timerBarLabel: { fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 2 },
  timerCompact: { fontSize: 22, letterSpacing: -0.5, fontVariant: ["tabular-nums"] },
  timerToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  timerToggleText: { fontSize: 14 },

  restrictionBlock: {
    marginHorizontal: 16,
    marginTop: 16,
    borderLeftWidth: 4,
    borderLeftColor: "#DC2626",
    backgroundColor: "#FEF2F2",
    padding: 14,
    borderRadius: 4,
    gap: 6,
  },
  restrictionTitle: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#DC2626",
  },
  restrictionBody: { fontSize: 14, color: "#7F1D1D", lineHeight: 20 },

  sectionBlock: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#9CA3AF",
  },

  goalRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  goalBullet: { fontSize: 15, color: "#9CA3AF", marginTop: 1 },
  goalText: { flex: 1, fontSize: 15, lineHeight: 22 },

  activitiesGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  activityChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  activityLabel: { fontSize: 13 },

  notesInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    lineHeight: 22,
    minHeight: 120,
  },
  evidenceRow: { flexDirection: "row", gap: 8 },
  evidenceBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
  },
  evidenceBtnText: { fontSize: 13 },
  photosRow: { flexDirection: "row", gap: 8 },
  photoThumb: { width: 72, height: 72, borderRadius: 8 },
  voiceNotesList: { gap: 6 },
  voiceNoteItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  voiceNoteText: { flex: 1, fontSize: 13 },

  stickyFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  incidentBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 52,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  incidentBtnText: { fontSize: 14, color: "#DC2626" },
  endShiftBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 52,
    borderRadius: 10,
  },
  endShiftBtnText: { fontSize: 14, color: "#FFFFFF" },

  completeOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  completeModal: {
    width: "100%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 28,
    paddingBottom: 48,
    alignItems: "center",
    gap: 12,
  },
  completeTitle: { fontSize: 22 },
  completeSummary: { fontSize: 15, textAlign: "center" },
  completeInfo: { fontSize: 13, textAlign: "center", lineHeight: 18, marginTop: 4 },
  completeActions: { flexDirection: "row", gap: 12, marginTop: 8, width: "100%" },
  cancelCompleteBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  cancelCompleteText: { fontSize: 15 },
  confirmCompleteBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  confirmCompleteText: { fontSize: 15, color: "#FFFFFF" },
});
