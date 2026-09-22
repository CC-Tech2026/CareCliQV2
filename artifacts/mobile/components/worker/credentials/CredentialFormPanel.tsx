import { Feather } from "@expo/vector-icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as DocumentPicker from "expo-document-picker";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
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
import { createCredential, updateCredential, uploadCredentialFile, type Credential } from "@/lib/resource-api";

type PickedFile = { uri: string; name: string; type: string };

const EXTENSION_MIME_FALLBACK: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Some Android content providers/file pickers don't report a `mimeType` —
 * falling back to "application/octet-stream" there guarantees the backend
 * rejects an otherwise-valid PDF/photo (it only accepts pdf/jpeg/png/webp),
 * so the upload could never succeed for those providers. Guess from the
 * filename extension instead when the picker didn't tell us. */
function resolveFileType(name: string, mimeType: string | undefined | null): string {
  if (mimeType) return mimeType;
  const ext = name.split(".").pop()?.toLowerCase();
  return (ext && EXTENSION_MIME_FALLBACK[ext]) || "application/octet-stream";
}

/** One form for both adding a brand-new credential and renewing an existing
 * one — passing `credential` switches it into update mode: the type is
 * fixed (it's the same requirement, not a new one), fields are prefilled,
 * and saving patches that same row (plus re-uploading a document onto it)
 * instead of inserting a second record for the same requirement.
 *
 * `presetType` is used when arriving from the "required to get rostered"
 * checklist for a specific missing credential — the type is locked so it's
 * unambiguous which requirement is being fulfilled. */
export function CredentialFormPanel({ credential, presetType }: { credential?: Credential; presetType?: CredentialTypeOption }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const router = useRouter();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const isUpdate = Boolean(credential);
  const typeLocked = isUpdate || Boolean(presetType);

  const [credentialType, setCredentialType] = useState<CredentialTypeOption>(
    (credential?.credential_type as CredentialTypeOption) ?? presetType ?? CREDENTIAL_TYPE_OPTIONS[0],
  );
  const [title, setTitle] = useState(credential?.title ?? (presetType ? credentialTypeLabel(presetType) : ""));
  const [credentialNumber, setCredentialNumber] = useState(credential?.credential_number ?? "");
  const [issuer, setIssuer] = useState(credential?.issuer ?? "");
  const [issueDate, setIssueDate] = useState(credential?.issue_date ?? "");
  const [expiryDate, setExpiryDate] = useState(credential?.expiry_date ?? "");
  const [screeningNumber, setScreeningNumber] = useState(credential?.screening_number ?? "");
  const [typeOpen, setTypeOpen] = useState(false);
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);

  async function handlePickFile() {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["application/pdf", "image/*"],
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const name = asset.name || "credential-document";
    setPickedFile({
      uri: asset.uri,
      name,
      type: resolveFileType(name, asset.mimeType),
    });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmedTitle = title.trim();
      if (!trimmedTitle) {
        throw new Error(t("credentials.titleRequired"));
      }

      const payload = {
        credential_type: credentialType,
        title: trimmedTitle,
        credential_number: credentialNumber.trim() || null,
        issuer: issuer.trim() || null,
        issue_date: issueDate.trim() || null,
        expiry_date: expiryDate.trim() || null,
        ...(credentialType === "ndis_screening" ? { screening_number: screeningNumber.trim() || null } : {}),
      };

      const saved = credential
        ? await updateCredential(credential.id, payload)
        : await createCredential(payload);

      if (pickedFile) {
        return uploadCredentialFile(saved.id, pickedFile);
      }
      return saved;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["credentials", "me"] });
      showToast(isUpdate ? t("credentials.updated") : t("credentials.saved"), "success");
      router.back();
    },
    onError: (error: Error) => {
      showToast(error.message || (isUpdate ? t("credentials.updateFailed") : t("credentials.saveFailed")), "error");
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
          {isUpdate ? t("credentials.updateDescription") : t("credentials.addDescription")}
        </Text>

        <SettingsPanelCard>
          <View style={styles.form}>
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("credentials.type")}
              </Text>
              {typeLocked ? (
                <View style={[styles.select, styles.selectDisabled, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  <Text style={[styles.selectText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    {credentialTypeLabel(credentialType)}
                  </Text>
                </View>
              ) : (
                <Pressable
                  onPress={() => setTypeOpen(true)}
                  style={[styles.select, { borderColor: colors.border, backgroundColor: colors.background }]}
                >
                  <Text style={[styles.selectText, { color: colors.foreground, fontFamily: "Inter_400Regular" }]}>
                    {credentialTypeLabel(credentialType)}
                  </Text>
                  <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
                </Pressable>
              )}
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

            {credentialType === "ndis_screening" ? (
              <View style={styles.field}>
                <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  {t("credentials.screeningNumber")}
                </Text>
                <TextInput
                  value={screeningNumber}
                  onChangeText={setScreeningNumber}
                  placeholder={t("credentials.screeningNumberPlaceholder")}
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="characters"
                  style={[styles.input, { color: colors.foreground, borderColor: colors.border, backgroundColor: colors.background }]}
                />
              </View>
            ) : null}

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

            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("credentials.document")}
              </Text>
              {credential?.file_url && !pickedFile ? (
                <Pressable
                  onPress={() => void Linking.openURL(credential.file_url as string)}
                  style={[styles.fileRow, { borderColor: colors.border, backgroundColor: colors.background }]}
                >
                  <Feather name="file-text" size={16} color={colors.primary} />
                  <Text style={[styles.fileRowText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]} numberOfLines={1}>
                    {t("credentials.viewCurrentDocument")}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => void handlePickFile()}
                style={[styles.filePicker, { borderColor: colors.border, backgroundColor: colors.background }]}
              >
                <Feather name="upload" size={16} color={colors.mutedForeground} />
                <Text style={[styles.filePickerText, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
                  {pickedFile
                    ? pickedFile.name
                    : credential?.file_url
                      ? t("credentials.replaceDocument")
                      : t("credentials.uploadFile")}
                </Text>
              </Pressable>
            </View>

            <SettingsSaveButton
              label={isUpdate ? t("credentials.update") : t("credentials.save")}
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
  selectDisabled: { opacity: 0.7 },
  selectText: { flex: 1, fontSize: 14 },
  fileRow: {
    minHeight: 40,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fileRowText: { flex: 1, fontSize: 13 },
  filePicker: {
    minHeight: 44,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  filePickerText: { flex: 1, fontSize: 13 },
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
