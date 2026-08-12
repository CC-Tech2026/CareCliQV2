import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import {
  getMedicationChecklist,
  logMedicationAdministration,
  type MedicationAdministrationStatus,
  type MedicationChecklistItem,
} from "@/lib/worker-api";

type Props = {
  shiftId: string;
  disabled?: boolean;
};

function dueMeta(item: MedicationChecklistItem, colors: ReturnType<typeof useColors>) {
  const status = item.administration?.status ?? item.due_status;
  if (status === "given") return { label: "Given", color: colors.success, bg: colors.statusDocumentedBg };
  if (status === "refused") return { label: "Refused", color: colors.destructive, bg: colors.dangerBg };
  if (status === "missed") return { label: "Missed", color: colors.destructive, bg: colors.dangerBg };
  if (status === "withheld") return { label: "Withheld", color: colors.warning, bg: colors.statusProgressBg };
  if (status === "overdue") return { label: "Overdue", color: colors.destructive, bg: colors.dangerBg };
  if (status === "due_now") return { label: "Due now", color: colors.primary, bg: colors.statusUpcomingBg };
  return { label: "Upcoming", color: colors.mutedForeground, bg: colors.soft };
}

export function WorkerMobileMedicationChecklist({ shiftId, disabled }: Props) {
  const colors = useColors();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState<MedicationChecklistItem | null>(null);
  const [noteText, setNoteText] = useState("");

  const { data } = useQuery({
    queryKey: ["worker", "medication-checklist", shiftId],
    queryFn: () => getMedicationChecklist(shiftId),
    enabled: !!shiftId,
    refetchInterval: 5 * 60 * 1000,
  });

  const checklist = data?.checklist ?? [];

  const logMutation = useMutation({
    mutationFn: ({ item, status, notes }: { item: MedicationChecklistItem; status: MedicationAdministrationStatus; notes?: string }) =>
      logMedicationAdministration(shiftId, item.medication_id, {
        scheduled_time: item.scheduled_time,
        status,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["worker", "medication-checklist", shiftId] });
      showToast("Medication logged", "success");
      setActiveItem(null);
      setNoteText("");
    },
    onError: (e: Error) => showToast(e.message || "Could not log medication.", "error"),
  });

  const submit = (status: MedicationAdministrationStatus) => {
    if (!activeItem) return;
    if (status !== "given" && !noteText.trim()) {
      showToast("A note is required for this outcome.", "error");
      return;
    }
    logMutation.mutate({ item: activeItem, status, notes: noteText.trim() || undefined });
  };

  if (checklist.length === 0) return null;

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

      <Modal visible={!!activeItem} transparent animationType="fade" onRequestClose={() => setActiveItem(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              {activeItem?.name}
            </Text>
            <Text style={[styles.modalSubtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {activeItem?.dosage ? `${activeItem.dosage} · ` : ""}{activeItem?.route}
            </Text>

            <Pressable
              onPress={() => submit("given")}
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              disabled={logMutation.isPending}
            >
              <Feather name="check" size={15} color="#FFFFFF" />
              <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>Confirm dose given</Text>
            </Pressable>

            <TextInput
              value={noteText}
              onChangeText={setNoteText}
              placeholder="Note (required for refused / missed / withheld)"
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[styles.noteInput, { borderColor: colors.border, color: colors.foreground }]}
            />

            <View style={styles.secondaryRow}>
              {(["refused", "missed", "withheld"] as MedicationAdministrationStatus[]).map((status) => (
                <Pressable
                  key={status}
                  onPress={() => submit(status)}
                  disabled={logMutation.isPending}
                  style={[styles.secondaryBtn, { borderColor: colors.border }]}
                >
                  <Text style={[styles.secondaryBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                    {status[0].toUpperCase() + status.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable onPress={() => setActiveItem(null)} style={styles.cancelBtn}>
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
  cancelBtn: { alignItems: "center", paddingVertical: 8 },
  cancelBtnText: { fontSize: 13 },
});
