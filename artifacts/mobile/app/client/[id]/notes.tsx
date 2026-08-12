import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { showAlert } from "@/lib/alert";
import { ClientScreenShell } from "@/components/worker/client/ClientScreenShell";
import { ClientSessionList } from "@/components/worker/client/ClientSessionList";
import { useWorkerClientDetail } from "@/hooks/worker/useWorkerClientDetail";
import { useColors } from "@/hooks/useColors";
import { createMyClientNote } from "@/lib/worker-api";

export default function ClientNotesScreen() {
  const colors = useColors();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data, isLoading, error } = useWorkerClientDetail(id);
  const [noteText, setNoteText] = useState("");

  const createNote = useMutation({
    mutationFn: () => createMyClientNote(id!, { notes: noteText.trim() }),
    onSuccess: () => {
      setNoteText("");
      void queryClient.invalidateQueries({ queryKey: ["worker", "my-clients", id] });
    },
    onError: (err) => {
      showAlert("Note failed", err instanceof Error ? err.message : "Please try again.");
    },
  });

  const handleSave = () => {
    if (!noteText.trim()) {
      showAlert("Note required", "Write a progress note before saving.");
      return;
    }
    createNote.mutate();
  };

  if (isLoading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (error || !data?.participant) {
    return (
      <ClientScreenShell title="Notes" backHref={`/client/${id}`}>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
            {(error as Error)?.message ?? "Client not found"}
          </Text>
        </View>
      </ClientScreenShell>
    );
  }

  return (
    <ClientScreenShell title="Notes" subtitle={data.participant.full_name} backHref={`/client/${id}`}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
          NEW NOTE
        </Text>
        <View style={[styles.composeCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TextInput
            value={noteText}
            onChangeText={setNoteText}
            placeholder="Write a progress note for this client..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            style={[styles.input, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}
          />
          {createNote.error ? (
            <Text style={[styles.mutationError, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
              {(createNote.error as Error).message}
            </Text>
          ) : null}
          <Pressable
            onPress={handleSave}
            disabled={createNote.isPending}
            style={[
              styles.saveBtn,
              { backgroundColor: colors.primary, opacity: createNote.isPending ? 0.6 : 1 },
            ]}
          >
            {createNote.isPending ? (
              <ActivityIndicator color={colors.primaryForeground} size="small" />
            ) : (
              <Text style={[styles.saveText, { color: colors.primaryForeground, fontFamily: "Inter_700Bold" }]}>
                Save note
              </Text>
            )}
          </Pressable>
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
          MY NOTES
        </Text>
        <ClientSessionList rows={data.notes} emptyLabel="No notes yet" />
      </ScrollView>
    </ClientScreenShell>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  scroll: { padding: 16, gap: 12 },
  sectionLabel: { fontSize: 11, letterSpacing: 0.8 },
  composeCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  input: { minHeight: 120, fontSize: 14, lineHeight: 22, textAlignVertical: "top" },
  saveBtn: { borderRadius: 999, paddingVertical: 12, alignItems: "center" },
  saveText: { fontSize: 14 },
  mutationError: { fontSize: 13 },
  errorText: { fontSize: 15, textAlign: "center" },
});
