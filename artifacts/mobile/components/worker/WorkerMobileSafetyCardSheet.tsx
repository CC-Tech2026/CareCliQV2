import { Feather } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { showAlert } from "@/lib/alert";
import {
  acknowledgeParticipantSafetyProtocol,
  getParticipantSafetyProtocol,
  type SafetyProtocol,
} from "@/lib/worker-api";

type Props = {
  participantId: string;
  participantName?: string;
  /** Shift being clocked into - acknowledgement is scoped to this shift, so it's
   * always required fresh on every clock-in rather than reused from a past shift. */
  shiftId?: string;
  /** True when the backend is actually blocking clock-in on this - hides the
   * close button and forces read-then-acknowledge. False shows a plain
   * read-only view with just a Close button (e.g. opened voluntarily). */
  mandatory?: boolean;
  onClose: () => void;
  onAcknowledged: () => void;
};

/**
 * Worker-facing "read and acknowledge the participant safety card" screen.
 * The backend has always blocked clock-in on this (clock_in_shift ->
 * _ensure_risks_acknowledged_if_required in shift_service.py, message "Read
 * and acknowledge the participant safety card before clocking in.") but there
 * was never a way to actually satisfy it from the phone: the web app's
 * equivalent (ParticipantSafetyPage.tsx) became unreachable once active
 * shifts moved mobile-only, and the native app never had this screen at all -
 * the worker just saw the raw error with no path forward. Mirrors the web
 * reference's scroll-to-end-then-acknowledge gating and section layout.
 */
export function WorkerMobileSafetyCardSheet({
  participantId,
  participantName,
  shiftId,
  mandatory = false,
  onClose,
  onAcknowledged,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [protocol, setProtocol] = useState<SafetyProtocol | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    getParticipantSafetyProtocol(participantId, shiftId)
      .then((data) => {
        if (!cancelled) setProtocol(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [participantId, shiftId]);

  useEffect(() => {
    if (contentHeight > 0 && viewportHeight > 0 && contentHeight <= viewportHeight + 8) {
      setScrolledToEnd(true);
    }
  }, [contentHeight, viewportHeight]);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const atEnd = contentOffset.y + layoutMeasurement.height >= contentSize.height - 24;
    if (atEnd) setScrolledToEnd(true);
  };

  const contacts = protocol?.escalation_contacts ?? [];
  const hasVisibleContent = Boolean(
    protocol?.safety_card_body?.trim()
      || (protocol?.scenarios ?? []).some((s) => s.trigger?.trim() || s.response?.trim())
      || (protocol?.deescalation_techniques ?? []).some(
        (t) => t.title?.trim() || (t.steps ?? []).some((step) => step.trim()),
      )
      || (protocol?.physical_safety_notes ?? []).some((n) => n.note?.trim())
      || contacts.some((c) => c.phone?.trim()),
  );
  // Acknowledgement is required every clock-in, whether or not there's actual
  // safety content on file - not gated on hasVisibleContent, otherwise an
  // empty card could never be acknowledged and clock-in would be permanently
  // blocked.
  const showAck = mandatory || Boolean(protocol?.requires_safety_ack);

  const handleAcknowledge = async () => {
    if (!protocol) return;
    setBusy(true);
    try {
      await acknowledgeParticipantSafetyProtocol(protocol.participant_id, protocol.content_version, shiftId);
      onAcknowledged();
    } catch (err) {
      showAlert("Couldn't save", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.card }]}>
        {!mandatory && (
          <Pressable onPress={onClose} hitSlop={8} style={[styles.back, { borderColor: colors.border }]}>
            <Feather name="x" size={18} color={colors.foreground} />
          </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
            Safety card{participantName ? ` · ${participantName}` : ""}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            Read before your shift starts
          </Text>
        </View>
      </View>

      {loading && (
        <View style={styles.centerFill}>
          <ActivityIndicator color={colors.composerPurple} />
        </View>
      )}

      {!loading && loadError && (
        <View style={styles.centerFill}>
          <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_500Medium" }]}>
            Couldn't load the safety card. Check your connection and try again.
          </Text>
          <Pressable onPress={onClose} style={styles.closeLink}>
            <Text style={[styles.manualLinkText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
              Close
            </Text>
          </Pressable>
        </View>
      )}

      {!loading && !loadError && (
        <>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            onScroll={handleScroll}
            scrollEventThrottle={64}
            onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
            onContentSizeChange={(_w, h) => setContentHeight(h)}
          >
            {!hasVisibleContent && (
              <View style={[styles.section, styles.emptySection, { borderColor: colors.border }]}>
                <Feather name="shield" size={28} color={colors.mutedForeground} />
                <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  No safety notes on file
                </Text>
                <Text style={[styles.emptyBody, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  Nothing has been added for this participant yet.
                </Text>
              </View>
            )}

            {protocol?.safety_card_body?.trim() ? (
              <View
                style={[
                  styles.section,
                  { backgroundColor: `${colors.composerPurple}14`, borderColor: `${colors.composerPurple}33` },
                ]}
              >
                <Text style={[styles.sectionLabel, { color: colors.composerPurple, fontFamily: "Inter_700Bold" }]}>
                  SAFETY CARD
                </Text>
                <Text style={[styles.sectionBody, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                  {protocol.safety_card_body}
                </Text>
              </View>
            ) : null}

            {(protocol?.scenarios ?? []).map((scenario, i) => (
              <View key={i} style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
                  IF
                </Text>
                <Text
                  style={[
                    styles.sectionBody,
                    styles.sectionBodyStrong,
                    { color: colors.foreground, fontFamily: "Inter_600SemiBold" },
                  ]}
                >
                  {scenario.trigger}
                </Text>
                <Text
                  style={[
                    styles.sectionLabel,
                    { color: colors.composerPurple, fontFamily: "Inter_700Bold", marginTop: 8 },
                  ]}
                >
                  THEN
                </Text>
                <Text style={[styles.sectionBody, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                  {scenario.response}
                </Text>
              </View>
            ))}

            {(protocol?.deescalation_techniques ?? []).map((tech, i) => (
              <View key={i} style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                  {tech.title}
                </Text>
                {tech.steps.map((step, si) => (
                  <Text key={si} style={[styles.stepText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                    {si + 1}. {step}
                  </Text>
                ))}
              </View>
            ))}

            {(protocol?.physical_safety_notes ?? []).map((item, i) => (
              <View
                key={i}
                style={[
                  styles.section,
                  styles.warnSection,
                  { backgroundColor: `${colors.warning}1A`, borderColor: `${colors.warning}55` },
                ]}
              >
                <Feather name="alert-triangle" size={16} color={colors.warning} style={{ marginTop: 1 }} />
                <Text
                  style={[
                    styles.sectionBody,
                    styles.sectionBodyStrong,
                    { color: colors.foreground, fontFamily: "Inter_600SemiBold", flex: 1 },
                  ]}
                >
                  {item.note}
                </Text>
              </View>
            ))}

            {contacts.length > 0 && (
              <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
                  WHO TO CALL
                </Text>
                {contacts.map((contact) => (
                  <View key={`${contact.role}-${contact.phone}`} style={styles.contactRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.contactLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                        {contact.label}
                      </Text>
                      <Text style={[styles.contactRole, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                        {contact.role.replace("_", " ")}
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => void Linking.openURL(`tel:${contact.phone.replace(/\s/g, "")}`)}
                      style={[styles.callBtn, { borderColor: colors.border }]}
                    >
                      <Feather name="phone" size={13} color={colors.composerPink} />
                      <Text style={[styles.callBtnText, { color: colors.composerPink, fontFamily: "Inter_600SemiBold" }]}>
                        Call
                      </Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
          </ScrollView>

          <View
            style={[
              styles.footer,
              { borderTopColor: colors.border, backgroundColor: colors.card, paddingBottom: insets.bottom + 12 },
            ]}
          >
            {showAck ? (
              <Pressable
                onPress={() => void handleAcknowledge()}
                disabled={!scrolledToEnd || busy}
                style={[
                  styles.ackBtn,
                  { backgroundColor: colors.composerPurple, opacity: !scrolledToEnd || busy ? 0.5 : 1 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={[styles.ackBtnText, { fontFamily: "Inter_700Bold" }]}>
                    {scrolledToEnd ? "I have read and understood" : "Scroll to continue"}
                  </Text>
                )}
              </Pressable>
            ) : (
              <Pressable onPress={onClose} style={[styles.closeBtn, { borderColor: colors.border }]}>
                <Text style={[styles.closeBtnText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  Close
                </Text>
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  back: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 16 },
  subtitle: { fontSize: 12, marginTop: 1 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  errorText: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  closeLink: { padding: 8 },
  manualLinkText: { fontSize: 13 },
  body: { flex: 1 },
  bodyContent: { padding: 16, gap: 12, paddingBottom: 32 },
  section: { borderWidth: 1, borderRadius: 14, padding: 14 },
  emptySection: { alignItems: "center", gap: 8, borderStyle: "dashed", paddingVertical: 32 },
  emptyTitle: { fontSize: 14 },
  emptyBody: { fontSize: 13, textAlign: "center", lineHeight: 18 },
  sectionLabel: { fontSize: 10, letterSpacing: 0.6, textTransform: "uppercase" },
  sectionTitle: { fontSize: 14, marginBottom: 6 },
  sectionBody: { fontSize: 14, lineHeight: 20, marginTop: 4 },
  sectionBodyStrong: { marginTop: 2 },
  warnSection: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepText: { fontSize: 14, lineHeight: 21 },
  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 8,
  },
  contactLabel: { fontSize: 14 },
  contactRole: { fontSize: 12, marginTop: 1, textTransform: "capitalize" },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  callBtnText: { fontSize: 12 },
  footer: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  ackBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  ackBtnText: { color: "#FFFFFF", fontSize: 15 },
  closeBtn: { borderRadius: 12, paddingVertical: 14, alignItems: "center", borderWidth: 1 },
  closeBtnText: { fontSize: 15 },
});
