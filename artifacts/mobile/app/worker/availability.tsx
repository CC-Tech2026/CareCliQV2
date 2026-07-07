import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { WorkerBottomNav, workerBottomNavHeight } from "@/components/worker/WorkerBottomNav";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { useColors } from "@/hooks/useColors";
import {
  DAY_LABELS,
  SLOT_LABELS,
  getWorkerAvailability,
  nextSlotStatus,
  setEmergencyAvailabilityOverride,
  updateAvailabilityBlackouts,
  updateAvailabilityPreferences,
  updateAvailabilitySlots,
  type AvailabilitySlot,
  type BlackoutDate,
  type SlotStatus,
  type TimeSlot,
} from "@/lib/worker-availability-api";

const SLOTS: TimeSlot[] = ["morning", "afternoon", "evening"];

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function statusStyle(status: SlotStatus, colors: ReturnType<typeof useColors>) {
  if (status === "available") {
    return {
      backgroundColor: "rgba(74, 222, 128, 0.12)",
      color: "#4ADE80",
      borderColor: "rgba(74, 222, 128, 0.25)",
    };
  }
  if (status === "unavailable") {
    return {
      backgroundColor: "rgba(244, 114, 182, 0.12)",
      color: colors.accent,
      borderColor: "rgba(244, 114, 182, 0.25)",
    };
  }
  return {
    backgroundColor: colors.activeBg,
    color: colors.primary,
    borderColor: colors.border,
  };
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>{label}</Text>
    </Pressable>
  );
}

function OutlineButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.outlineBtn, { borderColor: colors.border, opacity: disabled ? 0.5 : 1 }]}
    >
      <Text style={[styles.outlineBtnText, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function WorkerAvailabilityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["worker", "availability"],
    queryFn: getWorkerAvailability,
  });

  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [maxShifts, setMaxShifts] = useState(5);
  const [blackouts, setBlackouts] = useState<BlackoutDate[]>([]);
  const [newBlackout, setNewBlackout] = useState({ start_date: "", end_date: "", reason: "" });

  useEffect(() => {
    if (!data) return;
    setSlots(data.slots);
    setMaxShifts(data.preferences.max_shifts_per_week);
    setBlackouts(data.blackout_dates);
  }, [data]);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["worker", "availability"] });

  const slotsMut = useMutation({
    mutationFn: () => updateAvailabilitySlots(slots),
    onSuccess: () => {
      Alert.alert("Saved", "Weekly availability updated.");
      invalidate();
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const prefsMut = useMutation({
    mutationFn: () => updateAvailabilityPreferences(maxShifts),
    onSuccess: () => {
      Alert.alert("Saved", "Shift preference updated.");
      invalidate();
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const blackoutsMut = useMutation({
    mutationFn: () => updateAvailabilityBlackouts(blackouts),
    onSuccess: () => {
      Alert.alert("Saved", "Blackout dates updated.");
      invalidate();
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const emergencyMut = useMutation({
    mutationFn: (date: string) => setEmergencyAvailabilityOverride(date),
    onSuccess: () => {
      Alert.alert("Active", "Emergency availability override is active.");
      invalidate();
    },
    onError: (e: Error) => Alert.alert("Error", e.message),
  });

  const getSlot = (day: number, time_slot: TimeSlot): SlotStatus =>
    slots.find((s) => s.day_of_week === day && s.time_slot === time_slot)?.status ?? "available";

  const toggleSlot = (day: number, time_slot: TimeSlot) => {
    setSlots((prev) =>
      prev.map((s) =>
        s.day_of_week === day && s.time_slot === time_slot
          ? { ...s, status: nextSlotStatus(s.status) }
          : s,
      ),
    );
  };

  const addBlackout = () => {
    if (!newBlackout.start_date || !newBlackout.end_date) return;
    if (blackouts.length >= 12) {
      Alert.alert("Limit reached", "Maximum 12 blackout ranges.");
      return;
    }
    setBlackouts((prev) => [...prev, { ...newBlackout }]);
    setNewBlackout({ start_date: "", end_date: "", reason: "" });
  };

  const prefs = data?.preferences;
  const overrideActive = Boolean(prefs?.emergency_override_expires_at && prefs?.emergency_override_date);
  const today = formatIsoDate(new Date());
  const tomorrow = formatIsoDate(new Date(Date.now() + 86_400_000));
  const navPad = workerBottomNavHeight(insets.bottom, Platform.OS === "web");

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title="Availability" />

      {isLoading ? (
        <View style={[styles.center, { backgroundColor: colors.card, paddingBottom: navPad }]}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : error ? (
        <View style={[styles.center, { backgroundColor: colors.card, paddingBottom: navPad }]}>
          <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(error as Error).message}
          </Text>
        </View>
      ) : (
        <ScrollView
          style={{ backgroundColor: colors.card, flex: 1 }}
          contentContainerStyle={[styles.scroll, { paddingBottom: navPad }]}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.pageHeader}>
            <Text style={[styles.roleLabel, { color: colors.accent, fontFamily: "Inter_700Bold" }]}>
              SUPPORT WORKER
            </Text>
            <Text style={[styles.pageTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              Availability
            </Text>
            {prefs?.updated_at ? (
              <Text
                style={[
                  styles.updated,
                  {
                    color: prefs.is_stale ? colors.accent : colors.mutedForeground,
                    fontFamily: "Inter_600SemiBold",
                  },
                ]}
              >
                Last updated {prefs.days_since_updated ?? 0} days ago
                {prefs.is_stale ? " — please review" : ""}
              </Text>
            ) : null}
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              Weekly availability
            </Text>
            <Text style={[styles.cardHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              Tap each cell to cycle: Available → Unavailable → Preferred
            </Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.gridScroll}>
              <View>
                <View style={styles.gridHeaderRow}>
                  <View style={styles.slotLabelCell} />
                  {DAY_LABELS.map((day) => (
                    <View key={day} style={styles.dayHeaderCell}>
                      <Text style={[styles.dayHeaderText, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
                        {day}
                      </Text>
                    </View>
                  ))}
                </View>

                {SLOTS.map((slot) => (
                  <View key={slot} style={styles.gridRow}>
                    <View style={styles.slotLabelCell}>
                      <Text style={[styles.slotLabelText, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
                        {SLOT_LABELS[slot]}
                      </Text>
                    </View>
                    {DAY_LABELS.map((_, i) => {
                      const day = i + 1;
                      const status = getSlot(day, slot);
                      const cellStyle = statusStyle(status, colors);
                      return (
                        <Pressable
                          key={`${slot}-${day}`}
                          onPress={() => toggleSlot(day, slot)}
                          style={[
                            styles.gridCell,
                            {
                              backgroundColor: cellStyle.backgroundColor,
                              borderColor: cellStyle.borderColor,
                            },
                          ]}
                        >
                          <Text style={[styles.gridCellText, { color: cellStyle.color, fontFamily: "Inter_700Bold" }]}>
                            {status[0].toUpperCase()}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>

            <PrimaryButton
              label={slotsMut.isPending ? "Saving…" : "Save weekly grid"}
              onPress={() => slotsMut.mutate()}
              disabled={slotsMut.isPending}
            />
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              Max shifts per week
            </Text>
            <Text style={[styles.cardHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              How many shifts you are open to each week
            </Text>

            <View style={styles.stepperRow}>
              <Pressable
                onPress={() => setMaxShifts((v) => Math.max(1, v - 1))}
                style={[styles.stepperBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.stepperBtnText, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>−</Text>
              </Pressable>
              <Text style={[styles.stepperValue, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                {maxShifts}
              </Text>
              <Pressable
                onPress={() => setMaxShifts((v) => Math.min(7, v + 1))}
                style={[styles.stepperBtn, { borderColor: colors.border }]}
              >
                <Text style={[styles.stepperBtnText, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>+</Text>
              </Pressable>
            </View>

            <PrimaryButton
              label={prefsMut.isPending ? "Saving…" : "Save preference"}
              onPress={() => prefsMut.mutate()}
              disabled={prefsMut.isPending}
            />
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              Blackout dates
            </Text>
            <Text style={[styles.cardHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              Up to 12 future date ranges when you are unavailable.
            </Text>

            {blackouts.map((b, i) => (
              <View key={`${b.start_date}-${i}`} style={[styles.blackoutRow, { backgroundColor: colors.soft }]}>
                <Text style={[styles.blackoutText, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                  {b.start_date} – {b.end_date}
                  {b.reason ? ` (${b.reason})` : ""}
                </Text>
                <Pressable onPress={() => setBlackouts((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Text style={[styles.removeText, { color: colors.destructive, fontFamily: "Inter_700Bold" }]}>
                    Remove
                  </Text>
                </Pressable>
              </View>
            ))}
              <TextInput
                value={newBlackout.start_date}
                onChangeText={(v) => setNewBlackout((p) => ({ ...p, start_date: v }))}
                placeholder="Start (YYYY-MM-DD)"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.field, { color: colors.foreground, borderColor: colors.border, fontFamily: "Inter_400Regular" }]}
              />
              <TextInput
                value={newBlackout.end_date}
                onChangeText={(v) => setNewBlackout((p) => ({ ...p, end_date: v }))}
                placeholder="End (YYYY-MM-DD)"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.field, { color: colors.foreground, borderColor: colors.border, fontFamily: "Inter_400Regular" }]}
              />
            <TextInput
              value={newBlackout.reason}
              onChangeText={(v) => setNewBlackout((p) => ({ ...p, reason: v }))}
              placeholder="Note (optional)"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.field, { color: colors.foreground, borderColor: colors.border, fontFamily: "Inter_400Regular" }]}
            />

            <View style={styles.dualBtnRow}>
              <View style={styles.dualBtnCell}>
                <OutlineButton label="Add range" onPress={addBlackout} />
              </View>
              <View style={styles.dualBtnCell}>
                <PrimaryButton
                  label={blackoutsMut.isPending ? "Saving…" : "Save blackouts"}
                  onPress={() => blackoutsMut.mutate()}
                  disabled={blackoutsMut.isPending}
                />
              </View>
            </View>
          </View>

          <View style={[styles.emergencyCard, { borderColor: "rgba(251, 191, 36, 0.35)", backgroundColor: "rgba(251, 191, 36, 0.12)" }]}>
            <Text style={[styles.cardTitle, { color: colors.warning, fontFamily: "Inter_700Bold" }]}>
              Emergency availability
            </Text>
            <Text style={[styles.cardHint, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
              Signal that you can work outside your normal availability today or tomorrow. Expires after 24 hours.
            </Text>
            {overrideActive ? (
              <Text style={[styles.emergencyActive, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                Active for {prefs?.emergency_override_date}
              </Text>
            ) : null}
            <View style={styles.dualBtnRow}>
              <Pressable
                onPress={() => emergencyMut.mutate(today)}
                disabled={emergencyMut.isPending}
                style={[styles.amberBtn, { opacity: emergencyMut.isPending ? 0.5 : 1 }]}
              >
                <Text style={[styles.amberBtnText, { fontFamily: "Inter_700Bold" }]}>Available today</Text>
              </Pressable>
              <Pressable
                onPress={() => emergencyMut.mutate(tomorrow)}
                disabled={emergencyMut.isPending}
                style={[styles.amberBtn, { opacity: emergencyMut.isPending ? 0.5 : 1 }]}
              >
                <Text style={[styles.amberBtnText, { fontFamily: "Inter_700Bold" }]}>Available tomorrow</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      )}

      <View style={styles.bottomNav}>
        <WorkerBottomNav />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  error: { fontSize: 14, textAlign: "center" },
  scroll: { padding: 16, gap: 20 },
  pageHeader: { gap: 4, marginBottom: 4 },
  roleLabel: { fontSize: 10, letterSpacing: 2.2 },
  pageTitle: { fontSize: 24, letterSpacing: -0.3 },
  updated: { fontSize: 12, marginTop: 4 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  cardTitle: { fontSize: 14 },
  cardHint: { fontSize: 12, lineHeight: 17 },
  gridScroll: { marginTop: 4 },
  gridHeaderRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  gridRow: { flexDirection: "row", alignItems: "center", marginBottom: 4 },
  slotLabelCell: { width: 72, paddingRight: 8 },
  slotLabelText: { fontSize: 10 },
  dayHeaderCell: { width: 36, alignItems: "center" },
  dayHeaderText: { fontSize: 10 },
  gridCell: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 2,
  },
  gridCellText: { fontSize: 10 },
  primaryBtn: {
    marginTop: 6,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    alignSelf: "stretch",
  },
  primaryBtnText: { color: "#FFFFFF", fontSize: 12 },
  outlineBtn: {
    borderRadius: 999,
    borderWidth: 1,
    paddingVertical: 11,
    alignItems: "center",
    alignSelf: "stretch",
  },
  outlineBtnText: { fontSize: 12 },
  stepperRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    marginVertical: 8,
  },
  stepperBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepperBtnText: { fontSize: 20, lineHeight: 22 },
  stepperValue: { fontSize: 28, minWidth: 32, textAlign: "center" },
  blackoutRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  blackoutText: { flex: 1, fontSize: 12 },
  removeText: { fontSize: 12 },
  dateRow: { flexDirection: "row", gap: 8 },
  field: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    marginBottom: 4,
  },
  dualBtnRow: { flexDirection: "row", gap: 8, marginTop: 4 },
  dualBtnCell: { flex: 1 },
  emergencyCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  emergencyActive: { fontSize: 12 },
  amberBtn: {
    flex: 1,
    borderRadius: 999,
    backgroundColor: "#F59E0B",
    paddingVertical: 12,
    alignItems: "center",
  },
  amberBtnText: { color: "#111827", fontSize: 12 },
});
