import React, { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import type { AuthColors } from "@/constants/auth-colors";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
  auth: AuthColors;
};

export function OtpInput({ value, onChange, disabled, error, auth }: Props) {
  const [focused, setFocused] = useState(false);
  const t = useT();
  return (
    <View style={styles.container}>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.row}
      >
        {Array.from({ length: 6 }, (_, index) => (
          <View
            key={index}
            style={[
              styles.box,
              {
                backgroundColor: auth.inputBg,
                borderColor: error
                  ? auth.error
                  : (focused && index === Math.min(value.length, 5)) ||
                      value[index]
                    ? auth.plum
                    : auth.inputBorder,
              },
            ]}
          >
            <Text style={[styles.digit, { color: auth.text }]}>
              {value[index] ?? ""}
            </Text>
          </View>
        ))}
      </View>
      <TextInput
        accessibilityLabel={t("auth.verification.code")}
        value={value}
        onChangeText={(raw) => onChange(raw.replace(/\D/g, "").slice(0, 6))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        autoCorrect={false}
        autoCapitalize="none"
        editable={!disabled}
        caretHidden
        selectionColor="transparent"
        style={[StyleSheet.absoluteFill, styles.input]}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  container: { width: "100%", minHeight: 48 },
  row: { flexDirection: "row", width: "100%", gap: 6 },
  box: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  digit: { fontSize: 20, fontFamily: FontFamily.interSemiBold },
  input: {
    color: "transparent",
    backgroundColor: "transparent",
    fontSize: 20,
    padding: 0,
    borderWidth: 0,
  },
});
