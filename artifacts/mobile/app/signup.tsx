import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
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

import { AuthBrandHeader } from "@/components/auth/AuthBrandHeader";
import { AuthThemeToggle } from "@/components/auth/AuthThemeToggle";
import { OtpInput } from "@/components/auth/OtpInput";
import { PasswordStrengthBar } from "@/components/auth/PasswordStrengthBar";
import { getAuthColors } from "@/constants/auth-colors";
import { useAuth } from "@/context/AuthContext";
import { usePreferences } from "@/context/PreferencesContext";
import {
  acceptInvite,
  completeOnboarding,
  lookupInviteCode,
  type InviteLookup,
} from "@/lib/auth-api";
import { requireSupportWorker } from "@/lib/worker-access";
import { uploadProfilePhoto } from "@/lib/user-api";
function ReviewRow({
  label,
  value,
  auth,
}: {
  label: string;
  value: string;
  auth: ReturnType<typeof getAuthColors>;
}) {
  return (
    <View style={styles.reviewRow}>
      <Text
        style={[
          styles.reviewLabel,
          { color: auth.muted, fontFamily: FontFamily.interMedium },
        ]}
      >
        {label}
      </Text>
      <Text
        style={[
          styles.reviewValue,
          { color: auth.text, fontFamily: FontFamily.interBold },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function AuthLabel({
  children,
  auth,
  required,
}: {
  children: string;
  auth: ReturnType<typeof getAuthColors>;
  required?: boolean;
}) {
  return (
    <Text
      style={[
        styles.label,
        { color: auth.plum, fontFamily: FontFamily.interBold },
      ]}
    >
      {children.toUpperCase()}
      {required ? <Text style={{ color: "#EF4444" }}> *</Text> : null}
    </Text>
  );
}

function AuthInput({
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  showToggle,
  showPassword,
  onTogglePassword,
  auth,
  error,
  keyboardType,
  autoCapitalize,
  editable = true,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  showToggle?: boolean;
  showPassword?: boolean;
  onTogglePassword?: () => void;
  auth: ReturnType<typeof getAuthColors>;
  error?: boolean;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words";
  editable?: boolean;
}) {
  return (
    <View
      style={[
        styles.inputRow,
        {
          backgroundColor: auth.inputBg,
          borderColor: error ? auth.error : auth.inputBorder,
          opacity: editable ? 1 : 0.7,
        },
      ]}
    >
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={auth.muted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        editable={editable}
        style={[
          styles.input,
          { color: auth.text, fontFamily: FontFamily.interMedium },
        ]}
      />
      {showToggle ? (
        <Pressable onPress={onTogglePassword} style={styles.eyeBtn}>
          <Feather
            name={showPassword ? "eye-off" : "eye"}
            size={18}
            color={auth.muted}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { updateSession, setActivationInProgress } = useAuth();
  useEffect(
    () => () => setActivationInProgress(false),
    [setActivationInProgress],
  );
  const { resolvedScheme, t } = usePreferences();
  const auth = getAuthColors(resolvedScheme);

  const [joinStep, setJoinStep] = useState(1);
  const [inviteCode, setInviteCode] = useState("");
  const [invite, setInvite] = useState<InviteLookup | null>(null);
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [contactNumber, setContactNumber] = useState("");
  const [address, setAddress] = useState("");
  const [profilePhotoUri, setProfilePhotoUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [profileSaveWarning, setProfileSaveWarning] = useState<string | null>(
    null,
  );

  const mismatch = Boolean(confirmPassword) && password !== confirmPassword;
  const short = Boolean(password) && password.length < 10;
  const yourDetailsValid =
    fullName.trim().length > 0 &&
    password.length >= 10 &&
    password === confirmPassword &&
    Boolean(invite);
  const profileValid = address.trim().length > 0;

  const pickProfilePhoto = useCallback(
    async (fromCamera: boolean) => {
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          setError(t("profile.photo.permissionCamera"));
          return;
        }
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setError(t("profile.photo.permissionLibrary"));
          return;
        }
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            quality: 0.85,
            allowsEditing: true,
            aspect: [1, 1],
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            quality: 0.85,
            allowsEditing: true,
            aspect: [1, 1],
          });
      if (result.canceled || !result.assets[0]?.uri) return;
      setProfilePhotoUri(result.assets[0].uri);
      setError(null);
    },
    [t],
  );

  const handleLookupCode = async () => {
    if (inviteCode.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = await lookupInviteCode(inviteCode);
      requireSupportWorker(data);
      setInvite(data);
      setJoinStep(2);
    } catch (err) {
      setInvite(null);
      setError(
        err instanceof Error ? err.message : t("auth.signup.join.invalidCode"),
      );
    } finally {
      setBusy(false);
    }
  };

  /** The account itself is already created and the worker is logged in by the
   * time these run, so a failure here must never be swallowed silently —
   * that would leave the worker believing their phone/address/photo saved
   * when it didn't, with no prompt to redo it. One retry after a short delay
   * absorbs a transient network blip; a warning on the success screen covers
   * the rest so the worker knows to fix it in Settings instead of assuming
   * it's on file. */
  const saveWithRetry = async (
    fn: () => Promise<unknown>,
  ): Promise<boolean> => {
    try {
      await fn();
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        await fn();
        return true;
      } catch {
        return false;
      }
    }
  };

  const handleCompleteSetup = async () => {
    if (!invite || !yourDetailsValid || !profileValid || busy) return;
    setBusy(true);
    setActivationInProgress(true);
    setError(null);
    setProfileSaveWarning(null);
    try {
      requireSupportWorker(invite);
      const result = await acceptInvite(invite.token, {
        full_name: fullName.trim(),
        password,
      });
      await updateSession(result.accessToken, result.user);

      const failedParts: string[] = [];

      if (profilePhotoUri) {
        const photoSaved = await saveWithRetry(() =>
          uploadProfilePhoto({
            uri: profilePhotoUri,
            name: "avatar.jpg",
            type: "image/jpeg",
          }),
        );
        if (!photoSaved) failedParts.push("photo");
      }

      const detailsSaved = await saveWithRetry(() =>
        completeOnboarding({
          account_type: "independent_worker",
          organization_name: invite.organization_name || undefined,
          contact_number: contactNumber.trim() || undefined,
          address: address.trim(),
        }),
      );
      if (!detailsSaved) failedParts.push("details");

      if (failedParts.length > 0) {
        setProfileSaveWarning(
          failedParts.includes("details")
            ? t("auth.signup.join.saveWarningDetails")
            : t("auth.signup.join.saveWarningPhoto"),
        );
      }

      setJoinStep(5);
    } catch (err) {
      setActivationInProgress(false);
      setError(
        err instanceof Error ? err.message : t("auth.signup.error.tryAgain"),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: auth.shellBg }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.themeToggle, { top: insets.top + 8 }]}>
        <AuthThemeToggle />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingTop: insets.top + 36,
          paddingHorizontal: 16,
          paddingBottom: insets.bottom + 24,
        }}
        showsVerticalScrollIndicator={false}
      >
        <AuthBrandHeader taglineKey="auth.signup.marketing.tagline" />

        <View
          style={[
            styles.formPanel,
            {
              backgroundColor: auth.formBg,
              borderColor: auth.cardBorder,
            },
          ]}
        >
          <View
            style={[
              styles.card,
              { backgroundColor: auth.formBg, borderColor: auth.cardBorder },
            ]}
          >
            {joinStep === 1 ? (
              <View style={styles.stack}>
                <View>
                  <Text
                    style={[
                      styles.cardTitle,
                      { color: auth.plum, fontFamily: FontFamily.interBold },
                    ]}
                  >
                    {t("auth.signup.join.title")}
                  </Text>
                  <Text
                    style={[
                      styles.cardSubtitle,
                      {
                        color: auth.muted,
                        fontFamily: FontFamily.interRegular,
                      },
                    ]}
                  >
                    {t("auth.signup.join.subtitle", { step: joinStep })}
                  </Text>
                </View>

                <View style={styles.otpWrap}>
                  <OtpInput
                    value={inviteCode}
                    onChange={setInviteCode}
                    auth={auth}
                    disabled={busy}
                    error={Boolean(error)}
                  />
                </View>

                {invite?.organization_name ? (
                  <View
                    style={[
                      styles.orgBanner,
                      { backgroundColor: `${auth.plum}14` },
                    ]}
                  >
                    <Text
                      style={[
                        styles.orgBannerText,
                        {
                          color: auth.plum,
                          fontFamily: FontFamily.interMedium,
                        },
                      ]}
                    >
                      {t("auth.signup.join.joining")}{" "}
                      <Text style={{ fontFamily: FontFamily.interBold }}>
                        {invite.organization_name}
                      </Text>
                    </Text>
                  </View>
                ) : null}

                {error ? (
                  <Text
                    style={[
                      styles.error,
                      { color: auth.error, fontFamily: FontFamily.interMedium },
                    ]}
                  >
                    {error}
                  </Text>
                ) : null}

                <Pressable
                  onPress={() => void handleLookupCode()}
                  disabled={inviteCode.length !== 6 || busy}
                  style={[
                    styles.continueBtn,
                    {
                      backgroundColor: auth.plum,
                      opacity: inviteCode.length !== 6 || busy ? 0.45 : 1,
                    },
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text
                      style={[
                        styles.primaryBtnText,
                        { fontFamily: FontFamily.interBold },
                      ]}
                    >
                      {t("auth.signup.continue")}
                    </Text>
                  )}
                </Pressable>

                <Text
                  style={[
                    styles.askLine,
                    { color: auth.muted, fontFamily: FontFamily.interMedium },
                  ]}
                >
                  {t("auth.signup.join.noInvite")}{" "}
                  <Text
                    onPress={() => setAskOpen(true)}
                    style={{
                      color: auth.plum,
                      fontFamily: FontFamily.interBold,
                    }}
                  >
                    {t("auth.signup.join.askCoordinator")}
                  </Text>
                </Text>
              </View>
            ) : null}

            {joinStep === 2 && invite ? (
              <View style={styles.stack}>
                <View>
                  <Text
                    style={[
                      styles.cardTitle,
                      { color: auth.plum, fontFamily: FontFamily.interBold },
                    ]}
                  >
                    {t("auth.signup.join.createTitle")}
                  </Text>
                  <Text
                    style={[
                      styles.cardSubtitle,
                      {
                        color: auth.muted,
                        fontFamily: FontFamily.interRegular,
                      },
                    ]}
                  >
                    {t("auth.signup.join.createSubtitle", { step: joinStep })}
                  </Text>
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth} required>
                    {t("auth.signup.email")}
                  </AuthLabel>
                  <AuthInput
                    value={invite.email}
                    onChangeText={() => undefined}
                    auth={auth}
                    editable={false}
                  />
                  <Text
                    style={{
                      color: auth.muted,
                      fontFamily: FontFamily.interRegular,
                      fontSize: 12,
                    }}
                  >
                    {t("auth.signup.org.lockedFromInvite")}
                  </Text>
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth} required>
                    {t("auth.signup.fullName")}
                  </AuthLabel>
                  <AuthInput
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder={t("auth.signup.namePlaceholder")}
                    auth={auth}
                    autoCapitalize="words"
                  />
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth} required>
                    {t("auth.signup.password")}
                  </AuthLabel>
                  <AuthInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder={t("auth.signup.passwordPlaceholder")}
                    auth={auth}
                    secureTextEntry={!showPassword}
                    showToggle
                    showPassword={showPassword}
                    onTogglePassword={() => setShowPassword((v) => !v)}
                    error={short}
                  />
                  <PasswordStrengthBar password={password} auth={auth} />
                </View>

                <View style={styles.field}>
                  <View style={styles.confirmHeader}>
                    <AuthLabel auth={auth} required>
                      {t("auth.signup.confirmPassword")}
                    </AuthLabel>
                    {confirmPassword ? (
                      <Text
                        style={{
                          color: mismatch ? auth.error : auth.valid,
                          fontFamily: FontFamily.interBold,
                          fontSize: 11,
                        }}
                      >
                        {mismatch
                          ? t("auth.signup.passwordMismatch")
                          : t("auth.signup.passwordMatch")}
                      </Text>
                    ) : null}
                  </View>
                  <AuthInput
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder={t("auth.signup.confirmPlaceholder")}
                    auth={auth}
                    secureTextEntry={!showPassword}
                    error={mismatch}
                  />
                </View>

                {error ? (
                  <Text
                    style={[
                      styles.error,
                      { color: auth.error, fontFamily: FontFamily.interMedium },
                    ]}
                  >
                    {error}
                  </Text>
                ) : null}

                <View style={styles.actions}>
                  <Pressable
                    onPress={() => {
                      setJoinStep(1);
                      setError(null);
                    }}
                    style={[
                      styles.secondaryBtn,
                      { borderColor: auth.inputBorder },
                    ]}
                  >
                    <Text
                      style={[
                        styles.secondaryBtnText,
                        { color: auth.plum, fontFamily: FontFamily.interBold },
                      ]}
                    >
                      {t("auth.signup.back")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (!yourDetailsValid) return;
                      setError(null);
                      setJoinStep(3);
                    }}
                    disabled={!yourDetailsValid}
                    style={[
                      styles.primaryBtn,
                      {
                        backgroundColor: auth.plum,
                        opacity: !yourDetailsValid ? 0.4 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.primaryBtnText,
                        { fontFamily: FontFamily.interBold },
                      ]}
                    >
                      {t("auth.signup.continue")}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {joinStep === 3 && invite ? (
              <View style={styles.stack}>
                <View>
                  <Text
                    style={[
                      styles.cardTitle,
                      { color: auth.plum, fontFamily: FontFamily.interBold },
                    ]}
                  >
                    {t("auth.signup.join.profileTitle")}
                  </Text>
                  <Text
                    style={[
                      styles.cardSubtitle,
                      {
                        color: auth.muted,
                        fontFamily: FontFamily.interRegular,
                      },
                    ]}
                  >
                    {t("auth.signup.join.profileSubtitle", { step: joinStep })}
                  </Text>
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth}>
                    {t("auth.signup.join.profilePhoto")}
                  </AuthLabel>
                  <View style={styles.photoRow}>
                    <View
                      style={[
                        styles.photoAvatar,
                        {
                          backgroundColor: `${auth.plum}18`,
                          borderColor: auth.inputBorder,
                        },
                      ]}
                    >
                      {profilePhotoUri ? (
                        <Image
                          source={{ uri: profilePhotoUri }}
                          style={styles.photoAvatarImg}
                        />
                      ) : (
                        <Feather name="user" size={28} color={auth.plum} />
                      )}
                    </View>
                    <View style={styles.photoActions}>
                      <Pressable
                        onPress={() => void pickProfilePhoto(true)}
                        style={[
                          styles.photoBtn,
                          { borderColor: auth.inputBorder },
                        ]}
                      >
                        <Feather name="camera" size={14} color={auth.plum} />
                        <Text
                          style={[
                            styles.photoBtnText,
                            {
                              color: auth.plum,
                              fontFamily: FontFamily.interBold,
                            },
                          ]}
                        >
                          {t("auth.signup.join.photoCamera")}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() => void pickProfilePhoto(false)}
                        style={[
                          styles.photoBtn,
                          { borderColor: auth.inputBorder },
                        ]}
                      >
                        <Feather name="image" size={14} color={auth.plum} />
                        <Text
                          style={[
                            styles.photoBtnText,
                            {
                              color: auth.plum,
                              fontFamily: FontFamily.interBold,
                            },
                          ]}
                        >
                          {t("auth.signup.join.photoUpload")}
                        </Text>
                      </Pressable>
                      {profilePhotoUri ? (
                        <Pressable onPress={() => setProfilePhotoUri(null)}>
                          <Text
                            style={{
                              color: auth.muted,
                              fontFamily: FontFamily.interMedium,
                              fontSize: 12,
                            }}
                          >
                            {t("auth.signup.join.photoRemove")}
                          </Text>
                        </Pressable>
                      ) : (
                        <Text
                          style={{
                            color: auth.muted,
                            fontFamily: FontFamily.interRegular,
                            fontSize: 12,
                          }}
                        >
                          {t("auth.signup.join.photoOptional")}
                        </Text>
                      )}
                    </View>
                  </View>
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth}>
                    {t("auth.signup.field.contactNumber")}
                  </AuthLabel>
                  <AuthInput
                    value={contactNumber}
                    onChangeText={setContactNumber}
                    placeholder={t("auth.signup.placeholder.contact")}
                    auth={auth}
                    keyboardType="phone-pad"
                  />
                  <Text
                    style={{
                      color: auth.muted,
                      fontFamily: FontFamily.interRegular,
                      fontSize: 12,
                    }}
                  >
                    {t("auth.signup.join.optionalHint")}
                  </Text>
                </View>

                <View style={styles.field}>
                  <AuthLabel auth={auth} required>
                    {t("auth.signup.field.address")}
                  </AuthLabel>
                  <AuthInput
                    value={address}
                    onChangeText={setAddress}
                    placeholder={t("auth.signup.placeholder.address")}
                    auth={auth}
                  />
                </View>

                {error ? (
                  <Text
                    style={[
                      styles.error,
                      { color: auth.error, fontFamily: FontFamily.interMedium },
                    ]}
                  >
                    {error}
                  </Text>
                ) : null}

                <View style={styles.actions}>
                  <Pressable
                    onPress={() => {
                      setJoinStep(2);
                      setError(null);
                    }}
                    style={[
                      styles.secondaryBtn,
                      { borderColor: auth.inputBorder },
                    ]}
                  >
                    <Text
                      style={[
                        styles.secondaryBtnText,
                        { color: auth.plum, fontFamily: FontFamily.interBold },
                      ]}
                    >
                      {t("auth.signup.back")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (!profileValid) return;
                      setError(null);
                      setJoinStep(4);
                    }}
                    disabled={!profileValid}
                    style={[
                      styles.primaryBtn,
                      {
                        backgroundColor: auth.plum,
                        opacity: !profileValid ? 0.4 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.primaryBtnText,
                        { fontFamily: FontFamily.interBold },
                      ]}
                    >
                      {t("auth.signup.continue")}
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : null}

            {joinStep === 4 && invite ? (
              <View style={styles.stack}>
                <View>
                  <Text
                    style={[
                      styles.cardTitle,
                      { color: auth.plum, fontFamily: FontFamily.interBold },
                    ]}
                  >
                    {t("auth.signup.join.reviewTitle")}
                  </Text>
                  <Text
                    style={[
                      styles.cardSubtitle,
                      {
                        color: auth.muted,
                        fontFamily: FontFamily.interRegular,
                      },
                    ]}
                  >
                    {t("auth.signup.join.reviewSubtitle", { step: joinStep })}
                  </Text>
                </View>

                <View
                  style={[
                    styles.reviewCard,
                    {
                      backgroundColor: `${auth.plum}10`,
                      borderColor: auth.cardBorder,
                    },
                  ]}
                >
                  <View style={styles.reviewPhotoWrap}>
                    <View
                      style={[
                        styles.photoAvatar,
                        {
                          backgroundColor: `${auth.plum}18`,
                          borderColor: auth.inputBorder,
                        },
                      ]}
                    >
                      {profilePhotoUri ? (
                        <Image
                          source={{ uri: profilePhotoUri }}
                          style={styles.photoAvatarImg}
                        />
                      ) : (
                        <Feather name="user" size={28} color={auth.plum} />
                      )}
                    </View>
                  </View>
                  <ReviewRow
                    label={t("auth.signup.join.reviewOrg")}
                    value={
                      invite.organization_name ||
                      t("auth.signup.join.yourOrganisation")
                    }
                    auth={auth}
                  />
                  <ReviewRow
                    label={t("auth.signup.fullName")}
                    value={fullName.trim()}
                    auth={auth}
                  />
                  <ReviewRow
                    label={t("auth.signup.email")}
                    value={invite.email}
                    auth={auth}
                  />
                  <ReviewRow
                    label={t("auth.signup.field.contactNumber")}
                    value={
                      contactNumber.trim() || t("auth.signup.join.notProvided")
                    }
                    auth={auth}
                  />
                  <ReviewRow
                    label={t("auth.signup.field.address")}
                    value={address.trim()}
                    auth={auth}
                  />
                </View>

                {error ? (
                  <Text
                    style={[
                      styles.error,
                      { color: auth.error, fontFamily: FontFamily.interMedium },
                    ]}
                  >
                    {error}
                  </Text>
                ) : null}

                <View style={styles.actions}>
                  <Pressable
                    onPress={() => {
                      setJoinStep(3);
                      setError(null);
                    }}
                    style={[
                      styles.secondaryBtn,
                      { borderColor: auth.inputBorder },
                    ]}
                  >
                    <Text
                      style={[
                        styles.secondaryBtnText,
                        { color: auth.plum, fontFamily: FontFamily.interBold },
                      ]}
                    >
                      {t("auth.signup.back")}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void handleCompleteSetup()}
                    disabled={busy}
                    style={[
                      styles.primaryBtn,
                      { backgroundColor: auth.plum, opacity: busy ? 0.4 : 1 },
                    ]}
                  >
                    {busy ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <Text
                        style={[
                          styles.primaryBtnText,
                          { fontFamily: FontFamily.interBold },
                        ]}
                      >
                        {t("auth.signup.completeSetup")}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : null}

            {joinStep === 5 ? (
              <View style={styles.successWrap}>
                <Feather name="check-circle" size={70} color={auth.valid} />
                <Text
                  style={[
                    styles.successTitle,
                    { color: auth.plum, fontFamily: FontFamily.interBold },
                  ]}
                >
                  {t("auth.signup.join.welcomeTitle")}
                </Text>
                <Text
                  style={[
                    styles.successBody,
                    { color: auth.muted, fontFamily: FontFamily.interRegular },
                  ]}
                >
                  {t("auth.signup.join.welcomeBody", {
                    org:
                      invite?.organization_name ||
                      t("auth.signup.join.yourOrganisation"),
                  })}
                </Text>
                {profileSaveWarning ? (
                  <View
                    style={[styles.saveWarning, { borderColor: auth.plum }]}
                  >
                    <Feather
                      name="alert-triangle"
                      size={14}
                      color={auth.plum}
                    />
                    <Text
                      style={[
                        styles.saveWarningText,
                        {
                          color: auth.text,
                          fontFamily: FontFamily.interMedium,
                        },
                      ]}
                    >
                      {profileSaveWarning}
                    </Text>
                  </View>
                ) : null}
                <Pressable
                  onPress={() =>
                    router.replace("/worker/credentials/add" as never)
                  }
                  style={[
                    styles.primaryBtn,
                    styles.successBtn,
                    { backgroundColor: auth.plum },
                  ]}
                >
                  <Text
                    style={[
                      styles.primaryBtnText,
                      { fontFamily: FontFamily.interBold },
                    ]}
                  >
                    {t("auth.signup.join.uploadCredentials")}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => router.replace("/(tabs)" as never)}
                  style={styles.successSkip}
                >
                  <Text
                    style={[
                      styles.successSkipText,
                      {
                        color: auth.muted,
                        fontFamily: FontFamily.interSemiBold,
                      },
                    ]}
                  >
                    {t("auth.signup.goToDashboard")}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>

          {joinStep < 5 ? (
            <View style={styles.footerLinks}>
              <Text
                style={[
                  styles.signInLine,
                  { color: auth.muted, fontFamily: FontFamily.interMedium },
                ]}
              >
                {t("auth.signup.hasAccount")}{" "}
                <Text
                  onPress={() => router.replace("/login" as never)}
                  style={{ color: auth.plum, fontFamily: FontFamily.interBold }}
                >
                  {t("auth.signup.signIn")}
                </Text>
              </Text>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        visible={askOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAskOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setAskOpen(false)}
        >
          <Pressable
            style={[
              styles.askCard,
              { backgroundColor: auth.formBg, borderColor: auth.cardBorder },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text
              style={[
                styles.cardTitle,
                { color: auth.plum, fontFamily: FontFamily.interBold },
              ]}
            >
              {t("auth.signup.join.askTitle")}
            </Text>
            <Text
              style={[
                styles.cardSubtitle,
                { color: auth.muted, fontFamily: FontFamily.interRegular },
              ]}
            >
              {t("auth.signup.join.askIntro")}
            </Text>

            <View style={styles.askSteps}>
              {(
                [
                  "auth.signup.join.askStep1",
                  "auth.signup.join.askStep2",
                  "auth.signup.join.askStep3",
                  "auth.signup.join.askStep4",
                ] as const
              ).map((key, index) => (
                <View key={key} style={styles.askStepRow}>
                  <View
                    style={[
                      styles.askStepNum,
                      { backgroundColor: `${auth.plum}18` },
                    ]}
                  >
                    <Text
                      style={{
                        color: auth.plum,
                        fontFamily: FontFamily.interBold,
                        fontSize: 12,
                      }}
                    >
                      {index + 1}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.askStepText,
                      { color: auth.text, fontFamily: FontFamily.interRegular },
                    ]}
                  >
                    {t(key)}
                  </Text>
                </View>
              ))}
            </View>

            <Pressable
              onPress={() => setAskOpen(false)}
              style={({ pressed }) => [
                styles.askGotItBtn,
                {
                  borderColor: auth.plum,
                  backgroundColor: pressed ? auth.plum : "transparent",
                  marginTop: 8,
                },
              ]}
            >
              {({ pressed }) => (
                <Text
                  style={[
                    styles.askGotItBtnText,
                    {
                      fontFamily: FontFamily.interBold,
                      color: pressed ? "#FFFFFF" : auth.plum,
                    },
                  ]}
                >
                  {t("auth.signup.join.askGotIt")}
                </Text>
              )}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  themeToggle: { position: "absolute", right: 16, zIndex: 20 },
  formPanel: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    marginBottom: 16,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 16,
    overflow: "hidden",
  },
  dragHandleWrap: { alignItems: "center", paddingTop: 12, paddingBottom: 8 },
  dragHandle: { width: 40, height: 4, borderRadius: 2 },
  stepBar: {
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  stepItem: { flex: 1, gap: 6 },
  stepTrack: { height: 4, borderRadius: 999 },
  stepLabel: { fontSize: 9, textAlign: "center" },
  card: {
    paddingBottom: 20,
    overflow: "hidden",
  },
  stack: { gap: 16, width: "100%" },
  cardTitle: { fontSize: 24, lineHeight: 31 },
  cardSubtitle: { fontSize: 14, marginTop: 4, lineHeight: 20 },
  joinStepHint: { fontSize: 13, marginBottom: 10 },
  otpWrap: { width: "100%", alignSelf: "stretch" },
  field: { gap: 6 },
  label: { fontSize: 11, letterSpacing: 0.8 },
  inputRow: {
    minHeight: 44,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  input: { flex: 1, fontSize: 14, paddingVertical: 10 },
  eyeBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  actions: { flexDirection: "row", gap: 12, marginTop: 8 },
  secondaryBtn: {
    height: 48,
    paddingHorizontal: 18,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: { fontSize: 14 },
  primaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  continueBtn: {
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
    width: "100%",
  },
  fullBtn: { flex: 0, alignSelf: "stretch", width: "100%" },
  primaryBtnText: { color: "#FFFFFF", fontSize: 15 },
  error: { fontSize: 12 },
  successWrap: { alignItems: "center", gap: 12, paddingVertical: 12 },
  successTitle: { fontSize: 24, textAlign: "center", marginTop: 8 },
  successBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  successBtn: { width: "100%", marginTop: 12 },
  successSkip: { paddingVertical: 10 },
  successSkipText: { fontSize: 13, textAlign: "center" },
  saveWarning: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  saveWarningText: { flex: 1, fontSize: 12, lineHeight: 17 },
  signInLine: { textAlign: "center", fontSize: 13 },
  askLine: { textAlign: "center", fontSize: 13 },
  askSteps: { gap: 12, marginTop: 4 },
  askStepRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  askStepNum: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  askStepText: { flex: 1, fontSize: 14, lineHeight: 20 },
  photoRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  photoAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  photoAvatarImg: { width: 72, height: 72 },
  photoActions: { flex: 1, gap: 8 },
  photoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  photoBtnText: { fontSize: 13 },
  reviewCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  reviewPhotoWrap: { alignItems: "center", marginBottom: 4 },
  reviewRow: { gap: 2 },
  reviewLabel: { fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6 },
  reviewValue: { fontSize: 14 },
  askGotItBtn: {
    alignSelf: "stretch",
    width: "100%",
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  askGotItBtnText: { fontSize: 15 },
  orgBanner: {
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  orgBannerText: { fontSize: 14, textAlign: "center" },
  footerLinks: { gap: 10, marginTop: 16 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  askCard: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
    gap: 14,
  },
});
