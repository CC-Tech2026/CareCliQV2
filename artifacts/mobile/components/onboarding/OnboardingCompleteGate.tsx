import { Feather } from "@expo/vector-icons";
import { useRouter, useSegments } from "expo-router";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import * as Haptics from "@/lib/haptics";
import {
  getMyCompletionStatus,
  markMyCompletionSeen,
  type MyCompletionStats,
} from "@/lib/worker-api";

const EXCLUDED_ROUTES = ["splash", "onboarding", "login", "forgot-password", "signup"];

/** Shown once when a support worker reaches Active (cleared Credentials and
 * Training), closing the loop on the onboarding pipeline — the mobile mirror
 * of the web app's OnboardingCompleteGate. */
export function OnboardingCompleteGate() {
  const { isAuthenticated, user } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colors = useColors();
  const [show, setShow] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [stats, setStats] = useState<MyCompletionStats | null>(null);

  const eligible =
    isAuthenticated &&
    user?.role === "support_worker" &&
    !EXCLUDED_ROUTES.includes(segments[0] ?? "");

  useEffect(() => {
    if (!eligible || checked) return;
    let cancelled = false;
    getMyCompletionStatus()
      .then((res) => {
        if (!cancelled && res.onboarding_completed && !res.onboarding_completed_seen_at) {
          setStats(res.stats);
          setShow(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [eligible, checked]);

  if (!show) return null;

  async function handleContinue(destination: "/(tabs)/shifts" | "/(tabs)") {
    setDismissing(true);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      await markMyCompletionSeen();
    } catch {
      // Non-critical — worst case this screen shows again next login.
    }
    setShow(false);
    router.replace(destination as never);
  }

  const firstName = user?.full_name?.split(" ")[0];
  const hasStats = !!stats && (stats.credentials_verified > 0 || stats.training_completed > 0);

  return (
    <Modal visible transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.card }]}>
          <View style={[styles.iconCircle, { backgroundColor: colors.soft }]}>
            <Feather name="award" size={26} color={colors.primary} />
          </View>

          <Text style={[styles.title, { color: colors.foreground, fontFamily: "BricolageGrotesque_700Bold" }]}>
            {firstName ? `You made it, ${firstName}!` : "You made it!"}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Credentials, training, all of it — you&apos;re officially active and ready to take
            shifts.
          </Text>

          {hasStats && (
            <View style={styles.statsRow}>
              {stats!.credentials_verified > 0 && (
                <View style={[styles.statCard, { borderColor: colors.border }]}>
                  <Feather name="shield" size={16} color={colors.primary} />
                  <Text style={[styles.statNumber, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                    {stats!.credentials_verified}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                    {stats!.credentials_verified === 1 ? "credential verified" : "credentials verified"}
                  </Text>
                </View>
              )}
              {stats!.training_completed > 0 && (
                <View style={[styles.statCard, { borderColor: colors.border }]}>
                  <Feather name="book-open" size={16} color={colors.primary} />
                  <Text style={[styles.statNumber, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                    {stats!.training_completed}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                    {stats!.training_completed === 1 ? "module completed" : "modules completed"}
                  </Text>
                </View>
              )}
            </View>
          )}

          <Pressable
            onPress={() => void handleContinue("/(tabs)/shifts")}
            disabled={dismissing}
            style={[styles.cta, { backgroundColor: colors.primary, opacity: dismissing ? 0.5 : 1 }]}
            accessibilityRole="button"
          >
            <Text style={[styles.ctaText, { color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }]}>
              {dismissing ? "Loading…" : "View my shifts"}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void handleContinue("/(tabs)")}
            disabled={dismissing}
            style={styles.secondaryCta}
            accessibilityRole="button"
          >
            <Text style={[styles.secondaryCtaText, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
              Not now
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 24,
    paddingHorizontal: 28,
    paddingVertical: 32,
    alignItems: "center",
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginTop: 18,
    fontSize: 22,
    textAlign: "center",
  },
  body: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  statsRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
    marginTop: 20,
  },
  statCard: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    alignItems: "flex-start",
    gap: 4,
  },
  statNumber: {
    fontSize: 18,
  },
  statLabel: {
    fontSize: 11,
  },
  cta: {
    marginTop: 24,
    width: "100%",
    height: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontSize: 14,
  },
  secondaryCta: {
    marginTop: 6,
    width: "100%",
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryCtaText: {
    fontSize: 14,
  },
});
