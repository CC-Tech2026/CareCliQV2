import { useState } from "react";
import { cn } from "@/lib/utils";

export type BodyView = "front" | "back";
export type MarkerColor = "red" | "yellow" | "blue" | "green";
export type BodyType = "male" | "female" | "unspecified";

export interface BodyMarker {
  zone: string;
  color: MarkerColor;
  note: string;
}

export const MARKER_COLORS: Record<MarkerColor, { hex: string; label: string; bg: string; text: string; border: string }> = {
  red:    { hex: "#ef4444", label: "Pain",        bg: "bg-red-100",    text: "text-red-700",    border: "border-red-300" },
  yellow: { hex: "#f59e0b", label: "Discomfort",  bg: "bg-amber-100",  text: "text-amber-700",  border: "border-amber-300" },
  blue:   { hex: "#3b82f6", label: "Treatment",   bg: "bg-blue-100",   text: "text-blue-700",   border: "border-blue-300" },
  green:  { hex: "#10b981", label: "Resolved",    bg: "bg-emerald-100",text: "text-emerald-700",border: "border-emerald-300" },
};

type ShapeEllipse = { type: "e"; cx: number; cy: number; rx: number; ry: number };
type ShapeRect    = { type: "r"; x: number; y: number; w: number; h: number; rx?: number };
export type ZoneShape = ShapeEllipse | ShapeRect;

interface ZoneDef {
  id: string;
  label: string;
  shape: ZoneShape;
  centroid: [number, number];
  femaleOnly?: boolean;
}

const FRONT_ZONES: ZoneDef[] = [
  { id: "head",              label: "Head / Face",           shape: { type: "e", cx: 100, cy: 31,  rx: 24, ry: 27 }, centroid: [100, 31] },
  { id: "neck",              label: "Neck",                  shape: { type: "r", x: 89,  y: 57,  w: 22, h: 24, rx: 6 }, centroid: [100, 69] },
  { id: "left_shoulder",     label: "Left Shoulder",         shape: { type: "e", cx: 22,  cy: 106, rx: 21, ry: 14 }, centroid: [22, 106] },
  { id: "right_shoulder",    label: "Right Shoulder",        shape: { type: "e", cx: 178, cy: 106, rx: 21, ry: 14 }, centroid: [178, 106] },
  { id: "left_chest",        label: "Left Chest",            shape: { type: "e", cx: 76,  cy: 118, rx: 24, ry: 22 }, centroid: [76, 118] },
  { id: "right_chest",       label: "Right Chest",           shape: { type: "e", cx: 124, cy: 118, rx: 24, ry: 22 }, centroid: [124, 118] },
  { id: "left_breast",       label: "Left Breast",           shape: { type: "e", cx: 80,  cy: 118, rx: 20, ry: 22 }, centroid: [80, 118], femaleOnly: true },
  { id: "right_breast",      label: "Right Breast",          shape: { type: "e", cx: 120, cy: 118, rx: 20, ry: 22 }, centroid: [120, 118], femaleOnly: true },
  { id: "abdomen",           label: "Abdomen",               shape: { type: "r", x: 52,  y: 140, w: 96, h: 44, rx: 5 }, centroid: [100, 162] },
  { id: "left_hip",          label: "Left Hip",              shape: { type: "r", x: 50,  y: 184, w: 40, h: 32, rx: 5 }, centroid: [70, 200] },
  { id: "right_hip",         label: "Right Hip",             shape: { type: "r", x: 110, y: 184, w: 40, h: 32, rx: 5 }, centroid: [130, 200] },
  { id: "left_groin",        label: "Left Groin",            shape: { type: "e", cx: 76,  cy: 220, rx: 18, ry: 10 }, centroid: [76, 220] },
  { id: "right_groin",       label: "Right Groin",           shape: { type: "e", cx: 124, cy: 220, rx: 18, ry: 10 }, centroid: [124, 220] },
  { id: "left_upper_arm",    label: "Left Upper Arm",        shape: { type: "r", x: 10,  y: 106, w: 30, h: 62, rx: 10 }, centroid: [25, 137] },
  { id: "right_upper_arm",   label: "Right Upper Arm",       shape: { type: "r", x: 160, y: 106, w: 30, h: 62, rx: 10 }, centroid: [175, 137] },
  { id: "left_elbow",        label: "Left Elbow",            shape: { type: "e", cx: 25,  cy: 172, rx: 17, ry: 10 }, centroid: [25, 172] },
  { id: "right_elbow",       label: "Right Elbow",           shape: { type: "e", cx: 175, cy: 172, rx: 17, ry: 10 }, centroid: [175, 172] },
  { id: "left_forearm",      label: "Left Forearm",          shape: { type: "r", x: 10,  y: 172, w: 30, h: 60, rx: 10 }, centroid: [25, 202] },
  { id: "right_forearm",     label: "Right Forearm",         shape: { type: "r", x: 160, y: 172, w: 30, h: 60, rx: 10 }, centroid: [175, 202] },
  { id: "left_wrist",        label: "Left Wrist",            shape: { type: "e", cx: 25,  cy: 236, rx: 16, ry: 8  }, centroid: [25, 236] },
  { id: "right_wrist",       label: "Right Wrist",           shape: { type: "e", cx: 175, cy: 236, rx: 16, ry: 8  }, centroid: [175, 236] },
  { id: "left_hand",         label: "Left Hand",             shape: { type: "r", x: 10,  y: 236, w: 30, h: 46, rx: 10 }, centroid: [25, 259] },
  { id: "right_hand",        label: "Right Hand",            shape: { type: "r", x: 160, y: 236, w: 30, h: 46, rx: 10 }, centroid: [175, 259] },
  { id: "left_thigh",        label: "Left Thigh",            shape: { type: "r", x: 62,  y: 218, w: 30, h: 76, rx: 8  }, centroid: [77, 256] },
  { id: "right_thigh",       label: "Right Thigh",           shape: { type: "r", x: 108, y: 218, w: 30, h: 76, rx: 8  }, centroid: [123, 256] },
  { id: "left_knee",         label: "Left Knee",             shape: { type: "e", cx: 77,  cy: 298, rx: 20, ry: 12 }, centroid: [77, 298] },
  { id: "right_knee",        label: "Right Knee",            shape: { type: "e", cx: 123, cy: 298, rx: 20, ry: 12 }, centroid: [123, 298] },
  { id: "left_shin",         label: "Left Shin",             shape: { type: "r", x: 62,  y: 306, w: 30, h: 68, rx: 8  }, centroid: [77, 340] },
  { id: "right_shin",        label: "Right Shin",            shape: { type: "r", x: 108, y: 306, w: 30, h: 68, rx: 8  }, centroid: [123, 340] },
  { id: "left_ankle",        label: "Left Ankle",            shape: { type: "e", cx: 77,  cy: 378, rx: 18, ry: 10 }, centroid: [77, 378] },
  { id: "right_ankle",       label: "Right Ankle",           shape: { type: "e", cx: 123, cy: 378, rx: 18, ry: 10 }, centroid: [123, 378] },
  { id: "left_foot",         label: "Left Foot",             shape: { type: "e", cx: 72,  cy: 406, rx: 26, ry: 14 }, centroid: [72, 406] },
  { id: "right_foot",        label: "Right Foot",            shape: { type: "e", cx: 128, cy: 406, rx: 26, ry: 14 }, centroid: [128, 406] },
];

const BACK_ZONES: ZoneDef[] = [
  { id: "head_back",            label: "Head (Posterior)",      shape: { type: "e", cx: 100, cy: 31,  rx: 24, ry: 27 }, centroid: [100, 31] },
  { id: "neck_back",            label: "Neck (Posterior)",      shape: { type: "r", x: 89,  y: 57,  w: 22, h: 24, rx: 6 }, centroid: [100, 69] },
  { id: "left_shoulder_back",   label: "Left Shoulder",         shape: { type: "e", cx: 22,  cy: 106, rx: 21, ry: 14 }, centroid: [22, 106] },
  { id: "right_shoulder_back",  label: "Right Shoulder",        shape: { type: "e", cx: 178, cy: 106, rx: 21, ry: 14 }, centroid: [178, 106] },
  { id: "left_scapula",         label: "Left Scapula",          shape: { type: "r", x: 58,  y: 84,  w: 34, h: 46, rx: 6  }, centroid: [75, 107] },
  { id: "right_scapula",        label: "Right Scapula",         shape: { type: "r", x: 108, y: 84,  w: 34, h: 46, rx: 6  }, centroid: [125, 107] },
  { id: "upper_back",           label: "Upper Back",            shape: { type: "r", x: 60,  y: 82,  w: 80, h: 56, rx: 5  }, centroid: [100, 110] },
  { id: "mid_back",             label: "Mid Back",              shape: { type: "r", x: 62,  y: 136, w: 76, h: 38, rx: 5  }, centroid: [100, 155] },
  { id: "lower_back",           label: "Lower Back",            shape: { type: "r", x: 64,  y: 172, w: 72, h: 24, rx: 5  }, centroid: [100, 184] },
  { id: "sacrum",               label: "Sacrum / Coccyx",       shape: { type: "r", x: 78,  y: 193, w: 44, h: 26, rx: 5  }, centroid: [100, 206] },
  { id: "left_gluteal",         label: "Left Gluteal",          shape: { type: "r", x: 52,  y: 196, w: 44, h: 46, rx: 8  }, centroid: [74, 219] },
  { id: "right_gluteal",        label: "Right Gluteal",         shape: { type: "r", x: 104, y: 196, w: 44, h: 46, rx: 8  }, centroid: [126, 219] },
  { id: "left_upper_arm_back",  label: "Left Upper Arm",        shape: { type: "r", x: 10,  y: 106, w: 30, h: 62, rx: 10 }, centroid: [25, 137] },
  { id: "right_upper_arm_back", label: "Right Upper Arm",       shape: { type: "r", x: 160, y: 106, w: 30, h: 62, rx: 10 }, centroid: [175, 137] },
  { id: "left_elbow_back",      label: "Left Elbow",            shape: { type: "e", cx: 25,  cy: 172, rx: 17, ry: 10 }, centroid: [25, 172] },
  { id: "right_elbow_back",     label: "Right Elbow",           shape: { type: "e", cx: 175, cy: 172, rx: 17, ry: 10 }, centroid: [175, 172] },
  { id: "left_forearm_back",    label: "Left Forearm",          shape: { type: "r", x: 10,  y: 172, w: 30, h: 60, rx: 10 }, centroid: [25, 202] },
  { id: "right_forearm_back",   label: "Right Forearm",         shape: { type: "r", x: 160, y: 172, w: 30, h: 60, rx: 10 }, centroid: [175, 202] },
  { id: "left_hand_back",       label: "Left Hand",             shape: { type: "r", x: 10,  y: 236, w: 30, h: 46, rx: 10 }, centroid: [25, 259] },
  { id: "right_hand_back",      label: "Right Hand",            shape: { type: "r", x: 160, y: 236, w: 30, h: 46, rx: 10 }, centroid: [175, 259] },
  { id: "left_hamstring",       label: "Left Hamstring",        shape: { type: "r", x: 63,  y: 244, w: 29, h: 76, rx: 8  }, centroid: [77, 282] },
  { id: "right_hamstring",      label: "Right Hamstring",       shape: { type: "r", x: 108, y: 244, w: 29, h: 76, rx: 8  }, centroid: [123, 282] },
  { id: "left_popliteal",       label: "Left Knee (Back)",      shape: { type: "e", cx: 77,  cy: 323, rx: 19, ry: 11 }, centroid: [77, 323] },
  { id: "right_popliteal",      label: "Right Knee (Back)",     shape: { type: "e", cx: 123, cy: 323, rx: 19, ry: 11 }, centroid: [123, 323] },
  { id: "left_calf",            label: "Left Calf",             shape: { type: "r", x: 63,  y: 330, w: 29, h: 62, rx: 8  }, centroid: [77, 361] },
  { id: "right_calf",           label: "Right Calf",            shape: { type: "r", x: 108, y: 330, w: 29, h: 62, rx: 8  }, centroid: [123, 361] },
  { id: "left_achilles",        label: "Left Achilles",         shape: { type: "e", cx: 76,  cy: 394, rx: 15, ry: 8  }, centroid: [76, 394] },
  { id: "right_achilles",       label: "Right Achilles",        shape: { type: "e", cx: 124, cy: 394, rx: 15, ry: 8  }, centroid: [124, 394] },
  { id: "left_heel",            label: "Left Heel",             shape: { type: "e", cx: 71,  cy: 416, rx: 20, ry: 12 }, centroid: [71, 416] },
  { id: "right_heel",           label: "Right Heel",            shape: { type: "e", cx: 129, cy: 416, rx: 20, ry: 12 }, centroid: [129, 416] },
];

export const ALL_ZONES: ZoneDef[] = [...FRONT_ZONES, ...BACK_ZONES];

export function getZoneLabel(zoneId: string, translate?: (key: string) => string): string {
  if (translate) {
    const key = `clinical.bodyMap.zone.${zoneId}`;
    const translated = translate(key);
    if (translated !== key) return translated;
  }
  return ALL_ZONES.find((z) => z.id === zoneId)?.label ?? zoneId.replace(/_/g, " ");
}

export function getMarkerColorLabel(color: MarkerColor, translate?: (key: string) => string): string {
  const key = `clinical.bodyMap.marker.${color === "yellow" ? "discomfort" : color === "green" ? "resolved" : color}`;
  if (translate) {
    const translated = translate(key);
    if (translated !== key) return translated;
  }
  return MARKER_COLORS[color].label;
}

export const ZONE_CENTROIDS: Record<string, [number, number]> = Object.fromEntries(
  ALL_ZONES.map((z) => [z.id, z.centroid]),
);

function getViewZones(view: BodyView, bodyType: BodyType): ZoneDef[] {
  const base = view === "front" ? FRONT_ZONES : BACK_ZONES;
  if (bodyType !== "female") return base.filter((z) => !z.femaleOnly);
  return base;
}

function ZoneShapeEl({
  shape,
  ...svgProps
}: { shape: ZoneShape } & React.SVGAttributes<SVGElement>) {
  if (shape.type === "e") {
    return (
      <ellipse
        cx={shape.cx} cy={shape.cy} rx={shape.rx} ry={shape.ry}
        {...(svgProps as React.SVGAttributes<SVGEllipseElement>)}
      />
    );
  }
  return (
    <rect
      x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx ?? 4}
      {...(svgProps as React.SVGAttributes<SVGRectElement>)}
    />
  );
}

const SKIN = "#f5dfc8";
const SKIN_STROKE = "#c4906a";
const SW = "1.3";

function MaleFrontSilhouette() {
  return (
    <g fill={SKIN} stroke={SKIN_STROKE} strokeWidth={SW} strokeLinejoin="round">
      <ellipse cx="100" cy="31" rx="24" ry="27" />
      <ellipse cx="75"  cy="34" rx="4"  ry="7"  />
      <ellipse cx="125" cy="34" rx="4"  ry="7"  />
      <path d="M 90 56 C 88 62 88 71 88 80 L 112 80 C 112 71 112 62 110 56 Z" />
      <ellipse cx="22"  cy="106" rx="21" ry="14" />
      <ellipse cx="178" cy="106" rx="21" ry="14" />
      <path d="M 44 82 L 156 82
        C 158 100 160 122 158 144 C 157 158 154 170 150 182
        C 146 192 140 202 132 210 C 122 216 112 220 100 221
        C 88 220 78 216 68 210 C 60 202 54 192 50 182
        C 46 170 43 158 42 144 C 40 122 42 100 44 82 Z" />
      <path d="M 44 82 C 40 90 30 96 22 96 C 14 100 10 110 10 120
        C 10 134 11 148 12 164 L 40 164
        C 42 148 44 132 44 120 C 44 106 44 92 44 82 Z" />
      <path d="M 156 82 C 160 90 170 96 178 96 C 186 100 190 110 190 120
        C 190 134 189 148 188 164 L 160 164
        C 158 148 156 132 156 120 C 156 106 156 92 156 82 Z" />
      <ellipse cx="26"  cy="166" rx="17" ry="9" />
      <ellipse cx="174" cy="166" rx="17" ry="9" />
      <path d="M 12 164 C 11 178 10 196 11 212 C 11 220 12 228 15 234 L 39 234
        C 41 228 42 220 42 212 C 43 196 42 178 41 164 Z" />
      <path d="M 188 164 C 189 178 190 196 189 212 C 189 220 188 228 185 234 L 161 234
        C 159 228 158 220 158 212 C 157 196 158 178 159 164 Z" />
      <ellipse cx="26"  cy="236" rx="15" ry="7" />
      <ellipse cx="174" cy="236" rx="15" ry="7" />
      <path d="M 12 234 C 11 244 10 256 12 266 C 14 274 19 280 26 282
        C 33 280 39 274 40 266 C 42 256 41 244 40 234 Z" />
      <path d="M 188 234 C 189 244 190 256 188 266 C 186 274 181 280 174 282
        C 167 280 161 274 160 266 C 158 256 159 244 160 234 Z" />
      <path d="M 66 218 C 64 230 62 254 62 274 C 62 284 63 292 65 298 L 92 298
        C 94 292 95 284 95 274 C 95 254 93 230 92 218 Z" />
      <path d="M 134 218 C 136 230 138 254 138 274 C 138 284 137 292 135 298 L 108 298
        C 106 292 105 284 105 274 C 105 254 107 230 108 218 Z" />
      <ellipse cx="78"  cy="300" rx="20" ry="10" />
      <ellipse cx="122" cy="300" rx="20" ry="10" />
      <path d="M 61 298 C 59 314 58 336 58 358 C 58 366 59 373 62 378 L 93 378
        C 96 373 97 366 97 358 C 97 336 96 314 94 298 Z" />
      <path d="M 139 298 C 141 314 142 336 142 358 C 142 366 141 373 138 378 L 107 378
        C 104 373 103 366 103 358 C 103 336 104 314 106 298 Z" />
      <ellipse cx="78"  cy="380" rx="18" ry="8" />
      <ellipse cx="122" cy="380" rx="18" ry="8" />
      <path d="M 61 380 C 55 388 50 396 48 406 C 46 412 48 418 54 420 L 98 420
        C 102 418 104 412 102 406 C 100 396 95 388 94 380 Z" />
      <path d="M 139 380 C 145 388 150 396 152 406 C 154 412 152 418 146 420 L 102 420
        C 98 418 96 412 98 406 C 100 396 105 388 106 380 Z" />
    </g>
  );
}

function FemaleFrontSilhouette() {
  return (
    <g fill={SKIN} stroke={SKIN_STROKE} strokeWidth={SW} strokeLinejoin="round">
      <ellipse cx="100" cy="30" rx="23" ry="25" />
      <ellipse cx="76"  cy="33" rx="3.5" ry="6" />
      <ellipse cx="124" cy="33" rx="3.5" ry="6" />
      <path d="M 91 54 C 90 60 90 70 90 80 L 110 80 C 110 70 110 60 109 54 Z" />
      <ellipse cx="32"  cy="103" rx="18" ry="12" />
      <ellipse cx="168" cy="103" rx="18" ry="12" />
      <path d="M 50 82 L 150 82
        C 152 96 154 112 150 130
        C 148 140 144 148 138 156
        C 132 164 124 170 116 174
        C 108 178 104 182 100 183
        C 96 182 92 178 84 174
        C 76 170 68 164 62 156
        C 56 148 52 140 50 130
        C 46 112 48 96 50 82 Z" />
      <path d="M 66 100 C 60 108 58 120 62 130 C 66 140 74 148 84 150
        C 94 148 100 142 100 132 C 100 120 94 108 84 102
        C 78 98 70 98 66 100 Z" />
      <path d="M 134 100 C 140 108 142 120 138 130 C 134 140 126 148 116 150
        C 106 148 100 142 100 132 C 100 120 106 108 116 102
        C 122 98 130 98 134 100 Z" />
      <path d="M 50 174 C 48 184 46 196 46 208
        C 46 218 48 228 52 236 C 56 244 62 250 70 256
        C 80 262 90 266 100 267
        C 110 266 120 262 130 256
        C 138 250 144 244 148 236
        C 152 228 154 218 154 208
        C 154 196 152 184 150 174
        C 136 178 120 182 100 183
        C 80 182 64 178 50 174 Z" />
      <path d="M 32 93 C 26 98 22 108 22 120 C 22 134 23 148 24 162 L 46 162
        C 46 148 48 134 48 120 C 48 108 48 98 48 93 Z" />
      <path d="M 168 93 C 174 98 178 108 178 120 C 178 134 177 148 176 162 L 154 162
        C 154 148 152 134 152 120 C 152 108 152 98 152 93 Z" />
      <ellipse cx="34"  cy="164" rx="15" ry="8" />
      <ellipse cx="166" cy="164" rx="15" ry="8" />
      <path d="M 22 162 C 21 176 21 192 22 208 C 22 216 23 224 25 230 L 45 230
        C 47 224 48 216 48 208 C 49 192 49 176 48 162 Z" />
      <path d="M 178 162 C 179 176 179 192 178 208 C 178 216 177 224 175 230 L 155 230
        C 153 224 152 216 152 208 C 151 192 151 176 152 162 Z" />
      <ellipse cx="34"  cy="232" rx="13" ry="6" />
      <ellipse cx="166" cy="232" rx="13" ry="6" />
      <path d="M 22 230 C 21 240 21 252 23 262 C 25 270 29 276 34 278
        C 39 276 44 270 46 262 C 48 252 48 240 47 230 Z" />
      <path d="M 178 230 C 179 240 179 252 177 262 C 175 270 171 276 166 278
        C 161 276 156 270 154 262 C 152 252 152 240 153 230 Z" />
      <path d="M 67 256 C 65 268 63 288 63 308 C 63 318 64 326 66 332 L 91 332
        C 93 326 94 318 94 308 C 94 288 92 268 91 256 Z" />
      <path d="M 133 256 C 135 268 137 288 137 308 C 137 318 136 326 134 332 L 109 332
        C 107 326 106 318 106 308 C 106 288 108 268 109 256 Z" />
      <ellipse cx="78"  cy="334" rx="18" ry="10" />
      <ellipse cx="122" cy="334" rx="18" ry="10" />
      <path d="M 63 332 C 62 346 61 366 61 384 C 61 392 62 398 65 402 L 91 402
        C 94 398 95 392 95 384 C 95 366 94 346 92 332 Z" />
      <path d="M 137 332 C 138 346 139 366 139 384 C 139 392 138 398 135 402 L 109 402
        C 106 398 105 392 105 384 C 105 366 106 346 108 332 Z" />
      <ellipse cx="78"  cy="404" rx="16" ry="7" />
      <ellipse cx="122" cy="404" rx="16" ry="7" />
      <path d="M 62 404 C 57 410 52 418 50 426 C 48 430 50 430 56 430 L 96 430
        C 100 428 102 424 100 418 C 98 410 94 404 92 404 Z" />
      <path d="M 138 404 C 143 410 148 418 150 426 C 152 430 150 430 144 430 L 104 430
        C 100 428 98 424 100 418 C 102 410 106 404 108 404 Z" />
    </g>
  );
}

function MaleBackSilhouette() {
  return (
    <g fill={SKIN} stroke={SKIN_STROKE} strokeWidth={SW} strokeLinejoin="round">
      <ellipse cx="100" cy="31" rx="24" ry="27" />
      <ellipse cx="75"  cy="34" rx="4"  ry="7"  />
      <ellipse cx="125" cy="34" rx="4"  ry="7"  />
      <path d="M 90 56 C 88 62 88 71 88 80 L 112 80 C 112 71 112 62 110 56 Z" />
      <ellipse cx="22"  cy="106" rx="21" ry="14" />
      <ellipse cx="178" cy="106" rx="21" ry="14" />
      <path d="M 44 82 L 156 82
        C 160 102 162 126 160 150 C 159 164 156 176 150 188
        C 144 198 136 206 126 212 C 114 218 108 220 100 221
        C 92 220 86 218 74 212 C 64 206 56 198 50 188
        C 44 176 41 164 40 150 C 38 126 40 102 44 82 Z" />
      <path d="M 56 102 C 52 112 50 124 52 134 C 54 144 60 150 68 152
        C 76 150 82 144 84 134 C 86 122 82 110 74 104
        C 68 100 60 100 56 102 Z"
        fill="none" stroke={SKIN_STROKE} strokeWidth="0.8" strokeOpacity="0.4" />
      <path d="M 144 102 C 148 112 150 124 148 134 C 146 144 140 150 132 152
        C 124 150 118 144 116 134 C 114 122 118 110 126 104
        C 132 100 140 100 144 102 Z"
        fill="none" stroke={SKIN_STROKE} strokeWidth="0.8" strokeOpacity="0.4" />
      <line x1="100" y1="80" x2="100" y2="194" stroke={SKIN_STROKE} strokeWidth="0.7" strokeOpacity="0.3" />
      <path d="M 44 82 C 40 90 30 96 22 96 C 14 100 10 110 10 120
        C 10 134 11 148 12 164 L 40 164
        C 42 148 44 132 44 120 C 44 106 44 92 44 82 Z" />
      <path d="M 156 82 C 160 90 170 96 178 96 C 186 100 190 110 190 120
        C 190 134 189 148 188 164 L 160 164
        C 158 148 156 132 156 120 C 156 106 156 92 156 82 Z" />
      <ellipse cx="26"  cy="166" rx="17" ry="9" />
      <ellipse cx="174" cy="166" rx="17" ry="9" />
      <path d="M 12 164 C 11 178 10 196 11 212 C 11 220 12 228 15 234 L 39 234
        C 41 228 42 220 42 212 C 43 196 42 178 41 164 Z" />
      <path d="M 188 164 C 189 178 190 196 189 212 C 189 220 188 228 185 234 L 161 234
        C 159 228 158 220 158 212 C 157 196 158 178 159 164 Z" />
      <ellipse cx="26"  cy="236" rx="15" ry="7" />
      <ellipse cx="174" cy="236" rx="15" ry="7" />
      <path d="M 12 234 C 11 244 10 256 12 266 C 14 274 19 280 26 282
        C 33 280 39 274 40 266 C 42 256 41 244 40 234 Z" />
      <path d="M 188 234 C 189 244 190 256 188 266 C 186 274 181 280 174 282
        C 167 280 161 274 160 266 C 158 256 159 244 160 234 Z" />
      <path d="M 50 214 C 46 224 44 236 46 248 C 48 260 54 270 62 276
        C 70 282 82 286 100 288
        C 118 286 130 282 138 276
        C 146 270 152 260 154 248
        C 156 236 154 224 150 214
        C 138 220 120 224 100 224
        C 80 224 62 220 50 214 Z" />
      <path d="M 66 242 C 64 256 62 278 62 300 C 62 310 63 320 65 326 L 92 326
        C 94 320 95 310 95 300 C 95 278 93 256 92 242 Z" />
      <path d="M 134 242 C 136 256 138 278 138 300 C 138 310 137 320 135 326 L 108 326
        C 106 320 105 310 105 300 C 105 278 107 256 108 242 Z" />
      <ellipse cx="78"  cy="328" rx="20" ry="10" />
      <ellipse cx="122" cy="328" rx="20" ry="10" />
      <path d="M 61 326 C 59 342 58 362 58 382 C 58 390 59 398 62 402 L 94 402
        C 97 398 98 390 98 382 C 98 362 97 342 95 326 Z" />
      <path d="M 139 326 C 141 342 142 362 142 382 C 142 390 141 398 138 402 L 106 402
        C 103 398 102 390 102 382 C 102 362 103 342 105 326 Z" />
      <ellipse cx="78"  cy="404" rx="18" ry="8" />
      <ellipse cx="122" cy="404" rx="18" ry="8" />
      <path d="M 58 402 C 52 406 48 410 46 416 C 44 422 46 428 52 430 L 98 430
        C 102 428 104 424 102 418 C 100 412 94 406 94 402 Z" />
      <path d="M 142 402 C 148 406 152 410 154 416 C 156 422 154 428 148 430 L 102 430
        C 98 428 96 424 98 418 C 100 412 106 406 106 402 Z" />
    </g>
  );
}

function FemaleBackSilhouette() {
  return (
    <g fill={SKIN} stroke={SKIN_STROKE} strokeWidth={SW} strokeLinejoin="round">
      <ellipse cx="100" cy="30" rx="23" ry="25" />
      <ellipse cx="76"  cy="33" rx="3.5" ry="6" />
      <ellipse cx="124" cy="33" rx="3.5" ry="6" />
      <path d="M 91 54 C 90 60 90 70 90 80 L 110 80 C 110 70 110 60 109 54 Z" />
      <ellipse cx="32"  cy="103" rx="18" ry="12" />
      <ellipse cx="168" cy="103" rx="18" ry="12" />
      <path d="M 50 82 L 150 82
        C 154 100 156 124 154 148 C 153 162 150 174 144 184
        C 138 194 130 200 120 206 C 110 210 106 212 100 213
        C 94 212 90 210 80 206 C 70 200 62 194 56 184
        C 50 174 47 162 46 148 C 44 124 46 100 50 82 Z" />
      <path d="M 60 100 C 56 110 55 122 58 132 C 61 140 68 146 76 147
        C 84 145 90 138 91 128 C 92 116 88 104 80 100
        C 74 96 64 96 60 100 Z"
        fill="none" stroke={SKIN_STROKE} strokeWidth="0.8" strokeOpacity="0.4" />
      <path d="M 140 100 C 144 110 145 122 142 132 C 139 140 132 146 124 147
        C 116 145 110 138 109 128 C 108 116 112 104 120 100
        C 126 96 136 96 140 100 Z"
        fill="none" stroke={SKIN_STROKE} strokeWidth="0.8" strokeOpacity="0.4" />
      <line x1="100" y1="80" x2="100" y2="188" stroke={SKIN_STROKE} strokeWidth="0.7" strokeOpacity="0.3" />
      <path d="M 32 93 C 26 98 22 108 22 120 C 22 134 23 148 24 162 L 46 162
        C 46 148 48 134 48 120 C 48 108 48 98 48 93 Z" />
      <path d="M 168 93 C 174 98 178 108 178 120 C 178 134 177 148 176 162 L 154 162
        C 154 148 152 134 152 120 C 152 108 152 98 152 93 Z" />
      <ellipse cx="34"  cy="164" rx="15" ry="8" />
      <ellipse cx="166" cy="164" rx="15" ry="8" />
      <path d="M 22 162 C 21 176 21 192 22 208 C 22 216 23 224 25 230 L 45 230
        C 47 224 48 216 48 208 C 49 192 49 176 48 162 Z" />
      <path d="M 178 162 C 179 176 179 192 178 208 C 178 216 177 224 175 230 L 155 230
        C 153 224 152 216 152 208 C 151 192 151 176 152 162 Z" />
      <ellipse cx="34"  cy="232" rx="13" ry="6" />
      <ellipse cx="166" cy="232" rx="13" ry="6" />
      <path d="M 22 230 C 21 240 21 252 23 262 C 25 270 29 276 34 278
        C 39 276 44 270 46 262 C 48 252 48 240 47 230 Z" />
      <path d="M 178 230 C 179 240 179 252 177 262 C 175 270 171 276 166 278
        C 161 276 156 270 154 262 C 152 252 152 240 153 230 Z" />
      <path d="M 46 206 C 42 218 40 232 42 246 C 44 260 52 272 62 280
        C 72 288 84 292 100 294
        C 116 292 128 288 138 280
        C 148 272 156 260 158 246
        C 160 232 158 218 154 206
        C 140 214 122 218 100 218
        C 78 218 60 214 46 206 Z" />
      <path d="M 67 260 C 65 272 63 292 63 312 C 63 322 64 330 66 336 L 91 336
        C 93 330 94 322 94 312 C 94 292 92 272 91 260 Z" />
      <path d="M 133 260 C 135 272 137 292 137 312 C 137 322 136 330 134 336 L 109 336
        C 107 330 106 322 106 312 C 106 292 108 272 109 260 Z" />
      <ellipse cx="78"  cy="338" rx="18" ry="10" />
      <ellipse cx="122" cy="338" rx="18" ry="10" />
      <path d="M 63 336 C 62 350 61 370 61 388 C 61 396 62 402 65 406 L 91 406
        C 94 402 95 396 95 388 C 95 370 94 350 92 336 Z" />
      <path d="M 137 336 C 138 350 139 370 139 388 C 139 396 138 402 135 406 L 109 406
        C 106 402 105 396 105 388 C 105 370 106 350 108 336 Z" />
      <ellipse cx="78"  cy="408" rx="16" ry="7" />
      <ellipse cx="122" cy="408" rx="16" ry="7" />
      <path d="M 62 408 C 56 412 52 418 50 424 C 48 430 50 430 56 430 L 96 430
        C 100 428 101 424 99 418 C 97 412 93 408 92 408 Z" />
      <path d="M 138 408 C 144 412 148 418 150 424 C 152 430 150 430 144 430 L 104 430
        C 100 428 99 424 101 418 C 103 412 107 408 108 408 Z" />
    </g>
  );
}

function NeutralFrontSilhouette() {
  return (
    <g fill={SKIN} stroke={SKIN_STROKE} strokeWidth={SW} strokeLinejoin="round">
      <ellipse cx="100" cy="31" rx="24" ry="27" />
      <ellipse cx="75"  cy="34" rx="4"  ry="7"  />
      <ellipse cx="125" cy="34" rx="4"  ry="7"  />
      <path d="M 90 56 C 88 62 88 71 88 80 L 112 80 C 112 71 112 62 110 56 Z" />
      <ellipse cx="28"  cy="106" rx="20" ry="13" />
      <ellipse cx="172" cy="106" rx="20" ry="13" />
      <path d="M 48 82 L 152 82
        C 154 100 156 122 154 142 C 153 156 150 168 146 180
        C 142 190 136 198 128 205 C 116 212 108 215 100 216
        C 92 215 84 212 72 205 C 64 198 58 190 54 180
        C 50 168 47 156 46 142 C 44 122 46 100 48 82 Z" />
      <path d="M 48 82 C 44 90 34 96 28 96 C 20 100 16 110 16 120
        C 16 134 17 148 18 164 L 44 164
        C 44 148 46 132 46 120 C 46 106 46 92 48 82 Z" />
      <path d="M 152 82 C 156 90 166 96 172 96 C 180 100 184 110 184 120
        C 184 134 183 148 182 164 L 158 164
        C 158 148 154 132 154 120 C 154 106 154 92 152 82 Z" />
      <ellipse cx="31"  cy="166" rx="16" ry="9" />
      <ellipse cx="169" cy="166" rx="16" ry="9" />
      <path d="M 16 164 C 15 178 14 196 15 212 C 15 220 16 228 19 234 L 43 234
        C 45 228 46 220 46 212 C 47 196 46 178 45 164 Z" />
      <path d="M 184 164 C 185 178 186 196 185 212 C 185 220 184 228 181 234 L 157 234
        C 155 228 154 220 154 212 C 153 196 154 178 155 164 Z" />
      <path d="M 16 234 C 15 244 14 256 16 266 C 18 274 23 280 30 282
        C 37 280 42 274 44 266 C 46 256 45 244 44 234 Z" />
      <path d="M 184 234 C 185 244 186 256 184 266 C 182 274 177 280 170 282
        C 163 280 158 274 156 266 C 154 256 155 244 156 234 Z" />
      <path d="M 70 214 C 68 228 66 252 66 272 C 66 282 67 290 69 296 L 92 296
        C 94 290 95 282 95 272 C 95 252 93 228 92 214 Z" />
      <path d="M 130 214 C 132 228 134 252 134 272 C 134 282 133 290 131 296 L 108 296
        C 106 290 105 282 105 272 C 105 252 107 228 108 214 Z" />
      <ellipse cx="80"  cy="298" rx="18" ry="10" />
      <ellipse cx="120" cy="298" rx="18" ry="10" />
      <path d="M 65 296 C 63 312 62 334 62 354 C 62 362 63 370 66 376 L 94 376
        C 97 370 98 362 98 354 C 98 334 97 312 95 296 Z" />
      <path d="M 135 296 C 137 312 138 334 138 354 C 138 362 137 370 134 376 L 106 376
        C 103 370 102 362 102 354 C 102 334 103 312 105 296 Z" />
      <ellipse cx="80"  cy="378" rx="17" ry="8" />
      <ellipse cx="120" cy="378" rx="17" ry="8" />
      <path d="M 63 378 C 57 386 52 394 50 404 C 48 410 50 418 56 420 L 100 420
        C 103 418 104 412 102 404 C 100 394 95 386 96 378 Z" />
      <path d="M 137 378 C 143 386 148 394 150 404 C 152 410 150 418 144 420 L 100 420
        C 97 418 96 412 98 404 C 100 394 105 386 104 378 Z" />
    </g>
  );
}

function NeutralBackSilhouette() {
  return <MaleBackSilhouette />;
}

interface BodyMapProps {
  view: BodyView;
  markers: BodyMarker[];
  selectedZone: string | null;
  onZoneClick?: (zoneId: string, centroid: [number, number]) => void;
  readOnly?: boolean;
  className?: string;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  bodyType?: BodyType;
  markerCounts?: Record<string, number>;
}

export function BodyMap({
  view,
  markers,
  selectedZone,
  onZoneClick,
  readOnly = false,
  className,
  svgRef,
  bodyType = "unspecified",
  markerCounts,
}: BodyMapProps) {
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const zones = getViewZones(view, bodyType);
  const markerMap = new Map(markers.map((m) => [m.zone, m]));
  const hovered = hoveredZone ? ALL_ZONES.find((z) => z.id === hoveredZone) : null;
  const hoveredMarker = hoveredZone ? markerMap.get(hoveredZone) : null;

  function Silhouette() {
    if (view === "front") {
      if (bodyType === "male")   return <MaleFrontSilhouette />;
      if (bodyType === "female") return <FemaleFrontSilhouette />;
      return <NeutralFrontSilhouette />;
    } else {
      if (bodyType === "male")   return <MaleBackSilhouette />;
      if (bodyType === "female") return <FemaleBackSilhouette />;
      return <NeutralBackSilhouette />;
    }
  }

  return (
    <div className={cn("relative select-none", className)}>
      <svg
        ref={svgRef}
        viewBox="0 0 200 430"
        className="w-full max-w-[180px] mx-auto block"
        style={{ height: "auto" }}
      >
        <g opacity="0.72">
          <Silhouette />
        </g>

        {zones.map((zone) => {
          const marker = markerMap.get(zone.id);
          const isSelected = selectedZone === zone.id;
          const isHovered  = hoveredZone === zone.id;

          let fill = "transparent";
          let stroke = "transparent";
          let strokeWidth = 0;

          if (marker) {
            fill = MARKER_COLORS[marker.color].hex + "30";
            stroke = MARKER_COLORS[marker.color].hex;
            strokeWidth = 1.5;
          }
          if (isSelected) {
            fill = "#6366f138";
            stroke = "#6366f1";
            strokeWidth = 2;
          } else if (isHovered && !readOnly) {
            fill = marker ? MARKER_COLORS[marker.color].hex + "48" : "#6366f118";
            stroke = marker ? MARKER_COLORS[marker.color].hex : "#6366f1";
            strokeWidth = 1.5;
          }

          return (
            <ZoneShapeEl
              key={zone.id}
              shape={zone.shape}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth}
              style={{ cursor: readOnly ? "default" : "pointer", transition: "fill 0.12s, stroke 0.12s" }}
              onClick={() => !readOnly && onZoneClick?.(zone.id, zone.centroid)}
              onMouseEnter={() => setHoveredZone(zone.id)}
              onMouseLeave={() => setHoveredZone(null)}
            />
          );
        })}

        {markers.map((marker) => {
          const zone = ALL_ZONES.find((z) => z.id === marker.zone);
          if (!zone) return null;
          const [cx, cy] = zone.centroid;
          const col = MARKER_COLORS[marker.color];
          const isSelected = selectedZone === marker.zone;
          const count = markerCounts?.[marker.zone] ?? 0;
          const showCount = count > 1;
          return (
            <g
              key={marker.zone}
              style={{ cursor: readOnly ? "default" : "pointer" }}
              onClick={() => !readOnly && onZoneClick?.(marker.zone, zone.centroid)}
              onMouseEnter={() => setHoveredZone(marker.zone)}
              onMouseLeave={() => setHoveredZone(null)}
            >
              <circle
                cx={cx} cy={cy}
                r={isSelected ? 7 : 5.5}
                fill={col.hex}
                stroke="white"
                strokeWidth={isSelected ? 2 : 1.5}
                style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
              />
              {showCount && (
                <>
                  <circle cx={cx + 5} cy={cy - 5} r={4.5} fill="#1e293b" stroke="white" strokeWidth={1} />
                  <text
                    x={cx + 5} y={cy - 5}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize="4.5" fontWeight="bold" fill="white"
                  >
                    {count > 9 ? "9+" : count}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] font-semibold rounded-lg px-2.5 py-1.5 shadow-lg pointer-events-none whitespace-nowrap z-10 max-w-[170px] text-center">
          <p>{hovered.label}</p>
          {hoveredMarker && (
            <p className="mt-0.5 font-normal text-slate-300 truncate">
              {MARKER_COLORS[hoveredMarker.color].label}
              {hoveredMarker.note ? ` · ${hoveredMarker.note.slice(0, 28)}…` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
