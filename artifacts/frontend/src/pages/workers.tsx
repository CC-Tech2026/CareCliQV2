import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function SummaryCard({
  title,
  value,
  description,
}: {
  title: string;
  value: number | string;
  description: string;
}) {
  return (
    <div className="rounded-3xl border border-[#E9E5F5] bg-white p-5 shadow-sm">
      <p className="text-[11px] uppercase tracking-[0.22em] text-[#7A6A9E] font-bold mb-3">
        {title}
      </p>
      <p className="text-3xl font-black text-[#1E1640]">{value}</p>
      <p className="mt-2 text-sm text-[#5B4D73]">{description}</p>
    </div>
  );
}

export default function Workers() {
  const { toast } = useToast();
  const { user, token } = useAuth();
  console.log("TOKEN =>", token);

  const [workers, setWorkers] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [participants, setParticipants] = useState<any[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(false);

  // assignment modal state
  const [assignOpenFor, setAssignOpenFor] = useState<string | null>(null);
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string>("support_worker");

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setIsLoading(true);

      try {
        const headers: HeadersInit = token
          ? {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            }
          : {
              "Content-Type": "application/json",
            };

        const [workersRes, assignmentsRes] = await Promise.all([
          fetch("/api/assignments/workers", {
            headers,
          }),
          fetch("/api/assignments", {
            headers,
          }),
        ]);

        const workersData = await workersRes.json().catch(() => []);
        const assignmentsData = await assignmentsRes.json().catch(() => []);

        if (!workersRes.ok || !assignmentsRes.ok) {
          throw new Error(
            workersData?.detail ||
              assignmentsData?.detail ||
              "Unable to fetch team or assignment data"
          );
        }

        if (!cancelled) {
          setWorkers(Array.isArray(workersData) ? workersData : []);
          setAssignments(
            Array.isArray(assignmentsData) ? assignmentsData : []
          );
          // also fetch participants for assigning
          try {
            setLoadingParticipants(true);
            const pRes = await fetch("/api/participants", { headers });
            const pData = await pRes.json().catch(() => []);
            if (pRes.ok && !cancelled) setParticipants(Array.isArray(pData) ? pData : []);
          } catch (err) {
            // ignore
          } finally {
            setLoadingParticipants(false);
          }
        }
      } catch (error) {
        console.error(error);
        toast({
          title: "Failed to load team data",
          description: "Please refresh or try again later.",
          variant: "destructive",
        });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [token, toast]);

  // counts per worker
  const assignmentCounts = useMemo(() => {
    return assignments.reduce<Record<string, number>>((acc, a) => {
      const uid = a.user_id || a.worker_user_id;
      if (!uid) return acc;
      acc[uid] = (acc[uid] || 0) + 1;
      return acc;
    }, {});
  }, [assignments]);

  const activeWorkers = workers.filter((w) => w.active !== false);

  const unassignedWorkers = activeWorkers.filter(
    (w) => !assignmentCounts[w.id]
  );

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-black text-[#1E1640]">
        Team & worker assignments
      </h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          title="Active workers"
          value={activeWorkers.length}
          description="Staff in organisation"
        />
        <SummaryCard
          title="Assignments"
          value={assignments.length}
          description="Total active allocations"
        />
        <SummaryCard
          title="Unassigned"
          value={unassignedWorkers.length}
          description="Available staff"
        />
      </div>

      <div className="rounded-2xl border bg-white">
        {isLoading ? (
          <div className="p-6">Loading...</div>
        ) : activeWorkers.length === 0 ? (
          <div className="p-6">No workers found</div>
        ) : (
          activeWorkers.map((worker) => (
            <div key={worker.id} className="p-5 border-b">
              <p className="font-bold">
                {worker.full_name || worker.email}
              </p>

              <p className="text-sm text-gray-500">
                {worker.role || "worker"}
              </p>

              <p className="text-xs mt-1">
                Assignments: {assignmentCounts[worker.id] || 0}
              </p>
              <div className="flex items-center gap-3 mt-3">
                <Link href="/patients">
                  <span className="text-sm text-purple-600">View cases →</span>
                </Link>

                <Dialog open={assignOpenFor === worker.id} onOpenChange={(v) => setAssignOpenFor(v ? worker.id : null)}>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm">Assign participant</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Assign participant to {worker.full_name || worker.email}</DialogTitle>
                    </DialogHeader>

                    <div className="space-y-4 mt-2">
                      <div>
                        <label className="block text-sm font-medium mb-2">Participant</label>
                        <Select onValueChange={(v) => setSelectedParticipant(v)} value={selectedParticipant ?? ""}>
                          <SelectTrigger>
                            <SelectValue placeholder={loadingParticipants ? "Loading..." : "Select participant"} />
                          </SelectTrigger>
                          <SelectContent>
                            {participants.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.full_name || p.email || p.id}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-2">Role</label>
                        <Select onValueChange={(v) => setSelectedRole(v)} value={selectedRole}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="support_worker">Support Worker</SelectItem>
                            <SelectItem value="allied_health">Allied Health</SelectItem>
                            <SelectItem value="allied_health_pro">Allied Health (Pro)</SelectItem>
                            <SelectItem value="primary_ot">Primary OT</SelectItem>
                            <SelectItem value="supervisor">Supervisor</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <DialogFooter>
                      <Button onClick={async () => {
                        if (!selectedParticipant) {
                          toast({ title: "Select a participant", variant: "destructive" });
                          return;
                        }
                        try {
                          const headers: HeadersInit = token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
                          const resp = await fetch('/api/assignments', {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ participant_id: selectedParticipant, worker_user_id: worker.id, role_type: selectedRole }),
                          });
                          if (!resp.ok) throw new Error((await resp.json()).detail || 'Failed to assign');
                          const data = await resp.json();
                          setAssignments((prev) => [data, ...prev]);
                          toast({ title: 'Assigned', description: `${worker.full_name || worker.email} assigned` });
                          setAssignOpenFor(null);
                          setSelectedParticipant(null);
                        } catch (err) {
                          console.error(err);
                          toast({ title: 'Assignment failed', variant: 'destructive' });
                        }
                      }}>Confirm</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          ))
        )}
      </div>

      {unassignedWorkers.length > 0 && (
        <div className="p-4 bg-red-50 border rounded-xl flex items-center gap-2">
          <AlertTriangle size={16} />
          <span>{unassignedWorkers.length} unassigned workers</span>
        </div>
      )}
    </div>
  );
}