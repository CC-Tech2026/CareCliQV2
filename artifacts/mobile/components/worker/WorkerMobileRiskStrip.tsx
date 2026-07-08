import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { ShiftHealthAlert } from "@/lib/worker-api";

type Props = {
  alerts: ShiftHealthAlert[];
};

const RISK_ICONS: Record<string, keyof typeof Feather.glyphMap> = {
  allergy: "alert-triangle",
  legal_blindness: "eye-off",
  falls_risk: "alert-triangle",
  seizures: "activity",
  bsp: "shield",
  swallowing_risk: "droplet",
  other: "shield",
};

function shortLabel(alert: ShiftHealthAlert): string {
  const title = alert.title?.trim();
  if (title) return title;
  const desc = (alert.description ?? alert.instructions ?? "").trim();
  if (!desc) return "Safety alert";
  const firstLine = desc.split(/\n/)[0]?.trim() ?? desc;
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}…` : firstLine;
}

function hasLongDetails(alerts: ShiftHealthAlert[]): boolean {
  return alerts.some((a) => {
    const body = [a.detail, a.description, a.instructions].filter(Boolean).join(" ");
    return body.length > 80;
  });
}

export function WorkerMobileRiskStrip({ alerts }: Props) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  if (!alerts.length) return null;

  const summary = alerts.map(shortLabel).filter(Boolean).join(" · ");
  if (!summary) return null;

  const expandable = hasLongDetails(alerts);

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={expandable ? () => setOpen((v) => !v) : undefined}
        style={[styles.card, { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder }]}
      >
        <Feather name="alert-triangle" size={14} color={colors.dangerIcon} style={styles.headIcon} />
        <Text
          style={[styles.summary, { color: colors.dangerText, fontFamily: "Inter_500Medium" }]}
          numberOfLines={2}
        >
          {summary}
        </Text>
        {expandable && (
          <Feather
            name={open ? "chevron-up" : "chevron-down"}
            size={16}
            color={colors.dangerIcon}
            style={styles.headIcon}
          />
        )}
      </Pressable>

      {expandable && open && (
        <ScrollView
          style={[styles.detailWrap, { borderColor: colors.border, backgroundColor: colors.card }]}
          contentContainerStyle={styles.detailContent}
          nestedScrollEnabled
        >
          {alerts.map((alert, i) => {
            const iconName = RISK_ICONS[(alert.type ?? "other") as string] ?? "shield";
            const body = (alert.instructions || alert.description || "").trim();
            return (
              <View
                key={`${alert.title}-${i}`}
                style={[styles.row, { borderColor: colors.dangerBorder, backgroundColor: colors.dangerBg }]}
              >
                <View style={[styles.rowIcon, { backgroundColor: colors.dangerIcon + "22" }]}>
                  <Feather name={iconName} size={16} color={colors.dangerIcon} />
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, { color: colors.dangerText, fontFamily: "Inter_700Bold" }]}>
                    {alert.title}
                  </Text>
                  {!!body && (
                    <Text
                      style={[styles.rowBody, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}
                    >
                      {body}
                    </Text>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 12,
    marginTop: 8,
  },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headIcon: {
    marginTop: 1,
  },
  summary: {
    flex: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  detailWrap: {
    marginTop: 8,
    maxHeight: 224,
    borderRadius: 10,
    borderWidth: 1,
    padding: 8,
  },
  detailContent: {
    gap: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  rowText: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 12,
    lineHeight: 16,
  },
  rowBody: {
    marginTop: 3,
    fontSize: 11,
    lineHeight: 15,
  },
});
