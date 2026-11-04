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
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useOffline } from "@/context/OfflineContext";
import { usePreferences } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/lib/alert";
import { translate, type AppLanguage, type TranslationKey } from "@/lib/i18n/translations";
import {
  NOTE_LANGUAGES,
  loadNoteLanguage,
  noteLanguageNative,
  saveNoteLanguage,
  searchNoteLanguages,
  toEnglishRecord,
  type RecordTranslation,
} from "@/lib/note-languages";
import type { SessionNoteRecord, SessionNoteType } from "@/lib/worker-api";
import {
  improveNote,
  syncSessionNotes,
  translateForWorkerPreview,
  transcribeSessionAudio,
  uploadSessionAttachment,
} from "@/lib/worker-api";
import { buildAttachmentFileName, newClientNoteId, SESSION_NOTE_MAX } from "@/lib/shift-utils";
import { checkDraftNoteHints, nextNotePrompt, type DraftNoteHint, type NotePromptId } from "@workspace/worker-compliance";

type Translator = (key: TranslationKey, params?: Record<string, string | number>) => string;

const HINT_TRANSLATION_KEYS: Partial<Record<string, TranslationKey>> = {
  "word-count": "composer.hint.wordCount",
  "specific-observation": "composer.hint.specificObservation",
  "participant-reference": "composer.hint.participantReference",
  "participant-response": "composer.hint.participantResponse",
};

/**
 * checkDraftNoteHints (shared, locale-agnostic lib) always returns English
 * messages - localized here at the UI layer against the worker's app-wide
 * language preference (the same one every other screen already uses), so a
 * multilingual worker gets note-writing guidance in a language they've
 * already told the app they read comfortably, not just the raw note-input
 * language picker below (which covers more languages than the app has
 * translations for, and only describes the note content, not app chrome).
 */
function localizeHint(hint: DraftNoteHint, t: Translator): string {
  if (hint.id === "restrictive-practice") {
    return t("composer.hint.restrictivePractice", { phrase: hint.phrase ?? "" });
  }
  if (hint.id === "person-first") {
    return t("composer.hint.personFirst", { phrase: hint.phrase ?? "", suggestion: hint.suggestion ?? "" });
  }
  if (hint.id === "subjective-language") {
    return t("composer.hint.subjective", { phrase: hint.phrase ?? "" });
  }
  const key = HINT_TRANSLATION_KEYS[hint.id];
  return key ? t(key) : hint.message;
}

const APP_LANGUAGES: readonly AppLanguage[] = ["en", "vi", "zh", "ar"];

/** The note guide's questions, in the order a compliant note covers them
 * (nextNotePrompt picks the next one), and the sentence starter "Answer"
 * puts in the box for each. */
// The rounded box already shows focus; the browser's outline (web preview
// only) would draw a second rectangle inside it.
const NO_WEB_OUTLINE = Platform.OS === "web" ? ({ outlineStyle: "none", outlineWidth: 0 } as object) : null;

const GUIDE_QUESTIONS: Record<NotePromptId, { question: TranslationKey; starter: TranslationKey }> = {
  did: { question: "composer.guide.did", starter: "composer.prompt.didStarter" },
  response: { question: "composer.guide.response", starter: "composer.prompt.responseStarter" },
  goal: { question: "composer.guide.goal", starter: "composer.prompt.goalStarter" },
  concern: { question: "composer.guide.concern", starter: "composer.prompt.concernStarter" },
};

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
  /** The participant goal this task works toward, for the goal prompt. */
  goalTitle?: string;
  /** This task's saved notes (the English record), so the guide asks about
   * what they don't cover yet. */
  taskNotesText?: string;
  participantName?: string;
  participantId?: string | null;
  disabled?: boolean;
  onNoteSaved?: (note: SessionNoteRecord) => void;
};

export function WorkerMobileComposer({
  sessionId,
  taskId,
  taskLabel,
  goalTitle,
  taskNotesText,
  participantName,
  participantId,
  disabled,
  onNoteSaved,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { t, language: appLanguage } = usePreferences();
  const { isOnline, queueWorkerUpdate } = useOffline();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Defaults to the language the worker runs the app in, then to whatever
  // they last wrote a note in, so a worker who writes in Nepali isn't asked
  // to pick it again on every task.
  const [language, setLanguageState] = useState<string>(appLanguage);
  const setLanguage = (code: string) => {
    setLanguageState(code);
    void saveNoteLanguage(code);
  };
  useEffect(() => {
    let cancelled = false;
    void loadNoteLanguage().then((saved) => {
      if (saved && !cancelled) setLanguageState(saved);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const [langOpen, setLangOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const voiceControlsRef = useRef<VoiceRecordingControls | null>(null);
  const [draftHints, setDraftHints] = useState<DraftNoteHint[]>([]);
  const [suggestion, setSuggestion] = useState<{ text: string; preview?: string; source: "manual" | "auto" } | null>(null);
  const [improving, setImproving] = useState(false);
  const [translatingPreview, setTranslatingPreview] = useState(false);
  const [manualPending, setManualPending] = useState(false);
  const lastAutoSuggestRef = useRef<string>("");
  const autoFiredRef = useRef(false);

  const disabledInput = disabled || !taskId;
  const voiceUnavailable = !isOnline;
  const hasText = value.trim().length > 0;
  // The live checks read English. A note in another language is checked once
  // it has been translated, when it's saved.
  const checksLive = language === "en";
  const firstName = participantName?.split(" ")[0] || undefined;
  const inputRef = useRef<TextInput>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [langSearch, setLangSearch] = useState("");

  // The note guide asks about whatever this task's notes don't cover yet,
  // one question at a time. Skips last until the worker changes task.
  const [skipped, setSkipped] = useState<NotePromptId[]>([]);
  useEffect(() => {
    setSkipped([]);
  }, [taskId]);
  const nextPrompt = nextNotePrompt(taskNotesText ?? "", { hasGoal: !!goalTitle, skipped });
  const promptParams = { name: firstName ?? t("composer.prompt.theParticipant"), goal: goalTitle ?? "" };

  /** A sentence starter in the language the worker is writing in, or null
   * when the app has no translation for that language. */
  const starterFor = (key: TranslationKey) => {
    const inLanguage = language === "auto" ? appLanguage : language;
    if (!(APP_LANGUAGES as readonly string[]).includes(inLanguage)) return null;
    return translate(inLanguage as AppLanguage, key, { name: firstName ?? "", goal: goalTitle ?? "" });
  };
  const answerPrompt = (id: NotePromptId) => {
    const starter = starterFor(GUIDE_QUESTIONS[id].starter);
    Haptics.selectionAsync();
    if (starter) {
      setValue((current) => {
        const trimmed = current.trimEnd();
        return trimmed ? `${trimmed}${/[.!?]$/.test(trimmed) ? "" : "."} ${starter}` : starter;
      });
    }
    inputRef.current?.focus();
  };
  const skipPrompt = (id: NotePromptId) => {
    Haptics.selectionAsync();
    setSkipped((current) => [...current, id]);
  };

  const languageLine =
    language === "en"
      ? t("composer.language.writingInEnglish")
      : t("composer.language.writingIn", { language: language === "auto" ? t("composer.language.auto") : noteLanguageNative(language) });
  const suggestedLanguages = Array.from(new Set([appLanguage, "en", language]));
  const languageResults = searchNoteLanguages(langSearch);

  // Live, debounced compliance nudge while typing - soft/advisory only (see
  // checkDraftNoteHints' own docstring), so the note already reads as
  // compliant by the time it's actually saved rather than surprising the
  // worker with a warning after the fact. Never blocks typing or sending.
  useEffect(() => {
    if (!hasText) {
      setDraftHints([]);
      return;
    }
    if (!checksLive) {
      setDraftHints([]);
      return;
    }
    const handle = setTimeout(() => {
      setDraftHints(checkDraftNoteHints(value, firstName));
    }, 600);
    return () => clearTimeout(handle);
  }, [value, hasText, firstName, checksLive]);

  // Reset any pending suggestion when switching tasks - a suggestion for one
  // task's note has no business appearing against a different task's draft.
  useEffect(() => {
    setSuggestion(null);
    lastAutoSuggestRef.current = "";
    autoFiredRef.current = false;
  }, [taskId]);

  const runImprove = async (text: string, hints: DraftNoteHint[], source: "manual" | "auto") => {
    if (improving) return;
    setImproving(true);
    if (source === "manual") setManualPending(true);
    try {
      const failedRules = hints.length
        ? hints.map((h) => ({ rule: h.id, message: h.message }))
        : [{ rule: "clarity", message: "Make this note more specific and audit-ready." }];
      const result = await improveNote(text, failedRules, participantId);
      const improved = (result?.improved_note || "").trim();
      if (improved && improved !== text.trim()) {
        // Show the English suggestion immediately rather than waiting on the
        // translated preview too - the preview streams in a moment later
        // without blocking the primary suggestion the worker actually acts on.
        setSuggestion({ text: improved, source });
        if (appLanguage !== "en") {
          setTranslatingPreview(true);
          translateForWorkerPreview(improved, appLanguage)
            .then((previewResult) => {
              const translated = previewResult?.translated?.trim();
              if (previewResult?.translated_ok && translated) {
                // Guard against a stale response landing after the worker
                // dismissed/replaced/edited past this suggestion.
                setSuggestion((prev) => (prev && prev.text === improved ? { ...prev, preview: translated } : prev));
              }
            })
            .catch(() => {
              /* best-effort only - the English suggestion is still shown and usable */
            })
            .finally(() => setTranslatingPreview(false));
        }
      } else if (source === "manual") {
        showAlert("No changes suggested", "Your note already looks clear and complete.");
      }
    } catch {
      if (source === "manual") {
        showAlert("Couldn't get a suggestion", "Please try again in a moment.");
      }
      // Auto-triggered calls fail silently - non-critical, no need to
      // interrupt the worker over a background suggestion that didn't land.
    } finally {
      setImproving(false);
      if (source === "manual") setManualPending(false);
    }
  };

  const handleImprovePress = () => {
    if (!hasText || improving || disabled) return;
    Haptics.selectionAsync();
    void runImprove(value, draftHints, "manual");
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    setValue(suggestion.text);
    // The suggestion is always English (improve_note's output) - if the
    // input-language picker was left on something else, sending would
    // otherwise re-run this already-correct English text through the
    // translate-to-English step as if it were still in that language.
    setLanguage("en");
    setSuggestion(null);
    Haptics.selectionAsync();
  };

  // Auto-suggest is deliberately narrow to keep AI spend bounded: at most
  // once per task while the composer is open (autoFiredRef), only once a
  // note is substantial (15+ words) and the worker has paused typing for a
  // while, and only when a real quality issue remains - not a "word-count"
  // hint alone, which resolves itself the moment the worker keeps typing.
  // Restrictive-practice is excluded on purpose: that hint means an incident
  // report is required, and auto-offering a smoothed-over rewrite there
  // would risk encouraging language that quietly obscures it rather than
  // documenting it - the static warning + manual "Improve" button (which the
  // worker actively chooses to use) are the right tools for that case, not
  // an unprompted AI suggestion.
  useEffect(() => {
    if (!hasText || recording || disabled || autoFiredRef.current || !checksLive) return;
    const words = value.trim().split(/\s+/).filter(Boolean).length;
    if (words < 15) return;
    if (value === lastAutoSuggestRef.current) return;
    const timer = setTimeout(() => {
      const hints = checkDraftNoteHints(value, participantName?.split(" ")[0])
        .filter((h) => h.id !== "restrictive-practice");
      const meaningfulHints = hints.filter((h) => h.id !== "word-count");
      if (meaningfulHints.length === 0) return;
      autoFiredRef.current = true;
      lastAutoSuggestRef.current = value;
      void runImprove(value, meaningfulHints, "auto");
    }, 3200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, hasText, recording, disabled, participantName, checksLive]);

  const saveNote = async (
    content: string,
    noteType: SessionNoteType = "text",
    fileName?: string,
    attachmentUrls?: string[],
    language?: Pick<SessionNoteRecord, "original_content" | "original_language" | "needs_translation">,
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
      ...language,
    };

    onNoteSaved?.(payload);
    setValue("");
    setSuggestion(null);

    // Queue on ANY failure, not just when the device is offline - isOnline
    // is device-link connectivity, not "the CareCliQ API actually accepted
    // this request" (a weak cell signal, a timeout, or a 5xx all look
    // "online" but still fail the request). Previously an online-but-failed
    // save was silently dropped: the note stayed visible locally looking
    // saved, but nothing was ever persisted server-side. A note still waiting
    // on translation always goes through the queue, which translates it first.
    const trySync = isOnline && !language?.needs_translation;
    let syncFailed = false;
    if (trySync) {
      try {
        await syncSessionNotes(sessionId, [payload]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setSubmitting(false);
        return;
      } catch {
        syncFailed = true;
      }
    }

    const queued = await queueWorkerUpdate({
      type: "sync_notes",
      id: noteId,
      sessionId,
      notes: [payload],
      timestamp: Date.now(),
    });
    if (queued) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (syncFailed) {
        showAlert(
          "Saved locally",
          "Couldn't reach the server just now - this note will sync automatically once you're back online.",
        );
      }
    } else {
      // The queue write itself failed too - this note genuinely isn't saved
      // anywhere yet. Say so plainly rather than a false "saved" haptic.
      showAlert(
        "Not saved yet",
        "This note couldn't be saved. Please try sending it again before leaving this task.",
      );
    }
    setSubmitting(false);
  };

  /** After translation, the English record gets the same checks an English
   * note gets while typing. Only a possible restrictive practice is raised
   * here, since it may need an incident report. */
  const checkTranslated = (record: RecordTranslation) => {
    if (!record.original) return;
    const rp = checkDraftNoteHints(record.english, firstName).find((h) => h.id === "restrictive-practice");
    if (rp) showAlert(t("composer.translate.checkTitle"), localizeHint(rp, t));
  };

  /** Saves what the worker wrote, in English with their words kept beside
   * it. Offline, a non-English note waits in the queue and is translated
   * before it syncs. If translation fails, the text stays in the box: an
   * untranslated note is never saved as the English record. */
  const saveInWorkerLanguage = async (text: string, noteType: SessionNoteType) => {
    if (language === "en") return saveNote(text, noteType);
    if (!isOnline) {
      return saveNote(text, noteType, undefined, undefined, {
        original_content: text,
        original_language: language,
        needs_translation: true,
      });
    }
    let record: RecordTranslation;
    try {
      record = await toEnglishRecord(text, language);
    } catch {
      setValue(text);
      setSubmitting(false);
      showAlert(t("composer.translate.failedTitle"), t("composer.translate.failedBody"));
      return;
    }
    await saveNote(record.english, noteType, undefined, undefined, {
      original_content: record.original ?? null,
      original_language: record.originalLanguage ?? null,
    });
    checkTranslated(record);
  };

  const handleSend = async () => {
    if (!hasText || disabledInput) return;
    setSubmitting(true);
    await saveInWorkerLanguage(value.trim(), "text");
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
      await saveInWorkerLanguage(trimmed, "voice");
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
    const mimeType = asset.mimeType ?? (noteType === "photo" ? "image/jpeg" : "application/octet-stream");
    setSubmitting(true);

    // The captured/picked file is already safely on local disk regardless of
    // connectivity - only the upload needs a connection. Queue on any
    // failure (not just when already known-offline) rather than discarding
    // the local file reference and forcing the worker to redo the capture -
    // previously a failed upload lost the photo/file entirely, no retry.
    const attemptUpload = isOnline;
    let uploadFailed = false;
    if (attemptUpload) {
      try {
        const uploaded = await uploadSessionAttachment(sessionId, { uri: asset.uri, name, type: mimeType });
        await saveNote(`[Attachment: ${name}]`, noteType, name, [uploaded.public_url]);
        setSubmitting(false);
        return;
      } catch {
        uploadFailed = true;
      }
    }

    const queued = await queueWorkerUpdate({
      type: "upload_attachment",
      id: newClientNoteId(),
      sessionId,
      taskId: taskId ?? undefined,
      taskLabel,
      uri: asset.uri,
      name,
      mimeType,
      noteType: noteType === "photo" ? "photo" : "file",
      timestamp: Date.now(),
    });
    if (queued) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showAlert(
        "Saved locally",
        uploadFailed
          ? "Couldn't reach the server just now - this will upload automatically once you're back online."
          : "You're offline - this will upload automatically once you're back online.",
      );
    } else {
      Alert.alert(
        "Upload failed",
        "Could not save this attachment. Please try again before leaving this task.",
      );
    }
    setSubmitting(false);
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

  // One guide message at a time, most important first: a rewrite the worker
  // asked for (or was offered), a possible restrictive practice, a wording tip
  // for what they're typing, then the next question for this task.
  const topHint = !recording ? draftHints.find((h) => h.severity === "fail") ?? draftHints[0] : undefined;
  const guide = (() => {
    if (!taskId || recording || disabled) return null;
    if (suggestion) {
      return (
        <GuideBubble
          title={suggestion.source === "auto" ? t("composer.suggestion.auto") : t("composer.suggestion.manual")}
          actions={[
            { label: t("composer.suggestion.useThis"), onPress: applySuggestion, primary: true },
            { label: t("composer.guide.keepMine"), onPress: () => setSuggestion(null) },
          ]}
        >
          <Text style={[styles.guideText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>{suggestion.text}</Text>
          {(suggestion.preview || (translatingPreview && appLanguage !== "en")) && (
            <View style={[styles.guidePreview, { borderTopColor: colors.border }]}>
              <Text style={[styles.guideMeta, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                {t("composer.suggestion.previewLabel")}
              </Text>
              <Text style={[styles.guideText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                {suggestion.preview ?? t("composer.suggestion.translating")}
              </Text>
            </View>
          )}
        </GuideBubble>
      );
    }
    if (hasText && topHint) {
      const fail = topHint.severity === "fail";
      return (
        <GuideBubble
          tone={fail ? "danger" : "default"}
          actions={
            fail
              ? []
              : [{ label: improving ? t("composer.suggestion.translating") : t("composer.guide.improve"), onPress: handleImprovePress, icon: "zap", busy: manualPending }]
          }
        >
          <Text style={[styles.guideText, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>{localizeHint(topHint, t)}</Text>
        </GuideBubble>
      );
    }
    if (hasText && !checksLive) {
      return (
        <GuideBubble>
          <Text style={[styles.guideText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>{t("composer.hint.otherLanguage")}</Text>
        </GuideBubble>
      );
    }
    if (hasText) return null;
    if (nextPrompt) {
      return (
        <GuideBubble
          actions={[
            { label: t("composer.guide.answer"), onPress: () => answerPrompt(nextPrompt), primary: true },
            ...(nextPrompt === "did" ? [] : [{ label: t("composer.guide.skip"), onPress: () => skipPrompt(nextPrompt) }]),
          ]}
        >
          <Text style={[styles.guideQuestion, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
            {t(GUIDE_QUESTIONS[nextPrompt].question, promptParams)}
          </Text>
        </GuideBubble>
      );
    }
    return (
      <GuideBubble tone="done">
        <Text style={[styles.guideText, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>{t("composer.guide.done")}</Text>
      </GuideBubble>
    );
  })();

  const sendDisabled = disabledInput || submitting || (!hasText && !recording && voiceUnavailable);

  return (
    <View style={styles.wrap}>
      {guide}

      <View style={styles.bar}>
        <Pressable
          onPress={() => setAttachOpen(true)}
          disabled={disabledInput || submitting || recording}
          accessibilityRole="button"
          accessibilityLabel={t("composer.attach.title")}
          hitSlop={4}
          style={[styles.plusBtn, { backgroundColor: colors.background, borderColor: colors.border, opacity: disabledInput ? 0.45 : 1 }]}
        >
          <Feather name="plus" size={20} color={colors.foreground} />
        </Pressable>

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
              ref={inputRef}
              value={value}
              onChangeText={setValue}
              placeholder={taskId ? t("composer.placeholder") : t("composer.hint.selectTask")}
              placeholderTextColor={colors.mutedForeground}
              maxLength={SESSION_NOTE_MAX}
              editable={!disabledInput && !submitting}
              multiline
              // One line until the worker types more; the web textarea
              // otherwise opens two rows high.
              {...(Platform.OS === "web" ? { numberOfLines: 1 } : null)}
              accessibilityLabel={t("composer.placeholder")}
              style={[styles.input, NO_WEB_OUTLINE, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
            />
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
          accessibilityRole="button"
          accessibilityLabel={recording || hasText ? t("composer.send") : t("composer.record")}
          accessibilityState={{ disabled: sendDisabled }}
          style={[
            styles.roundBtn,
            {
              backgroundColor: recording ? colors.destructive : hasText ? colors.composerPurple : colors.composerPink,
              opacity: sendDisabled ? 0.45 : 1,
            },
          ]}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" size="small" />
          ) : recording ? (
            <Feather name="send" size={18} color="#FFFFFF" />
          ) : hasText ? (
            <Feather name="arrow-up" size={20} color="#FFFFFF" />
          ) : voiceUnavailable ? (
            <Feather name="wifi-off" size={18} color="#FFFFFF" />
          ) : (
            <Feather name="mic" size={20} color="#FFFFFF" />
          )}
        </Pressable>
      </View>

      <Pressable
        onPress={() => {
          setLangSearch("");
          setLangOpen(true);
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t("composer.language.title")}
        hitSlop={6}
        style={styles.langLine}
      >
        <Feather name="globe" size={13} color={colors.primary} />
        <Text numberOfLines={1} style={[styles.langLineText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {voiceUnavailable && !hasText ? t("composer.voice.offlineHint") : languageLine}
        </Text>
        <Feather name="chevron-down" size={13} color={colors.mutedForeground} />
      </Pressable>

      {/* Add a photo or file, or tidy the wording */}
      <Modal visible={attachOpen} transparent animationType="slide" onRequestClose={() => setAttachOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setAttachOpen(false)}>
          <Pressable
            style={[styles.sheetCard, { backgroundColor: colors.card, paddingBottom: insets.bottom + 12 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <Text style={[styles.sheetTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>{t("composer.attach.title")}</Text>
            {(
              [
                { icon: "camera", label: t("composer.attach.camera"), onPress: handleCamera, show: true },
                { icon: "image", label: t("composer.attach.library"), onPress: handleAttach, show: true },
                { icon: "zap", label: t("composer.guide.improve"), onPress: handleImprovePress, show: hasText },
              ] as const
            )
              .filter((o) => o.show)
              .map((o) => (
                <Pressable
                  key={o.icon}
                  onPress={() => {
                    setAttachOpen(false);
                    void o.onPress();
                  }}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.sheetOption, pressed && { backgroundColor: colors.activeBg }]}
                >
                  <View style={[styles.sheetOptionIcon, { backgroundColor: colors.activeBg }]}>
                    <Feather name={o.icon} size={18} color={colors.primary} />
                  </View>
                  <Text style={[styles.sheetOptionText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>{o.label}</Text>
                </Pressable>
              ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Which language the worker writes or speaks in */}
      <Modal visible={langOpen} transparent animationType="slide" onRequestClose={() => setLangOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setLangOpen(false)}>
          <Pressable
            style={[styles.sheetCard, styles.langSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 12 }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>{t("composer.language.title")}</Text>
              <Pressable onPress={() => setLangOpen(false)} hitSlop={10} accessibilityRole="button" accessibilityLabel={t("common.cancel")}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <Text style={[styles.sheetIntro, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {t("composer.language.intro")}
            </Text>
            <View style={[styles.searchBox, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Feather name="search" size={16} color={colors.mutedForeground} />
              <TextInput
                value={langSearch}
                onChangeText={setLangSearch}
                placeholder={t("composer.language.search")}
                placeholderTextColor={colors.mutedForeground}
                autoCorrect={false}
                style={[styles.searchInput, NO_WEB_OUTLINE, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
              />
            </View>
            <ScrollView style={styles.sheetScroll} keyboardShouldPersistTaps="handled">
              {[
                ...(langSearch ? [] : [{ heading: t("composer.language.suggested"), items: NOTE_LANGUAGES.filter((o) => suggestedLanguages.includes(o.value)) }]),
                { heading: langSearch ? null : t("composer.language.all"), items: languageResults.filter((o) => langSearch || !suggestedLanguages.includes(o.value)) },
              ].map((section, sectionIndex) => (
                <View key={sectionIndex}>
                  {section.heading ? (
                    <Text style={[styles.sheetSection, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>{section.heading}</Text>
                  ) : null}
                  {section.items.map((opt) => {
                    const active = opt.value === language;
                    return (
                      <Pressable
                        key={opt.value}
                        onPress={() => {
                          setLanguage(opt.value);
                          setLangOpen(false);
                          Haptics.selectionAsync();
                        }}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={[styles.langOption, active && { backgroundColor: colors.activeBg }]}
                      >
                        <View style={styles.langOptionNames}>
                          <Text
                            numberOfLines={1}
                            style={[styles.langOptionText, { color: active ? colors.primary : colors.foreground, fontFamily: "Inter_600SemiBold" }]}
                          >
                            {opt.nativeLabel}
                          </Text>
                          {opt.nativeLabel !== opt.label ? (
                            <Text numberOfLines={1} style={[styles.langOptionSub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                              {opt.label}
                            </Text>
                          ) : null}
                        </View>
                        {active ? <Feather name="check" size={18} color={colors.primary} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
              {languageResults.length === 0 ? (
                <Text style={[styles.sheetIntro, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {t("composer.language.none")}
                </Text>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

type GuideAction = { label: string; onPress: () => void; primary?: boolean; icon?: React.ComponentProps<typeof Feather>["name"]; busy?: boolean };

/** A message from the note guide, on the left of the task's conversation. */
function GuideBubble({
  tone = "default",
  title,
  actions = [],
  children,
}: {
  tone?: "default" | "danger" | "done";
  title?: string;
  actions?: GuideAction[];
  children: React.ReactNode;
}) {
  const colors = useColors();
  const { t } = usePreferences();
  const accent = tone === "danger" ? colors.destructive : tone === "done" ? colors.success : colors.primary;
  return (
    <View style={styles.guideRow} accessibilityRole="text">
      <View style={[styles.guideAvatar, { backgroundColor: accent + "1F" }]}>
        <Feather name={tone === "danger" ? "alert-triangle" : tone === "done" ? "check" : "compass"} size={14} color={accent} />
      </View>
      <View
        style={[
          styles.guideBubble,
          {
            backgroundColor: tone === "danger" ? colors.destructive + "12" : colors.card,
            borderColor: tone === "danger" ? colors.destructive + "55" : colors.border,
          },
        ]}
      >
        <Text style={[styles.guideMeta, { color: accent, fontFamily: "Inter_600SemiBold" }]}>{title ?? t("composer.guide.name")}</Text>
        {children}
        {actions.length > 0 && (
          <View style={styles.guideActions}>
            {actions.map((a) => (
              <Pressable
                key={a.label}
                onPress={a.onPress}
                accessibilityRole="button"
                hitSlop={4}
                style={[
                  styles.guideChip,
                  a.primary
                    ? { backgroundColor: colors.composerPurple, borderColor: colors.composerPurple }
                    : { backgroundColor: "transparent", borderColor: colors.border },
                ]}
              >
                {a.busy ? (
                  <ActivityIndicator size="small" color={a.primary ? "#FFFFFF" : colors.primary} />
                ) : a.icon ? (
                  <Feather name={a.icon} size={13} color={a.primary ? "#FFFFFF" : colors.primary} />
                ) : null}
                <Text style={[styles.guideChipText, { color: a.primary ? "#FFFFFF" : colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  {a.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop: 4,
    gap: 8,
  },
  // Note guide
  guideRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingRight: 28,
  },
  guideAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  guideBubble: {
    flexShrink: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 18,
    borderTopLeftRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  guideMeta: {
    fontSize: 11,
    letterSpacing: 0.2,
  },
  guideQuestion: {
    fontSize: 15,
    lineHeight: 21,
  },
  guideText: {
    fontSize: 14,
    lineHeight: 20,
  },
  guidePreview: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    gap: 3,
  },
  guideActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },
  guideChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  guideChipText: {
    fontSize: 13,
  },
  // Message bar
  bar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  plusBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  inputBox: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  input: {
    fontSize: 15,
    lineHeight: 20,
    minHeight: 42,
    maxHeight: 132,
    paddingTop: 11,
    paddingBottom: 11,
    textAlignVertical: "top",
  },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  recordingBox: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
  },
  waveRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    height: 22,
    flexShrink: 1,
    overflow: "hidden",
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
  langLine: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    maxWidth: "100%",
    gap: 6,
    minHeight: 28,
    paddingLeft: 52,
    paddingRight: 4,
  },
  langLineText: {
    fontSize: 12,
    flexShrink: 1,
  },
  // Sheets
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheetCard: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 10,
    paddingHorizontal: 12,
  },
  langSheet: {
    maxHeight: "85%",
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
    paddingRight: 8,
  },
  sheetTitle: {
    fontSize: 17,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  sheetIntro: {
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 8,
    paddingBottom: 10,
  },
  sheetOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  sheetOptionIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetOptionText: {
    fontSize: 15,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginHorizontal: 8,
    marginBottom: 6,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    paddingVertical: 8,
  },
  sheetScroll: {
    flexGrow: 0,
  },
  sheetSection: {
    fontSize: 12,
    paddingHorizontal: 8,
    paddingTop: 10,
    paddingBottom: 4,
  },
  langOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 12,
    borderRadius: 12,
  },
  langOptionNames: {
    flex: 1,
    minWidth: 0,
  },
  // Left-aligned like the rest of the list, including right-to-left names
  // (العربية, فارسی, اردو).
  langOptionText: {
    fontSize: 15,
    textAlign: "left",
  },
  langOptionSub: {
    fontSize: 12,
    marginTop: 1,
    textAlign: "left",
  },
});
