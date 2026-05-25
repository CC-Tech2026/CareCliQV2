import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Users, ClipboardList, ArrowRight, AlertTriangle } from "lucide-react";

function SummaryCard({ title, value, description }: { title: string; value: number | string; description: string }) {
  return (
    <div className="rounded-3xl border border-[#E9E5F5] bg-white p-5 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#7A6A9E] font-bold mb-3">{title}</p>
      <p className="text-3xl font-black text-[#1E1640]">{value}</p>
      <p className="mt-2 text-sm text-[#5B4D73]">{description}</p>
    </div>
  );
}

export default function Workers() {
  const { toast } = useToast();
  const { user, token } = useAuth();
  const [workers, setWorkers] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setIsLoading(true);
      try {
        const headers = token ? { Authorization: `Bearer ${token}` } : {};
        const [workersRes, assignmentsRes] = await Promise.all([
          fetch("/api/assignments/workers", { headers }),
          fetch("/api/assignments", { headers }),
        ]);
        if (!workersRes.ok || !assignmentsRes.ok) {
          throw new Error("Unable to fetch team or assignment data");
        }

        const workersData = await workersRes.json();
        const assignmentsData = await assignmentsRes.json();

        if (!cancelled) {
          setWorkers(Array.isArray(workersData) ? workersData : []);
          setAssignments(Array.isArray(assignmentsData) ? assignmentsData : []);
        }
      } catch (error) {
        console.error(error);
        toast({ title: "Failed to load coordinator team data.", description: "Please refresh or try again later.", variant: "destructive" });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [toast, user]);

  async function assignParticipantToWorker(worker: any, participantId?: string) {
    if (!token) {
      toast({ title: "Not authenticated", variant: "destructive" });
      return;
    }

    const pid = participantId ?? prompt(`Enter participant ID to assign to ${worker.full_name || worker.email}`);
    if (!pid) return;

    try {
      const res = await fetch(`/api/assignments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ participant_id: pid, worker_user_id: worker.id, role_type: "support_worker" }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.detail || payload?.message || "Failed to create assignment");
      }

      const created = await res.json();
      setAssignments((prev) => [...prev, created]);
      toast({ title: "Assigned", description: `Participant assigned to ${worker.full_name || worker.email}` });
    } catch (e) {
      console.error(e);
      toast({ title: "Assignment failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  }

  // Unassign an assignment by id
  async function unassign(assignmentId: string) {
    if (!token) {
      toast({ title: "Not authenticated", variant: "destructive" });
      return;
    }

    if (!confirm("Remove this assignment?")) return;

    try {
      const res = await fetch(`/api/assignments/${assignmentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to remove assignment");
      setAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
      toast({ title: "Assignment removed" });
    } catch (e) {
      console.error(e);
      toast({ title: "Failed to remove assignment", variant: "destructive" });
    }
  }

  // Participant picker modal state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerWorker, setPickerWorker] = useState<any | null>(null);
  const [participantsList, setParticipantsList] = useState<any[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  async function openPicker(worker: any) {
    setPickerWorker(worker);
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch("/api/participants", { headers });
      if (!res.ok) throw new Error("Failed to load participants");
      const data = await res.json();
      setParticipantsList(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      toast({ title: "Failed to load participants", variant: "destructive" });
      setParticipantsList([]);
    } finally {
      setPickerLoading(false);
    }
  }

  async function confirmAssign(participantId: string) {
    if (!pickerWorker) return;
    await assignParticipantToWorker(pickerWorker, participantId);
    setPickerOpen(false);
    setPickerWorker(null);
  }

  const assignmentCounts = useMemo(() => {
    return assignments.reduce<Record<string, number>>((memo, assignment) => {
      const uid = assignment.user_id || assignment.worker_user_id || assignment.support_worker_id;
      if (!uid) return memo;
      memo[uid] = (memo[uid] ?? 0) + 1;
      return memo;
    }, {});
  }, [assignments]);

  const activeWorkers = workers.filter((worker) => worker.active !== false);
  const unassignedWorkers = activeWorkers.filter((worker) => !assignmentCounts[worker.id]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-[#F03060] font-bold">Coordinator Hub</p>
          <h1 className="mt-2 text-3xl font-black text-[#1E1640]">Team & worker assignments</h1>
          <p className="mt-2 text-sm text-[#5B4D73] max-w-2xl">
            View active support staff, workload distribution, and quick links for invite or team management.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/settings">
            <Button variant="secondary">Manage team</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard title="Active workers" value={isLoading ? "..." : activeWorkers.length} description="Staff currently assigned to your organisation." />
        <SummaryCard title="Assigned cases" value={isLoading ? "..." : assignments.length} description="Total participant assignments under your coordination." />
        <SummaryCard title="Unassigned workers" value={isLoading ? "..." : unassignedWorkers.length} description="Support staff available for new cases." />
      </div>

      <div className="rounded-[2rem] border border-[#E9E5F5] bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-[#E9E5F5]">
          <div>
            <h2 className="text-lg font-bold text-[#1E1640]">Active workers</h2>
            <p className="text-sm text-[#7A6A9E]">Review current staff load and open assignment capacity.</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#F5F3FC] px-4 py-2 text-sm font-semibold text-[#5533CC]">
            <Users size={16} /> Team overview
          </div>
        </div>

        <div className="divide-y divide-[#F2EFF7]">
          {isLoading ? (
            <div className="p-6 text-sm text-[#7A6A9E]">Loading team members…</div>
          ) : activeWorkers.length === 0 ? (
            <div className="p-6 text-sm text-[#7A6A9E]">No active workers found. Use Settings to invite staff or manage existing team members.</div>
          ) : (
            activeWorkers.map((worker) => (
              <div key={worker.id} className="grid gap-4 px-6 py-5 sm:grid-cols-[1fr_auto] items-center">
                <div>
                  <p className="text-sm font-bold text-[#1E1640]">{worker.full_name || worker.email || "Unnamed worker"}</p>
                  <p className="mt-1 text-sm text-[#7A6A9E]">{worker.role?.replace("_", " ") || "Support Worker"}</p>

                  {/* Assigned participants list */}
                  <div className="mt-2 space-y-1">
                    {(assignments.filter((a) => (a.user_id || a.worker_user_id || a.support_worker_id) === worker.id) || []).map((a) => (
                      <div key={a.id} className="flex items-center gap-2 text-[13px] text-[#5B4D73]">
                        <span className="truncate">{(a.participant && (a.participant.full_name || a.participant.ndis_number)) || a.patient_id}</span>
                        <button onClick={() => unassign(a.id)} className="text-[12px] text-red-600 hover:underline">Unassign</button>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-[#5B4D73]">
                  <span className="rounded-full bg-[#F5F3FC] px-3 py-1">{assignmentCounts[worker.id] ?? 0} assignments</span>
                  <button onClick={() => openPicker(worker)} className="inline-flex items-center gap-1 font-semibold text-[#5533CC] hover:underline">
                    Assign
                  </button>
                  <Link href={`/patients`} className="inline-flex items-center gap-1 font-semibold text-[#5533CC] hover:underline">
                    View cases <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {unassignedWorkers.length > 0 && (
        <div className="rounded-[2rem] border border-[#FFE8EE] bg-[#FFF5F7] p-6">
          <div className="flex items-center gap-3 text-[#C41144]">
            <AlertTriangle size={20} />
            <div>
              <p className="font-bold text-sm">Available support staff</p>
              <p className="text-sm text-[#6B7280]">You have {unassignedWorkers.length} worker{unassignedWorkers.length !== 1 ? "s" : ""} with no active participant assignments.</p>
            </div>
          </div>
        </div>
      )}

      {/* Participant picker modal */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setPickerOpen(false); setPickerWorker(null); }} />
          <div className="relative z-10 w-full max-w-2xl bg-white rounded-2xl p-6 shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Assign participant to {pickerWorker?.full_name || pickerWorker?.email}</h3>
              <button onClick={() => { setPickerOpen(false); setPickerWorker(null); }} className="text-sm text-[#7A6A9E]">Close</button>
            </div>
            {pickerLoading ? (
              <div className="py-6 text-center text-sm text-[#7A6A9E]">Loading participants…</div>
            ) : (
              <div className="space-y-3">
                {participantsList.length === 0 ? (
                  <div className="text-sm text-[#7A6A9E]">No participants available.</div>
                ) : (
                  participantsList.map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-[#F5F3FC]">
                      <div>
                        <div className="font-semibold text-sm text-[#1E1640]">{p.full_name || p.ndis_number}</div>
                        <div className="text-[12px] text-[#7A6A9E]">{p.ndis_number || p.id}</div>
                      </div>
                      <div>
                        <button onClick={() => confirmAssign(p.id)} className="px-3 py-1 rounded-xl bg-[#5533CC] text-white">Assign</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
