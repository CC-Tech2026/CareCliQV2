import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import type { TranslationKey } from "@/lib/i18n/translations";
import {
  formatIncidentDate,
  formatIncidentDateTime,
  incidentSeverityLabelKey,
  incidentTypeLabelKey,
  severityMeta,
} from "@/lib/incident-utils";
import {
  addIncidentCorrection,
  getIncident,
  listIncidentCorrections,
  type CorrectableIncidentField,
  type IncidentCorrection,
} from "@/lib/resource-api";

type Props = {
  incidentId: string;
};

type Colors = ReturnType<typeof useColors>;

/** Reported, then the office looks into it, then it's closed. */
const STEPS: { key: TranslationKey; bodyKey: TranslationKey }[] = [
  {
    key: "incidents.worker.stepReported",
    bodyKey: "incidents.worker.stepReportedBody",
  },
  {
    key: "incidents.worker.stepReview",
    bodyKey: "incidents.worker.stepReviewBody",
  },
  {
    key: "incidents.worker.stepClosed",
    bodyKey: "incidents.worker.stepClosedBody",
  },
];

function stepIndex(status: string): number {
  if (status === "under_investigation") return 1;
  if (status === "resolved" || status === "closed") return 2;
  return 0;
}

const FIELD_LABELS: Record<CorrectableIncidentField, TranslationKey> = {
  description: "incidents.worker.whatHappened",
  participant_impact: "incidents.worker.impact",
  worker_actions: "incidents.worker.yourActions",
  location: "incidents.worker.location",
};

/**
 * Older reports saved every answer into the description as "Label: text"
 * blocks ("Title: ...", "Description: ..."). Show just the description part;
 * impact and actions have their own sections.
 */
function reportText(description: string): string {
  const text = (description || "").trim();
  const blocks = text.split(/\n\s*\n/).map((block) => {
    const match = block.match(/^([A-Z][A-Za-z ]{2,30}):\s*([\s\S]*)$/);
    return match
      ? { label: match[1].toLowerCase(), body: match[2].trim() }
      : { label: null as string | null, body: block.trim() };
  });
  if (!blocks.some((b) => b.label)) return text;
  const described = blocks.find((b) => b.label === "description");
  if (described) return described.body;
  return blocks
    .filter((b) => b.label !== "title")
    .map((b) => b.body)
    .join("\n\n");
}

function Card({
  children,
  colors,
}: {
  children: React.ReactNode;
  colors: Colors;
}) {
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {children}
    </View>
  );
}

export function IncidentDetailPanel({ incidentId }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<CorrectableIncidentField | null>(null);
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");

  const {
    data: incident,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["incident", incidentId],
    queryFn: () => getIncident(incidentId),
    enabled: Boolean(incidentId),
  });
  const { data: corrections = [] } = useQuery({
    queryKey: ["incident-corrections", incidentId],
    queryFn: () => listIncidentCorrections(incidentId),
    enabled: Boolean(incidentId),
  });

  const correctionsByField = useMemo(() => {
    const map = new Map<string, IncidentCorrection[]>();
    for (const c of corrections) {
      map.set(c.field_name, [...(map.get(c.field_name) ?? []), c]);
    }
    return map;
  }, [corrections]);

  const addCorrection = useMutation({
    mutationFn: (body: {
      field_name: CorrectableIncidentField;
      new_value: string;
      note?: string;
    }) => addIncidentCorrection(incidentId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["incident-corrections", incidentId],
      });
      setEditing(null);
      showToast(t("incidents.worker.correctionSaved"), "success");
    },
    onError: () => showToast(t("incidents.worker.correctionFailed"), "error"),
  });

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
        <Text
          style={[
            styles.errorTitle,
            { color: colors.foreground, fontFamily: FontFamily.interBold },
          ]}
        >
          {t("incidents.detail.notFound")}
        </Text>
        <Pressable
          accessibilityRole="link"
          onPress={() =>
            router.replace("/(tabs)/compliance?segment=incidents" as never)
          }
        >
          <Text
            style={[
              styles.link,
              { color: colors.primary, fontFamily: FontFamily.interSemiBold },
            ]}
          >
            {t("incidents.detail.backToIncidents")}
          </Text>
        </Pressable>
      </View>
    );
  }

  const tz = incident.timezone;
  const current = stepIndex(incident.status);
  const severity = severityMeta(incident.severity);
  const original: Record<CorrectableIncidentField, string> = {
    description: reportText(incident.description),
    participant_impact: (incident.participant_impact ?? "").trim(),
    worker_actions: (incident.worker_actions ?? "").trim(),
    location: (incident.location ?? "").trim(),
  };
  const latestValue = (field: CorrectableIncidentField) => {
    const list = correctionsByField.get(field);
    return list && list.length
      ? list[list.length - 1].new_value
      : original[field];
  };

  const openCorrection = (field: CorrectableIncidentField) => {
    setDraft(latestValue(field));
    setReason("");
    setEditing(field);
  };

  const saveCorrection = () => {
    if (!editing) return;
    const value = draft.trim();
    if (!value || value === latestValue(editing).trim()) return;
    addCorrection.mutate({
      field_name: editing,
      new_value: value,
      note: reason.trim() || undefined,
    });
  };

  // Location only shows once there's something in it; the rest always show.
  const visibleFields = (
    ["description", "participant_impact", "worker_actions", "location"] as const
  ).filter(
    (field) =>
      field !== "location" ||
      Boolean(original.location) ||
      (correctionsByField.get("location")?.length ?? 0) > 0,
  );

  const renderSection = (field: CorrectableIncidentField, last = false) => {
    const text = original[field];
    const fieldCorrections = correctionsByField.get(field) ?? [];
    return (
      <View
        key={field}
        style={[
          styles.section,
          !last && {
            borderBottomColor: colors.border,
            borderBottomWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <View style={styles.sectionHead}>
          <Text
            style={[
              styles.sectionLabel,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {t(FIELD_LABELS[field])}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t("incidents.worker.addCorrection")}: ${t(FIELD_LABELS[field])}`}
            hitSlop={10}
            onPress={() => openCorrection(field)}
          >
            <Text
              style={[
                styles.correctLink,
                { color: colors.primary, fontFamily: FontFamily.interSemiBold },
              ]}
            >
              {t("incidents.worker.correct")}
            </Text>
          </Pressable>
        </View>
        <Text
          style={[
            styles.sectionBody,
            {
              color: text ? colors.foreground : colors.mutedForeground,
              fontFamily: FontFamily.interRegular,
            },
          ]}
        >
          {text || t("incidents.worker.notGiven")}
        </Text>
        {fieldCorrections.map((c) => (
          <View
            key={c.id}
            style={[
              styles.correction,
              { backgroundColor: colors.soft, borderLeftColor: colors.primary },
            ]}
          >
            <Text
              style={[
                styles.correctionMeta,
                { color: colors.primary, fontFamily: FontFamily.interSemiBold },
              ]}
            >
              {t("incidents.worker.correctedOn", {
                date: formatIncidentDate(c.created_at, tz),
              })}
            </Text>
            <Text
              style={[
                styles.sectionBody,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            >
              {c.new_value}
            </Text>
            {c.note ? (
              <Text
                style={[
                  styles.correctionNote,
                  {
                    color: colors.mutedForeground,
                    fontFamily: FontFamily.interRegular,
                  },
                ]}
              >
                {t("incidents.worker.reason", { reason: c.note })}
              </Text>
            ) : null}
          </View>
        ))}
      </View>
    );
  };

  return (
    <>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: insets.bottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* What this report is */}
        <Card colors={colors}>
          <View style={styles.summaryTop}>
            <Text
              style={[
                styles.eyebrow,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {t(incidentTypeLabelKey(incident.incident_type))}
            </Text>
            <View style={[styles.severity, { backgroundColor: severity.bg }]}>
              <View
                style={[styles.severityDot, { backgroundColor: severity.dot }]}
              />
              <Text
                style={[
                  styles.severityText,
                  {
                    color: severity.color,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {t(incidentSeverityLabelKey(incident.severity))}
              </Text>
            </View>
          </View>
          <Text
            accessibilityRole="header"
            style={[
              styles.title,
              { color: colors.foreground, fontFamily: FontFamily.display },
            ]}
          >
            {incident.title}
          </Text>
          <View style={styles.facts}>
            {incident.participant_name ? (
              <View style={styles.fact}>
                <Feather name="user" size={15} color={colors.mutedForeground} />
                <Text
                  style={[
                    styles.factText,
                    {
                      color: colors.foreground,
                      fontFamily: FontFamily.interMedium,
                    },
                  ]}
                >
                  {incident.participant_name}
                </Text>
              </View>
            ) : null}
            <View style={styles.fact}>
              <Feather
                name="calendar"
                size={15}
                color={colors.mutedForeground}
              />
              <Text
                style={[
                  styles.factText,
                  {
                    color: colors.foreground,
                    fontFamily: FontFamily.interMedium,
                  },
                ]}
              >
                {formatIncidentDateTime(incident.incident_date, tz)}
              </Text>
            </View>
            {incident.reference_number ? (
              <View style={styles.fact}>
                <Feather name="hash" size={15} color={colors.mutedForeground} />
                <Text
                  style={[
                    styles.factText,
                    {
                      color: colors.foreground,
                      fontFamily: FontFamily.interMedium,
                    },
                  ]}
                >
                  {incident.reference_number}
                </Text>
              </View>
            ) : null}
          </View>
        </Card>

        {/* Where it's at */}
        <Card colors={colors}>
          <Text
            style={[
              styles.cardTitle,
              {
                color: colors.foreground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {t("incidents.worker.progress")}
          </Text>
          <View style={styles.steps}>
            {STEPS.map((step, index) => {
              const done = index < current;
              const active = index === current;
              const reached = done || active;
              return (
                <View key={step.key} style={styles.step}>
                  <View style={styles.stepRail}>
                    <View
                      style={[
                        styles.stepDot,
                        reached
                          ? {
                              backgroundColor: colors.primary,
                              borderColor: colors.primary,
                            }
                          : {
                              backgroundColor: colors.card,
                              borderColor: colors.border,
                            },
                      ]}
                    >
                      {done ? (
                        <Feather
                          name="check"
                          size={12}
                          color={colors.primaryForeground}
                        />
                      ) : null}
                    </View>
                    {index < STEPS.length - 1 ? (
                      <View
                        style={[
                          styles.stepLine,
                          {
                            backgroundColor: done
                              ? colors.primary
                              : colors.border,
                          },
                        ]}
                      />
                    ) : null}
                  </View>
                  <View style={styles.stepCopy}>
                    <Text
                      style={[
                        styles.stepTitle,
                        {
                          color: reached
                            ? colors.foreground
                            : colors.mutedForeground,
                          fontFamily: active
                            ? FontFamily.interSemiBold
                            : FontFamily.interMedium,
                        },
                      ]}
                    >
                      {t(step.key)}
                      {index === 0 && incident.reported_date
                        ? `  ·  ${formatIncidentDate(incident.reported_date, tz)}`
                        : ""}
                    </Text>
                    {active ? (
                      <Text
                        style={[
                          styles.stepBody,
                          {
                            color: colors.mutedForeground,
                            fontFamily: FontFamily.interRegular,
                          },
                        ]}
                      >
                        {t(step.bodyKey)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })}
          </View>
          {incident.ndis_reportable ? (
            <View style={[styles.note, { backgroundColor: colors.soft }]}>
              <Feather name="info" size={16} color={colors.primary} />
              <Text
                style={[
                  styles.noteText,
                  {
                    color: colors.foreground,
                    fontFamily: FontFamily.interRegular,
                  },
                ]}
              >
                {t("incidents.worker.ndisNote")}
              </Text>
            </View>
          ) : null}
        </Card>

        {/* What you reported */}
        <Card colors={colors}>
          <Text
            style={[
              styles.cardTitle,
              {
                color: colors.foreground,
                fontFamily: FontFamily.interSemiBold,
              },
            ]}
          >
            {t("incidents.worker.yourReport")}
          </Text>
          <Text
            style={[
              styles.cardHint,
              {
                color: colors.mutedForeground,
                fontFamily: FontFamily.interRegular,
              },
            ]}
          >
            {t("incidents.worker.yourReportHint")}
          </Text>
          {visibleFields.map((field, index) =>
            renderSection(field, index === visibleFields.length - 1),
          )}
        </Card>
      </ScrollView>

      <Modal
        visible={editing !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        <KeyboardAvoidingView
          style={styles.sheetRoot}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            style={styles.backdrop}
            onPress={() => setEditing(null)}
            accessible={false}
          />
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                paddingBottom: insets.bottom + 20,
              },
            ]}
          >
            <View
              style={[styles.grabber, { backgroundColor: colors.border }]}
            />
            <Text
              style={[
                styles.sheetTitle,
                { color: colors.foreground, fontFamily: FontFamily.display },
              ]}
            >
              {editing
                ? t("incidents.worker.correctTitle", {
                    section: t(FIELD_LABELS[editing]),
                  })
                : ""}
            </Text>
            <Text
              style={[
                styles.cardHint,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            >
              {t("incidents.worker.correctHint")}
            </Text>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              autoFocus
              accessibilityLabel={
                editing ? t(FIELD_LABELS[editing]) : undefined
              }
              style={[
                styles.sheetInput,
                styles.sheetInputTall,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            />
            <Text
              style={[
                styles.inputLabel,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {t("incidents.worker.reasonLabel")}
            </Text>
            <TextInput
              value={reason}
              onChangeText={setReason}
              placeholder={t("incidents.worker.reasonPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel={t("incidents.worker.reasonLabel")}
              style={[
                styles.sheetInput,
                {
                  color: colors.foreground,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            />
            <View style={styles.sheetActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditing(null)}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Text
                  style={[
                    styles.secondaryText,
                    {
                      color: colors.foreground,
                      fontFamily: FontFamily.interSemiBold,
                    },
                  ]}
                >
                  {t("common.cancel")}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={
                  addCorrection.isPending ||
                  !draft.trim() ||
                  (editing
                    ? draft.trim() === latestValue(editing).trim()
                    : true)
                }
                onPress={saveCorrection}
                style={[
                  styles.primaryBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity:
                      addCorrection.isPending ||
                      !draft.trim() ||
                      (editing
                        ? draft.trim() === latestValue(editing).trim()
                        : true)
                        ? 0.45
                        : 1,
                  },
                ]}
              >
                {addCorrection.isPending ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text
                    style={[
                      styles.primaryText,
                      {
                        color: colors.primaryForeground,
                        fontFamily: FontFamily.interSemiBold,
                      },
                    ]}
                  >
                    {t("incidents.worker.saveCorrection")}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 14 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  errorTitle: { fontSize: 18 },
  link: { fontSize: 15 },
  card: { borderRadius: 20, borderWidth: 1, padding: 18 },
  summaryTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  eyebrow: { fontSize: 14 },
  severity: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  severityDot: { width: 7, height: 7, borderRadius: 4 },
  severityText: { fontSize: 13 },
  title: { fontSize: 23, lineHeight: 29, letterSpacing: -0.3, marginTop: 8 },
  facts: { gap: 8, marginTop: 14 },
  fact: { flexDirection: "row", alignItems: "center", gap: 10 },
  factText: { fontSize: 15, flexShrink: 1 },
  cardTitle: { fontSize: 17 },
  cardHint: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  steps: { marginTop: 16 },
  step: { flexDirection: "row", gap: 14 },
  stepRail: { alignItems: "center", width: 22 },
  stepDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  stepLine: { width: 2, flex: 1, minHeight: 18, marginVertical: 2 },
  stepCopy: { flex: 1, paddingBottom: 16, gap: 4 },
  stepTitle: { fontSize: 15, lineHeight: 22 },
  stepBody: { fontSize: 14, lineHeight: 20 },
  note: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 14,
    padding: 12,
    alignItems: "flex-start",
  },
  noteText: { flex: 1, fontSize: 14, lineHeight: 20 },
  section: { paddingVertical: 14, gap: 6 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionLabel: { fontSize: 14 },
  correctLink: { fontSize: 14 },
  sectionBody: { fontSize: 15, lineHeight: 22 },
  correction: {
    borderLeftWidth: 3,
    borderRadius: 10,
    padding: 12,
    gap: 4,
    marginTop: 6,
  },
  correctionMeta: { fontSize: 13 },
  correctionNote: { fontSize: 13, lineHeight: 18 },
  sheetRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(26,26,46,0.45)",
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 8,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 10,
  },
  sheetTitle: { fontSize: 21, lineHeight: 27 },
  inputLabel: { fontSize: 14, marginTop: 6 },
  sheetInput: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  sheetInputTall: {
    minHeight: 130,
    maxHeight: 240,
    textAlignVertical: "top",
    marginTop: 8,
  },
  sheetActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  secondaryBtn: {
    height: 52,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { fontSize: 16 },
  primaryBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { fontSize: 16 },
});
