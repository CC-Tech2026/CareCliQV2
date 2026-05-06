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
type ZoneShape = ShapeEllipse | ShapeRect;

interface ZoneDef {
  id: string;
  label: string;
  shape: ZoneShape;
  centroid: [number, number];
}

const FRONT_ZONES: ZoneDef[] = [
  { id: "head",           label: "Head",            shape: { type: "e", cx: 100, cy: 38, rx: 25, ry: 27 }, centroid: [100, 38] },
  { id: "neck",           label: "Neck",            shape: { type: "r", x: 91, y: 64, w: 18, h: 16, rx: 5 }, centroid: [100, 72] },
  { id: "left_shoulder",  label: "Left Shoulder",   shape: { type: "e", cx: 60, cy: 96, rx: 19, ry: 14 }, centroid: [60, 96] },
  { id: "right_shoulder", label: "Right Shoulder",  shape: { type: "e", cx: 140, cy: 96, rx: 19, ry: 14 }, centroid: [140, 96] },
  { id: "chest",          label: "Chest",           shape: { type: "r", x: 72, y: 79, w: 56, h: 54, rx: 4 }, centroid: [100, 106] },
  { id: "abdomen",        label: "Abdomen",         shape: { type: "r", x: 74, y: 133, w: 52, h: 46, rx: 4 }, centroid: [100, 156] },
  { id: "left_hip",       label: "Left Hip",        shape: { type: "r", x: 74, y: 179, w: 26, h: 38, rx: 4 }, centroid: [87, 198] },
  { id: "right_hip",      label: "Right Hip",       shape: { type: "r", x: 100, y: 179, w: 26, h: 38, rx: 4 }, centroid: [113, 198] },
  { id: "left_upper_arm", label: "Left Upper Arm",  shape: { type: "r", x: 38, y: 84, w: 21, h: 57, rx: 8 }, centroid: [49, 113] },
  { id: "right_upper_arm",label: "Right Upper Arm", shape: { type: "r", x: 141, y: 84, w: 21, h: 57, rx: 8 }, centroid: [152, 113] },
  { id: "left_forearm",   label: "Left Forearm",    shape: { type: "r", x: 33, y: 141, w: 18, h: 54, rx: 8 }, centroid: [42, 168] },
  { id: "right_forearm",  label: "Right Forearm",   shape: { type: "r", x: 149, y: 141, w: 18, h: 54, rx: 8 }, centroid: [158, 168] },
  { id: "left_hand",      label: "Left Hand",       shape: { type: "e", cx: 41, cy: 210, rx: 11, ry: 9 }, centroid: [41, 210] },
  { id: "right_hand",     label: "Right Hand",      shape: { type: "e", cx: 159, cy: 210, rx: 11, ry: 9 }, centroid: [159, 210] },
  { id: "left_thigh",     label: "Left Thigh",      shape: { type: "r", x: 76, y: 217, w: 22, h: 64, rx: 6 }, centroid: [87, 249] },
  { id: "right_thigh",    label: "Right Thigh",     shape: { type: "r", x: 102, y: 217, w: 22, h: 64, rx: 6 }, centroid: [113, 249] },
  { id: "left_shin",      label: "Left Shin",       shape: { type: "r", x: 78, y: 281, w: 18, h: 64, rx: 6 }, centroid: [87, 313] },
  { id: "right_shin",     label: "Right Shin",      shape: { type: "r", x: 104, y: 281, w: 18, h: 64, rx: 6 }, centroid: [113, 313] },
  { id: "left_foot",      label: "Left Foot",       shape: { type: "e", cx: 85, cy: 357, rx: 16, ry: 9 }, centroid: [85, 357] },
  { id: "right_foot",     label: "Right Foot",      shape: { type: "e", cx: 113, cy: 357, rx: 16, ry: 9 }, centroid: [113, 357] },
];

const BACK_ZONES: ZoneDef[] = [
  { id: "head_back",            label: "Head (Back)",         shape: { type: "e", cx: 100, cy: 38, rx: 25, ry: 27 }, centroid: [100, 38] },
  { id: "neck_back",            label: "Neck (Back)",         shape: { type: "r", x: 91, y: 64, w: 18, h: 16, rx: 5 }, centroid: [100, 72] },
  { id: "left_shoulder_back",   label: "Left Shoulder",       shape: { type: "e", cx: 60, cy: 96, rx: 19, ry: 14 }, centroid: [60, 96] },
  { id: "right_shoulder_back",  label: "Right Shoulder",      shape: { type: "e", cx: 140, cy: 96, rx: 19, ry: 14 }, centroid: [140, 96] },
  { id: "upper_back",           label: "Upper Back",          shape: { type: "r", x: 72, y: 79, w: 56, h: 54, rx: 4 }, centroid: [100, 106] },
  { id: "lower_back",           label: "Lower Back",          shape: { type: "r", x: 74, y: 133, w: 52, h: 46, rx: 4 }, centroid: [100, 156] },
  { id: "left_gluteal",         label: "Left Gluteal",        shape: { type: "r", x: 74, y: 179, w: 26, h: 38, rx: 4 }, centroid: [87, 198] },
  { id: "right_gluteal",        label: "Right Gluteal",       shape: { type: "r", x: 100, y: 179, w: 26, h: 38, rx: 4 }, centroid: [113, 198] },
  { id: "left_upper_arm_back",  label: "Left Upper Arm",      shape: { type: "r", x: 38, y: 84, w: 21, h: 57, rx: 8 }, centroid: [49, 113] },
  { id: "right_upper_arm_back", label: "Right Upper Arm",     shape: { type: "r", x: 141, y: 84, w: 21, h: 57, rx: 8 }, centroid: [152, 113] },
  { id: "left_forearm_back",    label: "Left Forearm",        shape: { type: "r", x: 33, y: 141, w: 18, h: 54, rx: 8 }, centroid: [42, 168] },
  { id: "right_forearm_back",   label: "Right Forearm",       shape: { type: "r", x: 149, y: 141, w: 18, h: 54, rx: 8 }, centroid: [158, 168] },
  { id: "left_hand_back",       label: "Left Hand",           shape: { type: "e", cx: 41, cy: 210, rx: 11, ry: 9 }, centroid: [41, 210] },
  { id: "right_hand_back",      label: "Right Hand",          shape: { type: "e", cx: 159, cy: 210, rx: 11, ry: 9 }, centroid: [159, 210] },
  { id: "left_thigh_back",      label: "Left Thigh",          shape: { type: "r", x: 76, y: 217, w: 22, h: 64, rx: 6 }, centroid: [87, 249] },
  { id: "right_thigh_back",     label: "Right Thigh",         shape: { type: "r", x: 102, y: 217, w: 22, h: 64, rx: 6 }, centroid: [113, 249] },
  { id: "left_calf",            label: "Left Calf",           shape: { type: "r", x: 78, y: 281, w: 18, h: 64, rx: 6 }, centroid: [87, 313] },
  { id: "right_calf",           label: "Right Calf",          shape: { type: "r", x: 104, y: 281, w: 18, h: 64, rx: 6 }, centroid: [113, 313] },
  { id: "left_foot_back",       label: "Left Foot",           shape: { type: "e", cx: 85, cy: 357, rx: 16, ry: 9 }, centroid: [85, 357] },
  { id: "right_foot_back",      label: "Right Foot",          shape: { type: "e", cx: 113, cy: 357, rx: 16, ry: 9 }, centroid: [113, 357] },
];

export const ALL_ZONES = [...FRONT_ZONES, ...BACK_ZONES];

export function getZoneLabel(zoneId: string): string {
  return ALL_ZONES.find((z) => z.id === zoneId)?.label ?? zoneId.replace(/_/g, " ");
}

/** Map from zone ID to its SVG centroid [x, y] — used by PDF export */
export const ZONE_CENTROIDS: Record<string, [number, number]> = Object.fromEntries(
  ALL_ZONES.map((z) => [z.id, z.centroid]),
);

function ZoneShapeEl({
  shape,
  ...svgProps
}: { shape: ZoneShape } & React.SVGAttributes<SVGElement>) {
  if (shape.type === "e") {
    return (
      <ellipse
        cx={shape.cx}
        cy={shape.cy}
        rx={shape.rx}
        ry={shape.ry}
        {...(svgProps as React.SVGAttributes<SVGEllipseElement>)}
      />
    );
  }
  return (
    <rect
      x={shape.x}
      y={shape.y}
      width={shape.w}
      height={shape.h}
      rx={shape.rx ?? 4}
      {...(svgProps as React.SVGAttributes<SVGRectElement>)}
    />
  );
}

/** Neutral / unspecified silhouette shapes */
function SilhouetteNeutral() {
  return (
    <>
      <ellipse cx="100" cy="38" rx="26" ry="28" />
      <rect x="91" y="64" width="18" height="17" rx="3" />
      <ellipse cx="60" cy="96" rx="20" ry="15" />
      <ellipse cx="140" cy="96" rx="20" ry="15" />
      <rect x="71" y="78" width="58" height="56" rx="5" />
      <rect x="73" y="133" width="54" height="48" rx="4" />
      <rect x="73" y="180" width="54" height="40" rx="4" />
      <rect x="37" y="83" width="23" height="59" rx="9" />
      <rect x="140" y="83" width="23" height="59" rx="9" />
      <rect x="32" y="140" width="20" height="56" rx="9" />
      <rect x="148" y="140" width="20" height="56" rx="9" />
      <ellipse cx="41" cy="210" rx="13" ry="10" />
      <ellipse cx="159" cy="210" rx="13" ry="10" />
      <rect x="75" y="219" width="24" height="66" rx="7" />
      <rect x="101" y="219" width="24" height="66" rx="7" />
      <rect x="77" y="283" width="20" height="66" rx="7" />
      <rect x="103" y="283" width="20" height="66" rx="7" />
      <ellipse cx="86" cy="358" rx="17" ry="10" />
      <ellipse cx="113" cy="358" rx="17" ry="10" />
    </>
  );
}

/**
 * Male silhouette — broader shoulders (rx=23), wider chest (w=66),
 * straighter waist, narrower hips (w=46).
 */
function SilhouetteMale() {
  return (
    <>
      {/* Head */}
      <ellipse cx="100" cy="38" rx="26" ry="28" />
      {/* Neck */}
      <rect x="91" y="64" width="18" height="17" rx="3" />
      {/* Shoulders — wider */}
      <ellipse cx="56" cy="95" rx="23" ry="16" />
      <ellipse cx="144" cy="95" rx="23" ry="16" />
      {/* Chest — broader */}
      <rect x="67" y="78" width="66" height="56" rx="5" />
      {/* Abdomen — moderate width */}
      <rect x="71" y="133" width="58" height="48" rx="4" />
      {/* Hips — narrower */}
      <rect x="77" y="180" width="46" height="40" rx="4" />
      {/* Upper arms — bulkier */}
      <rect x="34" y="82" width="25" height="59" rx="9" />
      <rect x="141" y="82" width="25" height="59" rx="9" />
      {/* Forearms */}
      <rect x="31" y="139" width="21" height="57" rx="9" />
      <rect x="148" y="139" width="21" height="57" rx="9" />
      {/* Hands */}
      <ellipse cx="41" cy="210" rx="13" ry="10" />
      <ellipse cx="159" cy="210" rx="13" ry="10" />
      {/* Thighs */}
      <rect x="76" y="219" width="23" height="66" rx="7" />
      <rect x="101" y="219" width="23" height="66" rx="7" />
      {/* Shins */}
      <rect x="77" y="283" width="20" height="66" rx="7" />
      <rect x="103" y="283" width="20" height="66" rx="7" />
      {/* Feet */}
      <ellipse cx="86" cy="358" rx="17" ry="10" />
      <ellipse cx="113" cy="358" rx="17" ry="10" />
    </>
  );
}

/**
 * Female silhouette — narrower shoulders (rx=16), chest contour ellipses,
 * narrowed waist, wider hips (w=60).
 */
function SilhouetteFemale() {
  return (
    <>
      {/* Head — slightly smaller */}
      <ellipse cx="100" cy="38" rx="24" ry="27" />
      {/* Neck — narrower */}
      <rect x="92" y="64" width="16" height="16" rx="5" />
      {/* Shoulders — narrower */}
      <ellipse cx="63" cy="95" rx="16" ry="13" />
      <ellipse cx="137" cy="95" rx="16" ry="13" />
      {/* Chest/torso */}
      <rect x="73" y="78" width="54" height="52" rx="5" />
      {/* Breast contours */}
      <ellipse cx="89" cy="100" rx="11" ry="12" />
      <ellipse cx="111" cy="100" rx="11" ry="12" />
      {/* Abdomen — narrowed waist */}
      <rect x="76" y="129" width="48" height="40" rx="5" />
      {/* Hips — wider */}
      <rect x="70" y="168" width="60" height="44" rx="8" />
      {/* Upper arms — slimmer */}
      <rect x="40" y="82" width="20" height="57" rx="8" />
      <rect x="140" y="82" width="20" height="57" rx="8" />
      {/* Forearms */}
      <rect x="34" y="138" width="18" height="55" rx="8" />
      <rect x="148" y="138" width="18" height="55" rx="8" />
      {/* Hands */}
      <ellipse cx="42" cy="208" rx="12" ry="10" />
      <ellipse cx="158" cy="208" rx="12" ry="10" />
      {/* Thighs */}
      <rect x="74" y="212" width="24" height="68" rx="7" />
      <rect x="102" y="212" width="24" height="68" rx="7" />
      {/* Shins */}
      <rect x="76" y="278" width="20" height="67" rx="7" />
      <rect x="104" y="278" width="20" height="67" rx="7" />
      {/* Feet */}
      <ellipse cx="85" cy="357" rx="17" ry="10" />
      <ellipse cx="114" cy="357" rx="17" ry="10" />
    </>
  );
}

interface BodyMapProps {
  view: BodyView;
  markers: BodyMarker[];
  selectedZone: string | null;
  /** Called with zone id AND the zone's SVG-space centroid [x, y] */
  onZoneClick?: (zoneId: string, centroid: [number, number]) => void;
  readOnly?: boolean;
  className?: string;
  svgRef?: React.RefObject<SVGSVGElement | null>;
  bodyType?: BodyType;
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
}: BodyMapProps) {
  const [hoveredZone, setHoveredZone] = useState<string | null>(null);
  const zones = view === "front" ? FRONT_ZONES : BACK_ZONES;

  const markerMap = new Map(markers.map((m) => [m.zone, m]));

  const hovered = hoveredZone ? ALL_ZONES.find((z) => z.id === hoveredZone) : null;
  const hoveredMarker = hoveredZone ? markerMap.get(hoveredZone) : null;

  return (
    <div className={cn("relative select-none", className)}>
      <svg
        ref={svgRef}
        viewBox="0 0 200 380"
        className="w-full max-w-[200px] mx-auto block"
        style={{ height: "auto" }}
      >
        {/* Background silhouette — purely decorative, sex-specific */}
        <g opacity="0.08" fill="#334155">
          {bodyType === "male" ? (
            <SilhouetteMale />
          ) : bodyType === "female" ? (
            <SilhouetteFemale />
          ) : (
            <SilhouetteNeutral />
          )}
        </g>

        {/* Clickable zones */}
        {zones.map((zone) => {
          const marker = markerMap.get(zone.id);
          const isSelected = selectedZone === zone.id;
          const isHovered = hoveredZone === zone.id;

          let fill = "transparent";
          let stroke = "transparent";
          let strokeWidth = 0;

          if (marker) {
            fill = MARKER_COLORS[marker.color].hex + "30";
            stroke = MARKER_COLORS[marker.color].hex;
            strokeWidth = 1.5;
          }
          if (isSelected) {
            fill = "#6366f130";
            stroke = "#6366f1";
            strokeWidth = 2;
          } else if (isHovered && !readOnly) {
            fill = marker ? MARKER_COLORS[marker.color].hex + "45" : "#6366f115";
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

        {/* Marker dots */}
        {markers.map((marker) => {
          const zone = ALL_ZONES.find((z) => z.id === marker.zone);
          if (!zone) return null;
          const [cx, cy] = zone.centroid;
          const col = MARKER_COLORS[marker.color];
          const isSelected = selectedZone === marker.zone;
          return (
            <g
              key={marker.zone}
              style={{ cursor: readOnly ? "default" : "pointer" }}
              onClick={() => !readOnly && onZoneClick?.(marker.zone, zone.centroid)}
              onMouseEnter={() => setHoveredZone(marker.zone)}
              onMouseLeave={() => setHoveredZone(null)}
            >
              <circle
                cx={cx}
                cy={cy}
                r={isSelected ? 7 : 5.5}
                fill={col.hex}
                stroke="white"
                strokeWidth={isSelected ? 2 : 1.5}
                style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }}
              />
            </g>
          );
        })}
      </svg>

      {/* Hover tooltip */}
      {hovered && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] font-semibold rounded-lg px-2.5 py-1.5 shadow-lg pointer-events-none whitespace-nowrap z-10 max-w-[160px] text-center">
          <p>{hovered.label}</p>
          {hoveredMarker && (
            <p className="mt-0.5 font-normal text-slate-300 truncate">
              {MARKER_COLORS[hoveredMarker.color].label}{hoveredMarker.note ? ` · ${hoveredMarker.note.slice(0, 28)}…` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
