import { useState } from "react";
import { Loader2, MapPin, Pencil, Plus, Trash2, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api-fetch";
import { zoneAbbreviation } from "@/lib/datetime";
import { useBranches, useInvalidateBranches, type Branch } from "@/hooks/useBranches";

/**
 * Settings → Branches (managing director).
 *
 * A branch is an office in one state. Its state sets the timezone that
 * every staff member and participant assigned to it runs on — shift
 * times, penalty rates, billing periods, "today". Head office is created
 * automatically; extra branches are added here.
 */

const STATE_NAMES: Record<string, string> = {
  SA: "South Australia",
  NSW: "New South Wales",
  VIC: "Victoria",
  QLD: "Queensland",
  WA: "Western Australia",
  TAS: "Tasmania",
  NT: "Northern Territory",
  ACT: "Australian Capital Territory",
};

export function BranchStateSelect({
  value,
  onChange,
  states,
  id,
  disabled,
}: {
  value: string;
  onChange: (state: string) => void;
  states: { code: string; timezone: string }[];
  id?: string;
  disabled?: boolean;
}) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-lg border bg-white px-3 text-sm"
      style={{ borderColor: "var(--cc-border)", color: "var(--cc-text)" }}
    >
      <option value="">Select state…</option>
      {states.map((s) => (
        <option key={s.code} value={s.code}>
          {STATE_NAMES[s.code] ?? s.code} ({s.code}) · {zoneAbbreviation(new Date(), s.timezone)}
        </option>
      ))}
    </select>
  );
}

async function jsonOrThrow(res: Response) {
  if (res.ok) return res.status === 204 ? null : res.json();
  let detail = `Request failed (${res.status})`;
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") detail = body.detail;
  } catch {
    /* ignore */
  }
  throw new Error(detail);
}

export function BranchesSection() {
  const { toast } = useToast();
  const { branches, states, isLoading } = useBranches();
  const invalidate = useInvalidateBranches();

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newState, setNewState] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editState, setEditState] = useState("");

  const fail = (e: unknown) =>
    toast({ variant: "destructive", title: "Could not save branch", description: e instanceof Error ? e.message : undefined });

  const create = async () => {
    if (!newName.trim() || !newState) return;
    setSaving(true);
    try {
      await jsonOrThrow(
        await apiFetch("/api/branches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName.trim(), state: newState }),
        }),
      );
      toast({ title: "Branch added" });
      setNewName("");
      setNewState("");
      setAdding(false);
      invalidate();
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (b: Branch) => {
    setEditingId(b.id);
    setEditName(b.name);
    setEditState(b.state);
  };

  const saveEdit = async (b: Branch) => {
    setSaving(true);
    try {
      await jsonOrThrow(
        await apiFetch(`/api/branches/${b.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: editName.trim(), state: editState }),
        }),
      );
      toast({
        title: "Branch updated",
        description:
          editState !== b.state
            ? "Everyone in this branch now runs on the new state's time. Do this at a pay-period boundary."
            : undefined,
      });
      setEditingId(null);
      invalidate();
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (b: Branch) => {
    if (!confirm(`Delete the ${b.name} branch? It must have no staff or participants.`)) return;
    try {
      await jsonOrThrow(await apiFetch(`/api/branches/${b.id}`, { method: "DELETE" }));
      toast({ title: "Branch deleted" });
      invalidate();
    } catch (e) {
      fail(e);
    }
  };

  return (
    <div className="space-y-6">
      <div className="pb-1">
        <h2 className="text-[22px] font-black tracking-tight" style={{ color: "var(--cc-text)" }}>Branches</h2>
        <p className="text-[13px] mt-1 leading-relaxed" style={{ color: "var(--cc-muted)" }}>
          One office per state. A branch's state sets the clock for everyone assigned to it — shift times, penalty
          rates, billing periods and "today". Assign staff under Team and participants on their profile.
        </p>
      </div>

      <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid var(--cc-border)" }}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[15px] font-bold" style={{ color: "var(--cc-text)" }}>Offices</p>
            {!adding && (
              <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4 mr-1" /> Add branch
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-[13px] py-4" style={{ color: "var(--cc-muted)" }}>
              <Loader2 className="h-4 w-4 animate-spin" /> Loading branches…
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--cc-border)" }}>
              {branches.map((b) => {
                const editing = editingId === b.id;
                return (
                  <div key={b.id} className="flex items-center gap-3 py-3">
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: "var(--cc-plum-soft)", color: "var(--cc-plum)" }}
                    >
                      <MapPin size={16} />
                    </div>
                    {editing ? (
                      <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Branch name" />
                        <BranchStateSelect value={editState} onChange={setEditState} states={states} />
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold truncate" style={{ color: "var(--cc-text)" }}>
                          {b.name}
                          {b.is_head_office && (
                            <span
                              className="ml-2 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                              style={{ background: "var(--cc-plum-soft)", color: "var(--cc-plum)" }}
                            >
                              Head office
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] truncate" style={{ color: "var(--cc-muted)" }}>
                          {STATE_NAMES[b.state] ?? b.state} · {b.timezone} ({zoneAbbreviation(new Date(), b.timezone)}) ·{" "}
                          {b.member_count ?? 0} staff · {b.participant_count ?? 0} participants
                        </p>
                      </div>
                    )}
                    {editing ? (
                      <>
                        <button
                          onClick={() => saveEdit(b)}
                          disabled={saving || !editName.trim() || !editState}
                          title="Save"
                          className="p-1.5 rounded-lg hover:bg-green-50"
                          style={{ color: "var(--cc-plum)" }}
                        >
                          <Check size={14} />
                        </button>
                        <button onClick={() => setEditingId(null)} title="Cancel" className="p-1.5 rounded-lg hover:bg-gray-50" style={{ color: "var(--cc-muted)" }}>
                          <X size={14} />
                        </button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(b)} title="Edit branch" className="p-1.5 rounded-lg hover:bg-gray-50" style={{ color: "var(--cc-muted)" }}>
                          <Pencil size={14} />
                        </button>
                        {!b.is_head_office && (
                          <button onClick={() => remove(b)} title="Delete branch" className="p-1.5 rounded-lg hover:bg-red-50" style={{ color: "var(--cc-muted)" }}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {adding && (
            <div className="mt-4 pt-4 space-y-3" style={{ borderTop: "1px solid var(--cc-border)" }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="new-branch-name">Branch name</Label>
                  <Input id="new-branch-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Melbourne" />
                </div>
                <div>
                  <Label htmlFor="new-branch-state">State</Label>
                  <BranchStateSelect id="new-branch-state" value={newState} onChange={setNewState} states={states} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={create} disabled={saving || !newName.trim() || !newState}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                  Add branch
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAdding(false)} disabled={saving}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
