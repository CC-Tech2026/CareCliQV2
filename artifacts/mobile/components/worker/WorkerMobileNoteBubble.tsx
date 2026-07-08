import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { isCheckinSessionNote } from "@workspace/worker-compliance";
import type { SessionNoteRecord } from "@/lib/worker-api";
import type { NoteComplianceFlag } from "@workspace/worker-compliance";
import { SESSION_NOTE_MAX } from "@/lib/shift-utils";

type Props = {
  note: SessionNoteRecord;
  taskLabel?: string;
  goalTitle?: string;
  flag?: NoteComplianceFlag;
  editable?: boolean;
  onSave?: (noteId: string, content: string) => void;
  onIncidentReport?: (noteId: string, content: string) => void;
  onPress?: () => void;
};

const CLAMP_LINES = 4;

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function WorkerMobileNoteBubble({
  note,
  taskLabel,
  goalTitle,
  flag,
  editable,
  onSave,
  onIncidentReport,
  onPress,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [truncated, setTruncated] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.content);

  useEffect(() => {
    if (!editing) setDraft(note.content);
  }, [note.content, editing]);

  const time = note.created_at
    ? new Date(note.created_at).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
    : "";
  const categoryLabel = [taskLabel, goalTitle].filter(Boolean).join(" · ");
  const type = note.note_type ?? "text";
  const isCheckin = isCheckinSessionNote(note);
  const wc = wordCount(note.content);
  const isFail = flag?.severity === "fail";
  const accent = isFail ? colors.destructive : colors.warning;
  const metaLine = [time, isCheckin ? "check-in" : type, `${wc} words`, flag ? "flagged" : null]
    .filter(Boolean)
    .join(" · ");

  const handlePress = () => {
    if (editing) return;
    onPress?.();
    if (truncated) setModalOpen(true);
  };

  const handleSave = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSave?.(note.note_id, trimmed);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(note.content);
    setEditing(false);
  };

  const bubbleContent = (
    <View
      style={[
        styles.bubble,
        {
          backgroundColor: isCheckin ? colors.clockInBg : colors.card,
          borderColor: isCheckin ? colors.clockInBorder : flag ? accent : colors.border,
        },
      ]}
    >
      {categoryLabel ? (
        <Text style={[styles.category, { color: colors.composerPurple, fontFamily: "Inter_600SemiBold" }]}>
          {categoryLabel}
        </Text>
      ) : null}

      {editing ? (
        <View style={styles.editWrap}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            multiline
            maxLength={SESSION_NOTE_MAX}
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.editInput,
              { color: colors.foreground, borderColor: colors.border, fontFamily: "Inter_400Regular" },
            ]}
          />
          <View style={styles.editActions}>
            <Pressable onPress={handleSave} style={[styles.saveBtn, { backgroundColor: colors.primary }]}>
              <Text style={[styles.saveBtnText, { fontFamily: "Inter_600SemiBold" }]}>Save</Text>
            </Pressable>
            <Pressable
              onPress={handleCancel}
              style={[styles.cancelEditBtn, { borderColor: colors.border }]}
            >
              <Text style={[styles.cancelEditText, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
                Cancel
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <>
          <Text
            style={[styles.content, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
            numberOfLines={editable ? undefined : CLAMP_LINES}
            onTextLayout={(e) => {
              if (!editable && !truncated && e.nativeEvent.lines.length > CLAMP_LINES) setTruncated(true);
            }}
          >
            {note.content}
          </Text>
          {!editable && truncated ? (
            <Pressable onPress={() => setModalOpen(true)} hitSlop={6}>
              <Text style={[styles.readMore, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                ..... Read full note
              </Text>
            </Pressable>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={[styles.time, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
              {metaLine}
            </Text>
            {editable ? (
              <Pressable onPress={() => setEditing(true)} hitSlop={8} style={styles.editBtn}>
                <Feather name="edit-2" size={12} color={colors.primary} />
                <Text style={[styles.editBtnText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                  Edit
                </Text>
              </Pressable>
            ) : null}
          </View>
        </>
      )}

      {!editing && flag ? (
            <View style={[styles.flagBox, { borderColor: accent + "55", backgroundColor: accent + "14" }]}>
              <Text style={[styles.flagTitle, { color: accent, fontFamily: "Inter_600SemiBold" }]}>
                Rule {flag.ruleId} — {flag.ruleName}
              </Text>
              <Text style={[styles.flagMsg, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                {flag.message}
              </Text>
              {flag.actionLabel && onIncidentReport ? (
                <Pressable
                  onPress={() => onIncidentReport(note.note_id, note.content)}
                  style={[styles.flagBtn, { backgroundColor: colors.destructive }]}
                >
                  <Text style={[styles.flagBtnText, { fontFamily: "Inter_600SemiBold" }]}>
                    {flag.actionLabel}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
    </View>
  );

  return (
    <>
      {editable ? (
        bubbleContent
      ) : (
        <Pressable onPress={handlePress} style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}>
          {bubbleContent}
        </Pressable>
      )}

      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHandleWrap}>
              <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />
            </View>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderText}>
                {categoryLabel ? (
                  <Text
                    style={[styles.category, { color: colors.composerPurple, fontFamily: "Inter_600SemiBold" }]}
                  >
                    {categoryLabel}
                  </Text>
                ) : null}
                <Text style={[styles.time, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {metaLine}
                </Text>
              </View>
              <Pressable onPress={() => setModalOpen(false)} hitSlop={8}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              <Text style={[styles.modalContent, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                {note.content}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  bubble: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    marginHorizontal: 14,
    marginVertical: 4,
  },
  category: {
    fontSize: 11,
  },
  content: {
    fontSize: 14,
    lineHeight: 20,
  },
  readMore: {
    fontSize: 12,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 2,
  },
  time: {
    fontSize: 10,
    flex: 1,
  },
  editBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  editBtnText: {
    fontSize: 11,
  },
  editWrap: {
    gap: 8,
  },
  editInput: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    minHeight: 96,
    fontSize: 14,
    lineHeight: 20,
    textAlignVertical: "top",
  },
  editActions: {
    flexDirection: "row",
    gap: 8,
  },
  saveBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  saveBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
  },
  cancelEditBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  cancelEditText: {
    fontSize: 12,
  },
  flagBox: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  flagTitle: {
    fontSize: 11,
  },
  flagMsg: {
    fontSize: 12,
    lineHeight: 17,
  },
  flagBtn: {
    marginTop: 4,
    alignSelf: "flex-start",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  flagBtnText: {
    color: "#FFFFFF",
    fontSize: 12,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "80%",
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  modalHandleWrap: {
    alignItems: "center",
    paddingBottom: 8,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    paddingBottom: 12,
  },
  modalHeaderText: {
    flex: 1,
    gap: 4,
  },
  modalScroll: {
    marginTop: 4,
  },
  modalContent: {
    fontSize: 15,
    lineHeight: 22,
  },
});
