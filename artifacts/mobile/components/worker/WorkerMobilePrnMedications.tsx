import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { ActiveVoiceRecording, type VoiceRecordingControls } from "@/components/worker/WorkerMobileComposer";
import { useOffline } from "@/context/OfflineContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import {
  getPrnMedications,
  logMedicationAdministration,
  logMedicationEffect,
  transcribeSessionAudio,
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
        status: "given",
        prn_reason: reason.trim(),
        dose_given: doseGiven.trim() || undefined,
      });
    },
    onSuccess: () => {
      invalidate();
      showToast("PRN dose logged.", "success");
      setDoseTarget(null);
      setReason("");
      setDoseGiven("");
    },
    onError: (e: Error) => showToast(e.message || "Could not log PRN dose.", "error"),
  });

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
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Feather name="zap" size={14} color={colors.foreground} />
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
          As-needed (PRN) medications
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
            onPress={() => !disabled && setDoseTarget(med)}
            disabled={disabled}
            style={[styles.smallBtn, { backgroundColor: med.at_or_over_max ? colors.destructive : colors.primary }]}
          >
            <Text style={[styles.smallBtnText, { fontFamily: "Inter_700Bold" }]}>Log dose</Text>
          </Pressable>
        </View>
      ))}

      <Modal visible={!!doseTarget} transparent animationType="fade" onRequestClose={() => setDoseTarget(null)}>
        <View style={styles.modalOverlay}>
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
            <Pressable
              onPress={() => doseMutation.mutate()}
              disabled={doseMutation.isPending || !reason.trim()}
              style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: !reason.trim() ? 0.5 : 1 }]}
            >
              <Feather name="check" size={15} color="#FFFFFF" />
              <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>Confirm dose given</Text>
            </Pressable>
            <Pressable onPress={() => setDoseTarget(null)} style={styles.cancelBtn}>
              <Text style={[styles.cancelBtnText, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={!!effectTarget} transparent animationType="fade" onRequestClose={() => setEffectTarget(null)}>
        <View style={styles.modalOverlay}>
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
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden", marginBottom: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle: { fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14 },
  rowMeta: { fontSize: 12 },
  smallBtn: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  smallBtnText: { fontSize: 11, color: "#FFFFFF" },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 18, gap: 8 },
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
