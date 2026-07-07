import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
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
import { submitShiftSignature } from "@/lib/worker-api";

type Props = {
  shiftId: string;
  busy?: boolean;
  onSigned: () => void | Promise<void>;
};

type Point = { x: number; y: number };

const CHECKBOXES = [
  { key: "tasks" as const, label: "I confirm all tasks are accurately documented" },
  { key: "safety" as const, label: "I followed all safety protocols" },
  { key: "incidents" as const, label: "I have reported all incidents" },
];

export function ShiftSignatureForm({ shiftId, busy, onSigned }: Props) {
  const colors = useColors();
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
    const encoded = encodeURIComponent(svg);
    return `data:image/svg+xml,${encoded}`;
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
      {CHECKBOXES.map(({ key, label }) => (
        <Pressable
          key={key}
          onPress={() => toggleCheck(key)}
          style={styles.checkRow}
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
            {checks[key] && <Feather name="check" size={14} color="#FFFFFF" />}
          </View>
          <Text style={[styles.checkLabel, { color: colors.foreground, fontFamily: "Inter_500Medium" }]}>
            {label}
          </Text>
        </Pressable>
      ))}

      <Text style={[styles.canvasLabel, { color: colors.mutedForeground, fontFamily: "Inter_600SemiBold" }]}>
        SIGNATURE
      </Text>
      <View
        style={[styles.canvas, { borderColor: colors.border, backgroundColor: colors.background }]}
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
            Sign here
          </Text>
        )}
      </View>

      <Pressable onPress={handleClear} disabled={!hasStroke || isWaiting}>
        <Text style={[styles.clearBtn, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
          Clear signature
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
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={[styles.confirmText, { fontFamily: "Inter_700Bold" }]}>Sign & Submit Shift</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, padding: 16 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
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
  canvasLabel: { fontSize: 11, letterSpacing: 0.8 },
  canvas: {
    height: 160,
    borderRadius: 12,
    borderWidth: 1.5,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  canvasHint: { fontSize: 14, position: "absolute" },
  clearBtn: { fontSize: 13, textAlign: "center" },
  confirmBtn: {
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  confirmText: { color: "#FFFFFF", fontSize: 16 },
});
