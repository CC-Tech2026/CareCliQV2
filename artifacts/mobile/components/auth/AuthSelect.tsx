import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import type { AuthColors } from "@/constants/auth-colors";

type Option = { value: string; label: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  auth: AuthColors;
};

export function AuthSelect({ value, onChange, options, placeholder, disabled, auth }: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <Pressable
        onPress={() => !disabled && setOpen(true)}
        style={[
          styles.trigger,
          {
            backgroundColor: auth.inputBg,
            borderColor: auth.inputBorder,
            opacity: disabled ? 0.6 : 1,
          },
        ]}
      >
        <Text
          style={[
            styles.triggerText,
            {
              color: selected ? auth.text : auth.muted,
              fontFamily: "Inter_500Medium",
            },
          ]}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder ?? "Select…"}
        </Text>
        <Feather name="chevron-down" size={16} color={auth.muted} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <View style={[styles.sheet, { backgroundColor: auth.formBg, borderColor: auth.cardBorder }]}>
            <ScrollView>
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={[styles.option, value === option.value && { backgroundColor: auth.inputBg }]}
                >
                  <Text style={[styles.optionText, { color: auth.text, fontFamily: "Inter_500Medium" }]}>
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    height: 44,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  triggerText: { flex: 1, fontSize: 14 },
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
    padding: 16,
  },
  sheet: {
    borderWidth: 1,
    borderRadius: 16,
    maxHeight: "60%",
    overflow: "hidden",
  },
  option: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  optionText: { fontSize: 14 },
});
