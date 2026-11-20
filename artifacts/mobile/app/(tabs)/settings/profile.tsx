import { Feather } from "@expo/vector-icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CopyButton } from "@/components/worker/CopyButton";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { FontFamily } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import {
  addMySkill,
  addMyTag,
  getMySkills,
  getMyTags,
  getTagCatalog,
  getWorkerProfile,
  removeMySkill,
  removeMyTag,
  updateWorkerProfile,
} from "@/lib/user-api";
import { WorkerApiError } from "@/lib/worker-fetch";

const SUMMARY_MAX = 600;

/**
 * The worker's own profile: about me, experience, skills, interests and home
 * area. Coordinators and directors see these straight away, so workers keep
 * their details current themselves.
 */
export default function MyProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated, user } = useAuth();

  const profile = useQuery({
    queryKey: ["users", "me"],
    queryFn: getWorkerProfile,
    enabled: isAuthenticated,
  });
  const skills = useQuery({
    queryKey: ["worker", "my-skills"],
    queryFn: getMySkills,
    enabled: isAuthenticated,
  });
  const catalog = useQuery({
    queryKey: ["worker", "tag-catalog"],
    queryFn: getTagCatalog,
    enabled: isAuthenticated,
  });
  const myTags = useQuery({
    queryKey: ["worker", "my-tags"],
    queryFn: getMyTags,
    enabled: isAuthenticated,
  });

  const [summary, setSummary] = useState("");
  const [years, setYears] = useState(0);
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [suburb, setSuburb] = useState("");
  const [newSkill, setNewSkill] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const p = profile.data;
    if (!p || dirty) return;
    setSummary(p.profile_summary ?? "");
    setYears(p.profile_experience_years ?? 0);
    setPhone(p.phone ?? "");
    setAddress(p.address ?? "");
    setSuburb(p.suburb ?? "");
  }, [profile.data, dirty]);

  const edit =
    <T,>(setter: (v: T) => void) =>
    (v: T) => {
      setter(v);
      setDirty(true);
    };

  const saveProfile = () =>
    updateWorkerProfile({
      profile_summary: summary.trim() || null,
      profile_experience_years: years,
      phone: phone.trim(),
      address: address.trim() || null,
      suburb: suburb.trim() || null,
    });

  const save = useMutation({
    mutationFn: async () => {
      if (!phone.trim()) throw new Error(t("settings.contact.phoneRequired"));
      return saveProfile();
    },

    onSuccess: () => {
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      showToast(t("myProfile.saved"), "success");
    },
    onError: (e: Error) =>
      showToast(e.message || t("myProfile.saveFailed"), "error"),
  });

  const refreshSkills = () =>
    void queryClient.invalidateQueries({ queryKey: ["worker", "my-skills"] });
  const addSkill = useMutation({
    mutationFn: (skill: string) => addMySkill(skill),
    onSuccess: () => {
      setNewSkill("");
      refreshSkills();
    },
    onError: (e: Error) =>
      showToast(e.message || t("myProfile.saveFailed"), "error"),
  });
  const removeSkill = useMutation({
    mutationFn: (skill: string) => removeMySkill(skill),
    onSuccess: refreshSkills,
    onError: (e: Error) =>
      showToast(
        e instanceof WorkerApiError && e.status === 409
          ? t("myProfile.skills.confirmedLocked")
          : e.message,
        "error",
      ),
  });

  const myTagIds = useMemo(
    () => new Set((myTags.data ?? []).map((tag) => tag.tag_id)),
    [myTags.data],
  );
  const toggleTag = useMutation({
    mutationFn: (tagId: string) =>
      myTagIds.has(tagId)
        ? removeMyTag(tagId)
        : addMyTag(tagId).then(() => undefined),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["worker", "my-tags"] }),
    onError: (e: Error) =>
      showToast(e.message || t("myProfile.saveFailed"), "error"),
  });

  const categories = (catalog.data ?? []).filter(
    (c) => c.is_active !== false && c.tags.length > 0,
  );
  const name = profile.data?.full_name || user?.full_name || "";

  const card = { backgroundColor: colors.card, borderColor: colors.border };
  const label = [
    styles.label,
    { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
  ];
  const hint = [
    styles.hint,
    { color: colors.mutedForeground, fontFamily: FontFamily.interRegular },
  ];
  const input = [
    styles.input,
    {
      color: colors.foreground,
      borderColor: colors.border,
      backgroundColor: colors.background,
      fontFamily: FontFamily.interRegular,
    },
  ];

  if (profile.isLoading) {
    return (
      <SettingsSubScreen
        showBottomNav={false}
        title={t("myProfile.title")}
        guide="profile"
      >
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SettingsSubScreen>
    );
  }

  return (
    <SettingsSubScreen
      showBottomNav={false}
      title={t("myProfile.title")}
      guide="profile"
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + 110 },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.notice, { backgroundColor: colors.soft }]}>
            <Feather name="users" size={16} color={colors.primary} />
            <Text
              style={[
                styles.noticeText,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            >
              {t("myProfile.sharedNotice")}
            </Text>
          </View>

          {/* Name: shown, changed by the office (it's on payroll and NDIS records). */}
          <View style={[styles.card, card]}>
            <Text style={label}>{t("myProfile.name")}</Text>
            <Text
              style={[
                styles.value,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interMedium,
                },
              ]}
            >
              {name}
            </Text>
            <Text style={hint}>{t("myProfile.nameHint")}</Text>
          </View>

          <View style={[styles.card, card]}>
            <Text style={label}>{t("myProfile.contact")}</Text>
            <Text
              style={[
                styles.fieldLabel,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interMedium,
                },
              ]}
            >
              {t("settings.contact.phone")}
            </Text>
            <View style={styles.inline}>
              <TextInput
                value={phone}
                onChangeText={edit(setPhone)}
                keyboardType="phone-pad"
                autoComplete="tel"
                placeholder={t("settings.contact.phonePlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                accessibilityLabel={t("settings.contact.phone")}
                style={[input, { flex: 1 }]}
              />
              {phone.trim() ? (
                <CopyButton
                  value={phone.trim()}
                  label={t("settings.contact.phone")}
                />
              ) : null}
            </View>
            <Text
              style={[
                styles.fieldLabel,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interMedium,
                },
              ]}
            >
              {t("myProfile.email")}
            </Text>
            <View style={styles.inline}>
              <Text
                selectable
                numberOfLines={1}
                style={[
                  styles.value,
                  {
                    flex: 1,
                    color: colors.foreground,
                    fontFamily: FontFamily.interMedium,
                  },
                ]}
              >
                {profile.data?.email ?? ""}
              </Text>
              {profile.data?.email ? (
                <CopyButton
                  value={profile.data.email}
                  label={t("myProfile.email")}
                />
              ) : null}
            </View>
            <Text style={hint}>{t("myProfile.emailHint")}</Text>
          </View>

          <View style={[styles.card, card]}>
            <Text style={label}>{t("myProfile.about")}</Text>
            <Text style={hint}>{t("myProfile.aboutHint")}</Text>
            <TextInput
              value={summary}
              onChangeText={edit((v: string) =>
                setSummary(v.slice(0, SUMMARY_MAX)),
              )}
              multiline
              placeholder={t("myProfile.aboutPlaceholder")}
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel={t("myProfile.about")}
              style={[input, styles.textarea]}
            />
            <Text
              style={[
                styles.counter,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            >
              {summary.length}/{SUMMARY_MAX}
            </Text>

            <Text style={[label, { marginTop: 8 }]}>
              {t("myProfile.experience")}
            </Text>
            <View style={styles.stepper}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("myProfile.fewerYears")}
                onPress={() => edit(setYears)(Math.max(0, years - 1))}
                style={[styles.stepBtn, { borderColor: colors.border }]}
              >
                <Feather name="minus" size={18} color={colors.foreground} />
              </Pressable>
              <Text
                accessibilityLiveRegion="polite"
                style={[
                  styles.stepValue,
                  {
                    color: colors.foreground,
                    fontFamily: FontFamily.interSemiBold,
                  },
                ]}
              >
                {t(years === 1 ? "myProfile.year" : "myProfile.years", {
                  count: String(years),
                })}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("myProfile.moreYears")}
                onPress={() => edit(setYears)(Math.min(80, years + 1))}
                style={[styles.stepBtn, { borderColor: colors.border }]}
              >
                <Feather name="plus" size={18} color={colors.foreground} />
              </Pressable>
            </View>
          </View>

          <View style={[styles.card, card]}>
            <Text style={label}>{t("myProfile.skills.title")}</Text>
            <Text style={hint}>{t("myProfile.skills.hint")}</Text>
            <View style={styles.chips}>
              {(skills.data?.skills ?? []).map((item) => (
                <View
                  key={item.skill}
                  style={[
                    styles.chip,
                    item.is_certified
                      ? {
                          backgroundColor: colors.statusDocumentedBg,
                          borderColor: colors.statusDocumentedBg,
                        }
                      : {
                          backgroundColor: colors.card,
                          borderColor: colors.border,
                        },
                  ]}
                >
                  {item.is_certified ? (
                    <Feather
                      name="check-circle"
                      size={14}
                      color={colors.success}
                    />
                  ) : null}
                  <Text
                    style={[
                      styles.chipText,
                      {
                        color: colors.foreground,
                        fontFamily: FontFamily.interMedium,
                      },
                    ]}
                  >
                    {item.skill}
                  </Text>
                  {!item.is_certified ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("myProfile.skills.remove", {
                        skill: item.skill,
                      })}
                      hitSlop={8}
                      onPress={() => removeSkill.mutate(item.skill)}
                    >
                      <Feather
                        name="x"
                        size={15}
                        color={colors.mutedForeground}
                      />
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
            {(skills.data?.skills ?? []).some((s) => !s.is_certified) ? (
              <Text style={hint}>{t("myProfile.skills.legend")}</Text>
            ) : null}
            <View style={styles.addRow}>
              <TextInput
                value={newSkill}
                onChangeText={setNewSkill}
                placeholder={t("myProfile.skills.placeholder")}
                placeholderTextColor={colors.mutedForeground}
                accessibilityLabel={t("myProfile.skills.placeholder")}
                returnKeyType="done"
                onSubmitEditing={() =>
                  newSkill.trim() && addSkill.mutate(newSkill.trim())
                }
                style={[input, { flex: 1 }]}
              />
              <Pressable
                accessibilityRole="button"
                disabled={!newSkill.trim() || addSkill.isPending}
                onPress={() => addSkill.mutate(newSkill.trim())}
                style={[
                  styles.addBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: newSkill.trim() ? 1 : 0.45,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.addBtnText,
                    {
                      color: colors.primaryForeground,
                      fontFamily: FontFamily.interSemiBold,
                    },
                  ]}
                >
                  {t("myProfile.skills.add")}
                </Text>
              </Pressable>
            </View>
            {(skills.data?.suggestions ?? []).length > 0 ? (
              <>
                <Text style={[hint, { marginTop: 4 }]}>
                  {t("myProfile.skills.suggested")}
                </Text>
                <View style={styles.chips}>
                  {(skills.data?.suggestions ?? [])
                    .slice(0, 12)
                    .map((suggestion) => (
                      <Pressable
                        key={suggestion}
                        accessibilityRole="button"
                        accessibilityLabel={t("myProfile.skills.addNamed", {
                          skill: suggestion,
                        })}
                        onPress={() => addSkill.mutate(suggestion)}
                        style={[
                          styles.chip,
                          {
                            backgroundColor: colors.soft,
                            borderColor: colors.soft,
                          },
                        ]}
                      >
                        <Feather name="plus" size={14} color={colors.primary} />
                        <Text
                          style={[
                            styles.chipText,
                            {
                              color: colors.primary,
                              fontFamily: FontFamily.interMedium,
                            },
                          ]}
                        >
                          {suggestion}
                        </Text>
                      </Pressable>
                    ))}
                </View>
              </>
            ) : null}
          </View>

          {categories.length > 0 ? (
            <View style={[styles.card, card]}>
              <Text style={label}>{t("myProfile.interests")}</Text>
              <Text style={hint}>{t("myProfile.interestsHint")}</Text>
              {categories.map((category) => (
                <View key={category.id} style={{ gap: 8, marginTop: 6 }}>
                  <Text
                    style={[
                      styles.category,
                      {
                        color: colors.mutedForeground,
                        fontFamily: FontFamily.interSemiBold,
                      },
                    ]}
                  >
                    {category.name}
                  </Text>
                  <View style={styles.chips}>
                    {category.tags.map((tag) => {
                      const on = myTagIds.has(tag.id);
                      return (
                        <Pressable
                          key={tag.id}
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: on }}
                          onPress={() => toggleTag.mutate(tag.id)}
                          style={[
                            styles.chip,
                            on
                              ? {
                                  backgroundColor: colors.primary,
                                  borderColor: colors.primary,
                                }
                              : {
                                  backgroundColor: colors.card,
                                  borderColor: colors.border,
                                },
                          ]}
                        >
                          {on ? (
                            <Feather
                              name="check"
                              size={14}
                              color={colors.primaryForeground}
                            />
                          ) : null}
                          <Text
                            style={[
                              styles.chipText,
                              {
                                color: on
                                  ? colors.primaryForeground
                                  : colors.foreground,
                                fontFamily: FontFamily.interMedium,
                              },
                            ]}
                          >
                            {tag.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          <View style={[styles.card, card]}>
            <Text style={label}>{t("myProfile.home")}</Text>
            <Text style={hint}>{t("myProfile.homeHint")}</Text>
            <TextInput
              value={address}
              onChangeText={edit(setAddress)}
              placeholder={t("myProfile.address")}
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel={t("myProfile.address")}
              autoComplete="street-address"
              style={input}
            />
            <TextInput
              value={suburb}
              onChangeText={edit(setSuburb)}
              placeholder={t("myProfile.suburb")}
              placeholderTextColor={colors.mutedForeground}
              accessibilityLabel={t("myProfile.suburb")}
              style={input}
            />
          </View>
        </ScrollView>

        {dirty ? (
          <View
            style={[
              styles.saveBar,
              {
                backgroundColor: colors.card,
                borderTopColor: colors.border,
                paddingBottom: insets.bottom + 12,
              },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              disabled={save.isPending}
              onPress={() => save.mutate()}
              style={[
                styles.saveBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: save.isPending ? 0.6 : 1,
                },
              ]}
            >
              {save.isPending ? (
                <ActivityIndicator color={colors.primaryForeground} />
              ) : (
                <Text
                  style={[
                    styles.saveText,
                    {
                      color: colors.primaryForeground,
                      fontFamily: FontFamily.interSemiBold,
                    },
                  ]}
                >
                  {t("myProfile.save")}
                </Text>
              )}
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: 48, alignItems: "center" },
  scroll: { padding: 16, gap: 14 },
  notice: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 14,
    padding: 14,
    alignItems: "flex-start",
  },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: 20, padding: 16, gap: 8 },
  label: { fontSize: 16 },
  hint: { fontSize: 13, lineHeight: 18 },
  value: { fontSize: 16 },
  fieldLabel: { fontSize: 13, marginTop: 4 },
  inline: { flexDirection: "row", alignItems: "center", gap: 10 },
  input: {
    minHeight: 50,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  textarea: { minHeight: 120, textAlignVertical: "top" },
  counter: { fontSize: 12, textAlign: "right" },
  stepper: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepValue: { fontSize: 17, minWidth: 90, textAlign: "center" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    minHeight: 38,
  },
  chipText: { fontSize: 14 },
  category: { fontSize: 13 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center", marginTop: 4 },
  addBtn: {
    height: 50,
    borderRadius: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { fontSize: 15 },
  saveBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  saveBtn: {
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { fontSize: 16 },
});
