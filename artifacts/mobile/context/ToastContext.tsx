import { Feather } from "@expo/vector-icons";
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

export type ToastVariant = "success" | "error";

type ToastState = {
  message: string;
  variant: ToastVariant;
};

type ToastContextValue = {
  showToast: (message: string, variant?: ToastVariant) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const TOAST_DURATION_MS = 2500;

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 16, duration: 180, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) setToast(null);
    });
  }, [opacity, translateY]);

  const showToast = useCallback(
    (message: string, variant: ToastVariant = "success") => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setToast({ message, variant });
      opacity.setValue(0);
      translateY.setValue(16);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(translateY, { toValue: 0, duration: 200, useNativeDriver: true }),
      ]).start();
      hideTimer.current = setTimeout(() => hideToast(), TOAST_DURATION_MS);
    },
    [hideToast, opacity, translateY],
  );

  useEffect(
    () => () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast ? <ToastBanner toast={toast} opacity={opacity} translateY={translateY} onDismiss={hideToast} /> : null}
    </ToastContext.Provider>
  );
}

function ToastBanner({
  toast,
  opacity,
  translateY,
  onDismiss,
}: {
  toast: ToastState;
  opacity: Animated.Value;
  translateY: Animated.Value;
  onDismiss: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isError = toast.variant === "error";
  const accent = isError ? colors.destructive : colors.primary;
  const background = isError ? colors.dangerBg : colors.card;
  const border = isError ? colors.dangerBorder : colors.border;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.host,
        {
          bottom: Math.max(insets.bottom, 12) + 72,
          opacity,
          transform: [{ translateY }],
        },
      ]}
    >
      <Pressable
        onPress={onDismiss}
        style={[styles.toast, { backgroundColor: background, borderColor: border }]}
      >
        <View style={[styles.iconWrap, { backgroundColor: isError ? "rgba(239,68,68,0.12)" : colors.activeBg }]}>
          <Feather name={isError ? "alert-circle" : "check-circle"} size={16} color={accent} />
        </View>
        <Text style={[styles.message, { color: colors.foreground, fontFamily: "Inter_600SemiBold" }]} numberOfLines={3}>
          {toast.message}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 9999,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: "#0D0D55",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  message: { flex: 1, fontSize: 14, lineHeight: 19 },
});
