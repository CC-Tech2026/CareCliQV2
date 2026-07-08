import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { ShiftStatusBadge } from "@/components/worker/ShiftStatusBadge";
import { useT } from "@/context/PreferencesContext";
import { showAlert } from "@/lib/alert";
import { useColors } from "@/hooks/useColors";
import {
  clockInShift,
  startShiftSession,
  type WorkerShift,
} from "@/lib/worker-api";
import {
  avatarShouldPulse,
  emergencyContactDisplay,
  formatActiveGoalLabel,
  formatShiftTimeRange,
  isShiftCompletedForList,
  shiftInitials,
  shiftNeedsRiskAck,
  STATE_AVATAR_COLORS,
} from "@/lib/shift-utils";

type Props = {
  shift: WorkerShift;
  showActions?: boolean;
  onRefresh?: () => void;
};

export function ShiftListCard({ shift, showActions = false, onRefresh }: Props) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();
  const [starting, setStarting] = useState(false);

  const isCancelled = shift.status === "cancelled";
  const isCompleted = isShiftCompletedForList(shift);
  const needsRiskAck = shiftNeedsRiskAck(shift);
  const pulse = !isCompleted && avatarShouldPulse(shift.visual_state);
  const showDetails = showActions && !isCompleted;
  const isSessionLive = shift.visual_state === "session_active";

  const avatarColor = isCancelled
    ? colors.destructive
    : isCompleted
      ? colors.mutedForeground
      : STATE_AVATAR_COLORS[shift.visual_state] ?? colors.primary;

  const mapsUrl = shift.participant_address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(shift.participant_address)}`
    : null;
  const phone = shift.participant_phone?.trim();
  const goals = shift.active_goals ?? [];
  const notesText =
    shift.coordinator_notes?.trim() ||
    shift.visit_notes?.trim() ||
    shift.special_instructions?.trim() ||
    null;
  const medicalAlert =
    shift.health_alerts?.map((a) => a.title || a.detail).filter(Boolean).join(" · ") ||
    shift.health_flags?.trim() ||
    shift.allergies?.trim() ||
    null;
  const emergencyContact = emergencyContactDisplay(shift.profile?.emergency_contact);
  const caseManager = shift.profile?.case_manager;
  const coordinatorLine = [caseManager?.phone, caseManager?.email].filter(Boolean).join(" · ");
  const officePhone = shift.office_contact_number?.trim() || null;

  const navigateToShift = (focus?: "safety") => {
    const query = focus === "safety" ? "?focus=safety" : "";
    router.push(`/shift/${shift.id}${query}` as never);
  };

  const runStartSession = async () => {
    await startShiftSession(shift.id);
    onRefresh?.();
    navigateToShift();
  };

  const captureGps = async (): Promise<{ lat: number; lng: number; accuracy?: number } | null> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      return {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? undefined,
      };
    } catch {
      return null;
    }
  };

  const handleClockIn = async () => {
    if (starting) return;

    if (isSessionLive) {
      navigateToShift();
      return;
    }

    if (needsRiskAck) {
      showAlert(t("shifts.listCard.safetyFirst"), t("shifts.listCard.safetyFirstDesc"));
      navigateToShift("safety");
      return;
    }

    if (shift.visual_state === "clocked_in") {
      setStarting(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        await runStartSession();
      } catch (err) {
        showAlert(
          t("shifts.listCard.clockInFailed"),
          err instanceof Error ? err.message : t("shifts.listCard.tryAgain"),
        );
      } finally {
        setStarting(false);
      }
      return;
    }

    setStarting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const location = await captureGps();
      if (!location) {
        showAlert(t("shifts.listCard.geoDenied"), t("shifts.listCard.geoFailed"));
        return;
      }

      await clockInShift(shift.id, {
        method: "gps",
        location,
        client_timestamp: new Date().toISOString(),
      });
      await runStartSession();
    } catch (err) {
      showAlert(
        t("shifts.listCard.clockInFailed"),
        err instanceof Error ? err.message : t("shifts.listCard.tryAgain"),
      );
    } finally {
      setStarting(false);
    }
  };

  const actionLabel = starting
    ? t("shifts.listCard.starting")
    : isSessionLive
      ? t("shifts.listCard.resumeSession")
      : shift.visual_state === "clocked_in"
        ? t("shifts.listCard.startSession")
        : t("shifts.listCard.clockIn");

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: isCancelled || isCompleted ? 0.8 : 1,
        },
      ]}
      testID={`shift-card-${shift.id}`}
    >
      <View>
        <View style={styles.row}>
          <View style={[styles.avatar, { backgroundColor: avatarColor }, pulse && styles.avatarPulse]}>
            <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>
              {shiftInitials(shift.participant_name)}
            </Text>
          </View>

          <View style={styles.content}>
            <View style={styles.titleRow}>
              <Text
                style={[
                  styles.name,
                  { color: colors.foreground, fontFamily: "Inter_700Bold" },
                  isCancelled && styles.strikethrough,
                ]}
                numberOfLines={1}
              >
                {shift.participant_name ?? t("shifts.listCard.participant")}
              </Text>
              {!isCancelled && !isCompleted && <ShiftStatusBadge visualState={shift.visual_state} />}
              {isCompleted && (
                <Text style={[styles.doneBadge, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
                  {t("shifts.listCard.done").toUpperCase()}
                </Text>
              )}
            </View>

            <Text style={[styles.time, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
              {formatShiftTimeRange(shift.scheduled_start, shift.scheduled_end)}
            </Text>

            <View style={styles.addressRow}>
              <Feather
                name="map-pin"
                size={12}
                color={shift.participant_address ? colors.primary : colors.mutedForeground}
                style={styles.addressIcon}
              />
              <Text
                style={[
                  styles.address,
                  { color: colors.mutedForeground, fontFamily: "Inter_400Regular" },
                  !shift.participant_address && styles.italic,
                ]}
                numberOfLines={2}
              >
                {shift.participant_address?.trim() || t("shifts.listCard.noAddress")}
              </Text>
            </View>
          </View>
        </View>

        {showDetails && goals.length > 0 && (
          <View style={styles.goalRow}>
            {goals.map((goal, i) => (
              <View key={i} style={[styles.goalChip, { backgroundColor: colors.activeBg }]}>
                <Feather name="star" size={10} color="#F59E0B" />
                <Text
                  style={[styles.goalText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}
                  numberOfLines={1}
                >
                  {formatActiveGoalLabel(goal)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {showDetails && emergencyContact && (
          <View style={[styles.detailCard, { backgroundColor: colors.soft, borderColor: colors.border }]}>
            <View style={styles.detailTop}>
              <View style={styles.detailTextCol}>
                <Text style={[styles.detailEyebrow, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
                  {t("shifts.listCard.nextOfKin").toUpperCase()}
                </Text>
                {emergencyContact.name ? (
                  <Text style={[styles.detailTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                    {emergencyContact.name}
                  </Text>
                ) : null}
                <Text style={[styles.detailSub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {emergencyContact.detail || emergencyContact.text}
                </Text>
              </View>
              {emergencyContact.phone ? (
                <Pressable
                  onPress={() => Linking.openURL(`tel:${emergencyContact.phone!.replace(/\s/g, "")}`)}
                  style={[styles.detailCallBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                >
                  <Feather name="phone" size={12} color={colors.primary} />
                  <Text style={[styles.detailCallText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                    {t("shifts.listCard.call")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}

        {showDetails && (caseManager?.name || notesText) && (
          <View style={[styles.detailCard, { backgroundColor: colors.soft, borderColor: colors.border }]}>
            <View style={styles.detailTop}>
              <View style={styles.detailInline}>
                <Feather name="clipboard" size={14} color={colors.primary} />
                <Text
                  style={[styles.detailTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
                  numberOfLines={1}
                >
                  {caseManager?.name || t("shifts.listCard.messageCoordinator")}
                </Text>
              </View>
              <Pressable
                onPress={() => router.push("/worker/messages" as never)}
                style={styles.detailInlineBtn}
              >
                <Feather name="mail" size={12} color={colors.accent} />
                <Text style={[styles.detailCallText, { color: colors.accent, fontFamily: "Inter_700Bold" }]}>
                  {t("shifts.listCard.message")}
                </Text>
              </Pressable>
            </View>
            {notesText ? (
              <Text style={[styles.notesText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                {notesText}
              </Text>
            ) : null}
            {coordinatorLine || officePhone ? (
              <Text style={[styles.detailSub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                {coordinatorLine || officePhone}
              </Text>
            ) : null}
          </View>
        )}

        {showDetails && medicalAlert && (
          <View style={[styles.alertCard, { backgroundColor: colors.alertBg, borderColor: colors.destructive }]}>
            <View style={styles.detailInline}>
              <Feather name="alert-triangle" size={13} color={colors.destructive} />
              <Text style={[styles.alertTitle, { color: colors.destructive, fontFamily: "Inter_700Bold" }]}>
                {t("shifts.listCard.medicalAlert")}
              </Text>
            </View>
            <Text style={[styles.alertText, { color: colors.destructive, fontFamily: "Inter_500Medium" }]}>
              {medicalAlert}
            </Text>
          </View>
        )}
      </View>

      {showActions && !isCancelled && !isCompleted && (
        <View style={styles.actions}>
          <Pressable
            onPress={() => {
              if (mapsUrl) {
                void Linking.openURL(mapsUrl);
                return;
              }
              showAlert(t("shifts.listCard.directions"), t("shifts.listCard.noLocationStored"));
            }}
            style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Feather name="navigation" size={14} color={colors.foreground} />
            <Text style={[styles.secondaryBtnText, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              {t("shifts.listCard.directions")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => {
              if (phone) {
                void Linking.openURL(`tel:${phone.replace(/\s/g, "")}`);
                return;
              }
              showAlert(t("shifts.listCard.call"), t("shifts.listCard.noPhoneStored"));
            }}
            style={[styles.iconBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Feather name="phone" size={14} color={colors.foreground} />
          </Pressable>

          <Pressable
            onPress={() => void handleClockIn()}
            disabled={starting}
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
          >
            {starting ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>{actionLabel}</Text>
            )}
          </Pressable>
        </View>
      )}

      {isCompleted && (
        <Pressable
          onPress={() => navigateToShift()}
          style={[styles.completeBtn, { backgroundColor: colors.accent }]}
        >
          <Text style={[styles.primaryBtnText, { fontFamily: "Inter_700Bold" }]}>
            {t("shifts.listCard.completeNotes")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 12,
  },
  row: {
    flexDirection: "row",
    gap: 12,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPulse: {
    opacity: 0.9,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 14,
  },
  content: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  name: {
    fontSize: 16,
    flex: 1,
  },
  strikethrough: {
    textDecorationLine: "line-through",
  },
  doneBadge: {
    fontSize: 10,
    letterSpacing: 0.5,
  },
  time: {
    fontSize: 13,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
    marginTop: 2,
  },
  addressIcon: { marginTop: 2 },
  address: {
    fontSize: 12,
    flex: 1,
  },
  italic: { fontStyle: "italic" },
  goalRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 10,
  },
  goalChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: "100%",
  },
  goalText: { fontSize: 11 },
  detailCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
    marginTop: 10,
  },
  detailTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 8,
  },
  detailTextCol: { flex: 1, gap: 2 },
  detailInline: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  detailInlineBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  detailEyebrow: { fontSize: 9, letterSpacing: 0.8 },
  detailTitle: { fontSize: 13, flexShrink: 1 },
  detailSub: { fontSize: 12, lineHeight: 16 },
  detailCallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  detailCallText: { fontSize: 11 },
  notesText: { fontSize: 12, lineHeight: 18 },
  alertCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
    marginTop: 10,
  },
  alertTitle: { fontSize: 11 },
  alertText: { fontSize: 12, lineHeight: 17 },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  secondaryBtn: {
    flex: 1,
    height: 48,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  secondaryBtnText: {
    fontSize: 12,
  },
  iconBtn: {
    height: 48,
    width: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    flex: 1.35,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
  },
  completeBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
