import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import React, { useState } from "react";
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

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import {
  BEHAVIOUR_SUBTYPES,
  WORKER_REPORT_TYPES,
  WORKER_SEVERITIES,
  createWorkerIncident,
  type IncidentPhotoItem,
} from "@/lib/resource-api";

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
};

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
}: Props) {
  const colors = useColors();
  const t = useT();
  const [reportType, setReportType] = useState(initialReportType);
  const [behaviourSubtype, setBehaviourSubtype] = useState(initialBehaviourSubtype);
  const [severity, setSeverity] = useState(initialSeverity);
  const [description, setDescription] = useState(initialDescription);
  const [workerActions, setWorkerActions] = useState(initialWorkerActions);
  const [participantPresent, setParticipantPresent] = useState<boolean | null>(null);
  const [participantHarmed, setParticipantHarmed] = useState<"yes" | "no" | "unknown" | "">("");
  const [photos, setPhotos] = useState<PhotoDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationRef, setConfirmationRef] = useState<string | null>(null);

  const descLen = description.trim().length;
  const canSubmit = descLen >= 20 && descLen <= 2000 && !submitting;
  const counterColor = descLen < 20 || descLen > 2000 ? colors.accent : colors.mutedForeground;

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
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await createWorkerIncident({
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
      });
      const ref = result.reference_number ?? result.id.slice(0, 8).toUpperCase();
      setConfirmationRef(ref);
      onSubmitted?.(ref);
    } catch (err) {
      Alert.alert(
        "Submit failed",
        err instanceof Error ? err.message : "Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmationRef) {
    return (
      <View style={[styles.confirmCard, { borderColor: colors.border, backgroundColor: colors.card }]}>
        <Feather name="check-circle" size={32} color={colors.primary} />
        <Text style={[styles.confirmTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {t("incidents.form.submitted")}
        </Text>
        <Text style={[styles.confirmRef, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
          {confirmationRef}
        </Text>
        <Text style={[styles.confirmHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("incidents.form.keepRef")}
        </Text>
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

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
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

      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        {t("incidents.form.whatHappened")}
      </Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder={t("incidents.form.whatHappenedPlaceholder")}
        placeholderTextColor={colors.mutedForeground}
        multiline
        maxLength={2000}
        style={[
          styles.textArea,
          {
            borderColor: colors.border,
            backgroundColor: colors.card,
            color: colors.foreground,
            fontFamily: "Inter_400Regular",
          },
        ]}
      />
      <Text style={[styles.counter, { color: counterColor, fontFamily: "Inter_500Medium" }]}>
        {descLen}/2000{descLen < 20 ? ` ${t("incidents.form.minChars")}` : ""}
      </Text>

      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        {t("incidents.form.actionsTaken")}
      </Text>
      <TextInput
        value={workerActions}
        onChangeText={setWorkerActions}
        placeholder={t("incidents.form.actionsPlaceholder")}
        placeholderTextColor={colors.mutedForeground}
        multiline
        maxLength={1000}
        style={[
          styles.textArea,
          {
            minHeight: 60,
            borderColor: colors.border,
            backgroundColor: colors.card,
            color: colors.foreground,
            fontFamily: "Inter_400Regular",
          },
        ]}
      />

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

      <Pressable
        onPress={handleSubmit}
        disabled={!canSubmit}
        style={[styles.submitBtn, { backgroundColor: colors.primary, opacity: canSubmit ? 1 : 0.5 }]}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 40, gap: 6 },
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
  textArea: {
    minHeight: 84,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    textAlignVertical: "top",
  },
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
