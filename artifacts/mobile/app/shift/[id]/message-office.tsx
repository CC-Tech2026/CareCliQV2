import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { useWorkerShift } from "@/hooks/worker/useWorkerShift";
import { showAlert } from "@/lib/alert";
import {
  listShiftMessages,
  sendShiftOfficeMessage,
  type ShiftOfficeMessage,
} from "@/lib/worker-api";

type Priority = "normal" | "urgent" | "emergency";

const PRIORITY_OPTIONS: { value: Priority; label: string; dot: string }[] = [
  { value: "normal", label: "Normal", dot: "#9CA3AF" },
  { value: "urgent", label: "Urgent", dot: "#F59E0B" },
  { value: "emergency", label: "Emergency", dot: "#EF4444" },
];

export default function ShiftMessageOfficeScreen() {
  const colors = useColors();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: shift } = useWorkerShift(id);
  const isDark = colors.scheme === "dark";

  const [message, setMessage] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<ShiftOfficeMessage[]>([]);

  const priorityMeta = PRIORITY_OPTIONS.find((o) => o.value === priority) ?? PRIORITY_OPTIONS[0];
  const canSend = message.trim().length > 0 && !sending;
  const pageSubtitle = shift?.participant_name
    ? `${shift.participant_name} · ${t("shifts.messageOffice.subtitle")}`
    : t("shifts.messageOffice.subtitle");

  const loadHistory = useCallback(async () => {
    if (!id) return;
    try {
      const messages = await listShiftMessages(id);
      setHistory(messages ?? []);
    } catch {
      /* optional history */
    }
  }, [id]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const handleAddPhoto = async () => {
    if (photos.length >= 2) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      const lib = await ImagePicker.launchImageLibraryAsync({ base64: true, quality: 0.6 });
      const asset = lib.canceled ? null : lib.assets[0];
      if (asset?.base64) setPhotos((prev) => [...prev, `data:image/jpeg;base64,${asset.base64}`].slice(0, 2));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 });
    const asset = result.canceled ? null : result.assets[0];
    if (asset?.base64) setPhotos((prev) => [...prev, `data:image/jpeg;base64,${asset.base64}`].slice(0, 2));
  };

  const handleSend = async () => {
    const text = message.trim();
    if (!text || sending || !id) return;
    setSending(true);
    try {
      await sendShiftOfficeMessage(id, {
        message: text,
        priority,
        attachment_data: photos.length ? photos : undefined,
      });
      setMessage("");
      setPhotos([]);
      setPriority("normal");
      showAlert("Message sent", "The care office has received your update.");
      void loadHistory();
    } catch (err) {
      showAlert("Message failed", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <WorkerStackScreen
      headerTitle=""
      pageTitle={t("shifts.messageOffice.pageTitle")}
      subtitle={pageSubtitle}
      cardsOnBackground
      showBack
      minimalHeader
    >
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View
            style={[
              styles.card,
              elevatedCardShadow(isDark),
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.cardTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              Compose message
            </Text>
            <Text style={[styles.cardSubtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              Send an update to the care office during your shift.
            </Text>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
              PRIORITY
            </Text>
            <Pressable
              onPress={() => setPriorityOpen(true)}
              style={[styles.priorityField, { borderColor: colors.border, backgroundColor: colors.background }]}
            >
              <View style={[styles.dot, { backgroundColor: priorityMeta.dot }]} />
              <Text style={[styles.priorityText, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
                {priorityMeta.label}
              </Text>
              <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
            </Pressable>

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
              MESSAGE
            </Text>
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="Write your message to the office..."
              placeholderTextColor={colors.mutedForeground}
              multiline
              style={[
                styles.textarea,
                {
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                  color: colors.foreground,
                  fontFamily: "Inter_400Regular",
                },
              ]}
            />

            <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
              ADD PHOTO
            </Text>
            <View style={[styles.photoBox, { borderColor: colors.border }]}>
              <View style={styles.photoRow}>
                {photos.map((src, i) => (
                  <View key={`${i}-${src.slice(0, 16)}`} style={styles.photoThumbWrap}>
                    <Image source={{ uri: src }} style={[styles.photoThumb, { borderColor: colors.border }]} />
                    <Pressable
                      onPress={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                      style={[styles.photoRemove, { backgroundColor: colors.foreground }]}
                    >
                      <Feather name="x" size={10} color={colors.background} />
                    </Pressable>
                  </View>
                ))}
                {photos.length < 2 && (
                  <Pressable
                    onPress={handleAddPhoto}
                    style={[styles.addPhotoBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
                  >
                    <Feather name="camera" size={15} color={colors.composerPurple} />
                    <Text style={[styles.addPhotoText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                      Add photo
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>

            <Pressable
              onPress={handleSend}
              disabled={!canSend}
              style={[styles.sendBtn, { backgroundColor: colors.composerPink, opacity: canSend ? 1 : 0.5 }]}
            >
              {sending ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={[styles.sendBtnText, { fontFamily: "Inter_700Bold" }]}>Send message</Text>
              )}
            </Pressable>
          </View>

          {history.length > 0 && (
            <View
              style={[
                styles.card,
                elevatedCardShadow(isDark),
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", marginTop: 0 }]}>
                OFFICE MESSAGES
              </Text>
              {history.map((msg) => {
                const meta = PRIORITY_OPTIONS.find((o) => o.value === msg.priority) ?? PRIORITY_OPTIONS[0];
                return (
                  <View
                    key={msg.id}
                    style={[styles.historyItem, { borderColor: colors.border, backgroundColor: colors.background }]}
                  >
                    <View style={styles.historyMeta}>
                      <View style={[styles.dot, { backgroundColor: meta.dot }]} />
                      <Text style={[styles.historyPriority, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                        {meta.label}
                      </Text>
                      <Text style={[styles.historyTime, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                        {new Date(msg.created_at).toLocaleString("en-AU")}
                      </Text>
                    </View>
                    <Text style={[styles.historyText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                      {msg.message}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={priorityOpen} transparent animationType="fade" onRequestClose={() => setPriorityOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPriorityOpen(false)}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>Priority</Text>
            {PRIORITY_OPTIONS.map((opt) => {
              const active = opt.value === priority;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    setPriority(opt.value);
                    setPriorityOpen(false);
                  }}
                  style={[styles.modalOption, active && { backgroundColor: colors.activeBg }]}
                >
                  <View style={[styles.dot, { backgroundColor: opt.dot }]} />
                  <Text
                    style={[
                      styles.modalOptionText,
                      {
                        color: active ? colors.primary : colors.foreground,
                        fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                      },
                    ]}
                  >
                    {opt.label}
                  </Text>
                  {active ? <Feather name="check" size={16} color={colors.primary} style={{ marginLeft: "auto" }} /> : null}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: 16, gap: 16, paddingBottom: 24 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
  cardTitle: { fontSize: 16 },
  cardSubtitle: { fontSize: 13, marginTop: 4, lineHeight: 18 },
  fieldLabel: { fontSize: 11, letterSpacing: 0.8, marginTop: 18, marginBottom: 8 },
  priorityField: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  priorityText: { flex: 1, fontSize: 14 },
  textarea: {
    minHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    fontSize: 14,
    textAlignVertical: "top",
  },
  photoBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 12,
  },
  photoRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10 },
  photoThumbWrap: { width: 64, height: 64 },
  photoThumb: { width: 64, height: 64, borderRadius: 10, borderWidth: 1 },
  photoRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  addPhotoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
  },
  addPhotoText: { fontSize: 14 },
  sendBtn: {
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  sendBtnText: { color: "#FFFFFF", fontSize: 15 },
  historyItem: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 8,
  },
  historyMeta: { flexDirection: "row", alignItems: "center", gap: 6 },
  historyPriority: { fontSize: 12 },
  historyTime: { fontSize: 11, marginLeft: "auto" },
  historyText: { fontSize: 14, lineHeight: 20, marginTop: 6 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    gap: 2,
  },
  modalTitle: { fontSize: 15, paddingHorizontal: 8, paddingVertical: 8 },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  modalOptionText: { fontSize: 14 },
});
