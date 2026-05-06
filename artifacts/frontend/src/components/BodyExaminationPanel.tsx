import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  BodyMap,
  BodyMarker,
  BodyType,
  MarkerColor,
  MARKER_COLORS,
  getZoneLabel,
} from "@/components/BodyMap";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";

export type { BodyMarker, BodyType, MarkerColor };

const COLORS: MarkerColor[] = ["red", "yellow", "blue", "green"];

export function BodyExaminationPanel({
  markers,
  onChange,
  readOnly = false,
  bodyType = "unspecified",
}: {
  markers: BodyMarker[];
  onChange?: (markers: BodyMarker[]) => void;
  readOnly?: boolean;
  bodyType?: BodyType;
}) {
  const [view, setView] = useState<"front" | "back">("front");
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [selectedColor, setSelectedColor] = useState<MarkerColor>("red");

  function handleZoneClick(zoneId: string) {
    if (readOnly || !onChange) return;
    setSelectedZone(zoneId);
    const existing = markers.find((m) => m.zone === zoneId);
    if (existing) {
      onChange(markers.filter((m) => m.zone !== zoneId));
      setSelectedZone(null);
    } else {
      onChange([...markers, { zone: zoneId, color: selectedColor, note: "" }]);
    }
  }

  function removeMarker(zoneId: string) {
    if (!onChange) return;
    onChange(markers.filter((m) => m.zone !== zoneId));
    if (selectedZone === zoneId) setSelectedZone(null);
  }

  return (
    <div className="space-y-3">
      {/* View toggle */}
      <div className="flex gap-1 w-fit rounded-lg border border-border p-0.5 bg-muted">
        {(["front", "back"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={cn(
              "px-3 py-1 text-xs font-medium rounded-md capitalize transition-all",
              view === v
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {v}
          </button>
        ))}
      </div>

      <div className="flex gap-4 items-start">
        {/* Body map */}
        <div className="shrink-0 w-[120px]">
          <BodyMap
            view={view}
            markers={markers}
            selectedZone={selectedZone}
            onZoneClick={handleZoneClick}
            readOnly={readOnly}
            bodyType={bodyType}
          />
        </div>

        <div className="flex-1 space-y-3 min-w-0">
          {/* Color picker (edit mode) */}
          {!readOnly && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground font-medium">Mark type</p>
              <div className="flex gap-1.5 flex-wrap">
                {COLORS.map((c) => {
                  const def = MARKER_COLORS[c];
                  return (
                    <button
                      key={c}
                      onClick={() => setSelectedColor(c)}
                      className={cn(
                        "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium border transition-all",
                        def.bg, def.text, def.border,
                        selectedColor === c
                          ? "ring-2 ring-offset-1 ring-primary"
                          : "opacity-70 hover:opacity-100",
                      )}
                    >
                      <span
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: def.hex }}
                      />
                      {def.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground">
                Click a zone to add marker. Click again to remove.
              </p>
            </div>
          )}

          {/* Marker list */}
          {markers.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {markers.length} marker{markers.length !== 1 ? "s" : ""} recorded
              </p>
              <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                {markers.map((m) => {
                  const def = MARKER_COLORS[m.color];
                  return (
                    <div
                      key={m.zone}
                      className={cn(
                        "flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-xs",
                        def.bg, def.border,
                      )}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ background: def.hex }}
                        />
                        <span className={cn("font-medium truncate", def.text)}>
                          {getZoneLabel(m.zone)}
                        </span>
                        <span className="text-muted-foreground shrink-0">
                          — {def.label}
                        </span>
                      </div>
                      {!readOnly && (
                        <button
                          onClick={() => removeMarker(m.zone)}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">
              {readOnly ? "No markers recorded." : "Click any body zone to add a marker."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
