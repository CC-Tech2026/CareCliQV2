import { useState, useRef } from "react";
import { Check, Loader2, X, Upload, AlertCircle } from "lucide-react";
import { loadNdisPriceSchedule } from "@/services/ndisService";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { Button } from "@/components/ui/button";

// Design tokens aligned with billing.tsx
const PLUM   = "#5533CC";
const CORAL  = "#F03060";
const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";

interface ScheduleLoaderProps {
  onClose: () => void;
  onSuccess?: () => void;
}

export function NdisScheduleLoader({ onClose, onSuccess }: ScheduleLoaderProps) {
  const { toast } = useToast();
  const { requireReAuth } = useReAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [jsonContent, setJsonContent] = useState("");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        // Validate JSON
        JSON.parse(content);
        setJsonContent(content);
        setValidationErrors([]);
      } catch (err) {
        setValidationErrors([(err as Error).message]);
        setJsonContent("");
      }
    };
    reader.readAsText(file);
  }

  async function handleLoadSchedule() {
    if (!jsonContent) {
      toast({ title: "File required", description: "Select a valid NDIS JSON file", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await requireReAuth(() => loadNdisPriceSchedule(jsonContent));
      if (!res) return;

      toast({ 
        title: "Schedule loaded", 
        description: `${res.items_loaded} items from FY ${res.financial_year}`,
      });
      
      // Show any validation errors
      if (res.validation_errors.length > 0) {
        toast({
          title: "Load completed with warnings",
          description: `${res.validation_errors.length} items had issues (see below)`,
          variant: "destructive",
        });
      }

      setValidationErrors(res.validation_errors);
      
      // Success callback
      if (onSuccess) onSuccess();
      
      // Auto-close on success (after short delay for user to see message)
      setTimeout(onClose, 2000);
    } catch (err) {
      toast({ title: "Load failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl mx-4 rounded-lg bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 px-6 py-4 border-b flex items-center justify-between gap-4" style={{ borderColor: BORDER, background: "white" }}>
          <h2 className="text-lg font-black" style={{ color: TEXT }}>Load NDIS Price Schedule</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition">
            <X className="w-5 h-5" style={{ color: MUTED }} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Instructions */}
          <div className="rounded-lg p-4 border" style={{ background: "#FEF3C7", borderColor: "#FDE68A" }}>
            <div className="flex gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: "#D97706" }} />
              <div className="text-sm" style={{ color: "#92400E" }}>
                <p className="font-bold">Loading a new schedule will:</p>
                <ul className="mt-2 list-disc list-inside space-y-1">
                  <li>Create a new schedule record for the financial year</li>
                  <li>Supersede any previous schedule for that year</li>
                  <li>Preserve all manual price edits from previous years</li>
                  <li>Apply a standardized set of items for your organization</li>
                </ul>
              </div>
            </div>
          </div>

          {/* File Upload */}
          <div>
            <label className="text-xs font-bold" style={{ color: MUTED }}>NDIS Support Catalogue JSON</label>
            <div className="mt-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".json"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-8 transition hover:bg-gray-50"
                style={{ borderColor: BORDER, color: MUTED }}
              >
                <Upload className="w-5 h-5" />
                <div className="text-left">
                  <p className="font-bold text-sm" style={{ color: TEXT }}>
                    {fileName || "Choose NDIS JSON file"}
                  </p>
                  <p className="text-xs mt-0.5">
                    {fileName ? "Click to replace" : "Click to select file"}
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* File Preview */}
          {jsonContent && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold" style={{ color: MUTED }}>File Preview</p>
                <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ background: "#DBEAFE", color: "#1E40AF" }}>
                  ✓ Valid JSON
                </span>
              </div>
              <div 
                className="rounded-lg px-4 py-3 text-xs font-mono overflow-x-auto max-h-40 border"
                style={{ background: SOFT, borderColor: BORDER, color: TEXT }}
              >
                {JSON.stringify(JSON.parse(jsonContent), null, 2).split("\n").slice(0, 10).join("\n")}
                {JSON.stringify(JSON.parse(jsonContent), null, 2).split("\n").length > 10 && (
                  <p style={{ color: MUTED }} className="mt-2">... ({JSON.stringify(JSON.parse(jsonContent), null, 2).split("\n").length} lines total)</p>
                )}
              </div>
            </div>
          )}

          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className="rounded-lg p-4 border bg-red-50" style={{ borderColor: "#FCA5A5" }}>
              <p className="text-xs font-bold" style={{ color: "#991B1B" }}>
                ⚠ {validationErrors.length} Validation Issues
              </p>
              <div className="mt-2 text-xs space-y-1 max-h-32 overflow-y-auto" style={{ color: "#7F1D1D" }}>
                {validationErrors.map((err, idx) => (
                  <p key={idx}>• {err}</p>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t" style={{ borderColor: BORDER }}>
            <button
              onClick={onClose}
              className="flex-1 rounded-full px-4 py-2.5 text-sm font-bold border transition hover:bg-gray-50"
              style={{ borderColor: BORDER, color: MUTED }}
            >
              Cancel
            </button>
            <button
              onClick={handleLoadSchedule}
              disabled={loading || !jsonContent}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ background: PLUM }}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading...
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Load Schedule
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
