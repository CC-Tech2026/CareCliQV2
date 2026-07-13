import { Feather } from "@expo/vector-icons";
import { Audio } from "expo-av";
import * as Haptics from "@/lib/haptics";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOffline } from "@/context/OfflineContext";
import { useColors } from "@/hooks/useColors";
import type { SessionNoteRecord, SessionNoteType } from "@/lib/worker-api";
import { syncSessionNotes, translateNoteToEnglish } from "@/lib/worker-api";
import { newClientNoteId, SESSION_NOTE_MAX } from "@/lib/shift-utils";

const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "ar", label: "Arabic" },
  { value: "tl", label: "Filipino" },
  { value: "zh", label: "Chinese" },
  { value: "hi", label: "Hindi" },
] as const;

async function toEnglishNote(text: string, language: string): Promise<string> {
  const trimmed = text.trim();
  if (!trimmed) return trimmed;
  const source = language === "auto" ? "auto" : language;
  if (source === "en") return trimmed;
  try {
    const result = await translateNoteToEnglish(trimmed, source);
    const translated = String(result?.translated ?? "").trim();
    if (translated && result?.status !== "failed" && result?.status !== "unsupported") {
      return translated;
    }
  } catch {
    /* fall back to original text */
  }
  return trimmed;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function RecordingWave({ color }: { color: string }) {
  const bars = useRef(
    Array.from({ length: 14 }, () => new Animated.Value(0.3)),
  ).current;

  useEffect(() => {
    const animations = bars.map((bar, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(bar, {
            toValue: 1,
            duration: 300 + (i % 5) * 90,
            useNativeDriver: false,
          }),
          Animated.timing(bar, {
            toValue: 0.3,
            duration: 300 + (i % 5) * 90,
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    animations.forEach((a) => a.start());
    return () => animations.forEach((a) => a.stop());
  }, [bars]);

  return (
    <View style={styles.waveRow}>
      {bars.map((bar, i) => (
        <Animated.View
          key={i}
          style={[
            styles.waveBar,
            {
              backgroundColor: color,
              transform: [{ scaleY: bar }],
            },
          ]}
        />
      ))}
    </View>
  );
}

type Props = {
  sessionId?: string | null;
  taskId?: string | null;
  taskLabel?: string;
  disabled?: boolean;
  onNoteSaved?: (note: SessionNoteRecord) => void;
};

export function WorkerMobileComposer({
  sessionId,
  taskId,
  taskLabel,
  disabled,
  onNoteSaved,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isOnline, queueWorkerUpdate } = useOffline();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [language, setLanguage] = useState<string>("auto");
  const [langOpen, setLangOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(0);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const disabledInput = disabled || !taskId;
  const placeholder = taskId
    ? taskLabel ?? "Start typing a note…"
    : "Select a task above to start noting";
  const languageLabel =
    LANGUAGE_OPTIONS.find((o) => o.value === language)?.label ?? "Auto detect";
  const hasText = value.trim().length > 0;
  const showTranslateBadge = hasText && language !== "en";

  const saveNote = async (
    content: string,
    noteType: SessionNoteType = "text",
    fileName?: string,
  ) => {
    if (!sessionId || !content.trim() || disabled) return;

    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const noteId = newClientNoteId();
    const now = new Date().toISOString();
    const payload: SessionNoteRecord = {
      note_id: noteId,
      session_id: sessionId,
      task_id: taskId ?? undefined,
      content: content.trim().slice(0, SESSION_NOTE_MAX),
      created_at: now,
      auto_saved_at: now,
      note_type: noteType,
      file_name: fileName,
      synced: false,
    };

    onNoteSaved?.(payload);
    setValue("");

    if (!isOnline) {
      await queueWorkerUpdate({
        type: "sync_notes",
        id: noteId,
        sessionId,
        notes: [payload],
        timestamp: Date.now(),
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitting(false);
      return;
    }

    try {
      await syncSessionNotes(sessionId, [payload]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      /* optimistic — note already shown locally */
    } finally {
      setSubmitting(false);
    }
  };

  const handleSend = async () => {
    if (!hasText || disabledInput) return;
    setSubmitting(true);
    const english = await toEnglishNote(value, language).catch(() => value.trim());
    await saveNote(english, "text");
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startRecording = async () => {
    if (disabledInput || recording) return;
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) return;
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      recordingRef.current = rec;
      setRecordSecs(0);
      setRecording(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      timerRef.current = setInterval(() => setRecordSecs((s) => s + 1), 1000);
    } catch {
      setRecording(false);
    }
  };

  const teardownRecording = async () => {
    stopTimer();
    const rec = recordingRef.current;
    recordingRef.current = null;
    setRecording(false);
    if (!rec) return null;
    try {
      await rec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      return rec.getURI();
    } catch {
      return null;
    }
  };

  const cancelRecording = async () => {
    await teardownRecording();
    setRecordSecs(0);
    Haptics.selectionAsync();
  };

  const stopAndSaveRecording = async () => {
    const secs = recordSecs;
    const uri = await teardownRecording();
    setRecordSecs(0);
    if (!uri || secs < 1) return;
    await saveNote(`[Voice note · ${formatDuration(secs)}]`, "voice", "voice-note.m4a");
  };

  useEffect(() => {
    return () => {
      stopTimer();
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  const handleAttach = async () => {
    if (disabledInput) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.All,
      quality: 0.7,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) {
      const name = asset.fileName ?? "attachment";
      await saveNote(`[Attachment: ${name}]`, "file", name);
    }
  };

  const handleCamera = async () => {
    if (disabledInput) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    const asset = result.canceled ? null : result.assets[0];
    if (asset) {
      const name = asset.fileName ?? "photo";
      await saveNote(`[Attachment: ${name}]`, "photo", name);
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={styles.langRow}>
        <Text style={[styles.langLabel, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
          INPUT LANGUAGE
        </Text>
        <View style={styles.langRight}>
          {showTranslateBadge && (
            <View style={[styles.translateBadge, { backgroundColor: colors.activeBg, borderColor: colors.primary + "40" }]}>
              <Feather name="globe" size={13} color={colors.primary} />
              <Text style={[styles.translateBadgeText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                Translate → EN
              </Text>
            </View>
          )}
          <Pressable
            onPress={() => setLangOpen(true)}
            disabled={disabled}
            style={[styles.langPill, { borderColor: colors.border, backgroundColor: colors.background }]}
          >
            <Text style={[styles.langPillText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {languageLabel}
            </Text>
            <Feather name="chevron-right" size={14} color={colors.mutedForeground} />
          </Pressable>
        </View>
      </View>

      <View style={styles.inputRow}>
        {recording ? (
          <View style={[styles.recordingBox, { borderColor: colors.composerPink + "66", backgroundColor: colors.composerPink + "18" }]}>
            <RecordingWave color={colors.composerPink} />
            <Text style={[styles.recordingText, { color: colors.composerPink, fontFamily: "Inter_600SemiBold" }]}>
              Recording… {formatDuration(recordSecs)}
            </Text>
            <Pressable onPress={cancelRecording} hitSlop={8} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={[styles.inputBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <TextInput
              value={value}
              onChangeText={setValue}
              placeholder={placeholder}
              placeholderTextColor={colors.mutedForeground}
              maxLength={SESSION_NOTE_MAX}
              editable={!disabledInput && !submitting}
              style={[styles.input, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
            />
            <Pressable onPress={handleAttach} disabled={disabledInput} style={styles.iconBtn}>
              <Feather name="paperclip" size={17} color={colors.mutedForeground} />
            </Pressable>
            <Pressable onPress={handleCamera} disabled={disabledInput} style={styles.iconBtn}>
              <Feather name="camera" size={17} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}

        <Pressable
          onPress={() => {
            if (recording) return stopAndSaveRecording();
            if (hasText) return handleSend();
            return startRecording();
          }}
          disabled={disabledInput || submitting}
          style={[
            styles.roundBtn,
            {
              backgroundColor: recording
                ? colors.destructive
                : hasText
                  ? colors.composerPurple
                  : colors.composerPink,
              opacity: disabledInput ? 0.5 : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : recording ? (
            <Feather name="send" size={20} color="#FFFFFF" />
          ) : hasText ? (
            <Feather name="arrow-up" size={22} color="#FFFFFF" />
          ) : (
            <Feather name="mic" size={22} color="#FFFFFF" />
          )}
        </Pressable>
      </View>

      <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
        {!taskId
          ? "Select a task above to start noting."
          : recording
            ? "Recording… tap send to save, or cancel."
            : showTranslateBadge
              ? "Hold mic to record · tap to send when typing."
              : "Hold mic to record · tap to send when typing."}
      </Text>

      <Modal visible={langOpen} transparent animationType="fade" onRequestClose={() => setLangOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setLangOpen(false)}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              Input language
            </Text>
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = opt.value === language;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    setLanguage(opt.value);
                    setLangOpen(false);
                  }}
                  style={[styles.langOption, active && { backgroundColor: colors.activeBg }]}
                >
                  <Text
                    style={[
                      styles.langOptionText,
                      { color: active ? colors.primary : colors.foreground, fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular" },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {active ? <Feather name="check" size={16} color={colors.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 8,
  },
  langRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  langLabel: {
    fontSize: 10,
    letterSpacing: 1,
  },
  langRight: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  translateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  translateBadgeText: {
    fontSize: 11,
  },
  langPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  langPillText: {
    fontSize: 12,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inputBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    fontSize: 14,
    paddingVertical: 8,
  },
  recordingBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
  },
  waveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 22,
  },
  waveBar: {
    width: 3,
    height: 20,
    borderRadius: 2,
  },
  recordingText: {
    fontSize: 13,
  },
  cancelBtn: {
    marginLeft: "auto",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  cancelText: {
    fontSize: 13,
  },
  iconBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  roundBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  hint: {
    fontSize: 11,
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 2,
  },
  modalTitle: {
    fontSize: 15,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  langOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  langOptionText: {
    fontSize: 14,
  },
});
