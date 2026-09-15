import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock, Plus, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateTimePicker } from "@/components/ui/date-time-picker";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  createAccessGrant,
  getGrantableCapabilities,
  listAccessGrants,
  revokeAccessGrant,
  type AccessGrant,
  type AccessGrantStatus,
} from "@/services/accessGrantService";
import { getCoordinatorWorkerStats } from "@/services/coordinatorService";

const STATUS_STYLES: Record<AccessGrantStatus, { bg: string; color: string; label: string }> = {
  active: { bg: "var(--cc-status-success-bg)", color: "var(--cc-status-success)", label: "Active" },
  expired: { bg: "var(--cc-soft)", color: "var(--cc-muted)", label: "Expired" },
  revoked: { bg: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)", label: "Revoked" },
};

const DURATION_PRESETS = [
  { label: "1 day", hours: 24 },
  { label: "3 days", hours: 24 * 3 },
  { label: "7 days", hours: 24 * 7 },
  { label: "30 days", hours: 24 * 30 },
];

function fmt(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-AU", {
      day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function StatusBadge({ status }: { status: AccessGrantStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold"
      style={{ background: s.bg, color: s.color }}
    >
      {s.label}
    </span>
  );
}

function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function CreateGrantSheet({
  open,
  onOpenChange,
  capabilities,
  coordinators,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  capabilities: { capability: string; label: string }[];
  coordinators: { id: string; full_name: string }[];
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [coordinatorId, setCoordinatorId] = useState("");
  const [capability, setCapability] = useState("");
  const [expiresAt, setExpiresAt] = useState(() => toLocalInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000)));
  const [reason, setReason] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      createAccessGrant({
        granted_to_user_id: coordinatorId,
        capability,
        expires_at: new Date(expiresAt).toISOString(),
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      toast({ title: "Access granted" });
      setCoordinatorId("");
      setCapability("");
      setReason("");
      onCreated();
      onOpenChange(false);
    },
    onError: (err) => {
      toast({
        title: "Could not create the grant",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const canSubmit = Boolean(coordinatorId && capability && expiresAt);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-6 sm:max-w-md" style={{ background: "var(--cc-bg)" }}>
        <SheetHeader>
          <SheetTitle>Grant temporary access</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-5">
          <div>
            <Label htmlFor="grant-coordinator">Coordinator</Label>
            <Select value={coordinatorId} onValueChange={setCoordinatorId}>
              <SelectTrigger id="grant-coordinator" className="mt-1">
                <SelectValue placeholder="Choose a coordinator" />
              </SelectTrigger>
              <SelectContent>
                {coordinators.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="grant-capability">Capability</Label>
            <Select value={capability} onValueChange={setCapability}>
              <SelectTrigger id="grant-capability" className="mt-1">
                <SelectValue placeholder="Choose one capability" />
              </SelectTrigger>
              <SelectContent>
                {capabilities.map((c) => (
                  <SelectItem key={c.capability} value={c.capability}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1.5 text-xs" style={{ color: "var(--cc-muted)" }}>
              One grant, one capability. Create another grant for anything else they need.
            </p>
          </div>

          <div>
            <Label>Expires</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {DURATION_PRESETS.map((p) => (
                <Button
                  key={p.label}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setExpiresAt(toLocalInputValue(new Date(Date.now() + p.hours * 60 * 60 * 1000)))}
                >
                  {p.label}
                </Button>
              ))}
            </div>
            <DateTimePicker value={expiresAt} onChange={setExpiresAt} className="mt-2" />
          </div>

          <div>
            <Label htmlFor="grant-reason">Reason (optional)</Label>
            <Textarea
              id="grant-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1"
              rows={3}
              placeholder="e.g. Covering staff onboarding while I'm on leave"
            />
          </div>
        </div>
        <SheetFooter className="mt-6">
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit || createMutation.isPending}
            className="w-full"
          >
            {createMutation.isPending ? "Granting…" : "Grant access"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function DelegatedAccessSection() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);

  const grantsQuery = useOrgQuery(["access-grants", "org"], {
    queryFn: listAccessGrants,
  });
  const capabilitiesQuery = useQuery({
    queryKey: ["access-grants", "capabilities"],
    queryFn: getGrantableCapabilities,
    staleTime: Infinity,
  });
  const coordinatorsQuery = useOrgQuery(["access-grants", "coordinators"], {
    queryFn: () => getCoordinatorWorkerStats().then((list) => list.filter((w) => w.role === "support_coordinator")),
  });

  const revokeMutation = useMutation({
    mutationFn: (grantId: string) => revokeAccessGrant(grantId),
    onSuccess: () => {
      toast({ title: "Access revoked" });
      void qc.invalidateQueries({ queryKey: ["access-grants"] });
    },
    onError: (err) => {
      toast({
        title: "Could not revoke this grant",
        description: err instanceof Error ? err.message : "Try again.",
        variant: "destructive",
      });
    },
  });

  const grants = grantsQuery.data ?? [];
  const capabilities = capabilitiesQuery.data ?? [];
  const coordinators = coordinatorsQuery.data ?? [];

  const capabilityLabel = useMemo(() => {
    const map = new Map(capabilities.map((c) => [c.capability, c.label]));
    return (capability: string) => map.get(capability) ?? capability;
  }, [capabilities]);
  const coordinatorName = useMemo(() => {
    const map = new Map(coordinators.map((c) => [c.id, c.full_name]));
    return (id: string) => map.get(id) ?? "Former team member";
  }, [coordinators]);

  const sorted = [...grants].sort((a, b) => {
    // Active first, then most recently granted.
    const rank = (g: AccessGrant) => (g.status === "active" ? 0 : 1);
    const rankDiff = rank(a) - rank(b);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.granted_at).getTime() - new Date(a.granted_at).getTime();
  });

  return (
    <section className="min-w-0 space-y-5" aria-labelledby="delegated-access-heading">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="delegated-access-heading" className="text-2xl font-semibold tracking-tight text-cc-text">
            Delegated Access
          </h2>
          <p className="mt-1 text-sm text-cc-muted">
            Hand a coordinator temporary access to one MD-only capability, without making them MD.
            It disappears on its own when it expires, or the moment you revoke it.
          </p>
        </div>
        <Button onClick={() => setSheetOpen(true)} className="min-h-11">
          <Plus size={16} /> Grant access
        </Button>
      </header>

      {grantsQuery.isLoading ? (
        <div role="status" className="rounded-xl border border-cc-border bg-cc-card p-6">
          <p className="text-sm text-cc-muted">Loading grants…</p>
          <div className="mt-4 h-16 animate-pulse rounded-lg bg-cc-soft" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border border-dashed border-cc-border bg-cc-card p-8 text-center">
          <ShieldCheck className="mx-auto h-8 w-8" style={{ color: "var(--cc-muted)" }} />
          <p className="mt-3 text-sm font-medium text-cc-text">No delegated access yet</p>
          <p className="mt-1 text-sm text-cc-muted">
            Grant a coordinator temporary access to an MD-only capability above.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-cc-border bg-cc-card">
          <div className="divide-y divide-cc-border">
            {sorted.map((grant) => (
              <div key={grant.id} className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-cc-text">{coordinatorName(grant.granted_to_user_id)}</p>
                    <StatusBadge status={grant.status} />
                  </div>
                  <p className="mt-1 text-sm text-cc-text">{capabilityLabel(grant.capability)}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-cc-muted">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} /> Granted {fmt(grant.granted_at)}
                    </span>
                    <span>
                      {grant.status === "revoked" ? `Revoked ${fmt(grant.revoked_at)}` : `Expires ${fmt(grant.expires_at)}`}
                    </span>
                  </div>
                  {grant.reason && (
                    <p className="mt-1.5 text-xs italic text-cc-muted">&ldquo;{grant.reason}&rdquo;</p>
                  )}
                </div>
                {grant.status === "active" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => revokeMutation.mutate(grant.id)}
                    disabled={revokeMutation.isPending}
                  >
                    <X size={14} className="mr-1" /> Revoke
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <CreateGrantSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        capabilities={capabilities}
        coordinators={coordinators}
        onCreated={() => qc.invalidateQueries({ queryKey: ["access-grants"] })}
      />
    </section>
  );
}
