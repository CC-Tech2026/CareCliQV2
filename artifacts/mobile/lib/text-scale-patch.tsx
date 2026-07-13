import React from "react";
import {
  StyleSheet,
  Text as RNText,
  TextInput as RNTextInput,
  type StyleProp,
  type TextStyle,
} from "react-native";

/**
 * App text scale (small / default / large).
 * Does not reassign react-native.Text / TextInput (getter-only in RN 0.81).
 * Patches forwardRef.render on the shared Text/TextInput component objects.
 */
let scale = 1;
const listeners = new Set<() => void>();

export function setRuntimeTextScale(next: number) {
  if (Math.abs(scale - next) < 0.001) return;
  scale = next;
  listeners.forEach((fn) => fn());
}

export function getRuntimeTextScale() {
  return scale;
}

function useRuntimeScale() {
  const [value, setValue] = React.useState(scale);
  React.useEffect(() => {
    const onChange = () => setValue(scale);
    listeners.add(onChange);
    return () => {
      listeners.delete(onChange);
    };
  }, []);
  return value;
}

function scaleStyle(style: StyleProp<TextStyle>, s: number): StyleProp<TextStyle> {
  if (s === 1) return style;
  const flat = StyleSheet.flatten(style);
  if (!flat || typeof flat.fontSize !== "number") return style;
  return [
    style,
    {
      fontSize: Math.round(flat.fontSize * s * 10) / 10,
      ...(typeof flat.lineHeight === "number"
        ? { lineHeight: Math.round(flat.lineHeight * s * 10) / 10 }
        : null),
    },
  ];
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
    const s = getRuntimeTextScale();
    return originalRender.call(this, { ...props, style: scaleStyle(props?.style, s) }, ref);
  };
  Component.__ccqTextScalePatched = true;
}

try {
  patchForwardRefRender(RNText as PossiblyForwardRef);
  patchForwardRefRender(RNTextInput as PossiblyForwardRef);
} catch {
  /* ignore — preference still persists */
}

/** Keeps subscribers in sync when scale changes from PreferencesProvider. */
export function TextScaleSubscriber() {
  useRuntimeScale();
  return null;
}
