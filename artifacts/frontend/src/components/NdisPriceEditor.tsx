import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { editNdisItemPrice, getNdisItemHistory, type NdisPriceItem } from "@/services/ndisService";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAccessibility } from "@/contexts/AccessibilityContext";

// Design tokens aligned with billing.tsx
const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

interface PriceEditorProps {
  onClose: () => void;
}

export function NdisPriceEditor({ onClose }: PriceEditorProps) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const { requireReAuth } = useReAuth();
  
  const [itemCode, setItemCode] = useState("");
  const [priceNational, setPriceNational] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().split("T")[0]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<NdisPriceItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  async function loadHistory() {
    if (!itemCode.trim()) {
      toast({ title: translate("coordinator.ndis.price.itemCodeRequired"), description: translate("coordinator.ndis.price.enterItemCode"), variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const h = await getNdisItemHistory(itemCode, 5);
      setHistory(h);
      setShowHistory(true);
    } catch (err) {
      toast({ title: translate("coordinator.ndis.price.historyNotFound"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleSavePrice() {
    if (!itemCode.trim()) {
      toast({ title: translate("coordinator.ndis.price.itemCodeRequired"), description: translate("coordinator.ndis.price.enterNdisCode"), variant: "destructive" });
      return;
    }
    if (!priceNational || Number(priceNational) <= 0) {
      toast({ title: translate("coordinator.ndis.price.validPriceRequired"), description: translate("coordinator.ndis.price.priceGreaterThanZero"), variant: "destructive" });
      return;
    }
    if (!effectiveDate) {
      toast({ title: translate("coordinator.ndis.price.effectiveDateRequired"), description: translate("coordinator.ndis.price.selectEffectiveDate"), variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: translate("coordinator.ndis.price.reasonRequired"), description: translate("coordinator.ndis.price.provideReason"), variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const res = await requireReAuth(() => editNdisItemPrice(
        itemCode,
        Number(priceNational) * 100, // Convert to cents
        effectiveDate,
        reason,
        null, // price_remote
        null, // price_very_remote
      ));
      
      if (!res) return;
      
      toast({ 
        title: translate("coordinator.ndis.price.updated"), 
        description: translateParams("coordinator.ndis.price.updatedDesc", { code: itemCode, date: effectiveDate }),
      });
      
      // Reset form
      setItemCode("");
      setPriceNational("");
      setEffectiveDate(new Date().toISOString().split("T")[0]);
      setReason("");
      setHistory([]);
      setShowHistory(false);
    } catch (err) {
      toast({ title: translate("coordinator.ndis.price.updateFailed"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl mx-4 rounded-lg bg-white shadow-xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 px-6 py-4 border-b flex items-center justify-between gap-4" style={{ borderColor: BORDER, background: "var(--cc-bg)" }}>
          <h2 className="text-lg font-black" style={{ color: TEXT }}>{translate("coordinator.ndis.price.title")}</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg transition">
            <X className="w-5 h-5" style={{ color: MUTED }} />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Item Code Input */}
          <div>
            <Label className="text-xs font-bold" style={{ color: MUTED }}>{translate("coordinator.ndis.price.itemCode")}</Label>
            <div className="flex gap-2 mt-1.5">
              <Input 
                value={itemCode}
                onChange={e => setItemCode(e.target.value.toUpperCase())}
                placeholder={translate("coordinator.ndis.price.itemCodePlaceholder")}
                className="mt-0 rounded-lg flex-1"
                style={{ borderColor: BORDER }}
              />
              <button
                onClick={loadHistory}
                disabled={loading || !itemCode.trim()}
                className="px-4 py-2 rounded-full text-xs font-bold text-white transition hover:opacity-90 disabled:opacity-50"
                style={{ background: PLUM }}
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" />  : translate("coordinator.ndis.price.viewHistory")}
              </button>
            </div>
          </div>

          {/* Price Input */}
          <div>
            <Label className="text-xs font-bold" style={{ color: MUTED }}>{translate("coordinator.ndis.price.newPrice")}</Label>
            <Input 
              type="number"
              min={0}
              step={0.01}
              value={priceNational}
              onChange={e => setPriceNational(e.target.value)}
              placeholder="e.g. 75.50"
              className="mt-1.5 rounded-lg"
              style={{ borderColor: BORDER }}
            />
          </div>

          {/* Effective Date */}
          <div>
            <Label className="text-xs font-bold" style={{ color: MUTED }}>{translate("coordinator.ndis.price.effectiveDate")}</Label>
            <Input 
              type="date"
              value={effectiveDate}
              onChange={e => setEffectiveDate(e.target.value)}
              className="mt-1.5 rounded-lg"
              style={{ borderColor: BORDER }}
            />
            <p className="mt-1.5 text-[11px] font-medium" style={{ color: MUTED }}>
              · Prices take effect on this date (or immediately if today or earlier)
            </p>
          </div>

          {/* Reason */}
          <div>
            <Label className="text-xs font-bold" style={{ color: MUTED }}>{translate("coordinator.ndis.price.reason")} <span className="font-medium">{translate("coordinator.ndis.price.auditTrail")}</span></Label>
            <textarea 
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="e.g., Annual adjustment per NDIS guidance, market review, etc."
              rows={3}
              className="mt-1.5 w-full rounded-lg border px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 resize-none"
              style={{ borderColor: BORDER, "--tw-ring-color": `${PLUM}/20` } as React.CSSProperties}
            />
          </div>

          {/* History Panel */}
          {showHistory && history.length > 0 && (
            <div className="rounded-lg p-4 border" style={{ background: SOFT, borderColor: BORDER }}>
              <p className="text-xs font-bold mb-3" style={{ color: MUTED }}>{translate("coordinator.ndis.price.recentVersions")}</p>
              <div className="divide-y space-y-2" style={{ borderColor: "#EEEAFB" }}>
                {history.map((item, idx) => (
                  <div key={idx} className="py-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold" style={{ color: TEXT }}>
                        ${(item.price_national / 100).toFixed(2)}/h
                      </span>
                      <span style={{ color: MUTED }}>
                        {item.valid_from} {item.valid_to ? `→ ${item.valid_to}` : translate("coordinator.ndis.price.current")}
                      </span>
                    </div>
                    {item.edited_by && (
                      <p style={{ color: MUTED }} className="mt-0.5 text-[10px]">
                        {item.edited_by} on {item.edited_at}
                      </p>
                    )}
                  </div>
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
              onClick={handleSavePrice}
              disabled={loading || !itemCode.trim() || !priceNational || !reason.trim()}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
              style={{ background: CORAL }}
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {translate("coordinator.ndis.price.updating")}
                </>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  {translate("coordinator.ndis.price.saveChange")}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
