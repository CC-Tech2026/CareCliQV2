import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/haptics";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useShiftReviews } from "@/hooks/worker/useShiftReviews";
import { ReviewStatusChip } from "@/components/worker/review/ShiftReviewItem";
import { ShiftStatusBadge } from "@/components/worker/ShiftStatusBadge";
import { WorkerMobileRiskStrip } from "@/components/worker/WorkerMobileRiskStrip";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/lib/alert";
import { startShiftSession, type WorkerShift } from "@/lib/worker-api";
import { showBlockedByInProgressAlert } from "@/lib/shift-block-alert";
import {
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

type Props = {
  shift: WorkerShift;
  showActions?: boolean;
  onRefresh?: () => void;
  siblingShifts?: WorkerShift[];
};

/**
 * Extract a short readable label without assuming a specific alert shape.
 * The full clinical information is always available in the Care brief sheet.
 */
function getMedicalPreview(alerts: unknown[], fallback: string | null): string {
  const labels = alerts
    .map((alert) => {
      if (typeof alert === "string") return alert.trim();
      if (!alert || typeof alert !== "object") return "";
      const entry = alert as Record<string, unknown>;
      for (const key of ["title", "name", "label", "condition", "message"]) {
        const value = entry[key];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return "";
    })
    .filter(Boolean);

  if (labels.length > 0) {
    const extra = alerts.length - 1;
    return extra > 0 ? `${labels[0]} + ${extra} more` : labels[0];
  }
  if (alerts.length > 0) {
    return `${alerts.length} medical alert${alerts.length === 1 ? "" : "s"} recorded`;
  }
  return fallback || "Medical information recorded";
}

/**
 * CareCliQ worker shift card — two levels of information:
 * 1) A short list card for time, participant, risks, and actions.
 * 2) One clearly-labelled Care brief sheet for the complete care details.
 *
 * No carousel, flip gestures, nested scroll areas, or changing card heights.
 */
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
  const [briefOpen, setBriefOpen] = useState(false);

  const reviews = useShiftReviews(true);
  const review = reviews.data?.shifts.find(
    (item) => item.shift_id === shift.id,
  );
  const canReopen = review?.review_status === "changes_requested";

  const isCancelled = shift.status === "cancelled";
  const isCompleted = isShiftCompletedForList(shift);
  const isSessionLive = !isCompleted && shift.visual_state === "session_active";
  const isClockedIn = !isCompleted && shift.visual_state === "clocked_in";
  const isActive = !isCancelled && !isCompleted;
  const showActiveActions = showActions && isActive;
  const showLiveDot = isActive && avatarShouldPulse(shift.visual_state);

  const name =
    shift.participant_name?.trim() || t("shifts.listCard.participant");
  const firstName = name.split(/\s+/)[0];
  const address = shift.participant_address?.trim() || null;
  const phone = shift.participant_phone?.trim() || null;
  const mapsUrl = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : null;

  const goals = shift.active_goals ?? [];
  const noteItems = [
    { label: "Coordinator notes", text: shift.coordinator_notes?.trim() },
    { label: "Visit notes", text: shift.visit_notes?.trim() },
    { label: "Special instructions", text: shift.special_instructions?.trim() },
  ].filter((item): item is { label: string; text: string } =>
    Boolean(item.text),
  );
  const instructions = noteItems[0]?.text || null;
  const healthAlerts = shift.health_alerts ?? [];
  const healthFallback =
    shift.health_flags?.trim() || shift.allergies?.trim() || null;
  const hasMedical = healthAlerts.length > 0 || Boolean(healthFallback);
  const emergency = emergencyContactDisplay(shift.profile?.emergency_contact);
  const hasCareBrief =
    goals.length > 0 ||
    noteItems.length > 0 ||
    hasMedical ||
    Boolean(emergency);

  const carePreview =
    goals.length > 0
      ? formatActiveGoalLabel(goals[0])
      : instructions
        ? instructions
        : hasMedical
          ? "Medical information and safety alerts"
          : "Emergency contact information";

  const medicalPreview = getMedicalPreview(healthAlerts, healthFallback);
  const docsDueMs = parseIsoMs(shift.documentation_due_at);
  const docsOverdue = docsDueMs != null && docsDueMs < Date.now();
  const inProgressShift = findInProgressShift(
    siblingShifts.length ? siblingShifts : [shift],
  );

  const showBlockedAlert = useCallback(() => {
    showBlockedByInProgressAlert(t, inProgressShift, (id) =>
      router.push(`/shift/${id}` as never),
    );
  }, [t, inProgressShift, router]);

  const navigateToShift = useCallback(() => {
    if (isCompleted && !canReopen) return;
    if (isBlockedByInProgressShift(shift, inProgressShift)) {
      showBlockedAlert();
      return;
    }
    router.push(
      (isCompleted
        ? `/shift/${shift.id}/record`
        : `/shift/${shift.id}`) as never,
    );
  }, [
    shift,
    isCompleted,
    canReopen,
    inProgressShift,
    showBlockedAlert,
    router,
  ]);

  const handlePrimaryAction = useCallback(async () => {
    if (starting) return;

    if (isBlockedByInProgressShift(shift, inProgressShift)) {
      showBlockedAlert();
      return;
    }

    if (isSessionLive) {
      navigateToShift();
      return;
    }

    if (isClockedIn) {
      setStarting(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        await startShiftSession(shift.id);
        onRefresh?.();
        navigateToShift();
      } catch (error) {
        showAlert(
          t("shifts.listCard.clockInFailed"),
          error instanceof Error
            ? error.message
            : t("shifts.listCard.tryAgain"),
        );
      } finally {
        setStarting(false);
      }
      return;
    }

    navigateToShift();
  }, [
    starting,
    shift,
    inProgressShift,
    showBlockedAlert,
    isSessionLive,
    isClockedIn,
    navigateToShift,
    onRefresh,
    t,
  ]);

  const openPhone = (value: string) => {
    const sanitised = value.replace(/[^\d+]/g, "");
    if (sanitised) void Linking.openURL(`tel:${sanitised}`);
  };

  const primaryLabel = starting
    ? "Starting..."
    : isSessionLive
      ? "Resume session"
      : isClockedIn
        ? "Start session"
        : "View shift";

  return (
    <View
      testID={`shift-card-${shift.id}`}
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          opacity: isCancelled ? 0.78 : 1,
        },
      ]}
    >
      {/* At-a-glance information, always in the same place. */}
      <View style={styles.header}>
        <View style={styles.timeWrap}>
          <Feather name="clock" size={15} color={colors.primary} />
          <Text
            numberOfLines={1}
            style={[
              styles.time,
              { color: colors.foreground, fontFamily: FontFamily.interBold },
            ]}
          >
            {formatShiftTimeRange(
              shift.scheduled_start,
              shift.scheduled_end,
              shift.timezone,
            )}
          </Text>
        </View>
        {isCancelled ? (
          <Text style={[styles.cancelled, { color: colors.destructive }]}>
            {t("shifts.listCard.cancelled")}
          </Text>
        ) : isCompleted && review ? (
          <ReviewStatusChip status={review.review_status} />
        ) : (
          <ShiftStatusBadge
            visualState={isCompleted ? "completed" : shift.visual_state}
          />
        )}
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={isCompleted && !canReopen}
        accessibilityState={{ disabled: isCompleted && !canReopen }}
        accessibilityLabel={`Shift for ${name}`}
        onPress={navigateToShift}
        style={styles.personRow}
      >
        <View style={[styles.avatar, { backgroundColor: colors.soft }]}>
          <Text
            style={[
              styles.initials,
              {
                color: isCancelled ? colors.destructive : colors.primary,
                fontFamily: FontFamily.interBold,
              },
            ]}
          >
            {shiftInitials(shift.participant_name)}
          </Text>
          {showLiveDot && (
            <View
              style={[
                styles.liveDot,
                { backgroundColor: colors.success, borderColor: colors.card },
              ]}
            />
          )}
        </View>
        <View style={styles.personText}>
          <Text
            numberOfLines={1}
            style={[
              styles.personName,
              { color: colors.foreground, fontFamily: FontFamily.interBold },
              isCancelled && styles.strikethrough,
            ]}
          >
            {name}
          </Text>
          <View style={styles.addressRow}>
            <Feather name="map-pin" size={12} color={colors.mutedForeground} />
            <Text
              numberOfLines={1}
              style={[styles.address, { color: colors.mutedForeground }]}
            >
              {address || t("shifts.listCard.noAddress")}
            </Text>
          </View>
        </View>
        <Feather
          name="chevron-right"
          size={19}
          color={colors.mutedForeground}
        />
      </Pressable>

      {/* This alert is intentionally outside the Care brief. It should never be hidden. */}
      {isActive && hasMedical && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Medical alert: ${medicalPreview}. Read full care brief`}
          onPress={() => setBriefOpen(true)}
          style={[
            styles.alertRow,
            {
              backgroundColor: colors.dangerBg,
              borderColor: colors.dangerBorder,
            },
          ]}
        >
          <Feather name="alert-triangle" size={15} color={colors.destructive} />
          <Text
            numberOfLines={1}
            style={[styles.alertText, { color: colors.destructive }]}
          >
            <Text style={{ fontFamily: FontFamily.interBold }}>
              Medical alert ·{" "}
            </Text>
            {medicalPreview}
          </Text>
          <Feather name="chevron-right" size={15} color={colors.destructive} />
        </Pressable>
      )}

      {shift.documentation_pending && !isCancelled && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            docsOverdue
              ? "Documentation overdue. View shift"
              : "Documentation needed. View shift"
          }
          onPress={navigateToShift}
          style={styles.docsRow}
        >
          <Feather
            name="alert-circle"
            size={14}
            color={docsOverdue ? colors.destructive : colors.warning}
          />
          <Text
            style={[
              styles.docsText,
              { color: docsOverdue ? colors.destructive : colors.warning },
            ]}
          >
            {docsOverdue ? "Documentation overdue" : "Documentation needed"}
          </Text>
          <Feather
            name="arrow-up-right"
            size={13}
            color={colors.mutedForeground}
          />
        </Pressable>
      )}

      {/* One obvious way to access all detail, instead of a carousel inside a list. */}
      {showActiveActions && hasCareBrief && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open care brief for ${name}`}
          onPress={() => setBriefOpen(true)}
          style={[styles.briefRow, { backgroundColor: colors.soft }]}
        >
          <View style={[styles.briefIcon, { backgroundColor: colors.card }]}>
            <Feather name="clipboard" size={17} color={colors.primary} />
          </View>
          <View style={styles.briefCopy}>
            <Text style={[styles.briefTitle, { color: colors.foreground }]}>
              Care Instructions
            </Text>
            <Text
              numberOfLines={1}
              style={[styles.briefPreview, { color: colors.mutedForeground }]}
            >
              {carePreview}
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.primary} />
        </Pressable>
      )}

      {showActiveActions && (mapsUrl || phone) && (
        <View style={styles.quickActions}>
          {mapsUrl && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Get directions to ${name}`}
              onPress={() => void Linking.openURL(mapsUrl)}
              style={[styles.secondaryButton, { borderColor: colors.border }]}
            >
              <Feather name="navigation" size={16} color={colors.primary} />
              <Text
                style={[styles.secondaryText, { color: colors.foreground }]}
              >
                Directions
              </Text>
            </Pressable>
          )}
          {phone && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Call ${name}`}
              onPress={() => openPhone(phone)}
              style={[styles.secondaryButton, { borderColor: colors.border }]}
            >
              <Feather name="phone" size={16} color={colors.success} />
              <Text
                numberOfLines={1}
                style={[styles.secondaryText, { color: colors.foreground }]}
              >
                Call {firstName}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {showActiveActions && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          disabled={starting}
          onPress={() => void handlePrimaryAction()}
          style={[
            styles.primaryButton,
            { backgroundColor: colors.primary, opacity: starting ? 0.72 : 1 },
          ]}
        >
          {starting ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <>
              <Text
                style={[
                  styles.primaryText,
                  {
                    color: colors.primaryForeground,
                    fontFamily: FontFamily.interBold,
                  },
                ]}
              >
                {primaryLabel}
              </Text>
              <Feather
                name={isSessionLive ? "play-circle" : "arrow-right"}
                size={17}
                color={colors.primaryForeground}
              />
            </>
          )}
        </Pressable>
      )}

      {isCompleted && !isCancelled && canReopen && (
        <Pressable
          accessibilityRole="button"
          onPress={navigateToShift}
          style={[styles.primaryButton, { backgroundColor: colors.primary }]}
        >
          <Text
            style={[
              styles.primaryText,
              {
                color: colors.primaryForeground,
                fontFamily: FontFamily.interBold,
              },
            ]}
          >
            Review requested changes
          </Text>
          <Feather
            name="arrow-right"
            size={17}
            color={colors.primaryForeground}
          />
        </Pressable>
      )}

      {/* Details live in one readable sheet. The card itself never scrolls. */}
      {hasCareBrief && (
        <Modal
          animationType="slide"
          transparent
          visible={briefOpen}
          statusBarTranslucent
          onRequestClose={() => setBriefOpen(false)}
        >
          <View style={styles.overlay}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close care brief"
              style={styles.overlayDismiss}
              onPress={() => setBriefOpen(false)}
            />
            <View style={[styles.sheet, { backgroundColor: colors.card }]}>
              <View
                style={[styles.sheetHandle, { backgroundColor: colors.border }]}
              />
              <View style={styles.sheetHeading}>
                <View style={styles.sheetHeaderText}>
                  <Text
                    style={[
                      styles.sheetTitle,
                      {
                        color: colors.foreground,
                        fontFamily: FontFamily.interBold,
                      },
                    ]}
                  >
                    Care Instructions
                  </Text>
                  <Text
                    style={[
                      styles.sheetSubtitle,
                      { color: colors.mutedForeground },
                    ]}
                  >
                    {name}
                  </Text>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Close care brief"
                  onPress={() => setBriefOpen(false)}
                  style={[styles.closeButton, { backgroundColor: colors.soft }]}
                >
                  <Feather name="x" size={19} color={colors.foreground} />
                </Pressable>
              </View>

              <ScrollView
                style={styles.sheetScroll}
                contentContainerStyle={styles.sheetContent}
                showsVerticalScrollIndicator
              >
                {hasMedical && (
                  <View style={styles.sheetSection}>
                    <View style={styles.sectionHeading}>
                      <Feather
                        name="shield"
                        size={17}
                        color={colors.destructive}
                      />
                      <Text
                        style={[
                          styles.sectionTitle,
                          { color: colors.foreground },
                        ]}
                      >
                        Medical & safety information
                      </Text>
                    </View>
                    <WorkerMobileRiskStrip
                      alerts={healthAlerts}
                      fallbackSummary={healthFallback}
                      alwaysExpandable={false}
                      embedded
                      headerTitle={t("shifts.listCard.medicalAlert")}
                    />
                  </View>
                )}

                {goals.length > 0 && (
                  <View style={styles.sheetSection}>
                    <View style={styles.sectionHeading}>
                      <Feather name="target" size={17} color={colors.primary} />
                      <Text
                        style={[
                          styles.sectionTitle,
                          { color: colors.foreground },
                        ]}
                      >
                        Shift goals
                      </Text>
                      <Text
                        style={[
                          styles.count,
                          { color: colors.mutedForeground },
                        ]}
                      >
                        {goals.length}
                      </Text>
                    </View>
                    {goals.map((goal, index) => (
                      <View key={index} style={styles.goalRow}>
                        <Feather
                          name="check-circle"
                          size={15}
                          color={colors.primary}
                        />
                        <Text
                          style={[
                            styles.bodyText,
                            styles.goalText,
                            { color: colors.foreground },
                          ]}
                        >
                          {formatActiveGoalLabel(goal)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {noteItems.length > 0 && (
                  <View style={styles.sheetSection}>
                    <View style={styles.sectionHeading}>
                      <Feather
                        name="file-text"
                        size={17}
                        color={colors.primary}
                      />
                      <Text
                        style={[
                          styles.sectionTitle,
                          { color: colors.foreground },
                        ]}
                      >
                        Instructions
                      </Text>
                    </View>
                    {noteItems.map((item) => (
                      <View key={item.label} style={styles.noteBlock}>
                        <Text
                          style={[
                            styles.noteLabel,
                            { color: colors.mutedForeground },
                          ]}
                        >
                          {item.label}
                        </Text>
                        <Text
                          style={[
                            styles.bodyText,
                            { color: colors.foreground },
                          ]}
                        >
                          {item.text}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}

                {emergency && (
                  <View style={styles.sheetSection}>
                    <View style={styles.sectionHeading}>
                      <Feather
                        name="phone-call"
                        size={17}
                        color={colors.primary}
                      />
                      <Text
                        style={[
                          styles.sectionTitle,
                          { color: colors.foreground },
                        ]}
                      >
                        Emergency contact
                      </Text>
                    </View>
                    <View style={styles.emergencyRow}>
                      <Text
                        style={[
                          styles.emergencyName,
                          { color: colors.foreground },
                        ]}
                      >
                        {emergency.name || emergency.text}
                      </Text>
                      {emergency.phone && (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => openPhone(emergency.phone!)}
                          style={[
                            styles.emergencyCall,
                            { borderColor: colors.border },
                          ]}
                        >
                          <Feather
                            name="phone"
                            size={15}
                            color={colors.success}
                          />
                          <Text
                            style={[
                              styles.emergencyCallText,
                              { color: colors.foreground },
                            ]}
                          >
                            Call
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                )}
              </ScrollView>

              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setBriefOpen(false);
                  navigateToShift();
                }}
                style={[
                  styles.sheetAction,
                  { backgroundColor: colors.primary },
                ]}
              >
                <Text
                  style={[
                    styles.sheetActionText,
                    {
                      color: colors.primaryForeground,
                      fontFamily: FontFamily.interSemiBold,
                    },
                  ]}
                >
                  Open full shift
                </Text>
                <Feather
                  name="arrow-right"
                  size={16}
                  color={colors.primaryForeground}
                />
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 15,
    gap: 11,
    shadowColor: "#000",
    shadowOpacity: 0.035,
    shadowRadius: 6,
    elevation: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 9,
  },
  timeWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  time: { fontSize: 14, flexShrink: 1, lineHeight: 19 },
  cancelled: { fontSize: 12, fontFamily: FontFamily.interSemiBold },
  personRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    minHeight: 50,
  },
  avatar: {
    width: 47,
    height: 47,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
  },
  initials: { fontSize: 15 },
  liveDot: {
    position: "absolute",
    right: -2,
    bottom: -2,
    height: 12,
    width: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  personText: { flex: 1, minWidth: 0, gap: 5 },
  personName: { fontSize: 16, lineHeight: 21 },
  strikethrough: { textDecorationLine: "line-through" },
  addressRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  address: { fontSize: 12, flex: 1 },
  alertRow: {
    minHeight: 37,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  alertText: { flex: 1, fontSize: 11.5, lineHeight: 17 },
  docsRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  docsText: { fontSize: 12, fontFamily: FontFamily.interSemiBold },
  briefRow: {
    flexDirection: "row",
    minHeight: 62,
    alignItems: "center",
    padding: 10,
    borderRadius: 12,
    gap: 10,
  },
  briefIcon: {
    height: 37,
    width: 37,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  briefCopy: { flex: 1, minWidth: 0, gap: 4 },
  briefTitle: { fontFamily: FontFamily.interSemiBold, fontSize: 13 },
  briefPreview: { fontSize: 12, lineHeight: 16 },
  quickActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  secondaryButton: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
    gap: 7,
  },
  secondaryText: {
    fontSize: 12,
    fontFamily: FontFamily.interSemiBold,
    flexShrink: 1,
  },
  primaryButton: {
    minHeight: 46,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 15,
    gap: 9,
  },
  primaryText: { fontSize: 13, textAlign: "center" },
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.50)",
  },
  overlayDismiss: { ...StyleSheet.absoluteFillObject },
  sheet: {
    maxHeight: "86%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 9,
    paddingHorizontal: 18,
    paddingBottom: 26,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 15,
  },
  sheetHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  sheetHeaderText: { flex: 1, minWidth: 0, gap: 4 },
  sheetTitle: { fontSize: 19, lineHeight: 23 },
  sheetSubtitle: { fontSize: 13 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetScroll: { flexShrink: 1 },
  sheetContent: { paddingBottom: 16, gap: 22 },
  sheetSection: { gap: 11 },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: 9 },
  sectionTitle: {
    fontSize: 14,
    fontFamily: FontFamily.interBold,
    flexShrink: 1,
  },
  count: { fontSize: 12, fontFamily: FontFamily.interMedium },
  goalRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  bodyText: {
    fontFamily: FontFamily.interRegular,
    fontSize: 13,
    lineHeight: 20,
    flexShrink: 1,
  },
  goalText: { flex: 1 },
  noteBlock: { gap: 4 },
  noteLabel: { fontSize: 11, fontFamily: FontFamily.interSemiBold },
  emergencyRow: { flexDirection: "row", gap: 10, alignItems: "center" },
  emergencyName: { flex: 1, fontSize: 13, fontFamily: FontFamily.interMedium },
  emergencyCall: {
    borderWidth: 1,
    minHeight: 39,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 6,
  },
  emergencyCallText: { fontSize: 12, fontFamily: FontFamily.interSemiBold },
  sheetAction: {
    minHeight: 46,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    gap: 8,
  },
  sheetActionText: { fontSize: 13 },
});
