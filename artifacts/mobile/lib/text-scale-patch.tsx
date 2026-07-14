import React from "react";
import {
  Platform,
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type StyleProp,
  type TextStyle,
} from "react-native";

/**
 * App text scale + optional dyslexia-friendly font.
 * Does not reassign react-native.Text / TextInput (getter-only in RN 0.81).
 * Patches forwardRef.render on the shared Text/TextInput component objects.
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

function useRuntimeAccessibility() {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const onChange = () => setTick((n) => n + 1);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  return tick;
}

function scaleStyle(style: StyleProp<TextStyle>, s: number, useDyslexia: boolean): StyleProp<TextStyle> {
  if (s === 1 && !useDyslexia) return style;
  const flat = StyleSheet.flatten(style);
  const next: TextStyle = {};
  if (s !== 1 && flat && typeof flat.fontSize === "number") {
    next.fontSize = Math.round(flat.fontSize * s * 10) / 10;
    if (typeof flat.lineHeight === "number") {
      next.lineHeight = Math.round(flat.lineHeight * s * 10) / 10;
    }
  }
  if (useDyslexia) {
    next.fontFamily = DYSLEXIA_FONT;
    next.letterSpacing = 0.4;
  }
  if (Object.keys(next).length === 0) return style;
  return [style, next];
}

type PossiblyForwardRef = {
  render?: (props: { style?: StyleProp<TextStyle> }, ref: unknown) => unknown;
  __ccqTextScalePatched?: boolean;
};

function patchForwardRefRender(Component: PossiblyForwardRef) {
  if (!Component || typeof Component.render !== "function" || Component.__ccqTextScalePatched) {
    return;
  }
  const originalRender = Component.render;
  Component.render = function patchedRender(
    props: { style?: StyleProp<TextStyle> },
    ref: unknown,
  ) {
    return originalRender.call(
      this,
      { ...props, style: scaleStyle(props?.style, getRuntimeTextScale(), getRuntimeDyslexiaFont()) },
      ref,
    );
  };
  Component.__ccqTextScalePatched = true;
}

try {
  patchForwardRefRender(RNText as PossiblyForwardRef);
  patchForwardRefRender(RNTextInput as PossiblyForwardRef);
} catch {
  /* ignore — preference still persists */
}

/** Keeps a subscriber mounted so preference changes can notify listeners. */
export function TextScaleSubscriber() {
  useRuntimeAccessibility();
  return null;
}
