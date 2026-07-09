import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { useT } from "@/context/PreferencesContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import {
  formatIncidentDate,
  formatIncidentDateTime,
  formatIncidentRelativeTime,
  incidentSeverityLabelKey,
  incidentStatusLabelKey,
  incidentTypeLabelKey,
  severityMeta,
  statusMeta,
} from "@/lib/incident-utils";
import { getIncident, updateIncident } from "@/lib/resource-api";

type Props = {
  incidentId: string;
};

function SectionLabel({ children }: { children: string }) {
  return (
    <Text style={[styles.sectionLabel, { fontFamily: "Inter_600SemiBold" }]}>
      {children}
    </Text>
  );
}

function MetaField({
  icon,
  label,
  value,
  subValue,
}: {
  icon?: keyof typeof Feather.glyphMap;
  label: string;
  value: string;
  subValue?: string;
}) {
  const colors = useColors();

  return (
    <View style={styles.metaField}>
      <View style={styles.metaLabelRow}>
        {icon ? <Feather name={icon} size={11} color={colors.mutedForeground} /> : null}
        <Text style={[styles.metaLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {label}
        </Text>
      </View>
      <Text style={[styles.metaValue, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
        {value}
      </Text>
      {subValue ? (
        <Text style={[styles.metaSub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {subValue}
        </Text>
      ) : null}
    </View>
  );
}

function DetailCard({
  children,
  isDark,
  header,
}: {
  children: React.ReactNode;
  isDark: boolean;
  header?: React.ReactNode;
}) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.card,
        elevatedCardShadow(isDark),
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {header ? (
        <View style={[styles.cardHeader, { borderBottomColor: colors.border }]}>{header}</View>
      ) : null}
      <View style={styles.cardBody}>{children}</View>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  disabled,
  variant = "primary",
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  disabled?: boolean;
  variant?: "primary" | "amber" | "emerald" | "outline" | "danger";
}) {
  const colors = useColors();

  const variantStyle = {
    primary: { bg: colors.primary, text: "#FFFFFF", border: colors.primary },
    amber: { bg: "#D97706", text: "#FFFFFF", border: "#D97706" },
    emerald: { bg: "#059669", text: "#FFFFFF", border: "#059669" },
    outline: { bg: colors.card, text: colors.foreground, border: colors.border },
    danger: { bg: "#DC2626", text: "#FFFFFF", border: "#DC2626" },
  }[variant];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.actionBtn,
        {
          backgroundColor: disabled ? colors.muted : variantStyle.bg,
          borderColor: disabled ? colors.border : variantStyle.border,
          opacity: disabled ? 0.7 : 1,
        },
      ]}
    >
      <Feather name={icon} size={13} color={disabled ? colors.mutedForeground : variantStyle.text} />
      <Text
        style={[
          styles.actionBtnText,
          { color: disabled ? colors.mutedForeground : variantStyle.text, fontFamily: "Inter_600SemiBold" },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function IncidentDetailPanel({ incidentId }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isDark = colors.scheme === "dark";
  const emDash = t("common.emDash");

  const [investigationNotes, setInvestigationNotes] = useState("");
  const [correctiveActions, setCorrectiveActions] = useState("");

  const { data: incident, isLoading, error } = useQuery({
    queryKey: ["incident", incidentId],
    queryFn: () => getIncident(incidentId),
    enabled: Boolean(incidentId),
  });

  useEffect(() => {
    if (incident) {
      setInvestigationNotes(incident.investigation_notes ?? "");
      setCorrectiveActions(incident.corrective_actions ?? "");
    }
  }, [incident]);

  const updateMutation = useMutation({
    mutationFn: (updates: Record<string, unknown>) => updateIncident(incidentId, updates),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["incident", incidentId] });
      void queryClient.invalidateQueries({ queryKey: ["incidents"] });
      void queryClient.invalidateQueries({ queryKey: ["incident-stats"] });
      showToast(t("incidents.detail.updated"), "success");
    },
    onError: () => showToast(t("incidents.detail.updateFailed"), "error"),
  });

  const isUpdating = updateMutation.isPending;

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !incident) {
    return (
      <View style={styles.center}>
        <Text style={[styles.errorTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {t("incidents.detail.notFound")}
        </Text>
        <Pressable onPress={() => router.push("/incidents" as never)}>
          <Text style={[styles.backLink, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
            {t("incidents.detail.backToIncidents")}
          </Text>
        </Pressable>
      </View>
    );
  }

  const sev = severityMeta(incident.severity);
  const st = statusMeta(incident.status);
  const canInvestigate = incident.status === "reported";
  const canResolve = incident.status === "under_investigation";
  const canClose = incident.status === "resolved";

  const handleStatusChange = (status: string) => {
    updateMutation.mutate({ status });
  };

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {incident.ndis_pending ? (
        <View style={[styles.alertBanner, styles.ndisBanner, { backgroundColor: "#FEF2F2", borderColor: "#FECACA" }]}>
          <View style={styles.ndisBannerTop}>
            <Feather name="alert-triangle" size={18} color="#DC2626" style={styles.alertIcon} />
            <View style={styles.alertCopy}>
              <Text style={[styles.alertTitle, { color: "#991B1B", fontFamily: "Inter_700Bold" }]}>
                {t("incidents.detail.ndisReportableTitle")}
              </Text>
              <Text style={[styles.alertBody, { color: "#B91C1C", fontFamily: "Inter_400Regular" }]}>
                {t("incidents.detail.ndisReportableBody")}
                {incident.severity === "critical" ? ` ${t("incidents.detail.ndisCritical24h")}` : ""}
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => updateMutation.mutate({ ndis_reported_at: new Date().toISOString() })}
            disabled={isUpdating}
            style={[styles.ndisMarkBtn, { opacity: isUpdating ? 0.7 : 1 }]}
          >
            {isUpdating ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <Feather name="check-circle" size={12} color="#FFFFFF" />
                <Text style={[styles.ndisMarkBtnText, { fontFamily: "Inter_600SemiBold" }]}>
                  {t("incidents.detail.markReported")}
                </Text>
              </>
            )}
          </Pressable>
        </View>
      ) : null}

      {incident.overdue && !incident.ndis_pending ? (
        <View style={[styles.alertBanner, styles.overdueBanner, { backgroundColor: "#FFF7ED", borderColor: "#FED7AA" }]}>
          <Feather name="clock" size={16} color="#EA580C" style={styles.alertIcon} />
          <Text style={[styles.overdueText, { color: "#9A3412", fontFamily: "Inter_600SemiBold" }]}>
            {t("incidents.detail.overdueWarning")}
          </Text>
        </View>
      ) : null}

      <DetailCard isDark={isDark}>
        <View style={styles.titleRow}>
          <View style={styles.titleCopy}>
            <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              {incident.title}
            </Text>
            {incident.participant_name ? (
              <View style={styles.participantRow}>
                <Feather name="user" size={13} color={colors.mutedForeground} />
                <Text style={[styles.participantText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {incident.participant_name}
                  {incident.participant_ndis ? ` · NDIS ${incident.participant_ndis}` : ""}
                </Text>
              </View>
            ) : null}
          </View>
          <View style={styles.badgeCol}>
            <View style={[styles.badge, { backgroundColor: sev.bg, borderColor: sev.border }]}>
              <Text style={[styles.badgeText, { color: sev.color, fontFamily: "Inter_700Bold" }]}>
                {t(incidentSeverityLabelKey(incident.severity))}
              </Text>
            </View>
            <View style={[styles.badge, { backgroundColor: st.bg, borderColor: st.border }]}>
              <Text style={[styles.badgeText, { color: st.color, fontFamily: "Inter_700Bold" }]}>
                {t(incidentStatusLabelKey(incident.status))}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.metaGrid}>
          <MetaField
            icon="calendar"
            label={t("incidents.detail.incidentDate")}
            value={incident.incident_date ? formatIncidentDate(incident.incident_date) : emDash}
            subValue={formatIncidentRelativeTime(incident.incident_date)}
          />
          <MetaField
            label={t("incidents.detail.type")}
            value={t(incidentTypeLabelKey(incident.incident_type))}
          />
          {incident.location ? (
            <MetaField icon="map-pin" label={t("incidents.detail.location")} value={incident.location} />
          ) : null}
          {incident.witnesses ? (
            <MetaField icon="users" label={t("incidents.detail.witnesses")} value={incident.witnesses} />
          ) : null}
          {incident.practice_standard ? (
            <View style={styles.metaFieldWide}>
              <MetaField
                label={t("incidents.detail.ndisPracticeStandard")}
                value={incident.practice_standard}
              />
            </View>
          ) : null}
          {incident.ndis_reported_at ? (
            <View style={styles.metaFieldWide}>
              <MetaField
                label={t("incidents.detail.ndisQscNotified")}
                value={formatIncidentDateTime(incident.ndis_reported_at)}
              />
            </View>
          ) : null}
          {incident.resolved_date ? (
            <MetaField
              label={t("incidents.detail.resolved")}
              value={formatIncidentDate(incident.resolved_date)}
            />
          ) : null}
        </View>

        <View style={[styles.divider, { borderTopColor: colors.border }]}>
          <SectionLabel>{t("incidents.detail.whatHappened")}</SectionLabel>
          <Text style={[styles.bodyText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
            {incident.description}
          </Text>
        </View>

        {incident.participant_impact ? (
          <View style={styles.section}>
            <SectionLabel>{t("incidents.detail.participantImpact")}</SectionLabel>
            <Text style={[styles.bodyText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
              {incident.participant_impact}
            </Text>
          </View>
        ) : null}

        {incident.worker_actions ? (
          <View style={styles.section}>
            <SectionLabel>{t("incidents.detail.immediateActions")}</SectionLabel>
            <Text style={[styles.bodyText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
              {incident.worker_actions}
            </Text>
          </View>
        ) : null}

        {(canInvestigate || canResolve || canClose) ? (
          <View style={[styles.workflowRow, { borderTopColor: colors.border }]}>
            {canInvestigate ? (
              <ActionButton
                label={t("incidents.detail.startInvestigation")}
                icon="file-text"
                variant="amber"
                disabled={isUpdating}
                onPress={() => handleStatusChange("under_investigation")}
              />
            ) : null}
            {canResolve ? (
              <ActionButton
                label={t("incidents.detail.markResolved")}
                icon="check-circle"
                variant="emerald"
                disabled={isUpdating}
                onPress={() => handleStatusChange("resolved")}
              />
            ) : null}
            {canClose ? (
              <ActionButton
                label={t("incidents.detail.closeIncident")}
                icon="x-circle"
                variant="outline"
                disabled={isUpdating}
                onPress={() => handleStatusChange("closed")}
              />
            ) : null}
            {isUpdating ? <ActivityIndicator color={colors.mutedForeground} size="small" /> : null}
          </View>
        ) : null}
      </DetailCard>

      <DetailCard
        isDark={isDark}
        header={
          <View style={styles.cardHeaderRow}>
            <Feather name="clipboard" size={15} color={colors.mutedForeground} />
            <Text style={[styles.cardHeaderTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              {t("incidents.detail.investigationCorrective")}
            </Text>
          </View>
        }
      >
        <View style={styles.section}>
          <Text style={[styles.fieldLabel, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
            {t("incidents.detail.investigationNotes")}
          </Text>
          <TextInput
            style={[
              styles.textArea,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
                fontFamily: "Inter_400Regular",
              },
            ]}
            multiline
            value={investigationNotes}
            onChangeText={setInvestigationNotes}
            placeholder={t("incidents.detail.investigationNotesPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.fieldLabel, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
            {t("incidents.detail.correctiveActions")}
          </Text>
          <TextInput
            style={[
              styles.textArea,
              {
                color: colors.foreground,
                borderColor: colors.border,
                backgroundColor: colors.background,
                fontFamily: "Inter_400Regular",
              },
            ]}
            multiline
            value={correctiveActions}
            onChangeText={setCorrectiveActions}
            placeholder={t("incidents.detail.correctiveActionsPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            textAlignVertical="top"
          />
        </View>

        <View style={styles.saveRow}>
          <Pressable
            onPress={() =>
              updateMutation.mutate({
                investigation_notes: investigationNotes,
                corrective_actions: correctiveActions,
              })
            }
            disabled={isUpdating}
            style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: isUpdating ? 0.7 : 1 }]}
          >
            {isUpdating ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <Text style={[styles.saveBtnText, { fontFamily: "Inter_600SemiBold" }]}>
                {t("incidents.detail.saveNotes")}
              </Text>
            )}
          </Pressable>
        </View>
      </DetailCard>

      <DetailCard
        isDark={isDark}
        header={
          <View style={styles.cardHeaderRow}>
            <Feather name="shield" size={14} color={colors.mutedForeground} />
            <Text style={[styles.cardHeaderTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              {t("incidents.detail.auditTrail")}
            </Text>
          </View>
        }
      >
        <View style={styles.auditRow}>
          <Text style={[styles.auditLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("incidents.detail.incidentReported")}
          </Text>
          <Text style={[styles.auditValue, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
            {incident.reported_date ? formatIncidentDateTime(incident.reported_date) : emDash}
          </Text>
        </View>
        {incident.ndis_reportable ? (
          <View style={styles.auditRow}>
            <Text style={[styles.auditLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {t("incidents.detail.ndisReportableFlagged")}
            </Text>
            <View style={[styles.badge, { backgroundColor: "#FEE2E2", borderColor: "#FECACA" }]}>
              <Text style={[styles.badgeText, { color: "#B91C1C", fontFamily: "Inter_700Bold" }]}>
                {t("common.yes")}
              </Text>
            </View>
          </View>
        ) : null}
        {incident.ndis_reported_at ? (
          <View style={styles.auditRow}>
            <Text style={[styles.auditLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {t("incidents.detail.reportedToNdisQsc")}
            </Text>
            <Text style={[styles.auditValue, { color: "#15803D", fontFamily: "Inter_600SemiBold" }]}>
              {formatIncidentDate(incident.ndis_reported_at)}
            </Text>
          </View>
        ) : null}
        {incident.resolved_date ? (
          <View style={styles.auditRow}>
            <Text style={[styles.auditLabel, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {t("incidents.detail.incidentResolved")}
            </Text>
            <Text style={[styles.auditValue, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {formatIncidentDate(incident.resolved_date)}
            </Text>
          </View>
        ) : null}
      </DetailCard>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 12,
  },
  errorTitle: { fontSize: 16, textAlign: "center" },
  backLink: { fontSize: 14 },
  scroll: { padding: 16, gap: 12 },
  alertBanner: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  overdueBanner: { alignItems: "center" },
  ndisBanner: { flexDirection: "column", gap: 12 },
  ndisBannerTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  alertIcon: { marginTop: 2 },
  alertCopy: { flex: 1, gap: 4 },
  alertTitle: { fontSize: 14 },
  alertBody: { fontSize: 12, lineHeight: 18 },
  overdueText: { flex: 1, fontSize: 13, lineHeight: 18 },
  ndisMarkBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#DC2626",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: "stretch",
  },
  ndisMarkBtnText: { color: "#FFFFFF", fontSize: 11 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  cardHeader: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cardHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardHeaderTitle: { fontSize: 15 },
  cardBody: { padding: 16, gap: 16 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  titleCopy: { flex: 1, gap: 6 },
  title: { fontSize: 20, lineHeight: 26 },
  participantRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  participantText: { flex: 1, fontSize: 13 },
  badgeCol: { gap: 6, alignItems: "flex-end" },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 11 },
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metaField: { width: "47%", gap: 4 },
  metaFieldWide: { width: "100%" },
  metaLabelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaLabel: { fontSize: 11 },
  metaValue: { fontSize: 13 },
  metaSub: { fontSize: 11 },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
    gap: 8,
  },
  section: { gap: 8 },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#9CA3AF",
  },
  bodyText: { fontSize: 14, lineHeight: 21 },
  workflowRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 14,
  },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  actionBtnText: { fontSize: 12 },
  fieldLabel: { fontSize: 13 },
  textArea: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 110,
  },
  saveRow: { alignItems: "flex-end" },
  saveBtn: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    minWidth: 110,
    alignItems: "center",
  },
  saveBtnText: { color: "#FFFFFF", fontSize: 13 },
  auditRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  auditLabel: { flex: 1, fontSize: 12 },
  auditValue: { fontSize: 12, textAlign: "right" },
});
