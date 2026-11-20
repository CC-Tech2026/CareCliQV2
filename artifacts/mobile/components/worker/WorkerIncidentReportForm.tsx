import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { FontFamily } from "@/constants/typography";
import { useOffline } from "@/context/OfflineContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { TranslationKey } from "@/lib/i18n/translations";
import { severityMeta } from "@/lib/incident-utils";
import {
  BEHAVIOUR_SUBTYPES,
  WORKER_REPORT_TYPES,
  WORKER_SEVERITIES,
  createWorkerIncident,
  type IncidentPhotoItem,
} from "@/lib/resource-api";
import { transcribeSessionAudio } from "@/lib/worker-api";
import { newClientNoteId } from "@/lib/shift-utils";
import {
  ActiveVoiceRecording,
  type VoiceRecordingControls,
} from "@/components/worker/WorkerMobileComposer";

const BEHAVIOUR_TEMPLATES: Record<
  string,
  { description: string; worker_actions?: string }
> = {
  verbal: {
    description:
      "Participant displayed verbal behaviour of concern during the shift. ",
    worker_actions:
      "Maintained safe distance, used calm tone, and followed de-escalation steps.",
  },
  physical: {
    description:
      "Participant displayed physical behaviour of concern during the shift. ",
    worker_actions:
      "Ensured safety of all people present and followed participant safety protocol.",
  },
  property: {
    description:
      "Participant behaviour resulted in property damage during the shift. ",
    worker_actions: "Secured the area and documented visible damage.",
  },
};

const STEP_COUNT = 6;

/** Each step asks one question, shown as the step's heading. */
const STEP_QUESTIONS: TranslationKey[] = [
  "incidents.form.q1",
  "incidents.form.qSeverity",
  "incidents.form.q2",
  "incidents.form.q3",
  "incidents.form.q4",
  "incidents.form.q5",
];

const TYPE_META: Record<
  string,
  {
    icon: keyof typeof Feather.glyphMap;
    label: TranslationKey;
    hint: TranslationKey;
  }
> = {
  safety_hazard: {
    icon: "alert-triangle",
    label: "incidents.form.type.safety_hazard",
    hint: "incidents.form.typeHint.safety_hazard",
  },
  participant_behaviour: {
    icon: "user",
    label: "incidents.form.type.participant_behaviour",
    hint: "incidents.form.typeHint.participant_behaviour",
  },
  equipment_damage: {
    icon: "tool",
    label: "incidents.form.type.equipment_damage",
    hint: "incidents.form.typeHint.equipment_damage",
  },
  travel_accident: {
    icon: "navigation",
    label: "incidents.form.type.travel_accident",
    hint: "incidents.form.typeHint.travel_accident",
  },
  other: {
    icon: "more-horizontal",
    label: "incidents.form.type.other",
    hint: "incidents.form.typeHint.other",
  },
};

const SEVERITY_META: Record<
  string,
  { label: TranslationKey; hint: TranslationKey }
> = {
  low: { label: "incidents.severity.low", hint: "incidents.form.sevHint.low" },
  medium: {
    label: "incidents.severity.medium",
    hint: "incidents.form.sevHint.medium",
  },
  high: {
    label: "incidents.severity.high",
    hint: "incidents.form.sevHint.high",
  },
  emergency: {
    label: "incidents.form.sev.emergency",
    hint: "incidents.form.sevHint.emergency",
  },
};

/** What counts as an incident, in plain words (NDIS reportable kinds included). */
const HELP_EXAMPLES: TranslationKey[] = [
  "incidents.form.help.hurt",
  "incidents.form.help.abuse",
  "incidents.form.help.medication",
  "incidents.form.help.missing",
  "incidents.form.help.restraint",
  "incidents.form.help.property",
  "incidents.form.help.unsafe",
  "incidents.form.help.worried",
];

const BEHAVIOUR_LABELS: Record<string, TranslationKey> = {
  verbal: "incidents.form.behaviour.verbal",
  physical: "incidents.form.behaviour.physical",
  property: "incidents.form.behaviour.property",
};

type PhotoDraft = IncidentPhotoItem & { preview: string };

type Props = {
  shiftId?: string;
  participantId?: string;
  participantName?: string;
  sessionId?: string | null;
  shiftAddress?: string;
  initialReportType?: string;
  initialBehaviourSubtype?: string;
  initialSeverity?: string;
  initialDescription?: string;
  initialWorkerActions?: string;
  onSubmitted?: (referenceNumber?: string) => void;
  onCancel?: () => void;
  /** Extra bottom padding for presentation contexts that don't already
   * handle safe-area insets themselves (e.g. WorkerMobileIncidentSheet's
   * bottom sheet) — the full-screen route (WorkerStackScreen) already pads
   * for the device's bottom inset, so this defaults to 0 there. */
  bottomInset?: number;
};

/** Text field with a mic button that records, transcribes via the shared voice pipeline, and appends the result. */
function DictationField({
  value,
  onChange,
  placeholder,
  sessionId,
  minHeight = 84,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  sessionId?: string | null;
  minHeight?: number;
}) {
  const colors = useColors();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const controlsRef = useRef<VoiceRecordingControls | null>(null);
  const voiceUnavailable = !sessionId;

  const handleSave = async (_secs: number, uri: string | null) => {
    setRecording(false);
    if (!uri || !sessionId) return;
    setTranscribing(true);
    try {
      const { transcript } = await transcribeSessionAudio(sessionId, uri);
      onChange(value ? `${value.trim()} ${transcript}` : transcript);
    } catch (err) {
      Alert.alert(
        "Transcription failed",
        err instanceof Error ? err.message : "Could not transcribe audio.",
      );
    } finally {
      setTranscribing(false);
    }
  };

  return (
    <View>
      {recording ? (
        <ActiveVoiceRecording
          color={colors.primary}
          mutedColor={colors.mutedForeground}
          controlsRef={controlsRef}
          onEnded={() => setRecording(false)}
          onSave={handleSave}
        />
      ) : (
        <View
          style={[
            styles.dictationRow,
            {
              borderColor: colors.border,
              backgroundColor: colors.card,
              minHeight,
            },
          ]}
        >
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={2000}
            style={[
              styles.dictationInput,
              { color: colors.foreground, fontFamily: "Inter_400Regular" },
            ]}
          />
          <Pressable
            onPress={() => setRecording(true)}
            disabled={voiceUnavailable || transcribing}
            hitSlop={8}
            style={[
              styles.micBtn,
              { opacity: voiceUnavailable || transcribing ? 0.4 : 1 },
            ]}
          >
            <Feather name="mic" size={16} color={colors.primary} />
          </Pressable>
        </View>
      )}
      {transcribing && (
        <Text
          style={[
            styles.transcribingText,
            { color: colors.mutedForeground, fontFamily: "Inter_500Medium" },
          ]}
        >
          Transcribing…
        </Text>
      )}
    </View>
  );
}

export function WorkerIncidentReportForm({
  shiftId,
  participantId,
  participantName,
  sessionId,
  shiftAddress,
  // Nothing is chosen for the worker: an answer they didn't pick could be
  // filed by tapping through. Every choice starts empty.
  initialReportType = "",
  initialBehaviourSubtype = "",
  initialSeverity = "",
  initialDescription = "",
  initialWorkerActions = "",
  onSubmitted,
  onCancel,
  bottomInset = 0,
}: Props) {
  const colors = useColors();
  const t = useT();
  const [step, setStep] = useState(1);
  const [helpOpen, setHelpOpen] = useState(false);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [reportType, setReportType] = useState(initialReportType);
  const [behaviourSubtype, setBehaviourSubtype] = useState(
    initialBehaviourSubtype,
  );
  const [severity, setSeverity] = useState(initialSeverity);
  const [description, setDescription] = useState(initialDescription);
  const [workerActions, setWorkerActions] = useState(initialWorkerActions);
  const [participantPresent, setParticipantPresent] = useState<boolean | null>(
    null,
  );
  const [participantHarmed, setParticipantHarmed] = useState<
    "yes" | "no" | "unknown" | ""
  >("");
  const [safetyConfirmed, setSafetyConfirmed] = useState(false);
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationRef, setConfirmationRef] = useState<string | null>(null);
  const [queuedOffline, setQueuedOffline] = useState(false);
  const { isOnline, queueWorkerUpdate } = useOffline();

  const descLen = description.trim().length;
  const descValid = descLen >= 20 && descLen <= 2000;
  const counterColor = !descValid ? colors.accent : colors.mutedForeground;

  const applyBehaviourSubtype = (subtype: string) => {
    setBehaviourSubtype(subtype);
    const template = BEHAVIOUR_TEMPLATES[subtype];
    if (template) {
      setDescription(template.description);
      setWorkerActions(template.worker_actions ?? "");
    }
  };

  const captureLocation = async (): Promise<
    Pick<IncidentPhotoItem, "latitude" | "longitude">
  > => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return {};
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch {
      return {};
    }
  };

  const handleCapturePhoto = async () => {
    if (photos.length >= 3) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        "Camera access needed",
        "Enable camera access to attach a photo.",
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.6,
      base64: true,
    });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    const geo = await captureLocation();
    const dataUrl = `data:image/jpeg;base64,${asset.base64}`;
    setPhotos((prev) => [
      ...prev,
      {
        data: dataUrl,
        preview: asset.uri,
        captured_at: new Date().toISOString(),
        ...geo,
      },
    ]);
  };

  const handleSubmit = async () => {
    if (!everythingAnswered || submitting) return;
    setSubmitting(true);

    const payload = {
      shift_id: shiftId,
      participant_id: participantId,
      session_id: sessionId ?? undefined,
      worker_report_type: reportType,
      behaviour_subtype:
        reportType === "participant_behaviour"
          ? behaviourSubtype || undefined
          : undefined,
      severity,
      description: description.trim(),
      worker_actions: workerActions.trim() || undefined,
      incident_date: new Date().toISOString(),
      location: shiftAddress,
      participant_present: participantPresent ?? undefined,
      participant_harmed:
        participantPresent && participantHarmed
          ? (participantHarmed as "yes" | "no" | "unknown")
          : undefined,
      photo_items: photos.map(({ data, captured_at, latitude, longitude }) => ({
        data,
        captured_at,
        latitude,
        longitude,
      })),
    };

    // Incident reports previously had no offline/retry path at all: a failed
    // submit just showed an alert, and if the worker navigated away or the
    // app was killed before retrying, the whole report (including photos,
    // only ever held in local component state) was gone with no trace. Now
    // any failure - offline or a live request that fails - queues the full
    // payload the same way notes/attachments do, rather than only queuing
    // when already known-offline.
    if (isOnline) {
      try {
        const result = await createWorkerIncident(payload);
        const ref =
          result.reference_number ?? result.id.slice(0, 8).toUpperCase();
        setConfirmationRef(ref);
        onSubmitted?.(ref);
        setSubmitting(false);
        return;
      } catch {
        /* fall through to queue below */
      }
    }

    const queued = await queueWorkerUpdate({
      type: "submit_incident",
      id: newClientNoteId(),
      payload,
      timestamp: Date.now(),
    });
    setSubmitting(false);
    if (queued) {
      setQueuedOffline(true);
      setConfirmationRef("PENDING");
      onSubmitted?.();
    } else {
      Alert.alert(
        "Submit failed",
        "This report couldn't be saved. Please try submitting again before leaving this screen.",
      );
    }
  };

  if (confirmationRef) {
    return (
      <View
        style={[
          styles.confirmCard,
          { borderColor: colors.border, backgroundColor: colors.card },
        ]}
      >
        <Feather
          name={queuedOffline ? "clock" : "check-circle"}
          size={32}
          color={colors.primary}
        />
        <Text
          style={[
            styles.confirmTitle,
            { color: colors.foreground, fontFamily: "Inter_700Bold" },
          ]}
        >
          {queuedOffline
            ? t("incidents.form.queuedTitle")
            : t("incidents.form.submitted")}
        </Text>
        {queuedOffline ? (
          <Text
            style={[
              styles.confirmHint,
              { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
            ]}
          >
            {t("incidents.form.queuedBody")}
          </Text>
        ) : (
          <>
            <Text
              style={[
                styles.confirmRef,
                { color: colors.primary, fontFamily: "Inter_700Bold" },
              ]}
            >
              {confirmationRef}
            </Text>
            <Text
              style={[
                styles.confirmHint,
                {
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                },
              ]}
            >
              {t("incidents.form.keepRef")}
            </Text>
          </>
        )}
        <Pressable
          onPress={onCancel}
          style={[styles.submitBtn, { backgroundColor: colors.primary }]}
        >
          <Text
            style={[styles.submitText, { fontFamily: "Inter_600SemiBold" }]}
          >
            {t("common.done")}
          </Text>
        </Pressable>
      </View>
    );
  }

  const Chip = ({
    active,
    label,
    onPress,
    flex,
  }: {
    active: boolean;
    label: string;
    onPress: () => void;
    flex?: boolean;
  }) => (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        flex && styles.chipFlex,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? colors.activeBg : colors.card,
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          {
            color: active ? colors.primary : colors.foreground,
            fontFamily: active ? "Inter_600SemiBold" : "Inter_500Medium",
          },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );

  const stepLabels = [
    t("incidents.form.stepType"),
    t("incidents.form.stepSeverity"),
    t("incidents.form.stepDetails"),
    t("incidents.form.stepSafety"),
    t("incidents.form.stepEvidence"),
    t("incidents.form.stepReview"),
  ];

  const typeChosen =
    !!reportType &&
    (reportType !== "participant_behaviour" || !!behaviourSubtype);
  const stepValid =
    step === 1
      ? typeChosen
      : step === 2
        ? !!severity
        : step === 3
          ? descValid
          : step === 4
            ? safetyConfirmed
            : true;
  const everythingAnswered = typeChosen && !!severity && descValid && safetyConfirmed;

  const goNext = () => {
    if (!stepValid) return;
    setStep((s) => Math.min(STEP_COUNT, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  // Picking a type or a severity moves straight on (after a beat, so the
  // choice is seen). Only advances if the worker is still on that step.
  const advanceFrom = (from: number) => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => {
      setStep((s) => (s === from ? from + 1 : s));
    }, 220);
  };

  const typeLabel =
    WORKER_REPORT_TYPES.find((i) => i.value === reportType)?.label ??
    reportType;
  const severityLabel =
    WORKER_SEVERITIES.find((i) => i.value === severity)?.label ?? severity;

  return (
    <>
      <Modal
        visible={helpOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setHelpOpen(false)}
      >
        <View style={styles.helpRoot}>
          <Pressable
            style={styles.helpBackdrop}
            onPress={() => setHelpOpen(false)}
            accessible={false}
          />
          <View style={[styles.helpSheet, { backgroundColor: colors.card }]}>
            <View
              style={[styles.helpGrabber, { backgroundColor: colors.border }]}
            />
            <Text
              accessibilityRole="header"
              style={[
                styles.helpTitle,
                { color: colors.foreground, fontFamily: FontFamily.display },
              ]}
            >
              {t("incidents.form.helpTitle")}
            </Text>
            <Text
              style={[
                styles.helpLead,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interMedium,
                },
              ]}
            >
              {t("incidents.form.helpLead")}
            </Text>
            <ScrollView
              style={styles.helpList}
              contentContainerStyle={{ gap: 10 }}
            >
              {HELP_EXAMPLES.map((key) => (
                <View key={key} style={styles.helpRow}>
                  <Feather
                    name="check"
                    size={16}
                    color={colors.primary}
                    style={{ marginTop: 3 }}
                  />
                  <Text
                    style={[
                      styles.helpRowText,
                      {
                        color: colors.foreground,
                        fontFamily: FontFamily.interRegular,
                      },
                    ]}
                  >
                    {t(key)}
                  </Text>
                </View>
              ))}
            </ScrollView>
            <View style={[styles.helpNote, { backgroundColor: colors.soft }]}>
              <Text
                style={[
                  styles.helpNoteText,
                  {
                    color: colors.foreground,
                    fontFamily: FontFamily.interRegular,
                  },
                ]}
              >
                {t("incidents.form.helpNote")}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setHelpOpen(false)}
              style={[styles.helpClose, { backgroundColor: colors.primary }]}
            >
              <Text
                style={[
                  styles.helpCloseText,
                  {
                    color: colors.primaryForeground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {t("incidents.form.helpClose")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 40 + bottomInset },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bottomOffset={24}
      >
        <View style={styles.stepHeader}>
          <Text
            style={[
              styles.stepCount,
              { color: colors.primary, fontFamily: FontFamily.interSemiBold },
            ]}
          >
            {t("incidents.form.stepOf", {
              step: String(step),
              total: String(STEP_COUNT),
            })}{" "}
            · {stepLabels[step - 1]}
          </Text>
          <Text
            accessibilityRole="header"
            style={[
              styles.question,
              { color: colors.foreground, fontFamily: FontFamily.display },
            ]}
          >
            {t(STEP_QUESTIONS[step - 1])}
          </Text>
          <View
            style={styles.stepBar}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {stepLabels.map((label, index) => (
              <View
                key={label}
                style={[
                  styles.stepTrack,
                  {
                    backgroundColor:
                      index + 1 <= step ? colors.primary : colors.border,
                  },
                ]}
              />
            ))}
          </View>
        </View>

        {step === 1 ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => setHelpOpen(true)}
              style={styles.helpLink}
            >
              <Feather name="help-circle" size={18} color={colors.primary} />
              <Text
                style={[
                  styles.helpLinkText,
                  {
                    color: colors.primary,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {t("incidents.form.notSure")}
              </Text>
              <Feather name="chevron-right" size={18} color={colors.primary} />
            </Pressable>
            <View style={styles.options}>
              {WORKER_REPORT_TYPES.map((item) => {
                const meta = TYPE_META[item.value];
                const active = reportType === item.value;
                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      setReportType(item.value);
                      if (item.value !== "participant_behaviour")
                        advanceFrom(1);
                    }}
                    style={[
                      styles.option,
                      {
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.activeBg : colors.card,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.optionIcon,
                        {
                          backgroundColor: active
                            ? colors.primary
                            : colors.soft,
                        },
                      ]}
                    >
                      <Feather
                        name={meta?.icon ?? "circle"}
                        size={18}
                        color={
                          active ? colors.primaryForeground : colors.primary
                        }
                      />
                    </View>
                    <View style={styles.optionCopy}>
                      <Text
                        style={[
                          styles.optionTitle,
                          {
                            color: colors.foreground,
                            fontFamily: FontFamily.interSemiBold,
                          },
                        ]}
                      >
                        {meta ? t(meta.label) : item.label}
                      </Text>
                      {meta ? (
                        <Text
                          style={[
                            styles.optionHint,
                            {
                              color: colors.mutedForeground,
                              fontFamily: FontFamily.interRegular,
                            },
                          ]}
                        >
                          {t(meta.hint)}
                        </Text>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.radio,
                        {
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      {active ? (
                        <View
                          style={[
                            styles.radioDot,
                            { backgroundColor: colors.primary },
                          ]}
                        />
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>

            {reportType === "participant_behaviour" ? (
              <>
                <Text
                  style={[
                    styles.label,
                    {
                      color: colors.foreground,
                      fontFamily: FontFamily.interSemiBold,
                    },
                  ]}
                >
                  {t("incidents.form.behaviourType")}
                </Text>
                <View style={styles.chipRow}>
                  {BEHAVIOUR_SUBTYPES.map((item) => (
                    <Chip
                      key={item.value}
                      active={behaviourSubtype === item.value}
                      label={
                        BEHAVIOUR_LABELS[item.value]
                          ? t(BEHAVIOUR_LABELS[item.value])
                          : item.label
                      }
                      onPress={() => {
                        applyBehaviourSubtype(item.value);
                        advanceFrom(1);
                      }}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <Text
              style={[
                styles.stepHint,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            >
              {t("incidents.form.severityHint")}
            </Text>
            <View style={styles.severityGrid}>
              {WORKER_SEVERITIES.map((item) => {
                const active = severity === item.value;
                const meta = SEVERITY_META[item.value];
                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: active }}
                    onPress={() => {
                      setSeverity(item.value);
                      if (item.value !== "emergency") advanceFrom(2);
                    }}
                    style={[
                      styles.severityTile,
                      {
                        borderColor: active ? colors.primary : colors.border,
                        backgroundColor: active ? colors.activeBg : colors.card,
                      },
                    ]}
                  >
                    <View style={styles.severityHead}>
                      <View
                        style={[
                          styles.severityDot,
                          { backgroundColor: severityMeta(item.value).dot },
                        ]}
                      />
                      <Text
                        style={[
                          styles.severityLabel,
                          {
                            color: colors.foreground,
                            fontFamily: FontFamily.interSemiBold,
                          },
                        ]}
                      >
                        {meta ? t(meta.label) : item.label}
                      </Text>
                    </View>
                    {meta ? (
                      <Text
                        style={[
                          styles.severityHint,
                          {
                            color: colors.mutedForeground,
                            fontFamily: FontFamily.interRegular,
                          },
                        ]}
                      >
                        {t(meta.hint)}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
            {severity === "emergency" ? (
              <View
                style={[styles.emergency, { backgroundColor: colors.dangerBg }]}
              >
                <Feather name="phone" size={15} color={colors.dangerIcon} />
                <Text
                  style={[
                    styles.emergencyText,
                    {
                      color: colors.dangerText,
                      fontFamily: FontFamily.interMedium,
                    },
                  ]}
                >
                  {t("incidents.worker.emergency")}
                </Text>
              </View>
            ) : null}
          </>
        ) : null}

        {step === 3 ? (
          <>
            <DictationField
              value={description}
              onChange={setDescription}
              placeholder={t("incidents.form.whatHappenedPlaceholder")}
              sessionId={sessionId}
            />
            <Text
              style={[
                styles.counter,
                { color: counterColor, fontFamily: "Inter_500Medium" },
              ]}
            >
              {descLen}/2000
              {descLen < 20 ? ` ${t("incidents.form.minChars")}` : ""}
            </Text>

            <Text
              style={[
                styles.label,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {t("incidents.form.actionsTaken")}
            </Text>
            <DictationField
              value={workerActions}
              onChange={setWorkerActions}
              placeholder={t("incidents.form.actionsPlaceholder")}
              sessionId={sessionId}
              minHeight={60}
            />
          </>
        ) : null}

        {step === 4 ? (
          <>
            <Text
              style={[
                styles.label,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {t("incidents.form.participantPresent")}
            </Text>
            <View style={styles.chipRow}>
              <Chip
                active={participantPresent === true}
                label={t("common.yes")}
                onPress={() => setParticipantPresent(true)}
              />
              <Chip
                active={participantPresent === false}
                label={t("common.no")}
                onPress={() => {
                  setParticipantPresent(false);
                  setParticipantHarmed("");
                }}
              />
            </View>

            {participantPresent ? (
              <>
                <Text
                  style={[
                    styles.label,
                    {
                      color: colors.foreground,
                      fontFamily: FontFamily.interSemiBold,
                    },
                  ]}
                >
                  {t("incidents.form.participantHarmed")}
                </Text>
                <View style={styles.chipRow}>
                  {(["yes", "no", "unknown"] as const).map((v) => (
                    <Chip
                      key={v}
                      active={participantHarmed === v}
                      label={
                        v === "yes"
                          ? t("common.yes")
                          : v === "no"
                            ? t("common.no")
                            : t("common.unknown")
                      }
                      onPress={() => setParticipantHarmed(v)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            <Pressable
              onPress={() => setSafetyConfirmed((v) => !v)}
              style={[
                styles.safetyRow,
                {
                  borderColor: safetyConfirmed ? colors.primary : colors.border,
                  backgroundColor: safetyConfirmed
                    ? colors.activeBg
                    : colors.card,
                },
              ]}
            >
              <View
                style={[
                  styles.safetyCheckbox,
                  {
                    borderColor: safetyConfirmed
                      ? colors.primary
                      : colors.border,
                    backgroundColor: safetyConfirmed
                      ? colors.primary
                      : "transparent",
                  },
                ]}
              >
                {safetyConfirmed ? (
                  <Feather name="check" size={12} color="#FFFFFF" />
                ) : null}
              </View>
              <Text
                style={[
                  styles.safetyText,
                  { color: colors.foreground, fontFamily: "Inter_500Medium" },
                ]}
              >
                {t("incidents.form.safetyConfirm")}
              </Text>
            </Pressable>
          </>
        ) : null}

        {step === 5 ? (
          <>
            <Text
              style={[
                styles.label,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {t("incidents.form.photos")}
            </Text>
            <View style={styles.photoRow}>
              {photos.map((photo, i) => (
                <View key={i} style={styles.photoWrap}>
                  <Image source={{ uri: photo.preview }} style={styles.photo} />
                  <Pressable
                    onPress={() =>
                      setPhotos((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    style={styles.photoRemove}
                  >
                    <Feather name="x" size={12} color="#FFFFFF" />
                  </Pressable>
                </View>
              ))}
              {photos.length < 3 ? (
                <Pressable
                  onPress={handleCapturePhoto}
                  style={[
                    styles.photoAdd,
                    {
                      borderColor: colors.border,
                      backgroundColor: colors.card,
                    },
                  ]}
                >
                  <Feather
                    name="camera"
                    size={20}
                    color={colors.mutedForeground}
                  />
                </Pressable>
              ) : null}
            </View>
            <Text
              style={[
                styles.hint,
                {
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                },
              ]}
            >
              {t("incidents.form.photosHint")}
            </Text>
          </>
        ) : null}

        {step === 6 ? (
          <>
            <View
              style={[
                styles.reviewCard,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <ReviewRow
                label={t("incidents.form.reportType")}
                value={
                  !reportType
                    ? "Not chosen yet"
                    : TYPE_META[reportType]
                      ? t(TYPE_META[reportType].label)
                      : typeLabel
                }
                colors={colors}
              />
              <ReviewRow
                label={t("incidents.form.severity")}
                value={
                  !severity
                    ? "Not chosen yet"
                    : SEVERITY_META[severity]
                      ? t(SEVERITY_META[severity].label)
                      : severityLabel
                }
                colors={colors}
              />
              <ReviewRow
                label={t("incidents.form.whatHappened")}
                value={description.trim() || "—"}
                colors={colors}
                multiline
              />
              {workerActions.trim() ? (
                <ReviewRow
                  label={t("incidents.form.actionsTaken")}
                  value={workerActions.trim()}
                  colors={colors}
                  multiline
                />
              ) : null}
              <ReviewRow
                label={t("incidents.form.photos")}
                value={photos.length ? `${photos.length}` : t("common.none")}
                colors={colors}
              />
            </View>

            {!everythingAnswered ? (
              <Text
                accessibilityRole="alert"
                style={[
                  styles.stepHint,
                  { color: colors.destructive, fontFamily: FontFamily.interMedium },
                ]}
              >
                {`Still to answer: ${[
                  !typeChosen ? "what kind of incident (step 1)" : null,
                  !severity ? "how serious it is (step 2)" : null,
                  !descValid ? "what happened (step 3)" : null,
                  !safetyConfirmed ? "the safety check (step 4)" : null,
                ]
                  .filter(Boolean)
                  .join(", ")}.`}
              </Text>
            ) : null}
            <Pressable
              onPress={handleSubmit}
              disabled={!everythingAnswered || submitting}
              style={[
                styles.submitBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: everythingAnswered ? 1 : 0.5,
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text
                  style={[
                    styles.submitText,
                    { fontFamily: "Inter_600SemiBold" },
                  ]}
                >
                  {participantName
                    ? t("incidents.form.submitFor", { name: participantName })
                    : t("incidents.form.submit")}
                </Text>
              )}
            </Pressable>
          </>
        ) : null}

        <View style={styles.navRow}>
          {step > 1 ? (
            <Pressable
              onPress={goBack}
              style={[styles.navBtn, { borderColor: colors.border }]}
            >
              <Text
                style={[
                  styles.navBtnText,
                  { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
                ]}
              >
                {t("common.back")}
              </Text>
            </Pressable>
          ) : onCancel ? (
            <Pressable
              onPress={onCancel}
              style={[styles.navBtn, { borderColor: colors.border }]}
            >
              <Text
                style={[
                  styles.navBtnText,
                  { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
                ]}
              >
                {t("common.cancel")}
              </Text>
            </Pressable>
          ) : (
            <View />
          )}

          {/* Steps 1 and 2 move on when an option is tapped, so they need no
              Next, except an emergency, which stops to show the 000 reminder. */}
          {step < STEP_COUNT &&
          (step > 2 || (step === 2 && severity === "emergency")) ? (
            <Pressable
              onPress={goNext}
              disabled={!stepValid}
              style={[
                styles.navBtnPrimary,
                {
                  backgroundColor: colors.primary,
                  opacity: stepValid ? 1 : 0.5,
                },
              ]}
            >
              <Text
                style={[
                  styles.navBtnPrimaryText,
                  { fontFamily: "Inter_600SemiBold" },
                ]}
              >
                {t("common.next")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </KeyboardAwareScrollViewCompat>
    </>
  );
}

function ReviewRow({
  label,
  value,
  colors,
  multiline,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
  multiline?: boolean;
}) {
  return (
    <View style={styles.reviewRow}>
      <Text
        style={[
          styles.reviewLabel,
          { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.reviewValue,
          { color: colors.foreground, fontFamily: "Inter_400Regular" },
        ]}
        numberOfLines={multiline ? undefined : 1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stepHint: { fontSize: 15, lineHeight: 21, marginBottom: 12 },
  helpLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    marginTop: -4,
    marginBottom: 8,
  },
  helpLinkText: { flex: 1, fontSize: 15 },
  helpRoot: { flex: 1, justifyContent: "flex-end" },
  helpBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(26,26,46,0.45)",
  },
  helpSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 12,
    maxHeight: "88%",
  },
  helpGrabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 6,
  },
  helpTitle: { fontSize: 22, lineHeight: 28 },
  helpLead: { fontSize: 16, lineHeight: 22 },
  helpList: { flexGrow: 0 },
  helpRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  helpRowText: { flex: 1, fontSize: 15, lineHeight: 21 },
  helpNote: { borderRadius: 14, padding: 14 },
  helpNoteText: { fontSize: 14, lineHeight: 20 },
  helpClose: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  helpCloseText: { fontSize: 16 },
  stepHeader: { marginBottom: 12 },
  stepCount: { fontSize: 14 },
  question: { fontSize: 26, lineHeight: 32, letterSpacing: -0.3, marginTop: 6 },
  options: { gap: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  optionIcon: {
    width: 38,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  optionCopy: { flex: 1, gap: 2 },
  optionTitle: { fontSize: 16 },
  optionHint: { fontSize: 13, lineHeight: 18 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  severityGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  severityTile: {
    width: "48%",
    flexGrow: 1,
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  severityHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  severityDot: { width: 10, height: 10, borderRadius: 5 },
  severityLabel: { fontSize: 16 },
  severityHint: { fontSize: 13, lineHeight: 18 },
  emergency: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    padding: 14,
    marginTop: 10,
  },
  emergencyText: { flex: 1, fontSize: 14, lineHeight: 19 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40, gap: 8 },
  stepBar: { flexDirection: "row", gap: 4, marginTop: 14 },
  stepTrack: { flex: 1, height: 4, borderRadius: 2 },
  label: { fontSize: 15, marginTop: 16, marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 4 },
  chip: {
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1.5,
  },
  chipText: { fontSize: 15 },
  chipFlex: { flex: 1, alignItems: "center", paddingHorizontal: 0 },
  dictationRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dictationInput: {
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "top",
  },
  micBtn: { paddingBottom: 6 },
  transcribingText: { fontSize: 13, marginTop: 4 },
  counter: { fontSize: 13, textAlign: "right", marginTop: 4 },
  photoRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 4,
  },
  photoWrap: { width: 88, height: 88 },
  photo: { width: 88, height: 88, borderRadius: 14 },
  photoRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 999,
    padding: 3,
  },
  photoAdd: {
    width: 88,
    height: 88,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { fontSize: 14, marginTop: 10, lineHeight: 20 },
  safetyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 16,
    marginTop: 16,
  },
  safetyCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  safetyText: { flex: 1, fontSize: 15, lineHeight: 21 },
  reviewCard: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 14 },
  reviewRow: { gap: 4 },
  reviewLabel: { fontSize: 13 },
  reviewValue: { fontSize: 15, lineHeight: 21 },
  navRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 24,
    gap: 10,
  },
  navBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  navBtnText: { fontSize: 16 },
  navBtnPrimary: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  navBtnPrimaryText: { color: "#FFFFFF", fontSize: 16 },
  submitBtn: {
    marginTop: 16,
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  submitText: { color: "#FFFFFF", fontSize: 16 },
  confirmCard: {
    margin: 16,
    padding: 28,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    gap: 10,
  },
  confirmTitle: { fontSize: 20, textAlign: "center" },
  confirmRef: { fontSize: 24, letterSpacing: 1 },
  confirmHint: { fontSize: 15, lineHeight: 21, textAlign: "center" },
});
