import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import React, { useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ActiveVoiceRecording, type VoiceRecordingControls } from "@/components/worker/WorkerMobileComposer";
import { useOffline } from "@/context/OfflineContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import {
  getPrnMedications,
  logMedicationAdministration,
  logMedicationEffect,
  transcribeSessionAudio,
  uploadMedicationVerificationPhoto,
  type PrnMedication,
  type PrnPendingEffect,
} from "@/lib/worker-api";

/** Text field with a mic button that records, transcribes via the shared voice pipeline, and appends the result. */
function DictationField({
  value,
  onChange,
  placeholder,
  sessionId,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  sessionId?: string | null;
}) {
  const colors = useColors();
  const { isOnline } = useOffline();
  const { showToast } = useToast();
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const controlsRef = useRef<VoiceRecordingControls | null>(null);
  const voiceUnavailable = !isOnline || !sessionId;

  const handleSave = async (_secs: number, uri: string | null) => {
    setRecording(false);
    if (!uri || !sessionId) return;
    setTranscribing(true);
    try {
      const { transcript } = await transcribeSessionAudio(sessionId, uri);
      onChange(value ? `${value.trim()} ${transcript}` : transcript);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Could not transcribe audio.", "error");
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
        <View style={[styles.dictationRow, { borderColor: colors.border }]}>
          <TextInput
            value={value}
            onChangeText={onChange}
            placeholder={placeholder}
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.dictationInput, { color: colors.foreground }]}
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

type Props = {
  shiftId: string;
  sessionId?: string | null;
  disabled?: boolean;
};

export function WorkerMobilePrnMedications({ shiftId, sessionId, disabled }: Props) {
  const colors = useColors();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [doseTarget, setDoseTarget] = useState<PrnMedication | null>(null);
  const [effectTarget, setEffectTarget] = useState<PrnPendingEffect | null>(null);
  const [reason, setReason] = useState("");
  const [doseGiven, setDoseGiven] = useState("");
  const [effectText, setEffectText] = useState("");
  const [verificationPhotoUrl, setVerificationPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  // Kept on a failed upload so retrying doesn't require re-taking the photo -
  // for a high-risk med, that photo documents a moment that's already
  // passed and can't be recreated.
  const [failedPhotoUri, setFailedPhotoUri] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ["worker", "prn-medications", shiftId],
    queryFn: () => getPrnMedications(shiftId),
    enabled: !!shiftId,
    refetchInterval: 5 * 60 * 1000,
  });

  const medications = data?.medications ?? [];
  const pendingEffects = data?.pending_effects ?? [];

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["worker", "prn-medications", shiftId] });

  const doseMutation = useMutation({
    mutationFn: () => {
      if (!doseTarget) throw new Error("No medication selected.");
      return logMedicationAdministration(shiftId, doseTarget.id, {
        action: "given",
        prn_reason: reason.trim(),
        dose_given: doseGiven.trim() || undefined,
        verification_photo_url: verificationPhotoUrl ?? undefined,
      });
    },
    onSuccess: () => {
      invalidate();
      showToast("PRN dose logged.", "success");
      setDoseTarget(null);
      setReason("");
      setDoseGiven("");
      setVerificationPhotoUrl(null);
      setFailedPhotoUri(null);
    },
    onError: (e: Error) => showToast(e.message || "Could not log PRN dose.", "error"),
  });

  const uploadVerificationPhoto = async (uri: string) => {
    if (!doseTarget) return;
    setUploadingPhoto(true);
    try {
      const { url } = await uploadMedicationVerificationPhoto(shiftId, doseTarget.id, {
        uri,
        name: "verification-photo.jpg",
        type: "image/jpeg",
      });
      setVerificationPhotoUrl(url);
      setFailedPhotoUri(null);
    } catch (e) {
      // Keep the local uri so retrying re-uploads the same photo instead of
      // forcing the worker to take a new one of a moment that's now passed.
      setFailedPhotoUri(uri);
      showToast((e as Error).message || "Could not upload verification photo - tap to retry.", "error");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const captureVerificationPhoto = async () => {
    if (!doseTarget) return;
    if (failedPhotoUri) {
      await uploadVerificationPhoto(failedPhotoUri);
      return;
    }
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showToast("Camera access is required to verify this medication.", "error");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (result.canceled || !result.assets[0]?.uri) return;
    await uploadVerificationPhoto(result.assets[0].uri);
  };

  const effectMutation = useMutation({
    mutationFn: () => {
      if (!effectTarget) throw new Error("No administration selected.");
      return logMedicationEffect(effectTarget.id, effectText.trim());
    },
    onSuccess: () => {
      invalidate();
      showToast("Effect recorded.", "success");
      setEffectTarget(null);
      setEffectText("");
    },
    onError: (e: Error) => showToast(e.message || "Could not record effect.", "error"),
  });

  if (medications.length === 0 && pendingEffects.length === 0) return null;

  return (
    <View style={[styles.wrap, { borderTopColor: colors.border }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Feather name="zap" size={13} color={colors.mutedForeground} />
        <Text style={[styles.headerTitle, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
          As-needed (PRN)
        </Text>
      </View>

      {pendingEffects.map((pe) => (
        <View key={pe.id} style={[styles.row, { borderBottomColor: colors.border, backgroundColor: colors.statusUpcomingBg }]}>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={1}>
              Effect still needed
            </Text>
            <Text style={[styles.rowMeta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={1}>
              {pe.prn_reason}
            </Text>
          </View>
          <Pressable
            onPress={() => !disabled && setEffectTarget(pe)}
            disabled={disabled}
            style={[styles.smallBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={[styles.smallBtnText, { fontFamily: "Inter_700Bold" }]}>Log effect</Text>
          </Pressable>
        </View>
      ))}

      {medications.map((med) => (
        <View key={med.id} style={[styles.row, { borderBottomColor: colors.border }]}>
          <View style={styles.rowCopy}>
            <Text style={[styles.rowTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={1}>
              {med.name}{med.strength ? ` · ${med.strength}` : ""}
            </Text>
            <Text style={[styles.rowMeta, { color: med.at_or_over_max ? colors.destructive : colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {med.dosage ? `${med.dosage} · ` : ""}{med.route} · {med.doses_given_today} given today
              {med.prn_max_per_day ? ` / ${med.prn_max_per_day} max` : ""}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              if (disabled) return;
              setDoseTarget(med);
              setVerificationPhotoUrl(null);
              setFailedPhotoUri(null);
            }}
            disabled={disabled}
            style={[styles.smallBtn, { backgroundColor: med.at_or_over_max ? colors.destructive : colors.primary }]}
          >
            <Text style={[styles.smallBtnText, { fontFamily: "Inter_700Bold" }]}>Log dose</Text>
          </Pressable>
        </View>
      ))}

      <Modal visible={!!doseTarget} transparent animationType="fade" onRequestClose={() => setDoseTarget(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              {doseTarget?.name}
            </Text>
            {doseTarget?.at_or_over_max && (
              <Text style={[styles.warningText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
                Already at or over the daily max for this medication.
              </Text>
            )}
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>Reason for administering</Text>
            <DictationField value={reason} onChange={setReason} placeholder="Why is this being given now?" sessionId={sessionId} />
            <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>Dose given (optional)</Text>
            <TextInput
              value={doseGiven}
              onChangeText={setDoseGiven}
              placeholder="e.g. 1 tablet"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.plainInput, { borderColor: colors.border, color: colors.foreground }]}
            />
            {doseTarget?.is_high_risk && !verificationPhotoUrl ? (
              <Pressable
                onPress={captureVerificationPhoto}
                disabled={uploadingPhoto}
                style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: uploadingPhoto ? 0.6 : 1 }]}
              >
                <Feather name={failedPhotoUri ? "refresh-cw" : "camera"} size={15} color="#FFFFFF" />
                <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>
                  {uploadingPhoto ? "Uploading photo…" : failedPhotoUri ? "Retry upload" : "Take verification photo"}
                </Text>
              </Pressable>
            ) : (
              <>
                {doseTarget?.is_high_risk && (
                  <Text style={[styles.warningText, { color: colors.success, fontFamily: "Inter_600SemiBold" }]}>
                    ✓ Verification photo captured
                  </Text>
                )}
                <Pressable
                  onPress={() => doseMutation.mutate()}
                  disabled={doseMutation.isPending || !reason.trim()}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: !reason.trim() ? 0.5 : 1 }]}
                >
                  <Feather name="check" size={15} color="#FFFFFF" />
                  <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>Confirm dose given</Text>
                </Pressable>
              </>
            )}
            <Pressable onPress={() => { setDoseTarget(null); setVerificationPhotoUrl(null); setFailedPhotoUri(null); }} style={styles.cancelBtn}>
              <Text style={[styles.cancelBtnText, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!effectTarget} transparent animationType="fade" onRequestClose={() => setEffectTarget(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>Effect observed</Text>
            <Text style={[styles.modalSubtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {effectTarget?.prn_reason}
            </Text>
            <DictationField value={effectText} onChange={setEffectText} placeholder="What effect did this dose have?" sessionId={sessionId} />
            <Pressable
              onPress={() => effectMutation.mutate()}
              disabled={effectMutation.isPending || !effectText.trim()}
              style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: !effectText.trim() ? 0.5 : 1 }]}
            >
              <Feather name="check" size={15} color="#FFFFFF" />
              <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>Save</Text>
            </Pressable>
            <Pressable onPress={() => setEffectTarget(null)} style={styles.cancelBtn}>
              <Text style={[styles.cancelBtnText, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>Cancel</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14 },
  rowMeta: { fontSize: 12 },
  smallBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  smallBtnText: { fontSize: 11, color: "#FFFFFF" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", maxWidth: 420, borderRadius: 16, borderWidth: 1, padding: 18, gap: 8 },
  modalTitle: { fontSize: 16 },
  modalSubtitle: { fontSize: 13, marginBottom: 4 },
  warningText: { fontSize: 12, marginBottom: 4 },
  fieldLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, marginTop: 6 },
  dictationRow: { flexDirection: "row", alignItems: "flex-end", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  dictationInput: { flex: 1, minHeight: 44, fontSize: 13, textAlignVertical: "top" },
  micBtn: { paddingBottom: 8 },
  transcribingText: { fontSize: 11, marginTop: 4 },
  plainInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, fontSize: 13 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 12, marginTop: 10 },
  primaryBtnText: { color: "#FFFFFF", fontSize: 14 },
  cancelBtn: { alignItems: "center", paddingVertical: 8 },
  cancelBtnText: { fontSize: 13 },
});
