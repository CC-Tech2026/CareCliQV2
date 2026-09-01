import { Feather } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
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
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/lib/alert";
import type { SessionNoteRecord, SessionNoteType } from "@/lib/worker-api";
import { syncSessionNotes, translateNoteToEnglish, transcribeSessionAudio, uploadSessionAttachment } from "@/lib/worker-api";
import { buildAttachmentFileName, newClientNoteId, SESSION_NOTE_MAX } from "@/lib/shift-utils";
import { checkDraftNoteHints, type DraftNoteHint } from "@workspace/worker-compliance";

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

export type VoiceRecordingControls = {
  save: () => Promise<void>;
  cancel: () => Promise<void>;
};

/**
 * Owns useAudioRecorder only while mounted so the native shared object
 * is never accessed after expo-audio releases it (common crash on Android).
 * Exported so other shift-scoped voice-capture entry points (e.g. PRN medication
 * reason/effect fields) can reuse the same recording pipeline instead of duplicating it.
 */
export function ActiveVoiceRecording({
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
  const recorderState = useAudioRecorderState(audioRecorder, 500);
  const [recordSecs, setRecordSecs] = useState(0);
  const recordSecsRef = useRef(0);
  const finishedRef = useRef(false);
  const startedRef = useRef(false);
  const resumeAttemptedRef = useRef(false);
  const wasInterruptedRef = useRef(false);
  const sawRecordingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onSaveRef = useRef(onSave);
  const onEndedRef = useRef(onEnded);
  onSaveRef.current = onSave;
  onEndedRef.current = onEnded;

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const finishRef = useRef<(save: boolean) => Promise<void>>(async () => undefined);
  finishRef.current = async (save: boolean) => {
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
    if (save) {
      if (wasInterruptedRef.current) {
        showAlert(
          "Recording interrupted",
          "Something interrupted the recording (e.g. a phone call). What was captured up to that point has been saved - review it and add anything you missed.",
        );
      }
      await onSaveRef.current(secs, uri);
    } else {
      onEndedRef.current();
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted || cancelled) {
          onEndedRef.current();
          return;
        }
        // allowsBackgroundRecording matters here specifically: without it, the
        // recording is silently torn down the moment the screen locks or the
        // worker briefly switches apps (both routine mid-shift interruptions) -
        // the single biggest real-world cause of a recording getting cut off.
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true });
        if (cancelled) return;
        await audioRecorder.prepareToRecordAsync();
        if (cancelled || finishedRef.current) return;
        audioRecorder.record();
        startedRef.current = true;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        timerRef.current = setInterval(() => {
          setRecordSecs((s) => {
            const next = s + 1;
            recordSecsRef.current = next;
            return next;
          });
        }, 1000);
      } catch {
        if (!cancelled) onEndedRef.current();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Detects a genuine system interruption (a phone call, Siri, the OS
  // reclaiming the mic - mediaServicesDidReset is expo-audio's documented
  // signal for exactly this) and tries once to resume automatically, rather
  // than letting the recording just silently die. If resuming doesn't stick,
  // finalize with whatever was captured instead of discarding it - the
  // worker is told, not left guessing why their note looks short.
  useEffect(() => {
    if (!startedRef.current || finishedRef.current || !timerRef.current) return;
    // Don't trust a "not recording" reading until the poller has confirmed
    // recording actually started at least once - the poll and record() are
    // on independent timers, so right at startup a stale/early tick could
    // otherwise look identical to a genuine interruption.
    if (recorderState.isRecording) sawRecordingRef.current = true;
    if (!sawRecordingRef.current) return;
    const interrupted = recorderState.mediaServicesDidReset || !recorderState.isRecording;
    if (!interrupted) {
      resumeAttemptedRef.current = false;
      return;
    }
    if (resumeAttemptedRef.current) return;
    resumeAttemptedRef.current = true;
    wasInterruptedRef.current = true;

    (async () => {
      try {
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, allowsBackgroundRecording: true });
        audioRecorder.record();
      } catch {
        /* checked below regardless */
      }
      await new Promise((resolve) => setTimeout(resolve, 800));
      if (finishedRef.current) return;
      if (audioRecorder.isRecording) {
        resumeAttemptedRef.current = false;
      } else {
        void finishRef.current(true);
      }
    })();
  }, [recorderState.isRecording, recorderState.mediaServicesDidReset, audioRecorder]);

  useEffect(() => {
    controlsRef.current = {
      save: () => finishRef.current(true),
      cancel: async () => {
        await finishRef.current(false);
        Haptics.selectionAsync();
      },
    };
    return () => {
      controlsRef.current = null;
    };
  }, [controlsRef]);

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
  const t = useT();
  const { isOnline, queueWorkerUpdate } = useOffline();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [language, setLanguage] = useState<string>("auto");
  const [langOpen, setLangOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const voiceControlsRef = useRef<VoiceRecordingControls | null>(null);
  const [draftHints, setDraftHints] = useState<DraftNoteHint[]>([]);

  const disabledInput = disabled || !taskId;
  const voiceUnavailable = !isOnline;
  const placeholder = taskId
    ? taskLabel ?? "Start typing a note…"
    : "Select a task above to start noting";
  const languageLabel =
    LANGUAGE_OPTIONS.find((o) => o.value === language)?.label ?? "Auto detect";
  const hasText = value.trim().length > 0;
  const showTranslateBadge = hasText && language !== "en";

  // Live, debounced compliance nudge while typing - soft/advisory only (see
  // checkDraftNoteHints' own docstring), so the note already reads as
  // compliant by the time it's actually saved rather than surprising the
  // worker with a warning after the fact. Never blocks typing or sending.
  useEffect(() => {
    if (!hasText) {
      setDraftHints([]);
      return;
    }
    const handle = setTimeout(() => {
      setDraftHints(checkDraftNoteHints(value, participantName?.split(" ")[0]));
    }, 600);
    return () => clearTimeout(handle);
  }, [value, hasText, participantName]);

  const saveNote = async (
    content: string,
    noteType: SessionNoteType = "text",
    fileName?: string,
    attachmentUrls?: string[],
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
      attachment_urls: attachmentUrls,
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
    if (!isOnline) {
      showAlert(
        t("composer.voice.offlineTitle"),
        t("composer.voice.offlineBody"),
      );
      return;
    }
    const perm = await AudioModule.requestRecordingPermissionsAsync().catch(() => null);
    if (!perm?.granted) {
      showAlert(
        "Microphone blocked",
        "Allow microphone access, then try recording again.",
      );
      return;
    }
    setRecording(true);
  };

  const handleVoiceEnded = () => setRecording(false);

  const handleVoiceSave = async (secs: number, uri: string | null) => {
    setRecording(false);
    if (secs < 1) return;

    if (!uri || !sessionId) {
      showAlert(
        "Recording failed",
        "No audio was captured. Please try recording again.",
      );
      return;
    }
    if (!isOnline) {
      showAlert(
        t("composer.voice.offlineTitle"),
        t("composer.voice.offlineBody"),
      );
      return;
    }

    setSubmitting(true);
    try {
      const { transcript } = await transcribeSessionAudio(sessionId, uri);
      const trimmed = String(transcript ?? "").trim();
      if (!trimmed) {
        showAlert(
          "Could not hear that",
          "No speech was detected. Please try recording again.",
        );
        return;
      }
      const english = await toEnglishNote(trimmed, language).catch(() => trimmed);
      await saveNote(english, "voice");
    } catch (err) {
      showAlert(
        "Transcription failed",
        err instanceof Error ? err.message : "Could not convert your voice note to text. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const uploadAndSaveAttachment = async (
    asset: { uri: string; fileName?: string | null; mimeType?: string | null },
    noteType: SessionNoteType,
    fallbackName: string,
  ) => {
    if (!sessionId) return;
    const name = buildAttachmentFileName({
      participantName,
      taskTitle: taskLabel,
      originalName: asset.fileName ?? fallbackName,
    });
    setSubmitting(true);
    try {
      const uploaded = await uploadSessionAttachment(sessionId, {
        uri: asset.uri,
        name,
        type: asset.mimeType ?? (noteType === "photo" ? "image/jpeg" : "application/octet-stream"),
      });
      await saveNote(`[Attachment: ${name}]`, noteType, name, [uploaded.public_url]);
    } catch (err) {
      Alert.alert(
        "Upload failed",
        err instanceof Error ? err.message : "Could not upload the attachment. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleAttach = async () => {
    if (disabled || submitting) return;
    if (!taskId) {
      Alert.alert("Select a task", "Select a task above before attaching a file.");
      return;
    }
    if (!isOnline) {
      Alert.alert("You're offline", "Attachments need a connection to upload. Try again once you're back online.");
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        quality: 0.7,
      });
      const asset = result.canceled ? null : result.assets[0];
      if (asset) {
        await uploadAndSaveAttachment(asset, "file", "attachment.jpg");
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
    if (!isOnline) {
      Alert.alert("You're offline", "Photos need a connection to upload. Try again once you're back online.");
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
        await uploadAndSaveAttachment(asset, "photo", "photo.jpg");
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
          accessibilityState={{ disabled: disabledInput || submitting || (!hasText && voiceUnavailable) }}
          style={[
            styles.roundBtn,
            {
              backgroundColor: recording
                ? colors.destructive
                : hasText
                  ? colors.composerPurple
                  : colors.composerPink,
              opacity: disabledInput || (!hasText && voiceUnavailable) ? 0.45 : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : recording ? (
            <Feather name="send" size={20} color="#FFFFFF" />
          ) : hasText ? (
            <Feather name="arrow-up" size={22} color="#FFFFFF" />
          ) : voiceUnavailable ? (
            <Feather name="wifi-off" size={20} color="#FFFFFF" />
          ) : (
            <Feather name="mic" size={22} color="#FFFFFF" />
          )}
        </Pressable>
      </View>

      {(() => {
        const topHint = !recording
          ? draftHints.find((h) => h.severity === "fail") ?? draftHints[0]
          : undefined;
        // Only the restrictive-practice hint gets a stronger color - everything
        // else stays the same muted tone as the default caption, so it reads
        // as a gentle nudge rather than a warning (less intrusive by design).
        const hintColor = topHint?.severity === "fail" ? colors.destructive : colors.mutedForeground;
        return (
          <Text style={[styles.hint, { color: hintColor, fontFamily: "Inter_500Medium" }]}>
            {topHint
              ? topHint.message
              : !taskId
                ? "Select a task above to start noting."
                : recording
                  ? "Recording… tap send to save, or cancel."
                  : voiceUnavailable && !hasText
                    ? t("composer.voice.offlineHint")
                    : "Hold mic to record · tap to send when typing."}
          </Text>
        );
      })()}

      <Modal visible={langOpen} transparent animationType="slide" onRequestClose={() => setLangOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setLangOpen(false)}>
          <Pressable
            style={[styles.sheetCard, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                Input language
              </Text>
              <Pressable onPress={() => setLangOpen(false)} hitSlop={8}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <View style={styles.sheetBody}>
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
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheetCard: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    marginBottom: 6,
  },
  sheetTitle: { fontSize: 17 },
  sheetBody: { paddingHorizontal: 12, paddingBottom: 8, gap: 2 },
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
