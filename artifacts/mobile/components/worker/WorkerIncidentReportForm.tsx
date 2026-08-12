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
          Incident report submitted
        </Text>
        <Text style={[styles.confirmRef, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
          {confirmationRef}
        </Text>
        <Text style={[styles.confirmHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          Keep this reference number for your records.
        </Text>
        <Pressable
          onPress={onCancel}
          style={[styles.submitBtn, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.submitText, { fontFamily: "Inter_700Bold" }]}>Done</Text>
        </Pressable>
      </View>
    );
  }

  const Chip = ({
    active,
    label,
    onPress,
  }: {
    active: boolean;
    label: string;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          borderColor: active ? colors.primary : colors.border,
          backgroundColor: active ? colors.activeBg : colors.background,
        },
      ]}
    >
      <Text
        style={[
          styles.chipText,
          {
            color: active ? colors.primary : colors.foreground,
            fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
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
    >
      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        REPORT TYPE
      </Text>
      <View style={styles.chipRow}>
        {WORKER_REPORT_TYPES.map((t) => (
          <Chip key={t.value} active={reportType === t.value} label={t.label} onPress={() => setReportType(t.value)} />
        ))}
      </View>

      {reportType === "participant_behaviour" && (
        <>
          <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            BEHAVIOUR TYPE
          </Text>
          <View style={styles.chipRow}>
            {BEHAVIOUR_SUBTYPES.map((t) => (
              <Chip
                key={t.value}
                active={behaviourSubtype === t.value}
                label={t.label}
                onPress={() => applyBehaviourSubtype(t.value)}
              />
            ))}
          </View>
        </>
      )}

      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        SEVERITY
      </Text>
      <View style={styles.chipRow}>
        {WORKER_SEVERITIES.map((s) => (
          <Chip key={s.value} active={severity === s.value} label={s.label} onPress={() => setSeverity(s.value)} />
        ))}
      </View>

      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        WHAT HAPPENED
      </Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        placeholder="Describe what happened, when, and who was involved…"
        placeholderTextColor={colors.mutedForeground}
        multiline
        maxLength={2000}
        style={[
          styles.textArea,
          { borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground, fontFamily: "Inter_400Regular" },
        ]}
      />
      <Text
        style={[
          styles.counter,
          { color: descLen < 20 || descLen > 2000 ? colors.destructive : colors.mutedForeground, fontFamily: "Inter_500Medium" },
        ]}
      >
        {descLen}/2000 {descLen < 20 ? "(minimum 20)" : ""}
      </Text>

      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        ACTIONS TAKEN
      </Text>
      <TextInput
        value={workerActions}
        onChangeText={setWorkerActions}
        placeholder="What did you do in response?"
        placeholderTextColor={colors.mutedForeground}
        multiline
        maxLength={1000}
        style={[
          styles.textArea,
          { minHeight: 60, borderColor: colors.border, backgroundColor: colors.background, color: colors.foreground, fontFamily: "Inter_400Regular" },
        ]}
      />

      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        WAS THE PARTICIPANT PRESENT?
      </Text>
      <View style={styles.chipRow}>
        <Chip active={participantPresent === true} label="Yes" onPress={() => setParticipantPresent(true)} />
        <Chip
          active={participantPresent === false}
          label="No"
          onPress={() => {
            setParticipantPresent(false);
            setParticipantHarmed("");
          }}
        />
      </View>

      {participantPresent && (
        <>
          <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
            WAS THE PARTICIPANT HARMED?
          </Text>
          <View style={styles.chipRow}>
            {(["yes", "no", "unknown"] as const).map((v) => (
              <Chip
                key={v}
                active={participantHarmed === v}
                label={v === "yes" ? "Yes" : v === "no" ? "No" : "Unknown"}
                onPress={() => setParticipantHarmed(v)}
              />
            ))}
          </View>
        </>
      )}

      <Text style={[styles.label, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        PHOTOS (OPTIONAL)
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
        {photos.length < 3 && (
          <Pressable
            onPress={handleCapturePhoto}
            style={[styles.photoAdd, { borderColor: colors.border, backgroundColor: colors.background }]}
          >
            <Feather name="camera" size={20} color={colors.mutedForeground} />
          </Pressable>
        )}
      </View>

      <Pressable
        onPress={handleSubmit}
        disabled={!canSubmit}
        style={[styles.submitBtn, { backgroundColor: colors.destructive, opacity: canSubmit ? 1 : 0.5 }]}
      >
        {submitting ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={[styles.submitText, { fontFamily: "Inter_700Bold" }]}>
            {participantName ? `Submit report for ${participantName}` : "Submit incident report"}
          </Text>
        )}
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, gap: 8, paddingBottom: 40 },
  label: { fontSize: 11, letterSpacing: 0.6, marginTop: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: { fontSize: 13 },
  textArea: {
    minHeight: 100,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    textAlignVertical: "top",
  },
  counter: { fontSize: 11, textAlign: "right" },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
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
    marginTop: 16,
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  submitText: { color: "#FFFFFF", fontSize: 15 },
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
