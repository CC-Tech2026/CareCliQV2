import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/lib/haptics";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Path } from "react-native-svg";

import { useColors } from "@/hooks/useColors";
import { useT } from "@/context/PreferencesContext";
import { submitShiftSignature } from "@/lib/worker-api";

type Props = {
  shiftId: string;
  busy?: boolean;
  onSigned: () => void | Promise<void>;
};

type Point = { x: number; y: number };

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

const CHECKBOXES = [
  { key: "tasks" as const, labelKey: "shift.signature.confirmTasks" as const },
  { key: "safety" as const, labelKey: "shift.signature.confirmSafety" as const },
  { key: "incidents" as const, labelKey: "shift.signature.confirmIncidents" as const },
];

export function ShiftSignatureForm({ shiftId, busy, onSigned }: Props) {
  const colors = useColors();
  const t = useT();
  const [checks, setChecks] = useState({ tasks: false, safety: false, incidents: false });
  const [submitting, setSubmitting] = useState(false);
  const [paths, setPaths] = useState<string[]>([]);
  const currentPath = useRef<Point[]>([]);
  const canvasSize = useRef({ width: 300, height: 160 });

  const hasStroke = paths.length > 0;
  const allChecked = checks.tasks && checks.safety && checks.incidents;
  const isWaiting = submitting || Boolean(busy);
  const canSign = allChecked && hasStroke && !isWaiting;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !isWaiting,
      onMoveShouldSetPanResponder: () => !isWaiting,
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

  const handleClear = () => {
    setPaths([]);
    Haptics.selectionAsync();
  };

  const buildSvg = () => {
    const { width, height } = canvasSize.current;
    const strokePaths = paths.filter(Boolean).join(" ");
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><path d="${strokePaths}" stroke="#0D0D55" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };

  const buildPngDataUrl = () => {
    const svg = buildSvg();
    return `data:image/svg+xml;base64,${base64FromString(svg)}`;
  };

  const handleConfirm = async () => {
    if (!canSign) return;
    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      await submitShiftSignature(shiftId, {
        confirm_tasks_accurate: checks.tasks,
        confirm_safety_followed: checks.safety,
        confirm_no_unreported_incidents: checks.incidents,
        signature_svg: buildSvg(),
        signature_png_data_url: buildPngDataUrl(),
      });
      await onSigned();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (/already signed/i.test(message)) {
        await onSigned();
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleCheck = (key: keyof typeof checks) => {
    Haptics.selectionAsync();
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const displayPaths = paths.filter(Boolean);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.desc, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {t("shift.signature.desc")}
      </Text>

      {CHECKBOXES.map(({ key, labelKey }) => (
        <Pressable
          key={key}
          onPress={() => toggleCheck(key)}
          style={[styles.checkRow, { borderColor: colors.border, backgroundColor: colors.card }]}
          disabled={isWaiting}
        >
          <View
            style={[
              styles.checkbox,
              {
                borderColor: checks[key] ? colors.primary : colors.border,
                backgroundColor: checks[key] ? colors.primary : "transparent",
              },
            ]}
          >
            {checks[key] && <Feather name="check" size={14} color={colors.primaryForeground} />}
          </View>
          <Text style={[styles.checkLabel, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
            {t(labelKey)}
          </Text>
        </Pressable>
      ))}

      <Text style={[styles.canvasLabel, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
        {t("shift.signature.yourSignature").toUpperCase()}
      </Text>
      <View
        style={[styles.canvas, { borderColor: colors.blue, backgroundColor: colors.background }]}
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
            <Path key={i} d={d} stroke={colors.navy} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          ))}
        </Svg>
        {!hasStroke && (
          <Text style={[styles.canvasHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("shift.signature.signHere")}
          </Text>
        )}
      </View>

      <Pressable
        onPress={handleClear}
        disabled={!hasStroke || isWaiting}
        style={[
          styles.clearBtn,
          { borderColor: colors.border, opacity: !hasStroke || isWaiting ? 0.5 : 1 },
        ]}
      >
        <Feather name="rotate-ccw" size={13} color={colors.foreground} />
        <Text style={[styles.clearText, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]}>
          {t("shift.signature.clear")}
        </Text>
      </Pressable>

      <Pressable
        onPress={handleConfirm}
        disabled={!canSign}
        style={[
          styles.confirmBtn,
          { backgroundColor: canSign ? colors.primary : colors.muted },
        ]}
      >
        {isWaiting ? (
          <ActivityIndicator color={colors.primaryForeground} />
        ) : (
          <Text
            style={[
              styles.confirmText,
              { color: canSign ? colors.primaryForeground : colors.mutedForeground, fontFamily: "Inter_700Bold" },
            ]}
          >
            {t("shift.signature.confirm")}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, padding: 16 },
  desc: { fontSize: 13, lineHeight: 19 },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkLabel: { flex: 1, fontSize: 14, lineHeight: 20 },
  canvasLabel: { fontSize: 10, letterSpacing: 1, marginTop: 4 },
  canvas: {
    height: 160,
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    borderRadius: 12,
    borderWidth: 1.5,
    borderStyle: "dashed",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  canvasHint: { fontSize: 14, position: "absolute" },
  clearBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    height: 34,
  },
  clearText: { fontSize: 13 },
  confirmBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  confirmText: { fontSize: 16 },
});
