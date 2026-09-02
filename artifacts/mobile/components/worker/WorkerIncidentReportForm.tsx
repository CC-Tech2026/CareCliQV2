import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useOffline } from "@/context/OfflineContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import {
  BEHAVIOUR_SUBTYPES,
  WORKER_REPORT_TYPES,
  WORKER_SEVERITIES,
  createWorkerIncident,
  type IncidentPhotoItem,
} from "@/lib/resource-api";
import { transcribeSessionAudio } from "@/lib/worker-api";
import { newClientNoteId } from "@/lib/shift-utils";
import { ActiveVoiceRecording, type VoiceRecordingControls } from "@/components/worker/WorkerMobileComposer";

const BEHAVIOUR_TEMPLATES: Record<string, { description: string; worker_actions?: string }> = {
  verbal: {
    description: "Participant displayed verbal behaviour of concern during the shift. ",
    worker_actions: "Maintained safe distance, used calm tone, and followed de-escalation steps.",
  },
  physical: {
    description: "Participant displayed physical behaviour of concern during the shift. ",
    worker_actions: "Ensured safety of all people present and followed participant safety protocol.",
  },
  property: {
    description: "Participant behaviour resulted in property damage during the shift. ",
    worker_actions: "Secured the area and documented visible damage.",
  },
};

const STEP_COUNT = 5;

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
      Alert.alert("Transcription failed", err instanceof Error ? err.message : "Could not transcribe audio.");
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
        <View style={[styles.dictationRow, { borderColor: colors.border, backgroundColor: colors.card, minHeight }]}>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={2000}
            style={[styles.dictationInput, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
          />
          <Pressable
            onPress={() => setRecording(true)}
            disabled={voiceUnavailable || transcribing}
            hitSlop={8}
            style={[styles.micBtn, { opacity: voiceUnavailable || transcribing ? 0.4 : 1 }]}
          >
            <Feather name="mic" size={16} color={colors.primary} />
          </Pressable>
        </View>
      )}
      {transcribing && (
        <Text style={[styles.transcribingText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
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
  initialReportType = "safety_hazard",
  initialBehaviourSubtype = "",
  initialSeverity = "medium",
  initialDescription = "",
  initialWorkerActions = "",
  onSubmitted,
  onCancel,
  bottomInset = 0,
}: Props) {
  const colors = useColors();
  const t = useT();
  const [step, setStep] = useState(1);
  const [reportType, setReportType] = useState(initialReportType);
  const [behaviourSubtype, setBehaviourSubtype] = useState(initialBehaviourSubtype);
  const [severity, setSeverity] = useState(initialSeverity);
  const [description, setDescription] = useState(initialDescription);
  const [workerActions, setWorkerActions] = useState(initialWorkerActions);
  const [participantPresent, setParticipantPresent] = useState<boolean | null>(null);
  const [participantHarmed, setParticipantHarmed] = useState<"yes" | "no" | "unknown" | "">("");
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

  const captureLocation = async (): Promise<Pick<IncidentPhotoItem, "latitude" | "longitude">> => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== "granted") return {};
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
    } catch {
      return {};
    }
  };

  const handleCapturePhoto = async () => {
    if (photos.length >= 3) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Camera access needed", "Enable camera access to attach a photo.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.6, base64: true });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset?.base64) return;
    const geo = await captureLocation();
    const dataUrl = `data:image/jpeg;base64,${asset.base64}`;
    setPhotos((prev) => [
      ...prev,
      { data: dataUrl, preview: asset.uri, captured_at: new Date().toISOString(), ...geo },
    ]);
  };

  const handleSubmit = async () => {
    if (!descValid || submitting) return;
    setSubmitting(true);

    const payload = {
      shift_id: shiftId,
      participant_id: participantId,
      session_id: sessionId ?? undefined,
      worker_report_type: reportType,
      behaviour_subtype:
        reportType === "participant_behaviour" ? behaviourSubtype || undefined : undefined,
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
        const ref = result.reference_number ?? result.id.slice(0, 8).toUpperCase();
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
      <View style={[styles.confirmCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Feather name={queuedOffline ? "clock" : "check-circle"} size={32} color={colors.primary} />
        <Text style={[styles.confirmTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {queuedOffline ? "Saved - will submit automatically" : t("incidents.form.submitted")}
        </Text>
        {queuedOffline ? (
          <Text style={[styles.confirmHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Couldn't reach the server just now, so this report is saved on your device and will submit on its own
            once you're back online. You don't need to redo anything.
          </Text>
        ) : (
          <>
            <Text style={[styles.confirmRef, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
              {confirmationRef}
            </Text>
            <Text style={[styles.confirmHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {t("incidents.form.keepRef")}
            </Text>
          </>
        )}
        <Pressable
          onPress={onCancel}
          style={[styles.submitBtn, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.submitText, { fontFamily: "Inter_600SemiBold" }]}>{t("common.done")}</Text>
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
    t("incidents.form.stepDetails"),
    t("incidents.form.stepSafety"),
    t("incidents.form.stepEvidence"),
    t("incidents.form.stepReview"),
  ];

  const stepValid =
    step === 2 ? descValid : step === 3 ? safetyConfirmed : true;

  const goNext = () => {
    if (!stepValid) return;
    setStep((s) => Math.min(STEP_COUNT, s + 1));
  };
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const typeLabel = WORKER_REPORT_TYPES.find((i) => i.value === reportType)?.label ?? reportType;
  const severityLabel = WORKER_SEVERITIES.find((i) => i.value === severity)?.label ?? severity;

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.content, { paddingBottom: 40 + bottomInset }]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.stepBar}>
        {stepLabels.map((label, index) => (
          <View key={label} style={styles.stepItem}>
            <View
              style={[
                styles.stepTrack,
                { backgroundColor: index + 1 <= step ? colors.primary : colors.border },
              ]}
            />
            <Text
              numberOfLines={1}
              style={[
                styles.stepLabel,
                {
                  color: index + 1 <= step ? colors.primary : colors.mutedForeground,
                  fontFamily: index + 1 === step ? "Inter_700Bold" : "Inter_500Medium",
                },
              ]}
            >
              {label}
            </Text>
          </View>
        ))}
      </View>

      {step === 1 ? (
        <>
          <Text style={[styles.intro, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("incidents.form.intro")}
          </Text>

          <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            {t("incidents.form.reportType")}
          </Text>
          <View style={styles.chipRow}>
            {WORKER_REPORT_TYPES.map((item) => (
              <Chip
                key={item.value}
                active={reportType === item.value}
                label={item.label}
                onPress={() => setReportType(item.value)}
              />
            ))}
          </View>

          {reportType === "participant_behaviour" ? (
            <>
              <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                {t("incidents.form.behaviourType")}
              </Text>
              <View style={styles.chipRow}>
                {BEHAVIOUR_SUBTYPES.map((item) => (
                  <Chip
                    key={item.value}
                    active={behaviourSubtype === item.value}
                    label={item.label}
                    onPress={() => applyBehaviourSubtype(item.value)}
                  />
                ))}
              </View>
            </>
          ) : null}

          <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            {t("incidents.form.severity")}
          </Text>
          <View style={styles.severityRow}>
            {WORKER_SEVERITIES.map((item) => (
              <Chip
                key={item.value}
                flex
                active={severity === item.value}
                label={item.label}
                onPress={() => setSeverity(item.value)}
              />
            ))}
          </View>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            {t("incidents.form.whatHappened")}
          </Text>
          <DictationField
            value={description}
            onChange={setDescription}
            placeholder={t("incidents.form.whatHappenedPlaceholder")}
            sessionId={sessionId}
          />
          <Text style={[styles.counter, { color: counterColor, fontFamily: "Inter_500Medium" }]}>
            {descLen}/2000{descLen < 20 ? ` ${t("incidents.form.minChars")}` : ""}
          </Text>

          <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
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

      {step === 3 ? (
        <>
          <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            {t("incidents.form.participantPresent")}
          </Text>
          <View style={styles.chipRow}>
            <Chip active={participantPresent === true} label={t("common.yes")} onPress={() => setParticipantPresent(true)} />
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
              <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                {t("incidents.form.participantHarmed")}
              </Text>
              <View style={styles.chipRow}>
                {(["yes", "no", "unknown"] as const).map((v) => (
                  <Chip
                    key={v}
                    active={participantHarmed === v}
                    label={v === "yes" ? t("common.yes") : v === "no" ? t("common.no") : t("common.unknown")}
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
                backgroundColor: safetyConfirmed ? colors.activeBg : colors.card,
              },
            ]}
          >
            <View
              style={[
                styles.safetyCheckbox,
                {
                  borderColor: safetyConfirmed ? colors.primary : colors.border,
                  backgroundColor: safetyConfirmed ? colors.primary : "transparent",
                },
              ]}
            >
              {safetyConfirmed ? <Feather name="check" size={12} color="#FFFFFF" /> : null}
            </View>
            <Text style={[styles.safetyText, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
              {t("incidents.form.safetyConfirm")}
            </Text>
          </Pressable>
        </>
      ) : null}

      {step === 4 ? (
        <>
          <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            {t("incidents.form.photos")}
          </Text>
          <View style={styles.photoRow}>
            {photos.map((photo, i) => (
              <View key={i} style={styles.photoWrap}>
                <Image source={{ uri: photo.preview }} style={styles.photo} />
                <Pressable
                  onPress={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                  style={styles.photoRemove}
                >
                  <Feather name="x" size={12} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
            {photos.length < 3 ? (
              <Pressable
                onPress={handleCapturePhoto}
                style={[styles.photoAdd, { borderColor: colors.border, backgroundColor: colors.card }]}
              >
                <Feather name="camera" size={20} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("incidents.form.photosHint")}
          </Text>
        </>
      ) : null}

      {step === 5 ? (
        <>
          <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            {t("incidents.form.stepReview")}
          </Text>
          <View style={[styles.reviewCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <ReviewRow label={t("incidents.form.reportType")} value={typeLabel} colors={colors} />
            <ReviewRow label={t("incidents.form.severity")} value={severityLabel} colors={colors} />
            <ReviewRow label={t("incidents.form.whatHappened")} value={description.trim() || "—"} colors={colors} multiline />
            {workerActions.trim() ? (
              <ReviewRow label={t("incidents.form.actionsTaken")} value={workerActions.trim()} colors={colors} multiline />
            ) : null}
            <ReviewRow
              label={t("incidents.form.photos")}
              value={photos.length ? `${photos.length}` : t("common.none")}
              colors={colors}
            />
          </View>

          <Pressable
            onPress={handleSubmit}
            disabled={!descValid || submitting}
            style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: descValid ? 1 : 0.5 }]}
          >
            {submitting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={[styles.submitText, { fontFamily: "Inter_600SemiBold" }]}>
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
          <Pressable onPress={goBack} style={[styles.navBtn, { borderColor: colors.border }]}>
            <Text style={[styles.navBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {t("common.back")}
            </Text>
          </Pressable>
        ) : onCancel ? (
          <Pressable onPress={onCancel} style={[styles.navBtn, { borderColor: colors.border }]}>
            <Text style={[styles.navBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {t("common.cancel")}
            </Text>
          </Pressable>
        ) : <View />}

        {step < STEP_COUNT ? (
          <Pressable
            onPress={goNext}
            disabled={!stepValid}
            style={[styles.navBtnPrimary, { backgroundColor: colors.primary, opacity: stepValid ? 1 : 0.5 }]}
          >
            <Text style={[styles.navBtnPrimaryText, { fontFamily: "Inter_600SemiBold" }]}>
              {t("common.next")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
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
      <Text style={[styles.reviewLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        {label}
      </Text>
      <Text
        style={[styles.reviewValue, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
        numberOfLines={multiline ? undefined : 1}
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40, gap: 6 },
  stepBar: { flexDirection: "row", gap: 4, marginBottom: 14 },
  stepItem: { flex: 1, gap: 4 },
  stepTrack: { height: 3, borderRadius: 2 },
  stepLabel: { fontSize: 9, textTransform: "uppercase", letterSpacing: 0.3 },
  intro: { fontSize: 12, marginBottom: 6, lineHeight: 18 },
  label: {
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginTop: 8,
    marginBottom: 6,
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  severityRow: { flexDirection: "row", gap: 6, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1.5,
  },
  chipFlex: { flex: 1, alignItems: "center", paddingHorizontal: 0, paddingVertical: 8 },
  chipText: { fontSize: 12 },
  dictationRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  dictationInput: { flex: 1, fontSize: 13, textAlignVertical: "top" },
  micBtn: { paddingBottom: 6 },
  transcribingText: { fontSize: 11, marginTop: 4 },
  counter: { fontSize: 10, textAlign: "right", marginBottom: 8 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 4 },
  photoWrap: { width: 64, height: 64 },
  photo: { width: 64, height: 64, borderRadius: 10 },
  photoRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    backgroundColor: "rgba(0,0,0,0.7)",
    borderRadius: 999,
    padding: 3,
  },
  photoAdd: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  hint: { fontSize: 11, marginTop: 8, lineHeight: 16 },
  safetyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
  },
  safetyCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  safetyText: { flex: 1, fontSize: 12, lineHeight: 17 },
  reviewCard: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10, marginTop: 4 },
  reviewRow: { gap: 2 },
  reviewLabel: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.3 },
  reviewValue: { fontSize: 13, lineHeight: 18 },
  navRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 18, gap: 10 },
  navBtn: { flex: 1, height: 44, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  navBtnText: { fontSize: 13 },
  navBtnPrimary: { flex: 1, height: 44, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  navBtnPrimaryText: { color: "#FFFFFF", fontSize: 13 },
  submitBtn: {
    marginTop: 10,
    height: 46,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { color: "#FFFFFF", fontSize: 14 },
  confirmCard: {
    margin: 16,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    gap: 8,
  },
  confirmTitle: { fontSize: 16 },
  confirmRef: { fontSize: 22, letterSpacing: 1 },
  confirmHint: { fontSize: 12, textAlign: "center" },
});
