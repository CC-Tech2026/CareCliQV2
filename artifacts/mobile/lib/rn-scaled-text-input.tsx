import React from "react";
import type { StyleProp, TextStyle } from "react-native";
// RN internal module — Metro resolves the real TextInput when imported from this file. TS now
// resolves a type for this deep path, but it's the raw CJS module shape, not a JSX-usable
// component type, so it needs an explicit cast rather than @ts-expect-error.
import OriginalTextInputRaw from "react-native/Libraries/Components/TextInput/TextInput";

import {
  getRuntimeDyslexiaFont,
  getRuntimeTextScale,
  scaleTextStyle,
  useRuntimeAccessibility,
} from "./text-scale-patch";

type Props = {
  style?: StyleProp<TextStyle>;
  [key: string]: unknown;
};

const OriginalTextInput = OriginalTextInputRaw as unknown as React.ComponentType<Props>;

function ScaledTextInput(props: Props) {
  useRuntimeAccessibility();
  const { style, ...rest } = props;
  return (
    <OriginalTextInput
      {...rest}
      style={scaleTextStyle(style, getRuntimeTextScale(), getRuntimeDyslexiaFont())}
    />
  );
}

// Preserve statics used across the app (e.g. TextInput.State).
for (const key of Object.getOwnPropertyNames(OriginalTextInputRaw)) {
  if (key === "prototype" || key === "length" || key === "name" || key === "caller" || key === "arguments") {
    continue;
  }
  try {
    const desc = Object.getOwnPropertyDescriptor(OriginalTextInputRaw, key);
    if (desc) Object.defineProperty(ScaledTextInput, key, desc);
  } catch {
    /* ignore non-configurable */
  }
}

export default ScaledTextInput;
