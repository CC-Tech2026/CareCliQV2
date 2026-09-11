import { Feather } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import {
  formatIncidentRelativeTime,
  incidentSeverityLabelKey,
  incidentStatusLabelKey,
  incidentTypeLabelKey,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  severityMeta,
  statusMeta,
} from "@/lib/incident-utils";
import { listIncidents, type IncidentSummary } from "@/lib/resource-api";

const INCIDENTS_PAGE_SIZE = 10;

type FilterModal = "severity" | "status" | null;

/** An incident "needs attention" when something's actively moving on it —
 * under investigation (a coordinator may come back with questions), overdue
 * for NDIS notification, or flagged as NDIS-reportable and not yet lodged.
 * Every one of these is already surfaced honestly via the existing status/
 * overdue/NDIS badges on the card itself — this just decides which
 * incidents get pulled to the top instead of sitting in the plain list. */
function needsAttention(incident: IncidentSummary): boolean {
  return incident.status === "under_investigation" || Boolean(incident.overdue) || Boolean(incident.ndis_pending);
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.filterChip,
        {
          backgroundColor: active ? colors.activeBg : colors.card,
          borderColor: active ? colors.primary : colors.border,
        },
      ]}
    >
      <Text
        style={[
          styles.filterChipText,
          {
            color: active ? colors.primary : colors.foreground,
            fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
          },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Feather name="chevron-down" size={14} color={active ? colors.primary : colors.mutedForeground} />
    </Pressable>
  );
}

function IncidentCard({
  incident,
  onPress,
  isDark,
}: {
  incident: IncidentSummary;
  onPress: () => void;
  isDark: boolean;
}) {
  const colors = useColors();
  const t = useT();
  const sev = severityMeta(incident.severity);
  const st = statusMeta(incident.status);
  const relativeTime = formatIncidentRelativeTime(incident.incident_date);
  const metaParts = [
    incident.participant_name || t("incidents.noParticipant"),
    t(incidentTypeLabelKey(incident.incident_type)),
    relativeTime,
  ].filter(Boolean);

  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.incidentCard,
        elevatedCardShadow(isDark),
        { backgroundColor: colors.card, borderColor: colors.border, borderLeftColor: sev.dot },
      ]}
    >
      <View style={styles.incidentRow}>
        <View style={[styles.severityDot, { backgroundColor: sev.dot }]} />
        <View style={styles.incidentCopy}>
          <Text style={[styles.incidentTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={2}>
            {incident.title}
          </Text>
          <Text style={[styles.incidentMeta, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]} numberOfLines={2}>
            {metaParts.join(" · ")}
          </Text>
          <View style={styles.badgeRow}>
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
            {incident.ndis_pending ? (
              <View style={[styles.badge, { backgroundColor: "#FEE2E2", borderColor: "#FECACA" }]}>
                <Text style={[styles.badgeText, { color: "#B91C1C", fontFamily: "Inter_700Bold" }]}>
                  {t("incidents.ndisAlert")}
                </Text>
              </View>
            ) : null}
            {incident.overdue ? (
              <View style={[styles.badge, { backgroundColor: "#FFEDD5", borderColor: "#FED7AA" }]}>
                <Text style={[styles.badgeText, { color: "#C2410C", fontFamily: "Inter_700Bold" }]}>
                  {t("incidents.overdue")}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
        <Feather name="chevron-right" size={16} color={colors.mutedForeground} style={styles.chevron} />
      </View>
    </Pressable>
  );
}

type Props = {
  contentBottomPad?: number;
};

export function IncidentsPanel({ contentBottomPad }: Props = {}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const isDark = colors.scheme === "dark";
  const { isAuthenticated } = useAuth();

  const [search, setSearch] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterModal, setFilterModal] = useState<FilterModal>(null);
  const [visibleCount, setVisibleCount] = useState(INCIDENTS_PAGE_SIZE);
  const loadingMoreRef = useRef(false);

  const { data: incidents = [], isLoading, error } = useQuery({
    queryKey: ["incidents"],
    queryFn: async () => {
      const result = await listIncidents();
      return Array.isArray(result) ? result : (result as { items?: IncidentSummary[] }).items ?? [];
    },
    enabled: isAuthenticated,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return incidents.filter((incident) => {
      if (filterSeverity !== "all" && incident.severity !== filterSeverity) return false;
      if (filterStatus !== "all" && incident.status !== filterStatus) return false;
      if (!q) return true;
      const haystack = [
        incident.title,
        incident.participant_name,
        t(incidentTypeLabelKey(incident.incident_type)),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [incidents, filterSeverity, filterStatus, search, t]);

  // Pulled out of the plain list rather than duplicated into it, so there's
  // one obvious place to look for "is anything moving on my reports right
  // now" instead of scanning report-style totals.
  const attentionIncidents = useMemo(() => filtered.filter(needsAttention), [filtered]);
  const otherIncidents = useMemo(() => filtered.filter((i) => !needsAttention(i)), [filtered]);
  const ndisPendingCount = useMemo(() => incidents.filter((i) => i.ndis_pending).length, [incidents]);

  useEffect(() => {
    setVisibleCount(INCIDENTS_PAGE_SIZE);
  }, [otherIncidents]);

  const visibleIncidents = useMemo(
    () => otherIncidents.slice(0, visibleCount),
    [otherIncidents, visibleCount],
  );
  const hasMore = visibleCount < otherIncidents.length;

  const handleLoadMore = useCallback(() => {
    if (!hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setVisibleCount((count) => Math.min(count + INCIDENTS_PAGE_SIZE, otherIncidents.length));
    requestAnimationFrame(() => {
      loadingMoreRef.current = false;
    });
  }, [otherIncidents.length, hasMore]);

  const severityLabel =
    filterSeverity === "all" ? t("incidents.allSeverity") : t(incidentSeverityLabelKey(filterSeverity));
  const statusLabel =
    filterStatus === "all" ? t("incidents.allStatus") : t(incidentStatusLabelKey(filterStatus));

  const isFiltering = filterSeverity !== "all" || filterStatus !== "all" || Boolean(search.trim());
  const otherListTitle = isFiltering
    ? t("incidents.filteredResults")
    : attentionIncidents.length > 0
      ? t("incidents.otherIncidents")
      : t("incidents.allIncidents");

  const renderHeader = () => (
    <View style={styles.headerBlock}>
      <Pressable
        onPress={() => router.push("/incidents/new" as never)}
        style={[styles.logBtn, { backgroundColor: colors.accent }]}
      >
        <Feather name="plus" size={16} color="#FFFFFF" />
        <Text style={[styles.logBtnText, { fontFamily: "Inter_700Bold" }]}>{t("incidents.log")}</Text>
      </Pressable>

      {ndisPendingCount > 0 ? (
        <View style={[styles.ndisBanner, { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder }]}>
          <Feather name="alert-triangle" size={15} color={colors.dangerIcon} />
          <Text style={[styles.ndisBannerText, { color: colors.dangerText, fontFamily: "Inter_500Medium" }]}>
            {t("incidents.ndisBanner", { count: ndisPendingCount })}
          </Text>
        </View>
      ) : null}

      <View style={styles.filters}>
        <View style={[styles.searchWrap, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={t("incidents.searchPlaceholder")}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
          />
        </View>
        <View style={styles.filterRow}>
          <FilterChip label={severityLabel} active={filterSeverity !== "all"} onPress={() => setFilterModal("severity")} />
          <FilterChip label={statusLabel} active={filterStatus !== "all"} onPress={() => setFilterModal("status")} />
        </View>
      </View>

      {attentionIncidents.length > 0 ? (
        <View style={styles.attentionSection}>
          <View style={styles.listHeader}>
            <Text style={[styles.listTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              {t("incidents.needsAttention")}
            </Text>
            {/* Amber, not danger-red: this bucket mixes "just under
             * investigation" with genuinely urgent (overdue/NDIS) reasons —
             * red is reserved for the specific badges on each card below,
             * so the section-level count doesn't overstate every item in it. */}
            <View style={[styles.countPill, { backgroundColor: colors.statusProgressBg }]}>
              <Text style={[styles.countPillText, { color: colors.warning, fontFamily: "Inter_700Bold" }]}>
                {attentionIncidents.length}
              </Text>
            </View>
          </View>
          <View style={styles.attentionList}>
            {attentionIncidents.map((incident) => (
              <IncidentCard
                key={incident.id}
                incident={incident}
                isDark={isDark}
                onPress={() => router.push(`/incidents/${incident.id}` as never)}
              />
            ))}
          </View>
        </View>
      ) : null}

      {otherIncidents.length > 0 || attentionIncidents.length === 0 ? (
        <View style={styles.listHeader}>
          <Text style={[styles.listTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>{otherListTitle}</Text>
          {otherIncidents.length > 0 ? (
            <View style={[styles.countPill, { backgroundColor: colors.soft }]}>
              <Text style={[styles.countPillText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                {otherIncidents.length}{" "}
                {otherIncidents.length === 1 ? t("incidents.record") : t("incidents.records")}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );

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
    <>
      <FlatList
        data={visibleIncidents}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.list, { paddingBottom: contentBottomPad ?? insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={renderHeader}
        ListFooterComponent={
          hasMore ? (
            <View style={styles.listFooter}>
              <ActivityIndicator color={colors.primary} size="small" />
            </View>
          ) : (
            <View style={styles.listFooterSpacer} />
          )
        }
        ListEmptyComponent={
          // Everything that matched is already shown in the "Needs your
          // attention" block above the list itself — an empty-state card
          // here would sit directly under a non-empty section and read as
          // a contradiction, so it's only shown when nothing matched at all.
          attentionIncidents.length > 0 ? null : (
            <View style={[styles.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                {t("incidents.noIncidentsFound")}
              </Text>
              {incidents.length === 0 ? (
                <Text style={[styles.emptySub, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {t("incidents.noIncidentsYet")}{" "}
                  <Text
                    onPress={() => router.push("/incidents/new" as never)}
                    style={{ color: colors.primary, fontFamily: "Inter_700Bold" }}
                  >
                    {t("incidents.logFirst")}
                  </Text>
                </Text>
              ) : null}
            </View>
          )
        }
        renderItem={({ item }) => (
          <IncidentCard
            incident={item}
            isDark={isDark}
            onPress={() => router.push(`/incidents/${item.id}` as never)}
          />
        )}
      />

      <Modal visible={filterModal !== null} transparent animationType="fade" onRequestClose={() => setFilterModal(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setFilterModal(null)}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              {filterModal === "severity" ? t("incidents.allSeverity") : t("incidents.allStatus")}
            </Text>
            <ScrollView style={styles.modalList} nestedScrollEnabled>
              {filterModal === "severity" ? (
                <>
                  <FilterOption
                    label={t("incidents.allSeverity")}
                    active={filterSeverity === "all"}
                    onPress={() => {
                      setFilterSeverity("all");
                      setFilterModal(null);
                    }}
                  />
                  {INCIDENT_SEVERITIES.map((value) => (
                    <FilterOption
                      key={value}
                      label={t(incidentSeverityLabelKey(value))}
                      active={filterSeverity === value}
                      onPress={() => {
                        setFilterSeverity(value);
                        setFilterModal(null);
                      }}
                    />
                  ))}
                </>
              ) : (
                <>
                  <FilterOption
                    label={t("incidents.allStatus")}
                    active={filterStatus === "all"}
                    onPress={() => {
                      setFilterStatus("all");
                      setFilterModal(null);
                    }}
                  />
                  {INCIDENT_STATUSES.map((value) => (
                    <FilterOption
                      key={value}
                      label={t(incidentStatusLabelKey(value))}
                      active={filterStatus === value}
                      onPress={() => {
                        setFilterStatus(value);
                        setFilterModal(null);
                      }}
                    />
                  ))}
                </>
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

function FilterOption({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      style={[styles.modalOption, active && { backgroundColor: colors.activeBg }]}
    >
      <Text
        style={[
          styles.modalOptionText,
          {
            color: active ? colors.primary : colors.foreground,
            fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
          },
        ]}
      >
        {label}
      </Text>
      {active ? <Feather name="check" size={16} color={colors.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  error: { fontSize: 14, textAlign: "center" },
  list: { paddingHorizontal: 16, gap: 10 },
  headerBlock: { gap: 14, paddingTop: 8, paddingBottom: 6 },
  logBtn: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 999,
  },
  logBtnText: { color: "#FFFFFF", fontSize: 14 },
  attentionSection: { gap: 10 },
  attentionList: { gap: 10 },
  ndisBanner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderWidth: 1,
    borderLeftWidth: 3,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  ndisBannerText: { flex: 1, fontSize: 13, lineHeight: 18 },
  filters: { gap: 10 },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 14, paddingVertical: 10 },
  filterRow: { flexDirection: "row", gap: 10 },
  filterChip: {
    flex: 1,
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  filterChipText: { flex: 1, fontSize: 13 },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginTop: 4,
  },
  listTitle: { fontSize: 17, flex: 1 },
  countPill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  countPillText: { fontSize: 11 },
  incidentCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderLeftWidth: 4,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  incidentRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  severityDot: { width: 10, height: 10, borderRadius: 5, marginTop: 5 },
  incidentCopy: { flex: 1, gap: 6 },
  incidentTitle: { fontSize: 15, lineHeight: 20 },
  incidentMeta: { fontSize: 12, lineHeight: 17 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 10 },
  chevron: { marginTop: 4 },
  emptyCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    gap: 8,
    alignItems: "center",
  },
  emptyTitle: { fontSize: 15, textAlign: "center" },
  emptySub: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  listFooter: { paddingVertical: 16, alignItems: "center" },
  listFooterSpacer: { height: 8 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    maxHeight: "70%",
  },
  modalTitle: { fontSize: 15, paddingHorizontal: 8, paddingVertical: 8 },
  modalList: { maxHeight: 360 },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  modalOptionText: { flex: 1, fontSize: 14 },
});
