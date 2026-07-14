import React, { useRef } from "react";
import { StyleSheet, TextInput, View } from "react-native";

import type { AuthColors } from "@/constants/auth-colors";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: boolean;
  auth: AuthColors;
};

export function OtpInput({ value, onChange, disabled, error, auth }: Props) {
  const refs = useRef<(TextInput | null)[]>([]);

  const getDigit = (index: number) => value[index] ?? "";

  const focus = (index: number) => {
    refs.current[index]?.focus();
  };

  const handleChange = (index: number, raw: string) => {
    const char = raw.replace(/\D/g, "").slice(-1);
    const arr = Array.from({ length: 6 }, (_, i) => getDigit(i));
    arr[index] = char;
    onChange(arr.join(""));
    if (char) focus(Math.min(index + 1, 5));
  };

  const handleKey = (index: number, key: string) => {
    if (key === "Backspace" && !getDigit(index) && index > 0) {
      const arr = Array.from({ length: 6 }, (_, i) => getDigit(i));
      arr[index - 1] = "";
      onChange(arr.join("").trimEnd());
      focus(index - 1);
    }
  };

  return (
    <View style={styles.row}>
      {Array.from({ length: 6 }, (_, i) => {
        const filled = Boolean(getDigit(i));
        return (
          <TextInput
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            value={getDigit(i)}
            onChangeText={(text) => handleChange(i, text)}
            onKeyPress={({ nativeEvent }) => handleKey(i, nativeEvent.key)}
            keyboardType="number-pad"
            maxLength={1}
            editable={!disabled}
            selectTextOnFocus
            style={[
              styles.box,
              {
                backgroundColor: auth.inputBg,
                borderColor: error ? auth.coral : filled ? auth.plum : auth.inputBorder,
                color: auth.text,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    width: "100%",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 6,
  },
  box: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    height: 48,
    maxWidth: 52,
    borderWidth: 1.5,
    borderRadius: 12,
    textAlign: "center",
    fontSize: 20,
    fontFamily: "Inter_700Bold",
    paddingHorizontal: 0,
  },
});
