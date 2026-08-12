import React, { useMemo } from "react";
import Svg, { Rect } from "react-native-svg";

// Vendored MIT library (qrcode-generator) — no extra install required.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const createQrCode = require("./vendor/qrcode-generator.js") as (
  typeNumber: number,
  errorCorrectionLevel: "L" | "M" | "Q" | "H",
) => {
  addData: (data: string) => void;
  make: () => void;
  getModuleCount: () => number;
  isDark: (row: number, col: number) => boolean;
};

type Props = {
  value: string;
  size?: number;
  color?: string;
};

export function QrCodeSvg({ value, size = 220, color = "#1A1A2E" }: Props) {
  const cells = useMemo(() => {
    const qr = createQrCode(0, "M");
    qr.addData(value);
    qr.make();

    const count = qr.getModuleCount();
    const cellSize = size / count;
    const rects: React.ReactElement[] = [];

    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) {
          rects.push(
            <Rect
              key={`${row}-${col}`}
              x={col * cellSize}
              y={row * cellSize}
              width={cellSize}
              height={cellSize}
              fill={color}
            />,
          );
        }
      }
    }

    return rects;
  }, [color, size, value]);

  return <Svg width={size} height={size}>{cells}</Svg>;
}
