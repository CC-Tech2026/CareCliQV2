import React from "react";
import { Platform, type StyleProp, type TextStyle } from "react-native";

/**
 * App text scale + optional dyslexia-friendly font.
 * Applied by Metro-wrapped Text / TextInput (metro.config.js).
 * RN 0.81 Text is a plain function component — forwardRef.render patching no longer works.
 */
let scale = 1;
let dyslexia = false;
const listeners = new Set<() => void>();

const DYSLEXIA_FONT = Platform.select({
  ios: "Chalkboard SE",
  android: "sans-serif",
  default: "Comic Sans MS",
});

export function setRuntimeTextScale(next: number) {
  if (Math.abs(scale - next) < 0.001) return;
  scale = next;
  listeners.forEach((fn) => fn());
}

export function setRuntimeDyslexiaFont(enabled: boolean) {
  if (dyslexia === enabled) return;
  dyslexia = enabled;
  listeners.forEach((fn) => fn());
}

export function getRuntimeTextScale() {
  return scale;
}

export function getRuntimeDyslexiaFont() {
  return dyslexia;
}

/** Subscribe so Text / TextInput re-render when preferences change. */
export function useRuntimeAccessibility() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);
}

function flattenTextStyle(style: StyleProp<TextStyle> | undefined): TextStyle | undefined {
  if (style == null || typeof style === "boolean") return undefined;
  if (Array.isArray(style)) {
    const out: TextStyle = {};
    for (const item of style) {
      const flat = flattenTextStyle(item as StyleProp<TextStyle>);
      if (flat) Object.assign(out, flat);
    }
    return out;
  }
  return style as TextStyle;
}

export function scaleTextStyle(
  style: StyleProp<TextStyle> | undefined,
  s: number,
  useDyslexia: boolean,
): StyleProp<TextStyle> {
  if (s === 1 && !useDyslexia) return style;

  const flat = flattenTextStyle(style);
  const next: TextStyle = {};

  if (s !== 1) {
    const baseSize = typeof flat?.fontSize === "number" ? flat.fontSize : 14;
    next.fontSize = Math.round(baseSize * s * 10) / 10;
    if (typeof flat?.lineHeight === "number") {
      next.lineHeight = Math.round(flat.lineHeight * s * 10) / 10;
    }
  }

  if (useDyslexia) {
    next.fontFamily = DYSLEXIA_FONT;
    next.letterSpacing = 0.4;
  }

  if (Object.keys(next).length === 0) return style;
  return style != null ? [style, next] : next;
}

/** Kept for PreferencesProvider — each ScaledText also subscribes. */
export function TextScaleSubscriber() {
  useRuntimeAccessibility();
  return null;
}
