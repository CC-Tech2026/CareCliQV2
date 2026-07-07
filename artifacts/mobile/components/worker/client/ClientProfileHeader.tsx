import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { clientInitials, planDaysLeft, safeClientDate } from "@/lib/client-utils";
import type { WorkerClient } from "@/lib/worker-api";
import { useColors } from "@/hooks/useColors";

export function ClientProfileHeader({ client }: { client: WorkerClient }) {
  const colors = useColors();
  const daysLeft = planDaysLeft(client);
  const expiryUrgency =
    daysLeft === null ? null : daysLeft < 30 ? "critical" : daysLeft < 90 ? "warn" : "ok";

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.top}>
        <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
          <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>
            {clientInitials(client.full_name)}
          </Text>
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {client.full_name}
          </Text>
          <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            {client.ndis_number ? `NDIS ${client.ndis_number}` : "NDIS number not recorded"}
            {client.date_of_birth ? ` · DOB ${safeClientDate(client.date_of_birth)}` : ""}
          </Text>
          <View style={styles.chips}>
            {client.plan_status ? (
              <View style={[styles.chip, { backgroundColor: "#DCFCE7", borderColor: "#BBF7D0" }]}>
                <Text style={[styles.chipText, { color: "#15803D", fontFamily: "Inter_600SemiBold" }]}>
                  {client.plan_status}
                </Text>
              </View>
            ) : null}
            {daysLeft !== null ? (
              <View
                style={[
                  styles.chip,
                  {
                    backgroundColor:
                      expiryUrgency === "critical"
                        ? "#FEF2F2"
                        : expiryUrgency === "warn"
                          ? "#FFFBEB"
                          : colors.soft,
                    borderColor:
                      expiryUrgency === "critical"
                        ? "#FECACA"
                        : expiryUrgency === "warn"
                          ? "#FDE68A"
                          : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    {
                      color:
                        expiryUrgency === "critical"
                          ? "#DC2626"
                          : expiryUrgency === "warn"
                            ? "#92400E"
                            : colors.mutedForeground,
                      fontFamily: "Inter_600SemiBold",
                    },
                  ]}
                >
                  {daysLeft > 0 ? `Plan expires in ${daysLeft}d` : "Plan expired"}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </View>

      {(client.plan_start_date || client.plan_end_date || client.plan_management_type) && (
        <View style={[styles.facts, { borderTopColor: colors.border }]}>
          {client.plan_start_date ? (
            <Fact label="Plan start" value={safeClientDate(client.plan_start_date)} />
          ) : null}
          {client.plan_end_date ? (
            <Fact label="Plan end" value={safeClientDate(client.plan_end_date)} />
          ) : null}
          {client.plan_management_type ? (
            <Fact label="Management" value={client.plan_management_type} />
          ) : null}
        </View>
      )}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const colors = useColors();
  return (
    <View style={styles.fact}>
      <Text style={[styles.factLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        {label}
      </Text>
      <Text style={[styles.factValue, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  top: { flexDirection: "row", gap: 14, padding: 16 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#FFFFFF", fontSize: 16 },
  info: { flex: 1, gap: 4 },
  name: { fontSize: 18 },
  meta: { fontSize: 12, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  chip: { borderRadius: 20, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 3 },
  chipText: { fontSize: 11, textTransform: "capitalize" },
  facts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  fact: { minWidth: "28%", gap: 2 },
  factLabel: { fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase" },
  factValue: { fontSize: 13 },
});
