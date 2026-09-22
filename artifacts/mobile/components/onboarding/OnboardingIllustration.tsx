import React from "react";
import Svg, { Image as SvgImage } from "react-native-svg";

// Viewports use the original 1024px artwork coordinates. Display clipping keeps
// the supplied pixels intact and excludes the checkerboard, frame and duplicate scene.
const SCENES = ["70 70 432 432", "522 70 432 432", "522 520 432 432"] as const;
const artwork = require("@/assets/images/onboarding-artwork.png");

export function OnboardingIllustration({ step }: { step: number }) {
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox={SCENES[step] ?? SCENES[0]}
      preserveAspectRatio="xMidYMid meet"
      accessible={false}
      style={{ overflow: "hidden" }}
    >
      <SvgImage href={artwork} x={0} y={0} width={1024} height={1024} />
    </Svg>
  );
}
