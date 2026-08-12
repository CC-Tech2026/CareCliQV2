import React from "react";
import type { StyleProp, TextStyle } from "react-native";
// @ts-expect-error RN internal module — Metro resolves the real TextInput when imported from this file
import OriginalTextInput from "react-native/Libraries/Components/TextInput/TextInput";

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
for (const key of Object.getOwnPropertyNames(OriginalTextInput)) {
  if (key === "prototype" || key === "length" || key === "name" || key === "caller" || key === "arguments") {
    continue;
  }
  try {
    const desc = Object.getOwnPropertyDescriptor(OriginalTextInput, key);
    if (desc) Object.defineProperty(ScaledTextInput, key, desc);
  } catch {
    /* ignore non-configurable */
  }
}

export default ScaledTextInput;
