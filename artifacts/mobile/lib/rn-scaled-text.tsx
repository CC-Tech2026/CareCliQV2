import React from "react";
import type { StyleProp, TextStyle } from "react-native";
// @ts-expect-error RN internal module — Metro resolves the real Text when imported from this file
import OriginalText from "react-native/Libraries/Text/Text";

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
