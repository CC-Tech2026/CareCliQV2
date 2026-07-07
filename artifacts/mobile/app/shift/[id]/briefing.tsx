import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { useShiftBriefing } from "@/hooks/worker/useShiftBriefing";
import { useColors } from "@/hooks/useColors";
import { completeShiftBriefing } from "@/lib/worker-api";

function formatNoteDate(value?: string | null): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return value;
  }
}

export default function ShiftBriefingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id: shiftId } = useLocalSearchParams<{ id: string }>();
  const scrollRef = useRef<ScrollView>(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: briefing, isLoading, error } = useShiftBriefing(shiftId);

  useEffect(() => {
    if (briefing?.briefing_complete) {
      router.replace(`/shift/${shiftId}` as never);
    }
  }, [briefing?.briefing_complete, router, shiftId]);

  const checkScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const threshold = 48;
    const atBottom = contentSize.height - layoutMeasurement.height - contentOffset.y <= threshold;
    setScrolledToBottom(atBottom);
  }, []);

  const handleComplete = async () => {
    if (!scrolledToBottom) {
      scrollRef.current?.scrollToEnd({ animated: true });
      Alert.alert("Scroll required", "Please scroll to the bottom of the briefing before continuing.");
      return;
    }

    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await completeShiftBriefing(shiftId!, true);
      router.replace(`/shift/${shiftId}` as never);
    } catch (err) {
      Alert.alert("Failed", err instanceof Error ? err.message : "Could not complete briefing.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !briefing) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
          {(error as Error)?.message ?? "Briefing not available"}
        </Text>
        <Pressable onPress={() => router.back()} style={[styles.backLink, { borderColor: colors.border }]}>
          <Text style={[styles.backLinkText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
            Go back
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />

      <View style={[styles.header, { paddingTop: insets.top + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <Pressable onPress={() => router.back()} style={[styles.backBtn, { borderColor: colors.border }]}>
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            Pre-shift Briefing
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {briefing.participant_first_name}
          </Text>
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        onScroll={checkScroll}
        scrollEventThrottle={16}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 100 }]}
      >
        <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.sectionHeader}>
            <Feather name="user" size={16} color={colors.primary} />
            <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              Background
            </Text>
          </View>
          <Text style={[styles.body, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
            {briefing.background_summary.text}
          </Text>
          {briefing.background_summary.show_updated_badge && briefing.background_summary.updated_at && (
            <Text style={[styles.badge, { color: colors.accent, fontFamily: "Inter_600SemiBold" }]}>
              Updated {formatNoteDate(briefing.background_summary.updated_at)}
            </Text>
          )}
        </View>

        {briefing.previous_shift_note && (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <Feather name="file-text" size={16} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                Previous Shift Note
              </Text>
            </View>
            <Text style={[styles.meta, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
              {briefing.previous_shift_note.author_first_name} · {formatNoteDate(briefing.previous_shift_note.date)}
            </Text>
            <Text style={[styles.body, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
              {briefing.previous_shift_note.content}
            </Text>
          </View>
        )}

        {briefing.critical_alerts.length > 0 && (
          <View style={[styles.section, { backgroundColor: "#FCEBEB", borderColor: "#EF4444" }]}>
            <View style={styles.sectionHeader}>
              <Feather name="alert-octagon" size={16} color="#A32D2D" />
              <Text style={[styles.sectionTitle, { color: "#A32D2D", fontFamily: "Inter_700Bold" }]}>
                Critical Alerts
              </Text>
            </View>
            {briefing.critical_alerts.map((alert) => (
              <Text key={alert.id} style={[styles.alertItem, { color: "#7F1D1D", fontFamily: "Inter_500Medium" }]}>
                • {alert.text}
              </Text>
            ))}
          </View>
        )}

        {briefing.emergency_contacts.length > 0 && (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <Feather name="phone" size={16} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                Emergency Contacts
              </Text>
            </View>
            {briefing.emergency_contacts.map((contact, i) => (
              <View key={`${contact.name}-${i}`} style={styles.contactRow}>
                <Text style={[styles.contactName, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  {contact.name}
                </Text>
                <Text style={[styles.contactRole, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {contact.role} · {contact.phone}
                </Text>
              </View>
            ))}
          </View>
        )}

        {briefing.special_instructions && (
          <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.sectionHeader}>
              <Feather name="clipboard" size={16} color={colors.primary} />
              <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                Special Instructions
              </Text>
            </View>
            <Text style={[styles.body, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
              {briefing.special_instructions}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 12, backgroundColor: colors.card, borderTopColor: colors.border }]}>
        <Pressable
          onPress={handleComplete}
          disabled={busy}
          style={[styles.confirmBtn, { backgroundColor: scrolledToBottom ? colors.primary : colors.muted }]}
        >
          {busy ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={[styles.confirmText, { fontFamily: "Inter_700Bold" }]}>
              {scrolledToBottom ? "I'm Ready — Start Shift" : "Scroll to bottom to continue"}
            </Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1, gap: 2 },
  title: { fontSize: 18 },
  subtitle: { fontSize: 13 },
  scroll: { padding: 16, gap: 12 },
  section: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { fontSize: 15 },
  body: { fontSize: 14, lineHeight: 21 },
  meta: { fontSize: 12 },
  badge: { fontSize: 11 },
  alertItem: { fontSize: 14, lineHeight: 20 },
  contactRow: { gap: 2 },
  contactName: { fontSize: 14 },
  contactRole: { fontSize: 12 },
  footer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  confirmBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmText: { color: "#FFFFFF", fontSize: 15 },
  errorText: { fontSize: 15, textAlign: "center", paddingHorizontal: 32 },
  backLink: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  backLinkText: { fontSize: 14 },
});
