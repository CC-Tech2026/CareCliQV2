import { AlertTriangle, TrendingDown, DollarSign, BarChart3, ChevronRight } from "lucide-react";
import { useLocation } from "wouter";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

export type NeedAttentionItem = {
  participant_id: string;
  participant_name: string;
  status: 'blocked' | 'stalled' | 'low_compliance' | 'budget_concern';
  reason: string;
  severity: 'critical' | 'warning' | 'info';
  context?: string; // e.g. "2 blocked goals" or "Compliance 45%"
};

interface NeedAttentionWidgetProps {
  items: NeedAttentionItem[];
  isLoading?: boolean;
}

function getStatusMeta(status: NeedAttentionItem['status']) {
  const map: Record<NeedAttentionItem['status'], { icon: React.ComponentType<any>; label: string; color: string; bg: string }> = {
    'blocked': { icon: AlertTriangle, label: 'Blocked', color: '#DC2626', bg: '#FEF2F2' },
    'stalled': { icon: TrendingDown, label: 'Stalled', color: '#D97706', bg: '#FFFBEB' },
    'low_compliance': { icon: BarChart3, label: 'Low Compliance', color: '#E8457A', bg: '#F5F3FF' },
    'budget_concern': { icon: DollarSign, label: 'Budget Issue', color: '#F59E0B', bg: '#FEF3C7' },
  };
  return map[status];
}

export function NeedAttentionWidget({ items = [], isLoading = false }: NeedAttentionWidgetProps) {
  const [, navigate] = useLocation();
  const criticalCount = items.filter(i => i.severity === 'critical').length;
  const warningCount = items.filter(i => i.severity === 'warning').length;

  const handleViewParticipant = (participantId: string) => {
    navigate(`/patients/${participantId}`);
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl p-5 space-y-3 bg-white" style={{ border: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} style={{ color: CORAL }} />
          <p className="font-black text-[14px]" style={{ color: TEXT }}>Need Attention</p>
        </div>
        <div className="text-sm" style={{ color: MUTED }}>Loading…</div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-2xl p-5 space-y-3 bg-white" style={{ border: `1px solid ${BORDER}` }}>
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} style={{ color: CORAL }} />
          <p className="font-black text-[14px]" style={{ color: TEXT }}>Need Attention</p>
        </div>
        <p className="text-[13px]" style={{ color: MUTED }}>All participants are doing well! ✨</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl p-5 space-y-4 bg-white" style={{ border: `1px solid ${BORDER}` }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} style={{ color: CORAL }} />
          <p className="font-black text-[14px]" style={{ color: TEXT }}>Need Attention</p>
        </div>
        <span className="text-[12px] font-bold px-2 py-0.5 rounded-full" style={{ background: SOFT, color: PLUM }}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      {/* Summary badges */}
      {(criticalCount > 0 || warningCount > 0) && (
        <div className="flex gap-2 flex-wrap">
          {criticalCount > 0 && (
            <span className="text-[10px] font-bold px-2 py-1 rounded-full text-white" style={{ background: '#DC2626' }}>
              🔴 {criticalCount} Critical
            </span>
          )}
          {warningCount > 0 && (
            <span className="text-[10px] font-bold px-2 py-1 rounded-full text-white" style={{ background: '#F59E0B' }}>
              🟡 {warningCount} Warning
            </span>
          )}
        </div>
      )}

      {/* Items list */}
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {items.slice(0, 8).map((item) => {
          const meta = getStatusMeta(item.status);
          const Icon = meta.icon;
          
          return (
            <button
              key={`${item.participant_id}-${item.status}`}
              onClick={() => handleViewParticipant(item.participant_id)}
              className="w-full flex items-start justify-between gap-2 rounded-xl p-3 text-left transition-colors hover:bg-gray-50"
              style={{ border: `1px solid ${BORDER}` }}
            >
              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                <Icon size={14} style={{ color: meta.color, marginTop: '2px', flexShrink: 0 }} />
                <div className="min-w-0">
                  <p className="font-black text-[13px]" style={{ color: TEXT }}>
                    {item.participant_name}
                  </p>
                  <p className="text-[11px] line-clamp-1" style={{ color: meta.color }}>
                    {meta.label}: {item.reason}
                  </p>
                  {item.context && (
                    <p className="text-[10px]" style={{ color: MUTED }}>
                      {item.context}
                    </p>
                  )}
                </div>
              </div>
              <ChevronRight size={14} className="shrink-0 mt-1" style={{ color: MUTED }} />
            </button>
          );
        })}
      </div>

      {items.length > 8 && (
        <div className="pt-2 border-t text-center" style={{ borderColor: BORDER }}>
          <p className="text-[11px]" style={{ color: MUTED }}>
            +{items.length - 8} more {items.length - 8 === 1 ? 'item' : 'items'}
          </p>
        </div>
      )}
    </div>
  );
}
