import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsPanelCard, SettingsSaveButton } from "@/components/worker/settings/settings-ui";
import { useToast } from "@/context/ToastContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import {
  CREDENTIAL_TYPE_OPTIONS,
  credentialTypeLabel,
  type CredentialTypeOption,
} from "@/lib/credential-utils";
import { createCredential } from "@/lib/resource-api";

export function AddCredentialPanel() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  const [credentialType, setCredentialType] = useState<CredentialTypeOption>(CREDENTIAL_TYPE_OPTIONS[0]);
  const [title, setTitle] = useState("");
  const [credentialNumber, setCredentialNumber] = useState("");
  const [issuer, setIssuer] = useState("");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [typeOpen, setTypeOpen] = useState(false);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        throw new Error(t("credentials.titleRequired"));
      }

      return createCredential({
        credential_type: credentialType,
        title: trimmedTitle,
        credential_number: credentialNumber.trim() || null,
        issuer: issuer.trim() || null,
        issue_date: issueDate.trim() || null,
        expiry_date: expiryDate.trim() || null,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["credentials", "me"] });
      showToast(t("credentials.saved"), "success");
      router.back();
    },
    onError: (error: Error) => {
      showToast(error.message || t("credentials.saveFailed"), "error");
    },
  });

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.subtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("credentials.addDescription")}
        </Text>

        <SettingsPanelCard>
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("credentials.type")}
              </Text>
              <Pressable
                onPress={() => setTypeOpen(true)}
                style={[styles.select, { borderColor: colors.border, backgroundColor: colors.background }]}
              >
                <Text style={[styles.selectText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                  {credentialTypeLabel(credentialType)}
                </Text>
                <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
              </Pressable>
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("credentials.credentialTitle")}
              </Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder={t("credentials.titlePlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("credentials.number")}
              </Text>
              <TextInput
                value={credentialNumber}
                onChangeText={setCredentialNumber}
                placeholder={t("credentials.numberPlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("credentials.issuer")}
              </Text>
              <TextInput
                value={issuer}
                onChangeText={setIssuer}
                placeholder={t("credentials.issuerPlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("credentials.issueDate")}
              </Text>
              <TextInput
                value={issueDate}
                onChangeText={setIssueDate}
                placeholder={t("credentials.datePlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
            </View>

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("credentials.expiryDate")}
              </Text>
              <TextInput
                value={expiryDate}
                onChangeText={setExpiryDate}
                placeholder={t("credentials.datePlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
              />
            </View>

            <SettingsSaveButton
              label={t("credentials.save")}
              saving={saveMutation.isPending}
              onPress={() => saveMutation.mutate()}
            />
          </View>
        </SettingsPanelCard>
      </ScrollView>

      <Modal visible={typeOpen} transparent animationType="fade" onRequestClose={() => setTypeOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setTypeOpen(false)}>
          <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
              {t("credentials.type")}
            </Text>
            <ScrollView style={styles.modalList} nestedScrollEnabled>
              {CREDENTIAL_TYPE_OPTIONS.map((option) => {
                const active = option === credentialType;
                return (
                  <Pressable
                    key={option}
                    onPress={() => {
                      setCredentialType(option);
                      setTypeOpen(false);
                    }}
                    style={[styles.modalOption, active && { backgroundColor: colors.activeBg }]}
                  >
                    <Text
                      style={[
                        styles.modalOptionText,
                        {
                          color: active ? colors.primary : colors.foreground,
                          fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                        },
                      ]}
                    >
                      {credentialTypeLabel(option)}
                    </Text>
                    {active ? <Feather name="check" size={16} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 8, gap: 12 },
  subtitle: { fontSize: 13, lineHeight: 18 },
  form: { gap: 14 },
  field: { gap: 6 },
  label: { fontSize: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  select: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  selectText: { flex: 1, fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    maxHeight: "70%",
  },
  modalTitle: { fontSize: 15, paddingHorizontal: 8, paddingVertical: 8 },
  modalList: { maxHeight: 360 },
  modalOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  modalOptionText: { flex: 1, fontSize: 14 },
});
