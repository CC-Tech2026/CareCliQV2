import { Feather } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import * as Haptics from "@/lib/haptics";
import * as ImagePicker from "expo-image-picker";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { buildAttachmentFileName, newClientNoteId, SESSION_NOTE_MAX } from "@/lib/shift-utils";

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

type VoiceRecordingControls = {
  save: () => Promise<void>;
  cancel: () => Promise<void>;
};

/**
 * Owns useAudioRecorder only while mounted so the native shared object
 * is never accessed after expo-audio releases it (common crash on Android).
 */
function ActiveVoiceRecording({
  color,
  mutedColor,
  controlsRef,
  onEnded,
  onSave,
}: {
  color: string;
  mutedColor: string;
  controlsRef: React.MutableRefObject<VoiceRecordingControls | null>;
  onEnded: () => void;
  onSave: (secs: number, uri: string | null) => void | Promise<void>;
}) {
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recordSecs, setRecordSecs] = useState(0);
  const recordSecsRef = useRef(0);
  const finishedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const finish = async (save: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    stopTimer();
    let uri: string | null = null;
    try {
      await audioRecorder.stop();
      uri = audioRecorder.uri ?? null;
    } catch {
      /* already released / already stopped */
    }
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      /* ignore */
    }
    const secs = recordSecsRef.current;
    if (save) await onSave(secs, uri);
    else onEnded();
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted || cancelled) {
          onEnded();
          return;
        }
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
        if (cancelled) return;
        await audioRecorder.prepareToRecordAsync();
        if (cancelled || finishedRef.current) return;
        audioRecorder.record();
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        timerRef.current = setInterval(() => {
          setRecordSecs((s) => {
            const next = s + 1;
            recordSecsRef.current = next;
            return next;
          });
        }, 1000);
      } catch {
        if (!cancelled) onEnded();
      }
    })();

    return () => {
      cancelled = true;
      stopTimer();
      if (!finishedRef.current) {
        finishedRef.current = true;
        try {
          audioRecorder.stop();
        } catch {
          /* released on unmount */
        }
        void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      }
    };
    // Recorder is tied to this component's mount lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    controlsRef.current = {
      save: () => finish(true),
      cancel: async () => {
        await finish(false);
        Haptics.selectionAsync();
      },
    };
    return () => {
      controlsRef.current = null;
    };
  });

  return (
    <View style={[styles.recordingBox, { borderColor: color + "66", backgroundColor: color + "18" }]}>
      <RecordingWave color={color} />
      <Text style={[styles.recordingText, { color, fontFamily: "Inter_600SemiBold" }]}>
        Recording… {formatDuration(recordSecs)}
      </Text>
      <Pressable
        onPress={() => {
          void controlsRef.current?.cancel();
        }}
        hitSlop={8}
        style={styles.cancelBtn}
      >
        <Text style={[styles.cancelText, { color: mutedColor, fontFamily: "Inter_600SemiBold" }]}>
          Cancel
        </Text>
      </Pressable>
    </View>
  );
}

type Props = {
  sessionId?: string | null;
  taskId?: string | null;
  taskLabel?: string;
  participantName?: string;
  disabled?: boolean;
  onNoteSaved?: (note: SessionNoteRecord) => void;
};

export function WorkerMobileComposer({
  sessionId,
  taskId,
  taskLabel,
  participantName,
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
  const voiceControlsRef = useRef<VoiceRecordingControls | null>(null);

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

  const startRecording = async () => {
    if (disabledInput || recording) return;
    const perm = await AudioModule.requestRecordingPermissionsAsync().catch(() => null);
    if (!perm?.granted) return;
    setRecording(true);
  };

  const handleVoiceEnded = () => setRecording(false);

  const handleVoiceSave = async (secs: number, uri: string | null) => {
    setRecording(false);
    if (!uri || secs < 1) return;
    await saveNote(`[Voice note · ${formatDuration(secs)}]`, "voice", "voice-note.m4a");
  };

  const handleAttach = async () => {
    if (disabled || submitting) return;
    if (!taskId) {
      Alert.alert("Select a task", "Select a task above before attaching a file.");
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        quality: 0.7,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (asset) {
        const name = buildAttachmentFileName({
          participantName,
          taskTitle: taskLabel,
          originalName: asset.fileName ?? "attachment.jpg",
        });
        await saveNote(`[Attachment: ${name}]`, "file", name);
      }
    } catch (err) {
      Alert.alert(
        "Attachment failed",
        err instanceof Error ? err.message : "Could not open the photo library.",
      );
    }
  };

  const handleCamera = async () => {
    if (disabled || submitting) return;
    if (!taskId) {
      Alert.alert("Select a task", "Select a task above before taking a photo note.");
      return;
    }
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          "Camera permission needed",
          "Allow CareCliQ to use the camera so you can attach photo evidence to session notes.",
        );
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        quality: 0.7,
        allowsEditing: false,
        exif: false,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (asset) {
        const name = buildAttachmentFileName({
          participantName,
          taskTitle: taskLabel,
          originalName: asset.fileName ?? "photo.jpg",
        });
        await saveNote(`[Attachment: ${name}]`, "photo", name);
      }
    } catch (err) {
      Alert.alert(
        "Camera failed",
        err instanceof Error ? err.message : "Could not open the camera.",
      );
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
          <ActiveVoiceRecording
            color={colors.composerPink}
            mutedColor={colors.mutedForeground}
            controlsRef={voiceControlsRef}
            onEnded={handleVoiceEnded}
            onSave={handleVoiceSave}
          />
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
            <Pressable onPress={handleAttach} disabled={disabled || submitting} style={styles.iconBtn}>
              <Feather name="paperclip" size={17} color={colors.mutedForeground} />
            </Pressable>
            <Pressable onPress={handleCamera} disabled={disabled || submitting} style={styles.iconBtn}>
              <Feather name="camera" size={17} color={colors.mutedForeground} />
            </Pressable>
          </View>
        )}

        <Pressable
          onPress={() => {
            if (recording) {
              void voiceControlsRef.current?.save();
              return;
            }
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
