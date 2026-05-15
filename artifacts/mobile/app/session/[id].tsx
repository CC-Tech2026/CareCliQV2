import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import type { Audio } from "expo-av";
import {
  useGetParticipant,
  useGetSession,
  useUpdateSession,
  useSaveSessionWithAI,
} from "@workspace/api-client-react";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
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
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";

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

function PulsingDot({ active }: { active: boolean }) {
  const colors = useColors();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (active) {
      scale.value = withRepeat(
        withSequence(withTiming(1.4, { duration: 600 }), withTiming(1, { duration: 600 })),
        -1,
        false
      );
    } else {
      scale.value = withTiming(1);
    }
  }, [active, scale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        animStyle,
        styles.liveDot,
        { backgroundColor: active ? colors.accent : colors.mutedForeground },
      ]}
    />
  );
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
  const [showNotesModal, setShowNotesModal] = useState(false);

  const recordingRef = useRef<InstanceType<typeof Audio.Recording> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      if (recordingRef.current) {
        try {
          await recordingRef.current.stopAndUnloadAsync();
          const uri = recordingRef.current.getURI();
          const noteText = `Voice note ${voiceNotes.length + 1} — ${new Date().toLocaleTimeString()} (${uri ? "recorded" : "failed"})`;
          setVoiceNotes((prev) => [...prev, noteText]);
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } catch {
          setVoiceNotes((prev) => [...prev, `Voice note ${voiceNotes.length + 1}`]);
        }
        recordingRef.current = null;
      }
    } else {
      try {
        const { Audio } = await import("expo-av");
        const { status } = await Audio.requestPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission needed", "Microphone access is required for voice notes.");
          return;
        }
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
        const { recording } = await Audio.Recording.createAsync(
          Audio.RecordingOptionsPresets.HIGH_QUALITY
        );
        recordingRef.current = recording;
        setIsRecording(true);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {
        Alert.alert("Error", "Could not start recording. Please try again.");
      }
    }
  }, [isRecording, voiceNotes.length]);

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
          [{ text: "OK", onPress: () => router.replace("/(tabs)") }]
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
      router.replace("/(tabs)");
    } catch {
      Alert.alert("Error", "Failed to save session. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }, [id, notes, activities, elapsedSeconds, session, isOnline, queueNoteUpdate, updateSession, saveWithAI, router]);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  if (sessionLoading || participantLoading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.navy }]}>
        <ActivityIndicator color="#FFFFFF" size="large" />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <View
        style={[
          styles.sessionHeader,
          {
            paddingTop: topPad + 8,
            backgroundColor: colors.navy,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={styles.backBtn}
          testID="session-back"
        >
          <Feather name="chevron-left" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text
            style={[styles.participantHeaderName, { fontFamily: "Inter_700Bold" }]}
            numberOfLines={1}
          >
            {participant?.full_name ?? "Loading..."}
          </Text>
          <Text style={[styles.sessionTypeLabel, { fontFamily: "Inter_400Regular" }]}>
            {session?.session_type ?? "Session"}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <PulsingDot active={isRunning} />
          <Text style={[styles.statusLabel, { fontFamily: "Inter_600SemiBold" }]}>
            {isRunning ? "LIVE" : "PAUSED"}
          </Text>
        </View>
      </View>

      <View style={[styles.timerSection, { backgroundColor: colors.navy }]}>
        <Text style={[styles.timerText, { fontFamily: "Inter_700Bold" }]}>
          {formatTimer(elapsedSeconds)}
        </Text>
        <Pressable
          onPress={handleStartStop}
          style={[
            styles.startStopBtn,
            {
              backgroundColor: isRunning ? colors.accent : colors.primary,
            },
          ]}
          testID="session-start-stop"
        >
          <Feather
            name={isRunning ? "pause" : "play"}
            size={20}
            color="#FFFFFF"
          />
          <Text style={[styles.startStopText, { fontFamily: "Inter_600SemiBold" }]}>
            {isRunning ? "Pause" : "Start"}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: insets.bottom + 100 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.section}>
          <Text
            style={[
              styles.sectionTitle,
              { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" },
            ]}
          >
            ACTIVITIES
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
                      backgroundColor: selected
                        ? colors.primary + "20"
                        : colors.card,
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                  testID={`activity-${activity.id}`}
                >
                  <Feather
                    name={activity.icon as ComponentProps<typeof Feather>["name"]}
                    size={14}
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

        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" },
              ]}
            >
              CLINICAL NOTES
            </Text>
            <Pressable
              onPress={() => setShowNotesModal(true)}
              style={[styles.expandBtn, { backgroundColor: colors.muted }]}
            >
              <Feather name="maximize-2" size={14} color={colors.mutedForeground} />
            </Pressable>
          </View>
          <Pressable
            onPress={() => setShowNotesModal(true)}
            style={[
              styles.notesPreview,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.notesPreviewText,
                {
                  color: notes ? colors.foreground : colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                },
              ]}
              numberOfLines={4}
            >
              {notes || "Tap to add clinical notes..."}
            </Text>
          </Pressable>
        </View>

        {voiceNotes.length > 0 && (
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" },
              ]}
            >
              VOICE NOTES ({voiceNotes.length})
            </Text>
            <View style={styles.voiceNotesList}>
              {voiceNotes.map((note, i) => (
                <View
                  key={i}
                  style={[
                    styles.voiceNoteItem,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <Feather name="mic" size={14} color={colors.primary} />
                  <Text
                    style={[
                      styles.voiceNoteText,
                      { color: colors.foreground, fontFamily: "Inter_400Regular" },
                    ]}
                  >
                    {note}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {photos.length > 0 && (
          <View style={styles.section}>
            <Text
              style={[
                styles.sectionTitle,
                { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" },
              ]}
            >
              PHOTOS ({photos.length})
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.photosRow}>
                {photos.map((uri, i) => (
                  <Image
                    key={i}
                    source={{ uri }}
                    style={styles.photoThumb}
                    contentFit="cover"
                  />
                ))}
              </View>
            </ScrollView>
          </View>
        )}
      </ScrollView>

      <View
        style={[
          styles.actionBar,
          {
            backgroundColor: colors.card,
            borderTopColor: colors.border,
            paddingBottom: insets.bottom + 8,
          },
        ]}
      >
        <Pressable
          onPress={handleVoiceRecord}
          style={[
            styles.actionBtn,
            {
              backgroundColor: isRecording
                ? colors.destructive + "20"
                : colors.muted,
              borderColor: isRecording ? colors.destructive : "transparent",
              borderWidth: 1,
            },
          ]}
          testID="voice-record-btn"
        >
          <Feather
            name={isRecording ? "square" : "mic"}
            size={22}
            color={isRecording ? colors.destructive : colors.foreground}
          />
          <Text
            style={[
              styles.actionBtnLabel,
              {
                color: isRecording ? colors.destructive : colors.foreground,
                fontFamily: "Inter_500Medium",
              },
            ]}
          >
            {isRecording ? "Stop" : "Voice"}
          </Text>
        </Pressable>

        <Pressable
          onPress={handleTakePhoto}
          style={[styles.actionBtn, { backgroundColor: colors.muted }]}
          testID="photo-btn"
        >
          <Feather name="camera" size={22} color={colors.foreground} />
          <Text
            style={[
              styles.actionBtnLabel,
              { color: colors.foreground, fontFamily: "Inter_500Medium" },
            ]}
          >
            Photo
          </Text>
        </Pressable>

        <Pressable
          onPress={() => setShowNotesModal(true)}
          style={[styles.actionBtn, { backgroundColor: colors.muted }]}
          testID="notes-btn"
        >
          <Feather name="edit-3" size={22} color={colors.foreground} />
          <Text
            style={[
              styles.actionBtnLabel,
              { color: colors.foreground, fontFamily: "Inter_500Medium" },
            ]}
          >
            Notes
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            setShowCompleteModal(true);
          }}
          style={[styles.completeBtn, { backgroundColor: colors.primary }]}
          testID="complete-session-btn"
        >
          <Feather name="check-circle" size={20} color="#FFFFFF" />
          <Text
            style={[styles.completeBtnText, { fontFamily: "Inter_700Bold" }]}
          >
            Complete
          </Text>
        </Pressable>
      </View>

      <Modal
        visible={showNotesModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowNotesModal(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Pressable onPress={() => setShowNotesModal(false)}>
              <Text
                style={[
                  styles.modalCancel,
                  { color: colors.mutedForeground, fontFamily: "Inter_500Medium" },
                ]}
              >
                Cancel
              </Text>
            </Pressable>
            <Text
              style={[
                styles.modalTitle,
                { color: colors.foreground, fontFamily: "Inter_700Bold" },
              ]}
            >
              Clinical Notes
            </Text>
            <Pressable onPress={() => setShowNotesModal(false)}>
              <Text
                style={[
                  styles.modalDone,
                  { color: colors.primary, fontFamily: "Inter_600SemiBold" },
                ]}
              >
                Done
              </Text>
            </Pressable>
          </View>
          <TextInput
            style={[
              styles.notesTextarea,
              {
                color: colors.foreground,
                fontFamily: "Inter_400Regular",
                backgroundColor: colors.card,
              },
            ]}
            multiline
            placeholder="Enter detailed clinical notes here..."
            placeholderTextColor={colors.mutedForeground}
            value={notes}
            onChangeText={setNotes}
            textAlignVertical="top"
            autoFocus
            testID="clinical-notes-input"
          />
        </View>
      </Modal>

      <Modal
        visible={showCompleteModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowCompleteModal(false)}
      >
        <View style={styles.completeOverlay}>
          <View
            style={[
              styles.completeModal,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Feather name="check-circle" size={40} color={colors.primary} />
            <Text
              style={[
                styles.completeTitle,
                { color: colors.foreground, fontFamily: "Inter_700Bold" },
              ]}
            >
              Complete Session?
            </Text>
            <Text
              style={[
                styles.completeSummary,
                { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
              ]}
            >
              {formatTimer(elapsedSeconds)} · {activities.length} activities
              {voiceNotes.length > 0 ? ` · ${voiceNotes.length} voice notes` : ""}
              {photos.length > 0 ? ` · ${photos.length} photos` : ""}
            </Text>
            <Text
              style={[
                styles.completeInfo,
                { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
              ]}
            >
              AI analysis will run automatically and generate clinical insights
              for NDIS compliance.
            </Text>
            <View style={styles.completeActions}>
              <Pressable
                onPress={() => setShowCompleteModal(false)}
                style={[
                  styles.cancelCompleteBtn,
                  { borderColor: colors.border },
                ]}
              >
                <Text
                  style={[
                    styles.cancelCompleteText,
                    { color: colors.foreground, fontFamily: "Inter_500Medium" },
                  ]}
                >
                  Keep Going
                </Text>
              </Pressable>
              <Pressable
                onPress={handleComplete}
                disabled={isSaving}
                style={[
                  styles.confirmCompleteBtn,
                  { backgroundColor: colors.primary },
                ]}
              >
                {isSaving ? (
                  <ActivityIndicator color="#FFF" size="small" />
                ) : (
                  <Text
                    style={[
                      styles.confirmCompleteText,
                      { fontFamily: "Inter_700Bold" },
                    ]}
                  >
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
  sessionHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 14,
    gap: 12,
  },
  backBtn: { padding: 4 },
  headerCenter: { flex: 1 },
  participantHeaderName: {
    fontSize: 17,
    color: "#FFFFFF",
  },
  sessionTypeLabel: { fontSize: 13, color: "rgba(255,255,255,0.65)", marginTop: 1 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, color: "#FFFFFF", letterSpacing: 0.8 },
  timerSection: {
    alignItems: "center",
    paddingVertical: 20,
    paddingBottom: 28,
    gap: 14,
  },
  timerText: {
    fontSize: 56,
    color: "#FFFFFF",
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
  },
  startStopBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 30,
  },
  startStopText: { fontSize: 16, color: "#FFFFFF" },
  scrollView: { flex: 1 },
  scrollContent: { padding: 16, gap: 20 },
  section: { gap: 10 },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 11, letterSpacing: 0.8 },
  expandBtn: { width: 28, height: 28, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  activitiesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  activityChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  activityLabel: { fontSize: 13 },
  notesPreview: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    minHeight: 80,
  },
  notesPreviewText: { fontSize: 14, lineHeight: 20 },
  voiceNotesList: { gap: 6 },
  voiceNoteItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  voiceNoteText: { flex: 1, fontSize: 13 },
  photosRow: { flexDirection: "row", gap: 8 },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: 8,
  },
  actionBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  actionBtn: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 12,
    gap: 4,
  },
  actionBtnLabel: { fontSize: 11 },
  completeBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    gap: 6,
  },
  completeBtnText: { fontSize: 15, color: "#FFFFFF" },
  modalContainer: { flex: 1 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingTop: 60,
  },
  modalCancel: { fontSize: 16 },
  modalTitle: { fontSize: 17 },
  modalDone: { fontSize: 16 },
  notesTextarea: {
    flex: 1,
    padding: 16,
    fontSize: 16,
    lineHeight: 24,
  },
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
