import { useState } from "react";
import { Loader2, UserMinus, Users2 } from "lucide-react";
import { SidePanel } from "@/components/layout/SidePanel";
import { Button } from "@/components/ui/button";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useBranches, useInvalidateBranches } from "@/hooks/useBranches";
import { useReAuth } from "@/hooks/useReAuth";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";
import { jsonFetch } from "@/services/http";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

export type OrgMember = {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  full_name: string;
  email: string;
  /** Office the member works from (198_branches.sql). */
  branch_id?: string | null;
};

const ROLE_LABELS: Record<string, string> = {
  support_worker: "Support worker",
  support_coordinator: "Support coordinator",
  managing_director: "Managing director",
};

// The roles an office can move someone between. A managing director's role
// isn't changed from here.
const CHANGEABLE_ROLES = ["support_worker", "support_coordinator"] as const;

/** Everyone with access to the organisation (office staff as well as support
 * workers): their role, their office, and removing them. This used to live
 * in Settings, under Team; it belongs with the rest of the team. */
export function OrgMembersPanel({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const isMD = user?.role === "managing_director";
  const { toast } = useToast();
  const { requireReAuth, modal: reauthModal } = useReAuth();
  const { branches, byId: branchById, multiBranch } = useBranches();
  const invalidateBranches = useInvalidateBranches();
  const [busyId, setBusyId] = useState<string | null>(null);

  const members = useOrgQuery<OrgMember[]>(["org-members"], {
    queryFn: () => jsonFetch<OrgMember[]>("/api/invitations/members"),
    enabled: open,
  });

  async function changeRole(member: OrgMember, role: string) {
    setBusyId(member.id);
    try {
      const done = await requireReAuth(async () => {
        await jsonFetch(`/api/invitations/members/${member.id}/role`, {
          method: "PATCH",
          body: JSON.stringify({ role }),
        });
        return true;
      });
      await members.refetch();
      if (!done) {
        toast({ title: "The role wasn't changed" });
        return;
      }
      toast({ title: "Role updated", description: `${member.full_name || member.email} is now a ${(ROLE_LABELS[role] ?? role).toLowerCase()}.` });
    } catch {
      toast({ title: "Couldn't update the role", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function changeBranch(member: OrgMember, branchId: string) {
    if (!branchId) return;
    setBusyId(member.id);
    try {
      const res = await apiFetch(`/api/branches/members/${member.user_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_id: branchId }),
      });
      if (!res.ok) throw new Error();
      await members.refetch();
      invalidateBranches();
      toast({
        title: "Office updated",
        description: `${branchById.get(branchId)?.name ?? "Office"}. Their shifts and pay now follow that office's time.`,
      });
    } catch {
      toast({ title: "Couldn't update the office", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(member: OrgMember) {
    const name = member.full_name || member.email || "this person";
    if (!window.confirm(`Remove ${name} from your organisation? They'll lose access straight away.`)) return;
    setBusyId(member.id);
    try {
      const done = await requireReAuth(async () => {
        await jsonFetch(`/api/invitations/members/${member.id}`, { method: "DELETE" });
        return true;
      });
      await members.refetch();
      if (!done) {
        toast({ title: `${name} wasn't removed` });
        return;
      }
      toast({ title: `${name} has been removed` });
    } catch {
      toast({ title: "Couldn't remove them", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  const list = members.data ?? [];

  return (
    <>
      {reauthModal}
      <SidePanel
        open={open}
        onOpenChange={onOpenChange}
        icon={Users2}
        title="Members and roles"
        description="Everyone with access to your organisation, including office staff. Change someone's role or office, or remove their access."
        wide
        footer={
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        }
      >
        {members.isLoading ? (
          <p className="flex items-center gap-2 py-4 text-[13px]" style={{ color: MUTED }}>
            <Loader2 className="h-4 w-4 animate-spin" /> Loading members...
          </p>
        ) : members.isError ? (
          <p className="py-4 text-[13px]" style={{ color: MUTED }}>
            Couldn't load your members.{" "}
            <button type="button" className="font-semibold underline" style={{ color: "var(--cc-plum)" }} onClick={() => void members.refetch()}>
              Try again
            </button>
          </p>
        ) : list.length === 0 ? (
          <p className="py-4 text-[13px]" style={{ color: MUTED }}>
            No members yet. Invite your first staff member from the Team page.
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: BORDER }}>
            {list.map((m) => {
              const isSelf = m.user_id === user?.id;
              const busy = busyId === m.id;
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" style={{ borderColor: BORDER }}>
                  <div className="min-w-[160px] flex-1">
                    <p className="truncate text-[13px] font-semibold" style={{ color: TEXT }}>
                      {m.full_name || "(No name)"}
                      {isSelf && <span className="ml-1.5 font-normal" style={{ color: MUTED }}>(you)</span>}
                    </p>
                    <p className="truncate text-[12px]" style={{ color: MUTED }}>
                      {m.email}
                      {m.joined_at &&
                        ` · Joined ${new Date(m.joined_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`}
                    </p>
                  </div>

                  {isSelf || !CHANGEABLE_ROLES.includes(m.role as (typeof CHANGEABLE_ROLES)[number]) ? (
                    <span className="text-[12.5px]" style={{ color: TEXT }}>
                      {ROLE_LABELS[m.role] ?? m.role}
                    </span>
                  ) : (
                    <select
                      aria-label={`Role for ${m.full_name || m.email}`}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => void changeRole(m, e.target.value)}
                      className="h-8 rounded-lg border bg-transparent px-2 text-[12.5px] outline-none focus-visible:ring-2"
                      style={{ borderColor: BORDER, color: TEXT, ["--tw-ring-color" as string]: "var(--cc-plum)" }}
                    >
                      {CHANGEABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  )}

                  {multiBranch &&
                    (isMD ? (
                      <select
                        aria-label={`Office for ${m.full_name || m.email}`}
                        value={m.branch_id ?? ""}
                        disabled={busy}
                        onChange={(e) => void changeBranch(m, e.target.value)}
                        className="h-8 rounded-lg border bg-transparent px-2 text-[12.5px] outline-none focus-visible:ring-2"
                        style={{ borderColor: BORDER, color: TEXT, ["--tw-ring-color" as string]: "var(--cc-plum)" }}
                      >
                        {!m.branch_id && <option value="">No office</option>}
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[12.5px]" style={{ color: MUTED }}>
                        {branchById.get(m.branch_id ?? "")?.name ?? ""}
                      </span>
                    ))}

                  {!isSelf && (
                    <button
                      type="button"
                      onClick={() => void remove(m)}
                      disabled={busy}
                      aria-label={`Remove ${m.full_name || m.email}`}
                      title="Remove from the organisation"
                      className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--cc-soft)] disabled:opacity-40"
                      style={{ color: MUTED }}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserMinus size={15} />}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </SidePanel>
    </>
  );
}
