import React, { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { useColors } from "@/hooks/useColors";
import type { ShiftOfferSummary } from "@/lib/worker-api";

type Props = {
  offer: ShiftOfferSummary;
  onAccept: () => Promise<void>;
  onDecline: (reason?: string) => Promise<void>;
};

/** Decision-only card for a pending shift offer — deliberately shows just
 * enough to decide (participant first name, timing, shift type), never the
 * full participant profile. That stays locked server-side until the worker
 * actually accepts (getWorkerShift 403s a pending offer by design). */
export function ShiftOfferCard({ offer, onAccept, onDecline }: Props) {
  const colors = useColors();
  const isDark = colors.scheme === "dark";
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  const start = offer.scheduled_start ? new Date(offer.scheduled_start) : null;
  const timeLabel = start
    ? start.toLocaleString("en-AU", {
        weekday: "short",
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      })
    : "Time TBC";

  const handleAccept = async () => {
    if (busy) return;
    setBusy("accept");
    try {
      await onAccept();
    } finally {
      setBusy(null);
    }
  };

  const handleDecline = async () => {
    if (busy) return;
    setBusy("decline");
    try {
      await onDecline(reason.trim() || undefined);
    } finally {
      setBusy(null);
    }
  };

  return (
    <View
      style={[
        styles.card,
        elevatedCardShadow(isDark),
        { backgroundColor: colors.card, borderColor: colors.primary },
      ]}
    >
      <Text style={[styles.eyebrow, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
        Shift offer
      </Text>
      <Text style={[styles.time, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>{timeLabel}</Text>
      <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
        with {offer.participant_first_name ?? "a participant"}
        {offer.shift_type ? ` · ${offer.shift_type.replace(/_/g, " ")}` : ""}
      </Text>
      <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        Full participant details unlock once you accept — decide from the essentials above.
      </Text>

      {declining ? (
        <View style={styles.declineForm}>
          <TextInput
            value={reason}
            onChangeText={setReason}
            placeholder="Reason (optional)"
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[
              styles.input,
              { borderColor: colors.border, color: colors.foreground, fontFamily: "Inter_400Regular" },
            ]}
          />
          <View style={styles.row}>
            <Pressable
              onPress={() => setDeclining(false)}
              disabled={!!busy}
              style={[styles.button, styles.outlineButton, { borderColor: colors.border }]}
            >
              <Text style={[styles.buttonText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                Never mind
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void handleDecline()}
              disabled={!!busy}
              style={[styles.button, { backgroundColor: colors.primary }]}
            >
              {busy === "decline" ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[styles.buttonText, { color: "#fff", fontFamily: "Inter_600SemiBold" }]}>
                  Confirm decline
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          <Pressable
            onPress={() => setDeclining(true)}
            disabled={!!busy}
            style={[styles.button, styles.outlineButton, { borderColor: colors.border }]}
          >
            <Text style={[styles.buttonText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              Decline
            </Text>
          </Pressable>
          <Pressable
            onPress={() => void handleAccept()}
            disabled={!!busy}
            style={[styles.button, { backgroundColor: colors.primary }]}
          >
            {busy === "accept" ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={[styles.buttonText, { color: "#fff", fontFamily: "Inter_600SemiBold" }]}>Accept</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 2,
    padding: 20,
    marginHorizontal: 16,
    gap: 4,
  },
  eyebrow: { fontSize: 11, letterSpacing: 0.6, textTransform: "uppercase" },
  time: { fontSize: 18, marginTop: 4 },
  subtitle: { fontSize: 14, marginTop: 2 },
  hint: { fontSize: 12, marginTop: 10, lineHeight: 17 },
  row: { flexDirection: "row", gap: 10, marginTop: 16 },
  declineForm: { marginTop: 14, gap: 10 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    fontSize: 13,
    minHeight: 60,
    textAlignVertical: "top",
  },
  button: {
    flex: 1,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  outlineButton: { borderWidth: StyleSheet.hairlineWidth, backgroundColor: "transparent" },
  buttonText: { fontSize: 14 },
});
