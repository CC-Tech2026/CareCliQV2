import { useState } from "react";
import { BodyMap, BodyMarker, BodyView, MarkerColor, MARKER_COLORS, getZoneLabel } from "@/components/BodyMap";
import { cn } from "@/lib/utils";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BodyExaminationPanelProps {
  markers: BodyMarker[];
  onChange?: (markers: BodyMarker[]) => void;
  readOnly?: boolean;
  className?: string;
}

export function BodyExaminationPanel({
  markers,
  onChange,
  readOnly = false,
  className,
}: BodyExaminationPanelProps) {
  const [view, setView] = useState<BodyView>("front");
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [draftColor, setDraftColor] = useState<MarkerColor>("red");
  const [draftNote, setDraftNote] = useState("");

  const existingMarker = selectedZone
    ? markers.find((m) => m.zone === selectedZone)
    : null;

  const handleZoneClick = (zoneId: string) => {
    if (readOnly) return;
    if (selectedZone === zoneId) {
      setSelectedZone(null);
      return;
    }
    const existing = markers.find((m) => m.zone === zoneId);
    setDraftColor(existing?.color ?? "red");
    setDraftNote(existing?.note ?? "");
    setSelectedZone(zoneId);
  };

  const handleSave = () => {
    if (!selectedZone || !onChange) return;
    const updated = markers.filter((m) => m.zone !== selectedZone);
    updated.push({ zone: selectedZone, color: draftColor, note: draftNote.trim() });
    onChange(updated);
    setSelectedZone(null);
  };

  const handleRemove = () => {
    if (!selectedZone || !onChange) return;
    onChange(markers.filter((m) => m.zone !== selectedZone));
    setSelectedZone(null);
  };

  const handleCancel = () => setSelectedZone(null);

  return (
    <div className={cn("space-y-4", className)}>

      {/* Header: Front / Back toggle */}
      <div className="flex items-center justify-between">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
          <button
            onClick={() => { setView("front"); setSelectedZone(null); }}
            className={cn(
              "px-3 py-1.5 transition-colors",
              view === "front"
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-500 hover:bg-slate-50",
            )}
          >
            <ChevronLeft className="h-3 w-3 inline mr-0.5 -mt-0.5" />
            Front
          </button>
          <button
            onClick={() => { setView("back"); setSelectedZone(null); }}
            className={cn(
              "px-3 py-1.5 transition-colors border-l border-slate-200",
              view === "back"
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-500 hover:bg-slate-50",
            )}
          >
            Back
            <ChevronRight className="h-3 w-3 inline ml-0.5 -mt-0.5" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {markers.length > 0 && (
            <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
              {markers.length} finding{markers.length !== 1 ? "s" : ""}
            </span>
          )}
          {!readOnly && (
            <span className="text-[10px] text-slate-400">Tap a zone to mark</span>
          )}
        </div>
      </div>

      {/* Body map + form panel */}
      <div className="flex flex-col sm:flex-row gap-4">

        {/* SVG body map */}
        <div className="flex-shrink-0 sm:w-[180px]">
          <BodyMap
            view={view}
            markers={markers}
            selectedZone={selectedZone}
            onZoneClick={handleZoneClick}
            readOnly={readOnly}
            className="w-full"
          />
        </div>

        {/* Right panel: zone form or marker list */}
        <div className="flex-1 min-w-0">
          {selectedZone && !readOnly ? (
            /* Zone editing form */
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-slate-800">
                  {getZoneLabel(selectedZone)}
                </p>
                <button
                  onClick={handleCancel}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Color swatches */}
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Finding Type
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(MARKER_COLORS) as [MarkerColor, typeof MARKER_COLORS[MarkerColor]][]).map(([key, cfg]) => (
                    <button
                      key={key}
                      onClick={() => setDraftColor(key)}
                      className={cn(
                        "flex items-center gap-2 px-2.5 py-2 rounded-lg border text-xs font-semibold transition-all",
                        draftColor === key
                          ? `${cfg.bg} ${cfg.text} ${cfg.border} ring-2 ring-offset-1`
                          : "bg-white text-slate-500 border-slate-200 hover:border-slate-300",
                        draftColor === key && key === "red"   && "ring-red-400",
                        draftColor === key && key === "yellow"&& "ring-amber-400",
                        draftColor === key && key === "blue"  && "ring-blue-400",
                        draftColor === key && key === "green" && "ring-emerald-400",
                      )}
                    >
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: cfg.hex }}
                      />
                      {cfg.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Note */}
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                  Clinical Note
                </p>
                <textarea
                  value={draftNote}
                  onChange={(e) => setDraftNote(e.target.value.slice(0, 200))}
                  placeholder="Describe the finding (e.g. sharp pain on palpation)…"
                  rows={3}
                  className="w-full text-xs p-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 leading-relaxed"
                />
                <p className="text-[9px] text-slate-400 text-right mt-0.5">
                  {draftNote.length}/200
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                {existingMarker && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemove}
                    className="text-red-600 border-red-200 hover:bg-red-50 text-xs h-7 px-3"
                  >
                    Remove
                  </Button>
                )}
                <Button
                  size="sm"
                  onClick={handleSave}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs h-7"
                >
                  {existingMarker ? "Update Finding" : "Save Finding"}
                </Button>
              </div>
            </div>
          ) : (
            /* Marker summary list */
            <div className="space-y-2">
              {markers.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-[140px] text-center text-slate-400 border border-dashed border-slate-200 rounded-xl">
                  <p className="text-xs font-medium">No findings recorded</p>
                  {!readOnly && (
                    <p className="text-[10px] mt-1 text-slate-400">
                      Tap a body zone to add a finding
                    </p>
                  )}
                </div>
              ) : (
                markers.map((marker) => {
                  const cfg = MARKER_COLORS[marker.color];
                  return (
                    <button
                      key={marker.zone}
                      onClick={() => !readOnly && handleZoneClick(marker.zone)}
                      className={cn(
                        "w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-all",
                        readOnly
                          ? "cursor-default bg-white border-slate-100"
                          : "hover:border-indigo-200 hover:bg-indigo-50/30 cursor-pointer bg-white border-slate-100",
                      )}
                    >
                      <span
                        className="mt-0.5 h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: cfg.hex }}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-700 leading-none">
                          {getZoneLabel(marker.zone)}
                        </p>
                        <p className={cn("text-[10px] mt-0.5", cfg.text, "font-medium")}>
                          {cfg.label}
                        </p>
                        {marker.note && (
                          <p className="text-[10px] text-slate-500 mt-0.5 leading-snug line-clamp-2">
                            {marker.note}
                          </p>
                        )}
                      </div>
                      {!readOnly && (
                        <span className="text-[9px] text-slate-400 shrink-0 mt-0.5">Edit</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      {/* Color legend */}
      <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-slate-100">
        {(Object.entries(MARKER_COLORS) as [MarkerColor, typeof MARKER_COLORS[MarkerColor]][]).map(([key, cfg]) => (
          <span key={key} className="flex items-center gap-1 text-[9px] font-medium text-slate-500">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cfg.hex }} />
            {cfg.label}
          </span>
        ))}
      </div>
    </div>
  );
}
