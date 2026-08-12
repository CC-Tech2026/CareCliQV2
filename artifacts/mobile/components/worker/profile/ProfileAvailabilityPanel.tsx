import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import {
  DAY_LABELS,
  getWorkerAvailability,
  updateAvailabilitySlots,
  type AvailabilitySlot,
  type SlotStatus,
  type TimeSlot,
} from "@/lib/worker-availability-api";

const SLOTS: TimeSlot[] = ["morning", "afternoon", "evening"];

const SLOT_HEADER_KEYS = {
  morning: "profile.availability.slot.am",
  afternoon: "profile.availability.slot.pm",
  evening: "profile.availability.slot.night",
} as const;

function isSlotChecked(status: SlotStatus): boolean {
  return status === "available" || status === "preferred";
}

function toggleSlotStatus(status: SlotStatus): SlotStatus {
  return isSlotChecked(status) ? "unavailable" : "available";
}

type Props = {
  bottomInset?: number;
  footerBottom?: number;
};

export function ProfileAvailabilityPanel({ bottomInset = 24, footerBottom = 0 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isDark = colors.scheme === "dark";
  const { isAuthenticated } = useAuth();

  const { data, isLoading, error } = useQuery({
    queryKey: ["worker", "availability"],
    queryFn: getWorkerAvailability,
    enabled: isAuthenticated,
  });

  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);

  useEffect(() => {
    if (data?.slots) setSlots(data.slots);
  }, [data?.slots]);

  const availableCount = useMemo(
    () => slots.filter((slot) => isSlotChecked(slot.status)).length,
    [slots],
  );

  const saveMutation = useMutation({
    mutationFn: () => updateAvailabilitySlots(slots),
    onSuccess: () => {
      showToast(t("profile.availability.savedMessage"), "success");
      void queryClient.invalidateQueries({ queryKey: ["worker", "availability"] });
    },
    onError: (e: Error) => showToast(e.message || t("profile.availability.errorMessage"), "error"),
  });

  const getSlot = (day: number, time_slot: TimeSlot): SlotStatus =>
    slots.find((slot) => slot.day_of_week === day && slot.time_slot === time_slot)?.status ?? "unavailable";

  const toggleSlot = (day: number, time_slot: TimeSlot) => {
    setSlots((prev) =>
      prev.map((slot) =>
        slot.day_of_week === day && slot.time_slot === time_slot
          ? { ...slot, status: toggleSlotStatus(slot.status) }
          : slot,
      ),
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
          {(error as Error).message}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.banner, { backgroundColor: colors.activeBg, borderColor: colors.border }]}>
          <Text style={[styles.bannerTitle, { color: colors.navy, fontFamily: "Inter_700Bold" }]}>
            {t("profile.availability.weekly")}
          </Text>
          <Text style={[styles.bannerMeta, { color: colors.composerPurple, fontFamily: "Inter_500Medium" }]}>
            {t("profile.availability.slotsMarked", { count: availableCount })}
          </Text>
        </View>

        <View
          style={[
            styles.gridCard,
            elevatedCardShadow(isDark),
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={styles.gridHeaderRow}>
            <View style={styles.dayLabelCell} />
            {SLOTS.map((slot) => (
              <View key={slot} style={styles.slotHeaderCell}>
                <Text style={[styles.slotHeaderText, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                  {t(SLOT_HEADER_KEYS[slot])}
                </Text>
              </View>
            ))}
          </View>

          {DAY_LABELS.map((dayLabel, index) => {
            const day = index + 1;
            return (
              <View
                key={dayLabel}
                style={[
                  styles.gridRow,
                  index < DAY_LABELS.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <View style={styles.dayLabelCell}>
                  <Text style={[styles.dayLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                    {dayLabel}
                  </Text>
                </View>
                {SLOTS.map((slot) => {
                  const checked = isSlotChecked(getSlot(day, slot));
                  return (
                    <View key={`${day}-${slot}`} style={styles.slotHeaderCell}>
                      <Pressable
                        onPress={() => toggleSlot(day, slot)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked }}
                        style={[
                          styles.checkbox,
                          checked
                            ? { backgroundColor: colors.primary, borderColor: colors.primary }
                            : { backgroundColor: colors.soft, borderColor: colors.border },
                        ]}
                      >
                        {checked ? <Feather name="check" size={16} color="#FFFFFF" /> : null}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <View
        style={[
          styles.footer,
          {
            backgroundColor: colors.background,
            borderTopColor: colors.border,
            paddingBottom: Math.max(insets.bottom, footerBottom) + 10,
          },
        ]}
      >
        <Pressable
          onPress={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: saveMutation.isPending ? 0.7 : 1 }]}
        >
          <Text style={[styles.saveBtnText, { fontFamily: "Inter_700Bold" }]}>
            {saveMutation.isPending ? t("profile.availability.saving") : t("profile.availability.save")}
          </Text>
        </Pressable>
        <Text style={[styles.footerNote, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("profile.availability.footerNote")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  error: { fontSize: 14, textAlign: "center" },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 16 },
  banner: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 4,
  },
  bannerTitle: { fontSize: 15, lineHeight: 20 },
  bannerMeta: { fontSize: 13, lineHeight: 18 },
  gridCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingTop: 14,
    paddingBottom: 8,
  },
  gridHeaderRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, paddingHorizontal: 4 },
  gridRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  dayLabelCell: { width: 44 },
  dayLabel: { fontSize: 14 },
  slotHeaderCell: { flex: 1, alignItems: "center" },
  slotHeaderText: { fontSize: 11, textAlign: "center", lineHeight: 14 },
  checkbox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  saveBtn: {
    borderRadius: 999,
    paddingVertical: 15,
    alignItems: "center",
  },
  saveBtnText: { color: "#FFFFFF", fontSize: 15 },
  footerNote: { fontSize: 12, textAlign: "center", lineHeight: 16 },
});
