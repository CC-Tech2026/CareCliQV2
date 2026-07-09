import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";

type Point = { x: number; y: number };
type Tab = "draw" | "upload";

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64FromString(input: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i);
    if (c < 0x80) {
      bytes.push(c);
    } else if (c < 0x800) {
      bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0xd800 || c >= 0xe000) {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      i++;
      const c2 = input.charCodeAt(i);
      const cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
      bytes.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64_CHARS[b2 & 63] : "=";
  }
  return out;
}

type Props = {
  saving?: boolean;
  onSave: (dataUrl: string) => void | Promise<void>;
  onClearSaved?: () => void | Promise<void>;
  savedSignature?: string | null;
};

export function SettingsSignaturePad({ saving, onSave, onClearSaved, savedSignature }: Props) {
  const colors = useColors();
  const t = useT();
  const [activeTab, setActiveTab] = useState<Tab>("draw");
  const [paths, setPaths] = useState<string[]>([]);
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const currentPath = useRef<Point[]>([]);
  const canvasSize = useRef({ width: 300, height: 160 });

  const hasDrawing = paths.some(Boolean);
  const canSaveDraw = hasDrawing && !saving;
  const canSaveUpload = Boolean(uploadPreview) && !saving;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !saving,
      onMoveShouldSetPanResponder: () => !saving,
      onPanResponderGrant: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        currentPath.current = [{ x: locationX, y: locationY }];
        setPaths((prev) => [...prev, `M${locationX.toFixed(1)},${locationY.toFixed(1)}`]);
      },
      onPanResponderMove: (evt) => {
        const { locationX, locationY } = evt.nativeEvent;
        currentPath.current.push({ x: locationX, y: locationY });
        const pts = currentPath.current;
        if (pts.length < 2) return;
        const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
        setPaths((prev) => {
          const next = [...prev];
          next[next.length - 1] = d;
          return next;
        });
      },
      onPanResponderRelease: () => {
        currentPath.current = [];
      },
    }),
  ).current;

  const buildPngDataUrl = () => {
    const { width, height } = canvasSize.current;
    const strokePaths = paths.filter(Boolean).join(" ");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="${strokePaths}" stroke="#1e293b" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `data:image/svg+xml;base64,${base64FromString(svg)}`;
  };

  const handleClearCanvas = () => setPaths([]);

  const handlePickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      quality: 0.9,
      base64: true,
    });

    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (asset.base64) {
      const mime = asset.mimeType?.startsWith("image/") ? asset.mimeType : "image/png";
      setUploadPreview(`data:${mime};base64,${asset.base64}`);
      return;
    }
    if (asset.uri) setUploadPreview(asset.uri);
  };

  const displayPaths = paths.filter(Boolean);

  return (
    <View style={styles.wrap}>
      {savedSignature ? (
        <View style={[styles.savedBox, { borderColor: "rgba(22,163,74,0.2)", backgroundColor: "rgba(22,163,74,0.07)" }]}>
          <View style={styles.savedHeader}>
            <View style={styles.savedLabelRow}>
              <Feather name="check" size={14} color="#16A34A" />
              <Text style={[styles.savedLabel, { fontFamily: "Inter_600SemiBold" }]}>{t("settings.signature.saved")}</Text>
            </View>
            {onClearSaved ? (
              <Pressable onPress={() => void onClearSaved()} disabled={saving} style={styles.removeBtn}>
                <Feather name="trash-2" size={13} color={colors.destructive} />
                <Text style={[styles.removeText, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
                  {t("common.remove")}
                </Text>
              </Pressable>
            ) : null}
          </View>
          <View style={[styles.savedPreview, { borderColor: "rgba(22,163,74,0.15)", backgroundColor: colors.card }]}>
            <Image source={{ uri: savedSignature }} style={styles.savedImage} resizeMode="contain" />
          </View>
        </View>
      ) : null}

      <View style={[styles.tabRow, { backgroundColor: colors.soft, borderColor: colors.border }]}>
        {(["draw", "upload"] as const).map((tab) => {
          const active = activeTab === tab;
          return (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[styles.tabBtn, active && { backgroundColor: colors.card }]}
            >
              <Feather
                name={tab === "draw" ? "edit-3" : "upload"}
                size={14}
                color={active ? colors.primary : colors.mutedForeground}
              />
              <Text
                style={[
                  styles.tabLabel,
                  {
                    color: active ? colors.foreground : colors.mutedForeground,
                    fontFamily: active ? "Inter_700Bold" : "Inter_600SemiBold",
                  },
                ]}
              >
                {t(tab === "draw" ? "settings.signature.draw" : "settings.signature.upload")}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeTab === "draw" ? (
        <View style={styles.section}>
          <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("settings.signature.drawHint")}
          </Text>
          <View
            style={[styles.canvas, { borderColor: hasDrawing ? colors.primary : colors.border, backgroundColor: colors.card }]}
            onLayout={(e) => {
              canvasSize.current = {
                width: e.nativeEvent.layout.width,
                height: e.nativeEvent.layout.height,
              };
            }}
            {...panResponder.panHandlers}
          >
            <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
              {displayPaths.map((d, i) => (
                <Path key={i} d={d} stroke="#1e293b" strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </Svg>
          </View>
          <View style={styles.actions}>
            <Pressable
              onPress={handleClearCanvas}
              disabled={!hasDrawing || saving}
              style={[styles.secondaryBtn, { borderColor: colors.border, opacity: hasDrawing ? 1 : 0.5 }]}
            >
              <Feather name="rotate-ccw" size={14} color={colors.foreground} />
              <Text style={[styles.secondaryText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                {t("settings.signature.clear")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void onSave(buildPngDataUrl())}
              disabled={!canSaveDraw}
              style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: canSaveDraw ? 1 : 0.5 }]}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Feather name="check" size={14} color="#FFFFFF" />
                  <Text style={[styles.primaryText, { fontFamily: "Inter_700Bold" }]}>{t("settings.signature.save")}</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("settings.signature.uploadHint")}
          </Text>
          <Pressable
            onPress={() => void handlePickImage()}
            style={[styles.uploadBox, { borderColor: uploadPreview ? colors.primary : colors.border, backgroundColor: colors.card }]}
          >
            {uploadPreview ? (
              <Image source={{ uri: uploadPreview }} style={styles.uploadImage} resizeMode="contain" />
            ) : (
              <>
                <Feather name="image" size={28} color={colors.mutedForeground} />
                <Text style={[styles.uploadLabel, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                  {t("settings.signature.uploadCta")}
                </Text>
              </>
            )}
          </Pressable>
          <View style={styles.actions}>
            {uploadPreview ? (
              <Pressable
                onPress={() => setUploadPreview(null)}
                disabled={saving}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Feather name="rotate-ccw" size={14} color={colors.foreground} />
                <Text style={[styles.secondaryText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
                  {t("settings.signature.reset")}
                </Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable
              onPress={() => uploadPreview && void onSave(uploadPreview)}
              disabled={!canSaveUpload}
              style={[styles.primaryBtn, { backgroundColor: colors.primary, opacity: canSaveUpload ? 1 : 0.5 }]}
            >
              {saving ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Feather name="check" size={14} color="#FFFFFF" />
                  <Text style={[styles.primaryText, { fontFamily: "Inter_700Bold" }]}>{t("settings.signature.save")}</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      )}

      <Text style={[styles.footerHint, { color: colors.mutedForeground, borderTopColor: colors.border, fontFamily: "Inter_400Regular" }]}>
        {t("settings.signature.footer")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14 },
  savedBox: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 12 },
  savedHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  savedLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  savedLabel: { fontSize: 12, color: "#16A34A" },
  removeBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  removeText: { fontSize: 12 },
  savedPreview: {
    borderRadius: 12,
    borderWidth: 1,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },
  savedImage: { width: "100%", height: "100%" },
  tabRow: {
    flexDirection: "row",
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    borderRadius: 10,
  },
  tabLabel: { fontSize: 12 },
  section: { gap: 12 },
  hint: { fontSize: 12, lineHeight: 18 },
  canvas: {
    height: 160,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: "dashed",
    overflow: "hidden",
  },
  uploadBox: {
    minHeight: 140,
    borderRadius: 14,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
  },
  uploadImage: { width: "100%", height: 96 },
  uploadLabel: { fontSize: 13, textAlign: "center" },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  secondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  secondaryText: { fontSize: 13 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginLeft: "auto",
  },
  primaryText: { fontSize: 13, color: "#FFFFFF" },
  footerHint: { fontSize: 11, lineHeight: 17, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
});
