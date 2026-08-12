import React from "react";
import type { StyleProp, TextStyle } from "react-native";
// RN internal module — Metro resolves the real Text when imported from this file. TS now
// resolves a type for this deep path, but it's the raw CJS module shape, not a JSX-usable
// component type, so it needs an explicit cast rather than @ts-expect-error.
import OriginalTextRaw from "react-native/Libraries/Text/Text";

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

const OriginalText = OriginalTextRaw as unknown as React.ComponentType<Props>;

function ScaledText(props: Props) {
  useRuntimeAccessibility();
  const { style, ...rest } = props;
  return (
    <OriginalText
      {...rest}
      style={scaleTextStyle(style, getRuntimeTextScale(), getRuntimeDyslexiaFont())}
    />
  );
}

export default ScaledText;
