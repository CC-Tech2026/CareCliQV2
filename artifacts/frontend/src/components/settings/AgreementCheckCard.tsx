import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";

export type AgreementCheckLevel = "warn" | "reason" | "strict";

const KEY = ["settings", "agreement-checks"] as const;

const LEVELS: Array<{ value: AgreementCheckLevel; title: string; detail: string }> = [
  {
    value: "warn",
    title: "Warn only",
    detail:
      "Verification shows anything outside the service agreement, but shifts can be billed without a reason. For while existing participants' agreements are being entered.",
  },
  {
    value: "reason",
    title: "Reason needed",
    detail:
      "Billing anything outside the agreement (no agreement, a support that isn't on it, outside its dates, unsigned, or over its hours) needs a reason, saved with the verification.",
  },
  {
    value: "strict",
    title: "Strict",
    detail:
      "As above, and no shift can be rostered on a day that no signed agreement with supports covers.",
  },
];

/** How strictly shifts are held to each participant's service agreement.
 * The managing director chooses; everyone else sees it read-only. */
export function AgreementCheckCard() {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = user?.role === "managing_director";
  const query = useOrgQuery<{ level: AgreementCheckLevel }>([...KEY], {
    queryFn: async () => {
      const res = await apiFetch("/api/settings/agreement-checks");
      if (!res.ok) throw new Error("Couldn't load this setting.");
      return res.json();
    },
  });
  const saved = query.data?.level ?? "reason";
  const [level, setLevel] = useState<AgreementCheckLevel>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setLevel(saved), [saved]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await apiFetch("/api/settings/agreement-checks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === "string" ? body.detail : "Couldn't save.");
      }
      queryClient.setQueryData([user?.organizationId ?? "__no_org__", ...KEY], await res.json());
      toast({ title: "Saved", description: `${LEVELS.find((l) => l.value === level)?.title} from now on.` });
    } catch (err) {
      toast({ title: "Not saved", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (query.isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-cc-muted" /></div>;
  }

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Shifts outside the service agreement" className="space-y-2">
        {LEVELS.map((option) => (
          <label
            key={option.value}
            className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
            style={{
              borderColor: level === option.value ? "var(--cc-plum)" : "var(--cc-border)",
              opacity: !canEdit && level !== option.value ? 0.6 : 1,
            }}
          >
            <input
              type="radio"
              name="agreement-check-level"
              value={option.value}
              checked={level === option.value}
              disabled={!canEdit || saving}
              onChange={() => setLevel(option.value)}
              className="mt-1 h-4 w-4 accent-[var(--cc-plum)]"
            />
            <span>
              <span className="block text-[13px] font-semibold" style={{ color: "var(--cc-text)" }}>
                {option.title}
                {option.value === "reason" && <span className="font-normal" style={{ color: "var(--cc-muted)" }}> (default)</span>}
              </span>
              <span className="block text-[12px]" style={{ color: "var(--cc-muted)" }}>{option.detail}</span>
            </span>
          </label>
        ))}
      </div>
      {!canEdit && (
        <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>Only the managing director can change this.</p>
      )}
      {canEdit && level !== saved && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="rounded-lg" onClick={() => setLevel(saved)} disabled={saving}>Cancel</Button>
          <Button className="rounded-lg" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </div>
      )}
    </div>
  );
}
