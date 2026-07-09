import { Feather } from "@expo/vector-icons";
import { Image, type ImageSource } from "expo-image";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export type AvatarSheetKey = "sheet-a" | "sheet-b" | "sheet-c" | "sheet-d" | "sheet-e";

export type AvatarDef = {
  id: string;
  sheet: AvatarSheetKey;
  col: 0 | 1;
  row: 0 | 1;
};

const SHEET_SOURCES: Record<AvatarSheetKey, ImageSource> = {
  "sheet-a": require("@/assets/avatars/sheet-a.png"),
  "sheet-b": require("@/assets/avatars/sheet-b.png"),
  "sheet-c": require("@/assets/avatars/sheet-c.png"),
  "sheet-d": require("@/assets/avatars/sheet-d.png"),
  "sheet-e": require("@/assets/avatars/sheet-e.png"),
};

export const AVATARS: AvatarDef[] = [
  { id: "a0", sheet: "sheet-a", col: 0, row: 0 },
  { id: "a1", sheet: "sheet-a", col: 1, row: 0 },
  { id: "a2", sheet: "sheet-a", col: 0, row: 1 },
  { id: "a3", sheet: "sheet-a", col: 1, row: 1 },
  { id: "b0", sheet: "sheet-b", col: 0, row: 0 },
  { id: "b1", sheet: "sheet-b", col: 1, row: 0 },
  { id: "b2", sheet: "sheet-b", col: 0, row: 1 },
  { id: "b3", sheet: "sheet-b", col: 1, row: 1 },
  { id: "c0", sheet: "sheet-c", col: 0, row: 0 },
  { id: "c1", sheet: "sheet-c", col: 1, row: 0 },
  { id: "c2", sheet: "sheet-c", col: 0, row: 1 },
  { id: "c3", sheet: "sheet-c", col: 1, row: 1 },
  { id: "d0", sheet: "sheet-d", col: 0, row: 0 },
  { id: "d1", sheet: "sheet-d", col: 1, row: 0 },
  { id: "d2", sheet: "sheet-d", col: 0, row: 1 },
  { id: "d3", sheet: "sheet-d", col: 1, row: 1 },
  { id: "e0", sheet: "sheet-e", col: 0, row: 0 },
];

export function getAvatarDef(avatarId?: string | null): AvatarDef | null {
  if (!avatarId) return null;
  return AVATARS.find((item) => item.id === avatarId) ?? null;
}

type SpriteProps = {
  avatar: AvatarDef;
  size: number;
};

function AvatarSprite({ avatar, size }: SpriteProps) {
  return (
    <View style={[styles.clip, { width: size, height: size, borderRadius: size / 2 }]}>
      <Image
        source={SHEET_SOURCES[avatar.sheet]}
        style={{
          position: "absolute",
          width: size * 2,
          height: size * 2,
          left: avatar.col === 0 ? 0 : -size,
          top: avatar.row === 0 ? 0 : -size,
        }}
        contentFit="fill"
      />
    </View>
  );
}

type DisplayProps = {
  avatarId?: string | null;
  size?: number;
  fallback?: React.ReactNode;
};

export function SettingsAvatarDisplay({ avatarId, size = 52, fallback }: DisplayProps) {
  const avatar = getAvatarDef(avatarId);
  if (!avatar) return <>{fallback ?? null}</>;

  return <AvatarSprite avatar={avatar} size={size} />;
}

type PickerProps = {
  value: string | null;
  onChange: (id: string) => void;
};

export function SettingsAvatarPicker({ value, onChange }: PickerProps) {
  const colors = useColors();

  return (
    <View style={styles.grid}>
      {AVATARS.map((avatar) => {
        const selected = value === avatar.id;
        return (
          <Pressable
            key={avatar.id}
            onPress={() => onChange(avatar.id)}
            style={[
              styles.item,
              {
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.activeBg : colors.card,
              },
            ]}
          >
            <AvatarSprite avatar={avatar} size={44} />
            {selected ? (
              <View style={[styles.check, { backgroundColor: colors.primary }]}>
                <Feather name="check" size={10} color="#FFFFFF" />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

type StatusProps = {
  avatarId: string | null;
  selectedLabel: string;
  noneLabel: string;
  hint: string;
};

export function SettingsAvatarStatus({ avatarId, selectedLabel, noneLabel, hint }: StatusProps) {
  const colors = useColors();

  return (
    <View style={styles.statusRow}>
      <SettingsAvatarDisplay
        avatarId={avatarId}
        size={56}
        fallback={
          <View style={[styles.fallback, { backgroundColor: colors.activeBg, borderColor: colors.border }]}>
            <Feather name="user" size={24} color={colors.mutedForeground} />
          </View>
        }
      />
      <View style={styles.statusCopy}>
        <Text style={[styles.statusTitle, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
          {avatarId ? selectedLabel : noneLabel}
        </Text>
        <Text style={[styles.statusHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {hint}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden", backgroundColor: "#0f172a" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  item: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  check: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 },
  fallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  statusCopy: { flex: 1, gap: 4 },
  statusTitle: { fontSize: 14, lineHeight: 20 },
  statusHint: { fontSize: 12, lineHeight: 18 },
});
