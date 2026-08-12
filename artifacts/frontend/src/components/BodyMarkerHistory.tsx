import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ChevronDown, ChevronUp, MapPin, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import { BodyMap, BodyMarker, BodyType, MARKER_COLORS, getZoneLabel, getMarkerColorLabel } from "@/components/BodyMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

export interface SessionWithMarkers {
  id: string;
  session_date?: string | null;
  session_type?: string | null;
  body_markers: BodyMarker[];
}

interface BodyMarkerHistoryProps {
  sessions: SessionWithMarkers[];
  bodyType?: BodyType;
  className?: string;
}

function safeFormat(dateStr?: string | null, fmt = "MMM d, yyyy") {
  if (!dateStr) return "N/A";
  try {
    return format(parseISO(dateStr), fmt);
  } catch {
    return dateStr;
  }
}

export function BodyMarkerHistory({ sessions, bodyType = "unspecified", className }: BodyMarkerHistoryProps) {
  const { translate, translateParams } = useAccessibility();
  const [view, setView] = useState<"front" | "back">("front");
  const [expandedSession, setExpandedSession] = useState<string | null>(null);

  const sessionsWithMarkers = sessions
    .filter((s) => Array.isArray(s.body_markers) && s.body_markers.length > 0)
    .sort((a, b) => {
      if (!a.session_date) return 1;
      if (!b.session_date) return -1;
      return new Date(b.session_date).getTime() - new Date(a.session_date).getTime();
    });

  if (sessionsWithMarkers.length === 0) return null;

  const zoneCountMap: Record<string, number> = {};
  for (const s of sessionsWithMarkers) {
    for (const m of s.body_markers) {
      zoneCountMap[m.zone] = (zoneCountMap[m.zone] ?? 0) + 1;
    }
  }

  const compositeMarkers: BodyMarker[] = [];
  const seen = new Set<string>();
  for (const s of sessionsWithMarkers) {
    for (const m of s.body_markers) {
      if (!seen.has(m.zone)) {
        compositeMarkers.push(m);
        seen.add(m.zone);
      }
    }
  }

  const persistentZones = Object.entries(zoneCountMap)
    .filter(([, count]) => count > 1)
    .sort(([, a], [, b]) => b - a);

  return (
    <div className={cn("border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden", className)}>
      <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
        <MapPin className="h-4 w-4 text-indigo-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
            Body Findings History
          </h4>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            {sessionsWithMarkers.length === 1 ? translateParams("clinical.bodyMap.history.sessionsWithFindings", { count: String(sessionsWithMarkers.length) }) : translateParams("clinical.bodyMap.history.sessionsWithFindingsPlural", { count: String(sessionsWithMarkers.length) })}
            {persistentZones.length > 0 && (
              <> · <span className="text-indigo-600 font-medium">{persistentZones.length === 1 ? translateParams("clinical.bodyMap.history.recurringSites", { count: String(persistentZones.length) }) : translateParams("clinical.bodyMap.history.recurringSitesPlural", { count: String(persistentZones.length) })}</span></>
            )}
          </p>
        </div>
      </div>

      <div className="p-4">
        <div className="flex flex-col sm:flex-row gap-6">
          <div className="sm:w-[200px] shrink-0 space-y-2">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold w-fit">
              <button
                onClick={() => setView("front")}
                className={cn(
                  "px-3 py-1.5 transition-colors",
                  view === "front"
                    ? "bg-indigo-600 text-white"
                    : "bg-cc-surface dark:bg-slate-800 text-slate-500 hover:bg-cc-bg",
                )}
              >
                Front
              </button>
              <button
                onClick={() => setView("back")}
                className={cn(
                  "px-3 py-1.5 transition-colors border-l border-slate-200",
                  view === "back"
                    ? "bg-indigo-600 text-white"
                    : "bg-cc-surface dark:bg-slate-800 text-slate-500 hover:bg-cc-bg",
                )}
              >
                Back
              </button>
            </div>

            <BodyMap
              view={view}
              markers={compositeMarkers}
              selectedZone={null}
              readOnly
              bodyType={bodyType}
              markerCounts={zoneCountMap}
              className="w-full"
            />

            <div className="flex items-center gap-2 flex-wrap pt-1">
              {Object.entries(MARKER_COLORS).map(([key, cfg]) => (
                <span key={key} className="flex items-center gap-1 text-[9px] font-medium text-slate-500">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: cfg.hex }} />
                  {getMarkerColorLabel(key as any, translate)}
                </span>
              ))}
              <span className="flex items-center gap-1 text-[9px] font-medium text-slate-500">
                <span className="inline-flex items-center justify-center h-3 w-3 rounded-full bg-slate-800 text-white text-[6px] font-bold">N</span>
                recurrence
              </span>
            </div>
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            {persistentZones.length > 0 && (
              <div className="mb-3 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mb-1.5">{translate("clinical.bodyMap.history.recurringFindings")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {persistentZones.map(([zone, count]) => {
                    const latestMarker = compositeMarkers.find((m) => m.zone === zone);
                    const cfg = latestMarker ? MARKER_COLORS[latestMarker.color] : null;
                    return (
                      <span
                        key={zone}
                        className={cn(
                          "text-[10px] font-medium px-1.5 py-0.5 rounded border flex items-center gap-1",
                          cfg ? `${cfg.bg} ${cfg.text} ${cfg.border}` : "bg-slate-100 text-slate-600 border-slate-200",
                        )}
                      >
                        {cfg && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: cfg.hex }} />}
                        {getZoneLabel(zone, translate)}
                        <span className="font-bold">×{count}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">{translate("clinical.bodyMap.history.sessionTimeline")}</p>

            {sessionsWithMarkers.map((s) => {
              const isExpanded = expandedSession === s.id;
              return (
                <div
                  key={s.id}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden"
                >
                  <button
                    onClick={() => setExpandedSession(isExpanded ? null : s.id)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-cc-bg dark:hover:bg-slate-800/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">
                          {s.session_type || translate("clinical.bodyMap.history.session")}
                        </span>
                        <span className="text-[10px] text-slate-400 shrink-0">{safeFormat(s.session_date)}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        {s.body_markers.map((m) => {
                          const cfg = MARKER_COLORS[m.color];
                          return (
                            <span
                              key={m.zone}
                              className="flex items-center gap-0.5 text-[9px] font-medium text-slate-600"
                            >
                              <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: cfg.hex }} />
                              {getZoneLabel(m.zone, translate)}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[10px] px-1.5 h-5">
                        {s.body_markers.length === 1 ? translateParams("clinical.bodyMap.history.finding", { count: String(s.body_markers.length) }) : translateParams("clinical.bodyMap.history.findings", { count: String(s.body_markers.length) })}
                      </Badge>
                      {isExpanded
                        ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" />
                        : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                      }
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="border-t border-slate-100 dark:border-slate-700 px-3 py-2.5 space-y-2">
                      {s.body_markers.map((m) => {
                        const cfg = MARKER_COLORS[m.color];
                        return (
                          <div key={m.zone} className={cn("flex items-start gap-2 px-2.5 py-2 rounded-lg border", cfg.bg, cfg.border)}>
                            <span className="mt-0.5 h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: cfg.hex }} />
                            <div className="min-w-0 flex-1">
                              <p className={cn("text-[11px] font-semibold", cfg.text)}>
                                {getZoneLabel(m.zone, translate)} · {getMarkerColorLabel(m.color, translate)}
                              </p>
                              {m.note && (
                                <p className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 leading-snug">
                                  {m.note}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      <Link href={`/sessions/${s.id}`}>
                        <Button variant="outline" size="sm" className="w-full h-7 text-xs mt-1">
                          <ExternalLink className="h-3 w-3 mr-1.5" />
                          View full session
                        </Button>
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
