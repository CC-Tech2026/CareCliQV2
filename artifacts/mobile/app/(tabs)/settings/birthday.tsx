import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import { useBirthday } from "@/hooks/worker/useBirthday";
import { updateWorkerProfile } from "@/lib/user-api";

const digits = (v: string, max: number) => v.replace(/\D/g, "").slice(0, max);

/** The worker's own birthday: optional, used only to celebrate with them. */
export default function BirthdaySettingsScreen() {
  const colors = useColors();
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { dob, turnedOff, setTurnedOff } = useBirthday();
  const [day, setDay] = useState("");
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!dob) return;
    const [y, m, d] = dob.slice(0, 10).split("-");
    setDay(String(Number(d)));
    setMonth(String(Number(m)));
    setYear(y);
  }, [dob]);

  const save = async (value: string | null) => {
    setSaving(true);
    setError(null);
    try {
      await updateWorkerProfile({ date_of_birth: value });
      await queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      showToast(
        value ? t("birthday.settings.saved") : t("birthday.settings.removed"),
        "success",
      );
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("birthday.settings.failed"));
    } finally {
      setSaving(false);
    }
  };

  const onSave = () => {
    const d = Number(day);
    const m = Number(month);
    const y = Number(year);
    const date = new Date(y, m - 1, d);
    const valid =
      year.length === 4 &&
      date.getFullYear() === y &&
      date.getMonth() === m - 1 &&
      date.getDate() === d &&
      date < new Date();
    if (!valid) {
      setError(t("birthday.settings.invalid"));
      return;
    }
    void save(
      `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    );
  };

  const field = (
    value: string,
    onChange: (v: string) => void,
    label: string,
    max: number,
    flex: number,
  ) => (
    <View style={[styles.field, { flex }]}>
      <Text
        style={[
          styles.fieldLabel,
          { color: colors.foreground, fontFamily: FontFamily.interSemiBold },
        ]}
      >
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(digits(v, max))}
        keyboardType="number-pad"
        maxLength={max}
        accessibilityLabel={label}
        style={[
          styles.input,
          {
            color: colors.foreground,
            borderColor: colors.border,
            backgroundColor: colors.card,
            fontFamily: FontFamily.interMedium,
          },
        ]}
      />
    </View>
  );

  return (
    <SettingsSubScreen
      showBottomNav={false}
      title={t("birthday.settings.title")}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.intro, { backgroundColor: colors.soft }]}>
          <MaterialCommunityIcons
            name="cake-variant"
            size={26}
            color={colors.pink}
          />
          <Text
            style={[
              styles.introText,
              { color: colors.foreground, fontFamily: FontFamily.interRegular },
            ]}
          >
            {t("birthday.settings.intro")}
          </Text>
        </View>

        <View style={styles.row}>
          {field(day, setDay, t("birthday.settings.day"), 2, 1)}
          {field(month, setMonth, t("birthday.settings.month"), 2, 1)}
          {field(year, setYear, t("birthday.settings.year"), 4, 1.6)}
        </View>
        {error ? (
          <Text
            style={[
              styles.error,
              { color: colors.destructive, fontFamily: FontFamily.interMedium },
            ]}
          >
            {error}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={onSave}
          style={[
            styles.save,
            { backgroundColor: colors.primary, opacity: saving ? 0.6 : 1 },
          ]}
        >
          {saving ? (
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
              {t("birthday.settings.save")}
            </Text>
          )}
        </Pressable>

        <View
          style={[
            styles.switchRow,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={[
                styles.switchTitle,
                {
                  color: colors.foreground,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {t("birthday.settings.celebrate")}
            </Text>
            <Text
              style={[
                styles.switchHint,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
            >
              {t("birthday.settings.celebrateHint")}
            </Text>
          </View>
          <Switch
            value={!turnedOff}
            onValueChange={(on) => void setTurnedOff(!on)}
            accessibilityLabel={t("birthday.settings.celebrate")}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        </View>

        {dob ? (
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => void save(null)}
            style={styles.remove}
          >
            <Text
              style={[
                styles.removeText,
                {
                  color: colors.destructive,
                  fontFamily: FontFamily.interSemiBold,
                },
              ]}
            >
              {t("birthday.settings.remove")}
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 16 },
  intro: {
    flexDirection: "row",
    gap: 12,
    borderRadius: 16,
    padding: 16,
    alignItems: "flex-start",
  },
  introText: { flex: 1, fontSize: 15, lineHeight: 21 },
  row: { flexDirection: "row", gap: 10 },
  field: { gap: 6 },
  fieldLabel: { fontSize: 14 },
  input: {
    height: 54,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontSize: 18,
    textAlign: "center",
  },
  error: { fontSize: 14 },
  save: {
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  saveText: { fontSize: 16 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  switchTitle: { fontSize: 15 },
  switchHint: { fontSize: 13, lineHeight: 18 },
  remove: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 16 },
  removeText: { fontSize: 15 },
});
