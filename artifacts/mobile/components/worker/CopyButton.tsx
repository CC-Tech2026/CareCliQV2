import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useToast } from "@/context/ToastContext";
import { useColors } from "@/hooks/useColors";
import * as Haptics from "@/lib/haptics";
import { copyText } from "@/lib/copy-text";

/** A small "Copy" button that copies `value` and says so for a moment. */
export function CopyButton({
  value,
  label,
}: {
  value: string;
  label?: string;
}) {
  const colors = useColors();
  const t = useT();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const onPress = async () => {
    try {
      await copyText(value);
      void Haptics.selectionAsync();
      setCopied(true);
      showToast(t("copy.copied"), "success");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      showToast(t("copy.failed"), "error");
    }
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        label ? t("copy.copyNamed", { name: label }) : t("copy.copy")
      }
      hitSlop={8}
      onPress={() => void onPress()}
      style={({ pressed }) => [
        styles.btn,
        { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Feather
        name={copied ? "check" : "copy"}
        size={14}
        color={copied ? colors.success : colors.primary}
      />
      <Text
        style={[
          styles.text,
          {
            color: copied ? colors.success : colors.primary,
            fontFamily: FontFamily.interSemiBold,
          },
        ]}
      >
        {copied ? t("copy.done") : t("copy.copy")}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    minHeight: 34,
  },
  text: { fontSize: 13 },
});
