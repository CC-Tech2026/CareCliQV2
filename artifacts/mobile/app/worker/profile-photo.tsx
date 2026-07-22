import { Feather } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  cropRectFromTransform,
  ProfilePhotoCropEditor,
  type CropTransform,
} from "@/components/worker/profile/ProfilePhotoCropEditor";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { deleteProfilePhoto, uploadProfilePhoto } from "@/lib/user-api";

const CIRCLE = 280;

export default function ProfilePhotoScreen() {
  const colors = useColors();
  const router = useRouter();
  const t = useT();
  const queryClient = useQueryClient();
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();

  const [localUri, setLocalUri] = useState<string | null>(null);
  const [transform, setTransform] = useState<CropTransform | null>(null);
  const [busy, setBusy] = useState(false);

  const previewUri = localUri ?? user?.profile_photo_url ?? null;

  const pickImage = useCallback(
    async (fromCamera: boolean) => {
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          showToast(t("profile.photo.permissionCamera"), "error");
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          showToast(t("profile.photo.permissionLibrary"), "error");
          return;
        }
      }

      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 1,
            allowsEditing: false,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 1,
            allowsEditing: false,
          });

      if (result.canceled || !result.assets[0]?.uri) return;
      setLocalUri(result.assets[0].uri);
      setTransform(null);
    },
    [showToast, t],
  );

  const handleSave = async () => {
    if (!localUri || !transform) {
      showToast(t("profile.photo.chooseFirst"), "error");
      return;
    }
    setBusy(true);
    try {
      const crop = cropRectFromTransform(transform, CIRCLE);
      const cropped = await ImageManipulator.manipulateAsync(
        localUri,
        [{ crop }, { resize: { width: 512, height: 512 } }],
        { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG },
      );
      const uploaded = await uploadProfilePhoto({
        uri: cropped.uri,
        name: "avatar.jpg",
        type: "image/jpeg",
      });
      await updateUser({ profile_photo_url: uploaded.profile_photo_url });
      await queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      showToast(t("profile.photo.saved"), "success");
      router.back();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("profile.photo.uploadFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    try {
      await deleteProfilePhoto();
      await updateUser({ profile_photo_url: null });
      await queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      setLocalUri(null);
      setTransform(null);
      showToast(t("profile.photo.removed"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t("profile.photo.removeFailed"), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkerStackScreen headerTitle={t("profile.photo.title")} cardsOnBackground showBack>
      <View style={styles.body}>
        <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
          {t("profile.photo.hint")}
        </Text>

        <View style={styles.previewWrap}>
          {localUri ? (
            <ProfilePhotoCropEditor uri={localUri} size={CIRCLE} onTransformChange={setTransform} />
          ) : previewUri ? (
            <View
              style={[
                styles.staticCircle,
                {
                  width: CIRCLE,
                  height: CIRCLE,
                  borderRadius: CIRCLE / 2,
                  borderColor: colors.border,
                },
              ]}
            >
              <Image source={{ uri: previewUri }} style={{ width: CIRCLE, height: CIRCLE }} contentFit="cover" />
            </View>
          ) : (
            <View
              style={[
                styles.staticCircle,
                {
                  width: CIRCLE,
                  height: CIRCLE,
                  borderRadius: CIRCLE / 2,
                  backgroundColor: colors.soft,
                  borderColor: colors.border,
                },
              ]}
            >
              <Feather name="user" size={64} color={colors.primary} />
            </View>
          )}
        </View>

        {localUri ? (
          <Text style={[styles.dragHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("profile.photo.dragHint")}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Pressable
            onPress={() => void pickImage(false)}
            disabled={busy}
            style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Feather name="image" size={18} color={colors.primary} />
            <Text style={[styles.secondaryText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {t("profile.photo.chooseLibrary")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void pickImage(true)}
            disabled={busy}
            style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Feather name="camera" size={18} color={colors.primary} />
            <Text style={[styles.secondaryText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
              {t("profile.photo.takePhoto")}
            </Text>
          </Pressable>

          <Pressable
            onPress={() => void handleSave()}
            disabled={busy || !localUri || !transform}
            style={[
              styles.primaryBtn,
              { backgroundColor: colors.primary, opacity: busy || !localUri || !transform ? 0.45 : 1 },
            ]}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={[styles.primaryText, { fontFamily: "Inter_700Bold" }]}>
                {t("profile.photo.save")}
              </Text>
            )}
          </Pressable>

          {user?.profile_photo_url || localUri ? (
            <Pressable onPress={() => void handleRemove()} disabled={busy} style={styles.removeBtn}>
              <Text style={[styles.removeText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
                {t("profile.photo.remove")}
              </Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 16,
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  previewWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  staticCircle: {
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  dragHint: {
    fontSize: 13,
    textAlign: "center",
  },
  actions: {
    gap: 10,
    marginTop: 8,
  },
  secondaryBtn: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondaryText: { fontSize: 15 },
  primaryBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: "#FFFFFF", fontSize: 15 },
  removeBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  removeText: { fontSize: 14 },
});
