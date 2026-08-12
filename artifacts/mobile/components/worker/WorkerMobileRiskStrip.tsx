import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { formatHealthAlertBody, formatHealthAlertText, healthAlertShortLabel } from "@/lib/health-alert-utils";
import type { ShiftHealthAlert } from "@/lib/worker-api";

type Props = {
  alerts: ShiftHealthAlert[];
  alwaysExpandable?: boolean;
  embedded?: boolean;
  fallbackSummary?: string | null;
  headerTitle?: string;
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
  return healthAlertShortLabel(alert);
}

function hasLongDetails(alerts: ShiftHealthAlert[]): boolean {
  return alerts.some((a) => {
    const body = [a.detail, a.description, a.instructions].filter(Boolean).join(" ");
    return body.length > 80;
  });
}

function AlertDetailRows({
  alerts,
  fallbackSummary,
}: {
  alerts: ShiftHealthAlert[];
  fallbackSummary?: string | null;
}) {
  const colors = useColors();

  if (alerts.length > 0) {
    return (
      <>
        {alerts.map((alert, i) => {
          const iconName = RISK_ICONS[(alert.type ?? "other") as string] ?? "shield";
          const { lines, isList } = formatHealthAlertBody(alert);
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
                {lines.length > 0 &&
                  (isList ? (
                    <View style={styles.listBody}>
                      {lines.map((line, lineIndex) => (
                        <Text
                          key={`${line}-${lineIndex}`}
                          style={[styles.listItem, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}
                        >
                          {"• "}
                          {line}
                        </Text>
                      ))}
                    </View>
                  ) : (
                    <Text
                      style={[styles.rowBody, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}
                    >
                      {lines[0]}
                    </Text>
                  ))}
              </View>
            </View>
          );
        })}
      </>
    );
  }

  if (!fallbackSummary?.trim()) return null;

  const { lines, isList } = formatHealthAlertText(fallbackSummary);

  return (
    <View style={[styles.row, { borderColor: colors.dangerBorder, backgroundColor: colors.dangerBg }]}>
      <View style={[styles.rowIcon, { backgroundColor: colors.dangerIcon + "22" }]}>
        <Feather name="alert-triangle" size={16} color={colors.dangerIcon} />
      </View>
      <View style={styles.rowText}>
        {isList ? (
          <View style={styles.listBody}>
            {lines.map((line, lineIndex) => (
              <Text
                key={`${line}-${lineIndex}`}
                style={[styles.listItem, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}
              >
                {"• "}
                {line}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={[styles.rowBody, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
            {lines[0]}
          </Text>
        )}
      </View>
    </View>
  );
}

export function WorkerMobileRiskStrip({
  alerts,
  alwaysExpandable = false,
  embedded = false,
  fallbackSummary,
  headerTitle,
}: Props) {
  const colors = useColors();
  const [open, setOpen] = useState(false);

  const structuredSummary = alerts.map(shortLabel).filter(Boolean).join(" · ");
  const summary = structuredSummary || fallbackSummary?.trim() || "";
  if (!summary) return null;

  const expandable = alwaysExpandable || hasLongDetails(alerts) || Boolean(fallbackSummary?.trim() && !alerts.length);
  const showTitle = Boolean(headerTitle?.trim());

  return (
    <View style={[styles.wrap, embedded && styles.wrapEmbedded]}>
      <Pressable
        onPress={expandable ? () => setOpen((v) => !v) : undefined}
        style={[styles.card, { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder }]}
      >
        <Feather name="alert-triangle" size={14} color={colors.dangerIcon} style={styles.headIcon} />
        <View style={styles.headText}>
          {showTitle ? (
            <Text style={[styles.headerTitle, { color: colors.dangerText, fontFamily: "Inter_700Bold" }]}>
              {headerTitle}
            </Text>
          ) : null}
          {!alwaysExpandable || !showTitle ? (
            <Text
              style={[styles.summary, { color: colors.dangerText, fontFamily: "Inter_500Medium" }]}
              numberOfLines={2}
            >
              {summary}
            </Text>
          ) : null}
        </View>
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
          <AlertDetailRows alerts={alerts} fallbackSummary={fallbackSummary} />
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
  wrapEmbedded: {
    paddingHorizontal: 0,
    marginTop: 10,
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
  headText: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontSize: 11,
  },
  summary: {
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
  listBody: {
    marginTop: 3,
    gap: 2,
  },
  listItem: {
    fontSize: 11,
    lineHeight: 15,
  },
});
