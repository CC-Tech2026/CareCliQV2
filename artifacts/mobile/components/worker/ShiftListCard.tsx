import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/haptics";
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
import { WorkerMobileRiskStrip } from "@/components/worker/WorkerMobileRiskStrip";
import { useT } from "@/context/PreferencesContext";
import { showAlert } from "@/lib/alert";
import { useColors } from "@/hooks/useColors";
import { startShiftSession, type WorkerShift } from "@/lib/worker-api";
import {
  APP_TIMEZONE,
  avatarShouldPulse,
  emergencyContactDisplay,
  findInProgressShift,
  formatActiveGoalLabel,
  formatShiftTimeRange,
  isBlockedByInProgressShift,
  isShiftCompletedForList,
  parseIsoMs,
  shiftInitials,
} from "@/lib/shift-utils";
import { showBlockedByInProgressAlert } from "@/lib/shift-block-alert";

type Props = {
  shift: WorkerShift;
  showActions?: boolean;
  onRefresh?: () => void;
  /** Other shifts on the same list — used to block opening Upcoming while one is In progress. */
  siblingShifts?: WorkerShift[];
};

export function ShiftListCard({
  shift,
  showActions = false,
  onRefresh,
  siblingShifts = [],
}: Props) {
  const colors = useColors();
  const router = useRouter();
  const t = useT();
  const [starting, setStarting] = useState(false);

  const isCancelled = shift.status === "cancelled";
  const isCompleted = isShiftCompletedForList(shift);
  const docsDueMs = parseIsoMs(shift.documentation_due_at);
  const docsOverdue = docsDueMs != null && docsDueMs < Date.now();
  const pulse = !isCompleted && avatarShouldPulse(shift.visual_state);
  const showDetails = showActions && !isCompleted;
  const [preparationOpen, setPreparationOpen] = useState(false);
  const [preparationTab, setPreparationTab] = useState<"focus" | "contacts">(
    "focus",
  );
  const isSessionLive = shift.visual_state === "session_active";
  const inProgressShift = findInProgressShift(
    siblingShifts.length ? siblingShifts : [shift],
  );

  const avatarColor = isCancelled ? colors.destructive : colors.soft;
  const avatarTextColor = isCancelled ? "#FFFFFF" : colors.primary;

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
  const healthAlerts = shift.health_alerts ?? [];
  const medicalFallback =
    shift.health_flags?.trim() || shift.allergies?.trim() || null;
  const hasMedicalInfo = healthAlerts.length > 0 || Boolean(medicalFallback);
  const emergencyContact = emergencyContactDisplay(
    shift.profile?.emergency_contact,
  );
  const caseManager = shift.profile?.case_manager;
  const hasCaseManagerInfo = Boolean(
    caseManager?.name?.trim() || caseManager?.phone || caseManager?.email,
  );
  const officePhone = shift.office_contact_number?.trim() || null;

  const showBlockedAlert = () => {
    showBlockedByInProgressAlert(t, inProgressShift, (id) =>
      router.push(`/shift/${id}` as never),
    );
  };

  const navigateToShift = () => {
    if (isBlockedByInProgressShift(shift, inProgressShift)) {
      showBlockedAlert();
      return;
    }
    router.push(`/shift/${shift.id}` as never);
  };

  const runStartSession = async () => {
    await startShiftSession(shift.id);
    onRefresh?.();
    navigateToShift();
  };

  const handleClockIn = async () => {
    if (starting) return;

    if (isBlockedByInProgressShift(shift, inProgressShift)) {
      showBlockedAlert();
      return;
    }

    if (isSessionLive) {
      navigateToShift();
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

    // Review participant information and use the shared GPS/QR chooser.
    navigateToShift();
  };

  const actionLabel = starting
    ? t("shifts.listCard.starting")
    : isSessionLive
      ? t("shifts.listCard.resumeSession")
      : shift.visual_state === "clocked_in"
        ? t("shifts.listCard.startSession")
        : t("shifts.listCard.reviewClockIn");

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
      <View style={[styles.scheduleBand, { borderBottomColor: colors.border }]}>
        <View style={styles.timeRow}>
          <Feather name="clock" size={16} color={colors.primary} />
          <Text
            style={[
              styles.time,
              {
                color: colors.foreground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {formatShiftTimeRange(shift.scheduled_start, shift.scheduled_end)}
          </Text>
        </View>
        {isCancelled ? (
          <Text
            style={{
              color: colors.destructive,
              fontFamily: FontFamily.interSemiBold,
            }}
          >
            {t("shifts.listCard.cancelled")}
          </Text>
        ) : (
          <ShiftStatusBadge
            visualState={isCompleted ? "completed" : shift.visual_state}
          />
        )}
      </View>
      {shift.documentation_pending && (
        <View
          style={[
            styles.docsPendingBanner,
            {
              backgroundColor: docsOverdue ? colors.dangerBg : colors.statusProgressBg,
            },
          ]}
        >
          <Feather
            name="alert-triangle"
            size={13}
            color={docsOverdue ? colors.destructive : colors.warning}
          />
          <Text
            style={[
              styles.docsPendingText,
              {
                color: docsOverdue ? colors.destructive : colors.warning,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {docsOverdue ? "Documentation overdue" : "Documentation needed"}
          </Text>
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={navigateToShift}>
        <View style={styles.row}>
          <View
            style={[
              styles.avatar,
              { backgroundColor: avatarColor },
              pulse && styles.avatarPulse,
            ]}
          >
            <Text
              style={[
                styles.avatarText,
                {
                  color: avatarTextColor,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {shiftInitials(shift.participant_name)}
            </Text>
          </View>

          <View style={styles.content}>
            <View style={styles.titleRow}>
              <Text
                style={[
                  styles.name,
                  {
                    color: colors.foreground,
                    fontFamily: FontFamily.interBold,
                  },
                  isCancelled && styles.strikethrough,
                ]}
              >
                {shift.participant_name ?? t("shifts.listCard.participant")}
              </Text>
            </View>

            <View style={styles.addressRow}>
              <Feather
                name="map-pin"
                size={12}
                color={
                  shift.participant_address
                    ? colors.primary
                    : colors.mutedForeground
                }
                style={styles.addressIcon}
              />
              <Text
                style={[
                  styles.address,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interRegular,
                  },
                  !shift.participant_address && styles.italic,
                ]}
                numberOfLines={2}
              >
                {shift.participant_address?.trim() ||
                  t("shifts.listCard.noAddress")}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>

      {showDetails && hasMedicalInfo && (
        <WorkerMobileRiskStrip
          alerts={healthAlerts}
          fallbackSummary={medicalFallback}
          alwaysExpandable
          embedded
          headerTitle={t("shifts.listCard.medicalAlert")}
        />
      )}

      {showActions && !isCancelled && !isCompleted && (
        <View style={styles.actions}>
          {mapsUrl ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (mapsUrl) {
                  void Linking.openURL(mapsUrl);
                  return;
                }
                showAlert(
                  t("shifts.listCard.directions"),
                  t("shifts.listCard.noLocationStored"),
                );
              }}
              style={[
                styles.secondaryBtn,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
            >
              <Feather name="navigation" size={14} color={colors.foreground} />
              <Text
                style={[
                  styles.secondaryBtnText,
                  {
                    color: colors.foreground,
                    fontFamily: FontFamily.interBold,
                  },
                ]}
              >
                {t("shifts.listCard.directions")}
              </Text>
            </Pressable>
          ) : null}

          {phone ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (phone) {
                  void Linking.openURL(`tel:${phone.replace(/\s/g, "")}`);
                  return;
                }
                showAlert(
                  t("shifts.listCard.call"),
                  t("shifts.listCard.noPhoneStored"),
                );
              }}
              style={[
                styles.iconBtn,
                { borderColor: colors.border, backgroundColor: colors.card },
              ]}
              accessibilityLabel={t("shifts.listCard.call")}
            >
              <Feather name="phone" size={14} color={colors.foreground} />
            </Pressable>
          ) : null}

          <Pressable
            accessibilityRole="button"
            onPress={() => void handleClockIn()}
            disabled={starting}
            accessibilityState={{ disabled: starting, busy: starting }}
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
          >
            {starting ? (
              <ActivityIndicator
                color={colors.primaryForeground}
                size="small"
              />
            ) : (
              <Text
                style={[
                  styles.primaryBtnText,
                  {
                    fontFamily: FontFamily.interBold,
                    color: colors.primaryForeground,
                  },
                ]}
              >
                {actionLabel}
              </Text>
            )}
          </Pressable>
        </View>
      )}

      {showDetails &&
      (goals.length > 0 ||
        emergencyContact ||
        hasCaseManagerInfo ||
        officePhone ||
        notesText) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: preparationOpen }}
          onPress={() => setPreparationOpen((open) => !open)}
          style={[styles.preparationToggle, { borderColor: colors.border }]}
        >
          <Feather name="file-text" size={18} color={colors.primary} />
          <Text
            style={{
              flex: 1,
              color: colors.primary,
              fontFamily: FontFamily.interSemiBold,
              fontSize: 14,
            }}
          >
            {t("shifts.listCard.preparation")}
          </Text>
          <Feather
            name={preparationOpen ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.primary}
          />
        </Pressable>
      ) : null}
      {showDetails && preparationOpen ? (
        <View style={[styles.preparationBody, { borderColor: colors.border }]}>
          <View style={[styles.prepTabs, { backgroundColor: colors.soft }]}>
            {(["focus", "contacts"] as const).map((tab) => (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityState={{ selected: preparationTab === tab }}
                onPress={() => setPreparationTab(tab)}
                style={[
                  styles.prepTab,
                  preparationTab === tab && { backgroundColor: colors.card },
                ]}
              >
                <Text
                  style={[
                    styles.actionText,
                    {
                      color:
                        preparationTab === tab
                          ? colors.primary
                          : colors.mutedForeground,
                    },
                  ]}
                >
                  {t(
                    tab === "focus"
                      ? "shifts.listCard.shiftFocus"
                      : "shifts.listCard.contacts",
                  )}
                </Text>
              </Pressable>
            ))}
          </View>
          {preparationTab === "focus" && !goals.length && !notesText ? (
            <Text style={[styles.prepText, { color: colors.mutedForeground }]}>
              {t("shifts.listCard.noPreparationNotes")}
            </Text>
          ) : null}
          {preparationTab === "contacts" &&
          !emergencyContact &&
          !hasCaseManagerInfo &&
          !officePhone ? (
            <Text style={[styles.prepText, { color: colors.mutedForeground }]}>
              {t("shifts.listCard.noContacts")}
            </Text>
          ) : null}
          {preparationTab === "focus" && goals.length > 0 ? (
            <View style={styles.prepSection}>
              <Text
                accessibilityRole="header"
                style={[styles.sectionLabel, { color: colors.mutedForeground }]}
              >
                {t("shifts.listCard.shiftFocus")}
              </Text>
              {goals.map((goal, index) => (
                <View key={index} style={styles.focusRow}>
                  <Feather
                    name="check-circle"
                    size={16}
                    color={colors.primary}
                  />
                  <Text
                    style={[
                      styles.prepText,
                      { color: colors.foreground, flex: 1 },
                    ]}
                  >
                    {formatActiveGoalLabel(goal)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          {preparationTab === "focus" && notesText ? (
            <View style={styles.prepSection}>
              <Text
                accessibilityRole="header"
                style={[styles.sectionLabel, { color: colors.mutedForeground }]}
              >
                {t("shifts.listCard.shiftInstructions")}
              </Text>
              <Text style={[styles.prepText, { color: colors.foreground }]}>
                {notesText}
              </Text>
            </View>
          ) : null}
          {preparationTab === "contacts" && emergencyContact ? (
            <View style={styles.prepSection}>
              <Text
                accessibilityRole="header"
                style={[styles.sectionLabel, { color: colors.mutedForeground }]}
              >
                {t("shifts.listCard.nextOfKin")}
              </Text>
              <Text style={[styles.contactName, { color: colors.foreground }]}>
                {emergencyContact.name || emergencyContact.text}
              </Text>
              {emergencyContact.detail ? (
                <Text
                  style={[styles.prepText, { color: colors.mutedForeground }]}
                >
                  {emergencyContact.detail}
                </Text>
              ) : null}
              {emergencyContact.phone ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    t("shifts.listCard.call") +
                    " " +
                    (emergencyContact.name || emergencyContact.phone)
                  }
                  onPress={() =>
                    void Linking.openURL(
                      `tel:${emergencyContact.phone!.replace(/\s/g, "")}`,
                    )
                  }
                  style={[styles.contactAction, { borderColor: colors.border }]}
                >
                  <Feather name="phone" size={16} color={colors.primary} />
                  <Text style={[styles.actionText, { color: colors.primary }]}>
                    {t("shifts.listCard.call")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {preparationTab === "contacts" &&
          (hasCaseManagerInfo || officePhone) ? (
            <View style={styles.prepSection}>
              <Text
                accessibilityRole="header"
                style={[styles.sectionLabel, { color: colors.mutedForeground }]}
              >
                {hasCaseManagerInfo
                  ? t("shifts.listCard.caseManager")
                  : t("shifts.listCard.noCaseManager")}
              </Text>
              {caseManager?.name ? (
                <Text
                  style={[styles.contactName, { color: colors.foreground }]}
                >
                  {caseManager.name}
                </Text>
              ) : null}
              {[caseManager?.phone, caseManager?.email]
                .filter(Boolean)
                .map((value, index) => (
                  <Text
                    key={index}
                    style={[styles.prepText, { color: colors.mutedForeground }]}
                  >
                    {value}
                  </Text>
                ))}
              <View style={styles.contactActions}>
                {caseManager?.phone ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      void Linking.openURL(
                        `tel:${caseManager.phone!.replace(/[^+\d]/g, "")}`,
                      )
                    }
                    style={[
                      styles.contactAction,
                      { borderColor: colors.border },
                    ]}
                  >
                    <Text
                      style={[styles.actionText, { color: colors.primary }]}
                    >
                      {t("shifts.listCard.callCaseManager")}
                    </Text>
                  </Pressable>
                ) : null}
                {caseManager?.email ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() =>
                      void Linking.openURL(
                        `mailto:${caseManager.email!.trim()}`,
                      )
                    }
                    style={[
                      styles.contactAction,
                      { borderColor: colors.border },
                    ]}
                  >
                    <Text
                      style={[styles.actionText, { color: colors.primary }]}
                    >
                      {t("shifts.listCard.emailCaseManager")}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              <Text
                style={[
                  styles.sectionLabel,
                  { color: colors.mutedForeground, marginTop: 12 },
                ]}
              >
                {t("shifts.listCard.officeTeam")}
              </Text>
              {officePhone ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    void Linking.openURL(
                      `tel:${officePhone.replace(/[^+\d]/g, "")}`,
                    )
                  }
                  style={[styles.contactAction, { borderColor: colors.border }]}
                >
                  <Text style={[styles.actionText, { color: colors.primary }]}>
                    {t("shifts.listCard.callOffice")} / {officePhone}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() =>
                  router.push(`/shift/${shift.id}/message-office` as never)
                }
                style={[styles.contactAction, { borderColor: colors.border }]}
              >
                <Feather
                  name="message-circle"
                  size={16}
                  color={colors.primary}
                />
                <Text style={[styles.actionText, { color: colors.primary }]}>
                  {t("shifts.listCard.messageOffice")}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      ) : null}

      {isCompleted && (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigateToShift()}
          style={[styles.completeBtn, { backgroundColor: colors.primary }]}
        >
          <Text
            style={[
              styles.primaryBtnText,
              {
                fontFamily: FontFamily.interBold,
                color: colors.primaryForeground,
              },
            ]}
          >
            {t("shifts.listCard.completeNotes")}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 12,
    gap: 12,
  },
  scheduleBand: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingBottom: 14,
    borderBottomWidth: 1,
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  docsPendingBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  docsPendingText: { fontSize: 12 },
  preparationToggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  prepTabs: { flexDirection: "row", gap: 4, padding: 4, borderRadius: 14 },
  prepTab: {
    flex: 1,
    minHeight: 44,
    padding: 8,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  preparationBody: { borderTopWidth: 1, paddingTop: 10, gap: 12 },
  prepSection: { gap: 6 },
  sectionLabel: {
    fontFamily: FontFamily.interMedium,
    fontSize: 13,
    lineHeight: 19,
  },
  prepText: { fontFamily: FontFamily.body, fontSize: 14, lineHeight: 22 },
  contactName: {
    fontFamily: FontFamily.interSemiBold,
    fontSize: 16,
    lineHeight: 23,
  },
  focusRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  contactActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  contactAction: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },
  actionText: {
    fontFamily: FontFamily.interSemiBold,
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  avatar: {
    width: 48,
    height: 48,
    alignSelf: "flex-start",
    flexShrink: 0,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPulse: {
    opacity: 0.9,
  },
  avatarText: {
    fontSize: 12,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  name: {
    fontSize: 18,
    lineHeight: 25,
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
    fontSize: 15,
    lineHeight: 22,
    flexShrink: 1,
  },
  addressRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 4,
    marginTop: 2,
  },
  addressIcon: { marginTop: 2 },
  address: {
    fontSize: 14,
    lineHeight: 21,
    flex: 1,
  },
  italic: { fontStyle: "italic" },
  actions: {
    flexWrap: "wrap",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  secondaryBtn: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 10,
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
    minHeight: 48,
    paddingVertical: 10,
    width: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    width: "100%",
    paddingHorizontal: 16,
    minHeight: 48,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  completeBtn: {
    minHeight: 48,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});
