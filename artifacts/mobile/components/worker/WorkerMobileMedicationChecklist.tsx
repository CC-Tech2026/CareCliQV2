import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import {
  attachMedicationReason,
  getMedicationChecklist,
  logMedicationAdministration,
  MEDICATION_ERROR_SUBTYPES,
  MEDICATION_REASON_CODES,
  uploadMedicationVerificationPhoto,
  type MedicationAdministrationAction,
  type MedicationChecklistItem,
  type MedicationErrorSubtype,
} from "@/lib/worker-api";

type Props = {
  shiftId: string;
  disabled?: boolean;
};

const REASON_LABELS: Record<string, string> = {
  participant_asleep: "Participant was asleep",
  worker_delayed: "Worker was delayed",
  participant_off_site: "Participant was off site",
  participant_requested: "Participant requested it early",
  schedule_conflict: "Schedule conflict",
  verbal: "Verbal refusal",
  behavioural: "Behavioural",
  communication_device: "Via communication device",
  clinical_direction: "Clinical direction",
  other: "Other",
};

const ERROR_SUBTYPE_LABELS: Record<MedicationErrorSubtype, string> = {
  wrong_medication: "Wrong medication",
  wrong_dose: "Wrong dose",
  wrong_participant: "Wrong participant",
  wrong_route: "Wrong route",
  other: "Other",
};

function dueMeta(item: MedicationChecklistItem, colors: ReturnType<typeof useColors>) {
  const outcome = item.administration?.outcome ?? item.due_status;
  if (outcome === "given_on_time") return { label: "Given", color: colors.success, bg: colors.statusDocumentedBg };
  if (outcome === "given_late") return { label: "Given (late)", color: colors.warning, bg: colors.statusProgressBg };
  if (outcome === "given_early") return { label: "Given (early)", color: colors.warning, bg: colors.statusProgressBg };
  if (outcome === "refused") return { label: "Refused", color: colors.destructive, bg: colors.dangerBg };
  if (outcome === "missed") return { label: "Missed", color: colors.destructive, bg: colors.dangerBg };
  if (outcome === "withheld") return { label: "Withheld", color: colors.warning, bg: colors.statusProgressBg };
  if (outcome === "overdue") return { label: "Overdue", color: colors.destructive, bg: colors.dangerBg };
  if (outcome === "due_now") return { label: "Due now", color: colors.primary, bg: colors.statusUpcomingBg };
  return { label: "Upcoming", color: colors.mutedForeground, bg: colors.soft };
}

export function WorkerMobileMedicationChecklist({ shiftId, disabled }: Props) {
  const colors = useColors();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<MedicationChecklistItem | null>(null);
  const [reasonAction, setReasonAction] = useState<MedicationAdministrationAction | null>(null);
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  // Set once a "given" submission comes back late/early — the worker didn't choose this in
  // advance, the server classified it, so the reason step happens as a follow-up.
  const [followUp, setFollowUp] = useState<{ administrationId: string; outcome: "given_late" | "given_early" } | null>(null);
  // High-risk medications require a point-of-administration photo before "given" can submit.
  const [verificationPhotoUrl, setVerificationPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  const { data } = useQuery({
    queryKey: ["worker", "medication-checklist", shiftId],
    queryFn: () => getMedicationChecklist(shiftId),
    enabled: !!shiftId,
    refetchInterval: 5 * 60 * 1000,
  });

  const checklist = data?.checklist ?? [];

  const reset = () => {
    setActiveItem(null);
    setReasonAction(null);
    setReasonCode(null);
    setNoteText("");
    setFollowUp(null);
    setVerificationPhotoUrl(null);
    setUploadingPhoto(false);
  };

  const logMutation = useMutation({
    mutationFn: ({
      item, action, reason_code, notes, error_subtype, verification_photo_url,
    }: {
      item: MedicationChecklistItem;
      action: MedicationAdministrationAction;
      reason_code?: string;
      notes?: string;
      error_subtype?: MedicationErrorSubtype;
      verification_photo_url?: string;
    }) =>
      logMedicationAdministration(shiftId, item.medication_id, {
        scheduled_time: item.scheduled_time,
        action,
        reason_code,
        notes: notes || undefined,
        error_subtype,
        verification_photo_url,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["worker", "medication-checklist", shiftId] });
      if (result.outcome === "given_late" || result.outcome === "given_early") {
        showToast(result.outcome === "given_late" ? "Logged as given, but late — one more step" : "Logged as given, but early — one more step", "success");
        setReasonAction(null);
        setReasonCode(null);
        setNoteText("");
        setFollowUp({ administrationId: result.id, outcome: result.outcome });
        return;
      }
      showToast("Medication logged", "success");
      reset();
    },
    onError: (e: Error) => showToast(e.message || "Could not log medication.", "error"),
  });

  const followUpMutation = useMutation({
    mutationFn: () => attachMedicationReason(followUp!.administrationId, reasonCode ?? undefined, noteText.trim() || undefined),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["worker", "medication-checklist", shiftId] });
      showToast("Reason recorded", "success");
      reset();
    },
    onError: (e: Error) => showToast(e.message || "Could not save reason.", "error"),
  });

  const submitGiven = () => {
    if (!activeItem) return;
    if (activeItem.is_high_risk && !verificationPhotoUrl) {
      showToast("Take the verification photo first.", "error");
      return;
    }
    logMutation.mutate({ item: activeItem, action: "given", verification_photo_url: verificationPhotoUrl ?? undefined });
  };

  const captureVerificationPhoto = async () => {
    if (!activeItem) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showToast("Camera access is required to verify this medication.", "error");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 });
    if (result.canceled || !result.assets[0]?.uri) return;
    setUploadingPhoto(true);
    try {
      const { url } = await uploadMedicationVerificationPhoto(shiftId, activeItem.medication_id, {
        uri: result.assets[0].uri,
        name: "verification-photo.jpg",
        type: "image/jpeg",
      });
      setVerificationPhotoUrl(url);
    } catch (e) {
      showToast((e as Error).message || "Could not upload verification photo.", "error");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const pickReasonAction = (action: MedicationAdministrationAction) => {
    setReasonAction(action);
    setReasonCode(null);
    setNoteText("");
  };

  const submitReasonAction = () => {
    if (!activeItem || !reasonAction) return;
    if (reasonAction === "administration_error") {
      if (!reasonCode) {
        showToast("Pick what went wrong.", "error");
        return;
      }
      if (reasonCode === "other" && !noteText.trim()) {
        showToast("A note is required when the reason is 'Other'.", "error");
        return;
      }
      logMutation.mutate({
        item: activeItem,
        action: reasonAction,
        error_subtype: reasonCode as MedicationErrorSubtype,
        notes: noteText.trim() || undefined,
      });
      return;
    }
    if (!noteText.trim()) {
      showToast("A note is required for this outcome.", "error");
      return;
    }
    logMutation.mutate({ item: activeItem, action: reasonAction, reason_code: reasonCode ?? undefined, notes: noteText.trim() });
  };

  const submitFollowUp = () => {
    if (!reasonCode && !noteText.trim()) {
      showToast("Pick a reason or add a note.", "error");
      return;
    }
    followUpMutation.mutate();
  };

  if (checklist.length === 0) return null;

  const modalVisible = !!activeItem || !!followUp;
  const reasonCodes = reasonAction
    ? reasonAction === "administration_error"
      ? MEDICATION_ERROR_SUBTYPES
      : MEDICATION_REASON_CODES[reasonAction as Exclude<MedicationAdministrationAction, "given" | "administration_error">] ?? []
    : followUp
      ? MEDICATION_REASON_CODES[followUp.outcome]
      : [];
  const reasonLabels: Record<string, string> = reasonAction === "administration_error" ? ERROR_SUBTYPE_LABELS : REASON_LABELS;
  const busy = logMutation.isPending || followUpMutation.isPending;

  return (
    <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Feather name="clipboard" size={14} color={colors.foreground} />
        <Text style={[styles.headerTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
          Medications
        </Text>
      </View>

      {checklist.map((item) => {
        const meta = dueMeta(item, colors);
        const logged = !!item.administration;
        const time = (() => {
          try {
            return new Date(item.scheduled_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          } catch {
            return item.scheduled_time;
          }
        })();
        return (
          <Pressable
            key={`${item.medication_id}-${item.scheduled_time}`}
            onPress={() => !logged && !disabled && setActiveItem(item)}
            disabled={logged || disabled}
            style={[styles.row, { borderBottomColor: colors.border }]}
          >
            <View style={styles.rowCopy}>
              <Text style={[styles.rowTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={1}>
                {item.name}{item.strength ? ` · ${item.strength}` : ""}
              </Text>
              <Text style={[styles.rowMeta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {item.dosage ? `${item.dosage} · ` : ""}{item.route} · {time}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: meta.bg }]}>
              <Text style={[styles.badgeText, { color: meta.color, fontFamily: "Inter_700Bold" }]}>{meta.label}</Text>
            </View>
          </Pressable>
        );
      })}

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={reset}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {followUp ? (
              <>
                <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                  Why was this dose {followUp.outcome === "given_late" ? "late" : "early"}?
                </Text>
                <View style={styles.chipWrap}>
                  {reasonCodes.map((code) => (
                    <Pressable
                      key={code}
                      onPress={() => setReasonCode(code)}
                      style={[
                        styles.chip,
                        { borderColor: reasonCode === code ? colors.primary : colors.border, backgroundColor: reasonCode === code ? colors.activeBg : "transparent" },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: reasonCode === code ? colors.primary : colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                        {REASON_LABELS[code] ?? code}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  value={noteText}
                  onChangeText={setNoteText}
                  placeholder="Note (required if reason is 'Other')"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  style={[styles.noteInput, { borderColor: colors.border, color: colors.foreground }]}
                />
                <Pressable
                  onPress={submitFollowUp}
                  disabled={busy}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
                >
                  <Feather name="check" size={15} color="#FFFFFF" />
                  <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>Save reason</Text>
                </Pressable>
              </>
            ) : reasonAction ? (
              <>
                <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                  {activeItem?.name} — {reasonAction === "administration_error" ? "Report an error" : reasonAction[0].toUpperCase() + reasonAction.slice(1)}
                </Text>
                <View style={styles.chipWrap}>
                  {reasonCodes.map((code) => (
                    <Pressable
                      key={code}
                      onPress={() => setReasonCode(code)}
                      style={[
                        styles.chip,
                        { borderColor: reasonCode === code ? colors.primary : colors.border, backgroundColor: reasonCode === code ? colors.activeBg : "transparent" },
                      ]}
                    >
                      <Text style={[styles.chipText, { color: reasonCode === code ? colors.primary : colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                        {reasonLabels[code] ?? code}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  value={noteText}
                  onChangeText={setNoteText}
                  placeholder={reasonAction === "administration_error" ? "Note (required if 'Other')" : "Note (required)"}
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  style={[styles.noteInput, { borderColor: colors.border, color: colors.foreground }]}
                />
                <Pressable
                  onPress={submitReasonAction}
                  disabled={busy}
                  style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
                >
                  <Feather name="check" size={15} color="#FFFFFF" />
                  <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>Confirm</Text>
                </Pressable>
                <Pressable onPress={() => setReasonAction(null)} style={styles.cancelBtn}>
                  <Text style={[styles.cancelBtnText, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>Back</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                  {activeItem?.name}
                </Text>
                <Text style={[styles.modalSubtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {activeItem?.dosage ? `${activeItem.dosage} · ` : ""}{activeItem?.route}
                </Text>

                {activeItem?.is_high_risk && !verificationPhotoUrl ? (
                  <Pressable
                    onPress={captureVerificationPhoto}
                    style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: uploadingPhoto ? 0.6 : 1 }]}
                    disabled={uploadingPhoto}
                  >
                    <Feather name="camera" size={15} color="#FFFFFF" />
                    <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>
                      {uploadingPhoto ? "Uploading photo…" : "Take verification photo"}
                    </Text>
                  </Pressable>
                ) : (
                  <>
                    {activeItem?.is_high_risk && (
                      <View style={[styles.chip, { alignSelf: "flex-start", borderColor: colors.success }]}>
                        <Text style={[styles.chipText, { color: colors.success, fontFamily: "Inter_600SemiBold" }]}>
                          ✓ Verification photo captured
                        </Text>
                      </View>
                    )}
                    <Pressable
                      onPress={submitGiven}
                      style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
                      disabled={busy}
                    >
                      <Feather name="check" size={15} color="#FFFFFF" />
                      <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>Confirm dose given</Text>
                    </Pressable>
                  </>
                )}

                <View style={styles.secondaryRow}>
                  {(["refused", "missed", "withheld"] as MedicationAdministrationAction[]).map((action) => (
                    <Pressable
                      key={action}
                      onPress={() => pickReasonAction(action)}
                      disabled={busy}
                      style={[styles.secondaryBtn, { borderColor: colors.border }]}
                    >
                      <Text style={[styles.secondaryBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                        {action[0].toUpperCase() + action.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  onPress={() => pickReasonAction("administration_error")}
                  disabled={busy}
                  style={[styles.secondaryBtn, { borderColor: colors.destructive, alignSelf: "stretch" }]}
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
                    Report an administration error
                  </Text>
                </Pressable>
              </>
            )}

            {!reasonAction && !followUp && (
              <Pressable onPress={reset} style={styles.cancelBtn}>
                <Text style={[styles.cancelBtnText, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>Cancel</Text>
              </Pressable>
            )}
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
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 11 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 20 },
  modalCard: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 18, gap: 10 },
  modalTitle: { fontSize: 16 },
  modalSubtitle: { fontSize: 13, marginBottom: 4 },
  primaryBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: 12 },
  primaryBtnText: { color: "#FFFFFF", fontSize: 14 },
  noteInput: { minHeight: 60, borderWidth: 1, borderRadius: 10, padding: 10, fontSize: 13, textAlignVertical: "top" },
  secondaryRow: { flexDirection: "row", gap: 8 },
  secondaryBtn: { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  secondaryBtnText: { fontSize: 12 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  chipText: { fontSize: 12 },
  cancelBtn: { alignItems: "center", paddingVertical: 8 },
  cancelBtnText: { fontSize: 13 },
});
