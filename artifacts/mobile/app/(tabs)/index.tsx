import { useQueryClient } from "@tanstack/react-query";
import React from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { DashboardActionItems } from "@/components/worker/dashboard/DashboardActionItems";
import { DashboardClientsCard } from "@/components/worker/dashboard/DashboardClientsCard";
import { DashboardComplianceAlerts } from "@/components/worker/dashboard/DashboardComplianceAlerts";
import { DashboardCompliancePanel } from "@/components/worker/dashboard/DashboardCompliancePanel";
import { DashboardSessionsCard } from "@/components/worker/dashboard/DashboardSessionsCard";
import { DashboardShiftsWidget } from "@/components/worker/dashboard/DashboardShiftsWidget";
import { DayShiftTimeline } from "@/components/worker/dashboard/DayShiftTimeline";
import { NextShiftCard } from "@/components/worker/NextShiftCard";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { WorkerPageSubheader } from "@/components/worker/WorkerPageSubheader";
import { WorkerStatCard } from "@/components/worker/WorkerStatCard";
import { useOffline } from "@/context/OfflineContext";
import { useT } from "@/context/PreferencesContext";
import { useWorkerDashboard } from "@/hooks/worker/useWorkerDashboard";
import { useWorkerLandingDashboard } from "@/hooks/worker/useWorkerLandingDashboard";
import { useColors } from "@/hooks/useColors";

function formatDateLabel(date = new Date()): string {
  return date.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const t = useT();
  const { isOnline } = useOffline();

  const {
    data: dashboard,
    isLoading: dashboardLoading,
    error: dashboardError,
    refetch: refetchDashboard,
    isRefetching: dashboardRefetching,
  } = useWorkerDashboard();

  const {
    data: landing,
    isLoading: landingLoading,
    refetch: refetchLanding,
    isRefetching: landingRefetching,
  } = useWorkerLandingDashboard();

  const loading = dashboardLoading || landingLoading;
  const refreshing = dashboardRefetching || landingRefetching;

  const handleRefresh = () => {
    void refetchDashboard();
    void refetchLanding();
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    void queryClient.invalidateQueries({ queryKey: ["worker", "compliance-detail"] });
  };

  const todayClients =
    dashboard && dashboard.today_clients.length > 0
      ? dashboard.today_clients
      : (dashboard?.assigned_clients.slice(0, 4) ?? []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={t("dashboard.title")} />
      <WorkerPageSubheader title={t("dashboard.title")} subtitle={formatDateLabel()} />

      {loading ? (
        <View style={[styles.center, { backgroundColor: colors.card }]}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : dashboardError ? (
        <View style={[styles.center, { backgroundColor: colors.card }]}>
          <Text style={[styles.error, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(dashboardError as Error).message}
          </Text>
        </View>
      ) : dashboard ? (
        <ScrollView
          style={{ backgroundColor: colors.background }}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={
            isOnline ? (
              <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.primary} />
            ) : undefined
          }
        >
          <View style={styles.statsGrid}>
            <View style={styles.statCell}>
              <WorkerStatCard label={t("dashboard.sessionsToday")} value={dashboard.sessions_today} />
            </View>
            <View style={styles.statCell}>
              <WorkerStatCard
                label={t("dashboard.notesDue")}
                value={dashboard.notes_due}
                variant={dashboard.notes_due > 0 ? "warning" : "default"}
              />
            </View>
            <View style={styles.statCell}>
              <WorkerStatCard label={t("dashboard.myClients")} value={dashboard.assigned_clients.length} />
            </View>
            <View style={styles.statCell}>
              <WorkerStatCard
                label={t("dashboard.pendingFixes")}
                value={dashboard.pending_compliance_fixes.length}
                variant={dashboard.pending_compliance_fixes.length > 0 ? "critical" : "default"}
              />
            </View>
          </View>

          {landing ? (
            <>
              <NextShiftCard shift={landing.next_shift} />
              <DayShiftTimeline shifts={landing.today_shifts} nextShiftId={landing.next_shift?.id} />
              <DashboardShiftsWidget shifts={landing.today_shifts} />
              <DashboardActionItems items={landing.action_items} />
              <DashboardComplianceAlerts alerts={landing.compliance_alerts} />
            </>
          ) : (
            <NextShiftCard shift={null} />
          )}

          <DashboardCompliancePanel />

          <DashboardClientsCard clients={todayClients} />

          <DashboardSessionsCard
            title={t("dashboard.incompleteSessions")}
            sessions={dashboard.incomplete_sessions.slice(0, 5)}
          />
          <DashboardSessionsCard
            title={t("dashboard.pendingCompliance")}
            sessions={dashboard.pending_compliance_fixes.slice(0, 5)}
          />
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 16, paddingTop: 12, gap: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  error: { fontSize: 14, textAlign: "center", padding: 24 },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statCell: {
    width: "47%",
    flexGrow: 1,
  },
});
