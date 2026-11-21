import { Feather } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";

import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { FontFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/lib/alert";
import { formatShiftDate } from "@/lib/shift-utils";
import {
  TRANSIT_TYPES, claimStatus, dollars, getSentTravelClaims, getTravelDrafts, missingEvidence, sendTravelClaims,
  type TravelExpense,
} from "@/lib/travel-api";
import { getWorkerShifts } from "@/lib/worker-api";

/**
 * The worker's travel claims: saved claims with anything they still need,
 * one button to send them all to the office, and recent finished shifts to
 * claim for.
 */
export default function TravelClaimsScreen() {
  const colors = useColors();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState(false);

  const drafts = useQuery({ queryKey: ["worker", "travel", "drafts"], queryFn: getTravelDrafts });
  const recent = useQuery({ queryKey: ["worker", "travel", "recent-shifts"], queryFn: () => getWorkerShifts("completed", { limit: 20 }) });
  const sent = useQuery({ queryKey: ["worker", "travel", "sent"], queryFn: getSentTravelClaims });
  useFocusEffect(
    useCallback(() => {
      void drafts.refetch();
      void recent.refetch();
      void sent.refetch();
    }, []), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const list = drafts.data?.drafts ?? [];
  const shifts = recent.data?.shifts ?? [];
  const byShift = new Map(shifts.map((s) => [s.id, s]));
  const sentClaims = sent.data?.claims ?? [];
  const claimed = new Set([...list.map((d) => d.shift_id), ...sentClaims.filter((c) => c.status !== "rejected").map((c) => c.shift_id ?? "")]);
  const unclaimed = shifts.filter((s) => !claimed.has(s.id)).slice(0, 10);
  const blocked = list.filter((d) => missingEvidence(d));
  const total = list.reduce((sum, d) => sum + (d.amount_cents || 0), 0);

  const send = () => {
    if (!list.length || blocked.length) return;
    showAlert("Send claims to the office?", `${list.length} claim${list.length === 1 ? "" : "s"}, ${dollars(total)} in all. You can't change them after this.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Send",
        onPress: async () => {
          setSending(true);
          try {
            const result = await sendTravelClaims();
            await queryClient.invalidateQueries({ queryKey: ["worker", "travel"] });
            showAlert("Sent", `${result.expense_count} claim${result.expense_count === 1 ? "" : "s"} sent to the office.`);
          } catch (err) {
            showAlert("Couldn't send", err instanceof Error ? err.message : "Please try again.");
          } finally {
            setSending(false);
          }
        },
      },
    ]);
  };

  const label = { color: colors.foreground, fontFamily: FontFamily.interSemiBold };
  const muted = { color: colors.mutedForeground, fontFamily: FontFamily.interRegular };

  const describe = (d: TravelExpense) =>
    d.expense_type === "mileage"
      ? `Car, ${Number(d.claimed_km ?? 0)} km`
      : `${TRANSIT_TYPES.find((t) => t.value === d.transit_type)?.label ?? "Fare"}`;

  return (
    <WorkerStackScreen headerTitle="" pageTitle="Travel claims" subtitle="Car trips and fares for your shifts, with their receipts." minimalHeader showBack cardsOnBackground>
      {drafts.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={drafts.isRefetching} onRefresh={() => { void drafts.refetch(); void recent.refetch(); void sent.refetch(); }} />}
        >
          <Text style={[styles.heading, label]}>Ready to send</Text>
          {list.length === 0 ? (
            <Text style={muted}>No saved claims. Claim travel for a shift below.</Text>
          ) : (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
              {list.map((d, i) => {
                const shift = byShift.get(d.shift_id);
                const needs = missingEvidence(d);
                return (
                  <Pressable
                    key={d.id}
                    accessibilityRole="button"
                    accessibilityLabel={`${describe(d)}, ${dollars(d.amount_cents)}${needs ? `, still needs ${needs}` : ""}. Edit`}
                    onPress={() => router.push(`/shift/${d.shift_id}/travel` as never)}
                    style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={label}>{describe(d)} · {dollars(d.amount_cents)}</Text>
                      <Text style={muted}>
                        {shift ? `${shift.participant_name ?? "Shift"}, ${formatShiftDate(shift.scheduled_start, shift.timezone) ?? ""}` : "Shift"}
                      </Text>
                      {needs ? <Text style={[muted, { color: colors.destructive }]}>Still needs {needs}</Text> : null}
                    </View>
                    <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
                  </Pressable>
                );
              })}
            </View>
          )}

          {list.length > 0 ? (
            <View style={{ gap: 8 }}>
              {blocked.length ? <Text style={[muted, { color: colors.destructive }]}>Finish the claims marked above before sending.</Text> : null}
              <Pressable accessibilityRole="button" onPress={send} disabled={sending || blocked.length > 0} style={[styles.primary, { backgroundColor: colors.primary, opacity: sending || blocked.length ? 0.5 : 1 }]}>
                {sending ? <ActivityIndicator color={colors.primaryForeground} /> : (
                  <Text style={{ color: colors.primaryForeground, fontFamily: FontFamily.interSemiBold, fontSize: 16 }}>
                    Send {list.length} to the office · {dollars(total)}
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}

          <Text style={[styles.heading, label]}>Claim for a shift</Text>
          {recent.isLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : unclaimed.length === 0 ? (
            <Text style={muted}>No recent shifts to claim for.</Text>
          ) : (
            <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
              {unclaimed.map((s, i) => (
                <Pressable
                  key={s.id}
                  accessibilityRole="button"
                  onPress={() => router.push(`/shift/${s.id}/travel` as never)}
                  style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={label}>{s.participant_name ?? "Shift"}</Text>
                    <Text style={muted}>{formatShiftDate(s.scheduled_start, s.timezone) ?? ""}</Text>
                  </View>
                  <Text style={{ color: colors.primary, fontFamily: FontFamily.interSemiBold }}>Claim</Text>
                </Pressable>
              ))}
            </View>
          )}

          {sentClaims.length > 0 ? (
            <>
              <Text style={[styles.heading, label]}>Sent claims</Text>
              <Text style={muted}>Approved claims are paid with your wages: kilometres as a car allowance, fares paid back.</Text>
              <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}>
                {sentClaims.map((c, i) => (
                  <View key={c.id} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
                    <Feather
                      name={c.status === "paid" ? "check-circle" : c.status === "rejected" ? "x-circle" : "clock"}
                      size={18}
                      color={c.status === "paid" ? colors.primary : c.status === "rejected" ? colors.destructive : colors.mutedForeground}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={label}>
                        {c.kind === "km" ? `Car, ${Number(c.km ?? 0)} km` : TRANSIT_TYPES.find((t) => t.value === c.transit_type)?.label ?? "Fare"}
                        {byShift.get(c.shift_id ?? "")?.participant_name ? ` · ${byShift.get(c.shift_id ?? "")?.participant_name}` : ""}
                      </Text>
                      <Text style={[muted, c.status === "rejected" && { color: colors.destructive }]}>{claimStatus(c)}</Text>
                    </View>
                    <Text style={label}>{dollars(c.amount_cents)}</Text>
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      )}
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  center: { padding: 32, alignItems: "center" },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  heading: { fontSize: 16, marginTop: 8 },
  card: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  primary: { minHeight: 52, borderRadius: 999, alignItems: "center", justifyContent: "center", paddingHorizontal: 16 },
});
