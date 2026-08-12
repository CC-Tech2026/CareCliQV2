import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
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
  getTrainingHistory,
  getTrainingModules,
  getTrainingRecommendations,
  markTrainingComplete,
  startTrainingModule,
  type TrainingHistoryItem,
  type TrainingModule,
  type TrainingRecommendation,
} from "@/lib/resource-api";

type CompletionStatus = "not_started" | "awaiting_confirmation" | "confirmed" | "rejected";

function statusMeta(
  status: CompletionStatus,
  colors: ReturnType<typeof useColors>,
  t: ReturnType<typeof useT>,
): { label: string; color: string; bg: string } {
  if (status === "confirmed") {
    return { label: t("training.confirmed"), color: colors.success, bg: colors.statusDocumentedBg };
  }
  if (status === "awaiting_confirmation") {
    return { label: t("training.awaitingConfirmation"), color: colors.warning, bg: colors.statusProgressBg };
  }
  if (status === "rejected") {
    return { label: t("training.rejected"), color: colors.destructive, bg: colors.dangerBg };
  }
  return { label: t("training.notStarted"), color: colors.mutedForeground, bg: colors.soft };
}

type Props = {
  bottomInset?: number;
};

export function ProfileTrainingPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isDark = colors.scheme === "dark";
  const { isAuthenticated } = useAuth();

  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  const modulesQuery = useQuery({
    queryKey: ["training", "modules"],
    queryFn: getTrainingModules,
    enabled: isAuthenticated,
  });
  const recommendationsQuery = useQuery({
    queryKey: ["training", "recommendations"],
    queryFn: getTrainingRecommendations,
    enabled: isAuthenticated,
  });
  const historyQuery = useQuery({
    queryKey: ["training", "history"],
    queryFn: getTrainingHistory,
    enabled: isAuthenticated,
  });

  const modules = modulesQuery.data?.modules ?? [];
  const recommendationByModule = useMemo(() => {
    const map = new Map<string, TrainingRecommendation>();
    for (const rec of recommendationsQuery.data?.recommendations ?? []) map.set(rec.training_module_id, rec);
    return map;
  }, [recommendationsQuery.data]);
  const historyByModule = useMemo(() => {
    const map = new Map<string, TrainingHistoryItem>();
    for (const item of historyQuery.data?.history ?? []) map.set(item.module_id, item);
    return map;
  }, [historyQuery.data]);

  const completeMutation = useMutation({
    mutationFn: (moduleId: string) => markTrainingComplete(moduleId, new Date().toISOString().slice(0, 10), true),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["training"] });
      showToast(t("training.markCompleteSuccess"), "success");
      setOpenModuleId(null);
    },
    onError: (e: Error) => showToast(e.message || t("training.markCompleteFailed"), "error"),
  });

  const isLoading = modulesQuery.isLoading || recommendationsQuery.isLoading || historyQuery.isLoading;
  const error = modulesQuery.error || recommendationsQuery.error || historyQuery.error;

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

  const openModule = openModuleId ? modules.find((m) => m.id === openModuleId) ?? null : null;

  if (openModule) {
    return (
      <TrainingModuleDetail
        module={openModule}
        recommendation={recommendationByModule.get(openModule.id) ?? null}
        historyItem={historyByModule.get(openModule.id) ?? null}
        bottomInset={bottomInset}
        onBack={() => setOpenModuleId(null)}
        onComplete={() => completeMutation.mutate(openModule.id)}
        completing={completeMutation.isPending}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset }]}
      showsVerticalScrollIndicator={false}
    >
      <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {t("training.subtitle")}
      </Text>

      {modules.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.empty, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            {t("training.empty")}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {modules.map((module) => (
            <TrainingCard
              key={module.id}
              module={module}
              isDark={isDark}
              recommended={recommendationByModule.has(module.id)}
              dueAt={recommendationByModule.get(module.id)?.due_at}
              status={(historyByModule.get(module.id)?.status as CompletionStatus) ?? "not_started"}
              completedAt={historyByModule.get(module.id)?.completed_at}
              onPress={() => setOpenModuleId(module.id)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function TrainingCard({
  module,
  isDark,
  recommended,
  dueAt,
  status,
  completedAt,
  onPress,
}: {
  module: TrainingModule;
  isDark: boolean;
  recommended: boolean;
  dueAt?: string | null;
  status: CompletionStatus;
  completedAt?: string;
  onPress: () => void;
}) {
  const colors = useColors();
  const t = useT();
  const meta = statusMeta(status, colors, t);
  const overdue = !!dueAt && new Date(dueAt).getTime() < Date.now() && status !== "confirmed" && status !== "awaiting_confirmation";

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.card,
        elevatedCardShadow(isDark),
        { backgroundColor: colors.card, borderColor: overdue ? colors.destructive : colors.border },
      ]}
    >
      {recommended ? (
        <View style={[styles.assignedTag, { backgroundColor: overdue ? colors.dangerBg : colors.statusUpcomingBg }]}>
          <Feather name={overdue ? "alert-circle" : "star"} size={11} color={overdue ? colors.destructive : colors.primary} />
          <Text style={[styles.assignedTagText, { color: overdue ? colors.destructive : colors.primary, fontFamily: "Inter_700Bold" }]}>
            {overdue ? t("training.overdueSince", { date: dueAt!.slice(0, 10) }) : t("training.assignedBanner")}
          </Text>
        </View>
      ) : null}

      <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={2}>
        {module.title}
      </Text>
      {module.description ? (
        <Text style={[styles.description, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={3}>
          {module.description}
        </Text>
      ) : null}

      <View style={styles.footer}>
        <View style={[styles.badge, { backgroundColor: meta.bg }]}>
          <Text style={[styles.badgeText, { color: meta.color, fontFamily: "Inter_700Bold" }]}>
            {status === "confirmed" && completedAt ? t("training.completedOn", { date: completedAt }) : meta.label}
          </Text>
        </View>

        <View style={[styles.actionBtn, { backgroundColor: colors.activeBg }]}>
          <Text style={[styles.actionText, { color: colors.composerPurple, fontFamily: "Inter_700Bold" }]}>
            {t("training.startTraining")}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

function TrainingModuleDetail({
  module,
  recommendation,
  historyItem,
  bottomInset,
  onBack,
  onComplete,
  completing,
}: {
  module: TrainingModule;
  recommendation: TrainingRecommendation | null;
  historyItem: TrainingHistoryItem | null;
  bottomInset: number;
  onBack: () => void;
  onComplete: () => void;
  completing: boolean;
}) {
  const colors = useColors();
  const t = useT();
  const insets = useSafeAreaInsets();
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    void startTrainingModule(module.id).catch(() => {
      // Non-critical — the start timestamp is a best-effort audit log.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module.id]);

  const status = (historyItem?.status as CompletionStatus) ?? "not_started";
  const overdue = !!recommendation?.due_at && new Date(recommendation.due_at).getTime() < Date.now();
  const canSubmit = status === "not_started" || status === "rejected";

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset }]}
      showsVerticalScrollIndicator={false}
    >
      <Pressable onPress={onBack} style={styles.backRow}>
        <Feather name="arrow-left" size={16} color={colors.primary} />
        <Text style={[styles.backText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
          {t("training.backToTraining")}
        </Text>
      </Pressable>

      <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {module.title}
        </Text>
        {module.description ? (
          <Text style={[styles.description, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {module.description}
          </Text>
        ) : null}

        {recommendation?.due_at ? (
          <View
            style={[
              styles.deadlineBanner,
              { backgroundColor: overdue ? colors.dangerBg : colors.statusProgressBg },
            ]}
          >
            <Feather name={overdue ? "alert-triangle" : "clock"} size={14} color={overdue ? colors.destructive : colors.warning} />
            <Text style={[styles.deadlineText, { color: overdue ? colors.destructive : colors.warning, fontFamily: "Inter_600SemiBold" }]}>
              {overdue
                ? t("training.overdueBanner", { date: recommendation.due_at.slice(0, 10) })
                : t("training.dueBanner", { date: recommendation.due_at.slice(0, 10) })}
            </Text>
          </View>
        ) : null}

        {!!module.resources?.length && (
          <View style={styles.resourceList}>
            {module.resources.map((res) => (
              <Pressable
                key={res.id}
                disabled={!res.external_url}
                onPress={() => res.external_url && Linking.openURL(res.external_url)}
                style={[styles.resourceRow, { backgroundColor: colors.soft }]}
              >
                <Feather
                  name={res.resource_type === "video" ? "video" : res.resource_type === "pdf" ? "file-text" : "external-link"}
                  size={15}
                  color={colors.primary}
                />
                <Text style={[styles.resourceText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
                  {res.title}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {module.requires_certification ? (
          <Text style={[styles.note, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("training.requiresCertificationNote")}
          </Text>
        ) : status === "confirmed" ? (
          <View style={[styles.statusBanner, { backgroundColor: colors.statusDocumentedBg }]}>
            <Feather name="check-circle" size={16} color={colors.success} />
            <Text style={[styles.statusBannerText, { color: colors.success, fontFamily: "Inter_700Bold" }]}>
              {t("training.completedConfirmed")}
            </Text>
          </View>
        ) : status === "awaiting_confirmation" ? (
          <View style={[styles.statusBanner, { backgroundColor: colors.statusProgressBg }]}>
            <Feather name="clock" size={16} color={colors.warning} />
            <Text style={[styles.statusBannerText, { color: colors.warning, fontFamily: "Inter_700Bold" }]}>
              {t("training.awaitingConfirmationNote")}
            </Text>
          </View>
        ) : (
          <View style={styles.ackSection}>
            {status === "rejected" ? (
              <Text style={[styles.rejectedNote, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
                {t("training.rejectedNote")}
                {historyItem?.rejection_reason ? ` ${historyItem.rejection_reason}` : ""}
              </Text>
            ) : null}
            <Pressable style={styles.ackRow} onPress={() => setAcknowledged((prev) => !prev)}>
              <Feather
                name={acknowledged ? "check-square" : "square"}
                size={18}
                color={acknowledged ? colors.primary : colors.mutedForeground}
              />
              <Text style={[styles.ackText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("training.acknowledgment")}
              </Text>
            </Pressable>
            <Pressable
              onPress={onComplete}
              disabled={!acknowledged || completing || !canSubmit}
              style={[
                styles.submitBtn,
                { backgroundColor: colors.primary, opacity: !acknowledged || completing ? 0.5 : 1 },
              ]}
            >
              <Text style={[styles.submitText, { color: "#FFFFFF", fontFamily: "Inter_700Bold" }]}>
                {completing ? t("common.loading") : t("training.markComplete")}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  error: { fontSize: 14, textAlign: "center" },
  scroll: { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  subtitle: { fontSize: 12, lineHeight: 17 },
  emptyCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
  },
  empty: { fontSize: 14, textAlign: "center" },
  list: { gap: 12 },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  assignedTag: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  assignedTagText: { fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 },
  title: { fontSize: 15, lineHeight: 20 },
  description: { fontSize: 13, lineHeight: 18 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, flexShrink: 1 },
  badgeText: { fontSize: 11 },
  actionBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  actionText: { fontSize: 12 },
  backRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  backText: { fontSize: 13 },
  detailCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  deadlineBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  deadlineText: { fontSize: 12, flex: 1, lineHeight: 17 },
  resourceList: { gap: 8 },
  resourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  resourceText: { fontSize: 13, flex: 1 },
  note: { fontSize: 12, lineHeight: 17 },
  statusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  statusBannerText: { fontSize: 13, flex: 1 },
  ackSection: { gap: 12 },
  rejectedNote: { fontSize: 12, lineHeight: 17 },
  ackRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  ackText: { fontSize: 13, lineHeight: 19, flex: 1 },
  submitBtn: {
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: "center",
  },
  submitText: { fontSize: 14 },
});
