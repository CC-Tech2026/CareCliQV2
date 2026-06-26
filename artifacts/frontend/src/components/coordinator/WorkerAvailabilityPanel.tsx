/**
 * WorkerAvailabilityPanel — CARECLIQV2-235
 * Availability settings and skill management for a worker.
 */
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Calendar, Clock, Plus, Trash2, Check, X, ChevronDown,
} from "lucide-react";
import {
  getWorkerAvailability,
  updateWorkerAvailability,
  getWorkerSkills,
  addWorkerSkill,
  removeWorkerSkill,
  type WorkerStats,
  type BlackoutDate,
} from "@/services/coordinatorService";
import { useToast } from "@/hooks/use-toast";

const PLUM   = "var(--cc-plum)";
const CORAL  = "var(--cc-coral)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const COMMON_SKILLS = [
  "Mobility Assistance",
  "Continence Care",
  "Medication Administration",
  "Mental Health Awareness",
  "Dementia Care",
  "Autism Support",
  "Complex Behaviour Support",
  "Manual Handling",
  "First Aid",
  "Epilepsy Management",
];

interface WorkerAvailabilityPanelProps {
  worker: WorkerStats;
  onClose?: () => void;
}

export function WorkerAvailabilityPanel({ worker, onClose }: WorkerAvailabilityPanelProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<"availability" | "skills">("availability");

  // Availability
  const { data: availData, isLoading: availLoading, refetch: refetchAvail } = useQuery({
    queryKey: ["worker-availability", worker.id],
    queryFn: () => getWorkerAvailability(worker.id),
    staleTime: 60_000,
  });

  const [availDays,   setAvailDays]   = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime,   setStartTime]   = useState("08:00");
  const [endTime,     setEndTime]     = useState("18:00");
  const [maxHours,    setMaxHours]    = useState(40);
  const [blackouts,   setBlackouts]   = useState<BlackoutDate[]>([]);
  const [newBlackout, setNewBlackout] = useState({ start_date: "", end_date: "", reason: "" });

  useEffect(() => {
    if (availData) {
      const a = availData.availability;
      setAvailDays(a.available_days ?? [1, 2, 3, 4, 5]);
      setStartTime(a.day_start_time?.slice(0, 5) ?? "08:00");
      setEndTime(a.day_end_time?.slice(0, 5) ?? "18:00");
      setMaxHours(a.max_hours_per_week ?? 40);
      setBlackouts(availData.blackout_dates ?? []);
    }
  }, [availData]);

  const saveMut = useMutation({
    mutationFn: () =>
      updateWorkerAvailability(worker.id, {
        available_days: availDays,
        day_start_time: startTime,
        day_end_time: endTime,
        max_hours_per_week: maxHours,
        blackout_dates: blackouts,
      }),
    onSuccess: () => {
      toast({ title: "Availability saved" });
      refetchAvail();
    },
    onError: (e: Error) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const addBlackout = () => {
    if (!newBlackout.start_date || !newBlackout.end_date) return;
    setBlackouts((prev) => [...prev, newBlackout]);
    setNewBlackout({ start_date: "", end_date: "", reason: "" });
  };

  const removeBlackout = (i: number) => setBlackouts((prev) => prev.filter((_, idx) => idx !== i));

  const toggleDay = (d: number) =>
    setAvailDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  // Skills
  const { data: skills = [], refetch: refetchSkills } = useQuery({
    queryKey: ["worker-skills", worker.id],
    queryFn: () => getWorkerSkills(worker.id),
    staleTime: 60_000,
  });

  const [newSkill, setNewSkill] = useState("");

  const addSkillMut = useMutation({
    mutationFn: (skill: string) => addWorkerSkill(worker.id, { skill, is_certified: true }),
    onSuccess: () => { refetchSkills(); setNewSkill(""); },
    onError: (e: Error) => toast({ title: "Failed to add skill", description: e.message, variant: "destructive" }),
  });

  const removeSkillMut = useMutation({
    mutationFn: (skill: string) => removeWorkerSkill(worker.id, skill),
    onSuccess: () => refetchSkills(),
    onError: (e: Error) => toast({ title: "Failed to remove skill", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-hidden" style={{ borderColor: BORDER }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <div>
          <h3 className="text-[15px] font-black" style={{ color: TEXT }}>{worker.full_name}</h3>
          <p className="text-[11px]" style={{ color: MUTED }}>Availability & Skills</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-gray-100">
            <X size={14} style={{ color: MUTED }} />
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex" style={{ borderBottom: `1px solid ${BORDER}` }}>
        {(["availability", "skills"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="flex-1 py-2.5 text-[12px] font-black capitalize transition-colors"
            style={{
              color: tab === t ? PLUM : MUTED,
              borderBottom: tab === t ? `2px solid ${PLUM}` : "2px solid transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="px-5 py-4 max-h-96 overflow-y-auto">
        {tab === "availability" ? (
          <div className="space-y-5">
            {/* Days of week */}
            <div>
              <p className="text-[11px] font-black mb-2" style={{ color: TEXT }}>Available Days</p>
              <div className="flex gap-1.5 flex-wrap">
                {DAYS.map((label, i) => {
                  const val = i + 1;
                  const active = availDays.includes(val);
                  return (
                    <button
                      key={val}
                      onClick={() => toggleDay(val)}
                      className="h-8 w-11 rounded-lg text-[11px] font-black"
                      style={{
                        background: active ? PLUM : SOFT,
                        color: active ? "white" : MUTED,
                        border: `1px solid ${active ? PLUM : BORDER}`,
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Hours */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-black mb-1.5" style={{ color: TEXT }}>Day Start</p>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: BORDER }}
                />
              </div>
              <div>
                <p className="text-[11px] font-black mb-1.5" style={{ color: TEXT }}>Day End</p>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full rounded-xl border px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: BORDER }}
                />
              </div>
            </div>

            {/* Max hours */}
            <div>
              <p className="text-[11px] font-black mb-1.5" style={{ color: TEXT }}>Max Hours / Week</p>
              <input
                type="number"
                min={1}
                max={80}
                value={maxHours}
                onChange={(e) => setMaxHours(parseInt(e.target.value) || 40)}
                className="w-28 rounded-xl border px-3 py-2 text-[12px] outline-none"
                style={{ borderColor: BORDER }}
              />
            </div>

            {/* Blackout dates */}
            <div>
              <p className="text-[11px] font-black mb-2" style={{ color: TEXT }}>Blackout Dates</p>
              {blackouts.map((b, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-1.5 mb-1.5" style={{ borderColor: BORDER }}>
                  <div>
                    <p className="text-[11px] font-bold" style={{ color: TEXT }}>{b.start_date} – {b.end_date}</p>
                    {b.reason && <p className="text-[10px]" style={{ color: MUTED }}>{b.reason}</p>}
                  </div>
                  <button onClick={() => removeBlackout(i)} className="rounded p-0.5 hover:bg-red-50">
                    <Trash2 size={11} style={{ color: CORAL }} />
                  </button>
                </div>
              ))}
              <div className="space-y-1.5 rounded-xl border p-3" style={{ borderColor: BORDER, background: SOFT }}>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={newBlackout.start_date} onChange={(e) => setNewBlackout((b) => ({ ...b, start_date: e.target.value }))} className="rounded-lg border px-2.5 py-1.5 text-[11px] outline-none" style={{ borderColor: BORDER }} placeholder="Start" />
                  <input type="date" value={newBlackout.end_date} onChange={(e) => setNewBlackout((b) => ({ ...b, end_date: e.target.value }))} className="rounded-lg border px-2.5 py-1.5 text-[11px] outline-none" style={{ borderColor: BORDER }} placeholder="End" />
                </div>
                <input value={newBlackout.reason} onChange={(e) => setNewBlackout((b) => ({ ...b, reason: e.target.value }))} className="w-full rounded-lg border px-2.5 py-1.5 text-[11px] outline-none" style={{ borderColor: BORDER }} placeholder="Reason (optional)" />
                <button onClick={addBlackout} disabled={!newBlackout.start_date || !newBlackout.end_date} className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-bold text-white" style={{ background: PLUM, opacity: !newBlackout.start_date ? 0.5 : 1 }}>
                  <Plus size={10} /> Add Date
                </button>
              </div>
            </div>

            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="w-full rounded-xl py-2.5 text-[12px] font-black text-white"
              style={{ background: PLUM, opacity: saveMut.isPending ? 0.65 : 1 }}
            >
              {saveMut.isPending ? "Saving…" : "Save Availability"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Current skills */}
            <div>
              <p className="text-[11px] font-black mb-2" style={{ color: TEXT }}>Certified Skills</p>
              {skills.length === 0 ? (
                <p className="text-[12px]" style={{ color: MUTED }}>No skills recorded yet.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((s) => (
                    <span
                      key={s.skill}
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
                      style={{ background: "#EDE9FF", color: PLUM }}
                    >
                      <Check size={9} />
                      {s.skill}
                      <button
                        onClick={() => removeSkillMut.mutate(s.skill)}
                        className="ml-0.5 rounded-full hover:bg-[#C4B5FD] transition-colors"
                      >
                        <X size={9} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Add skill */}
            <div>
              <p className="text-[11px] font-black mb-2" style={{ color: TEXT }}>Add Skill</p>
              <div className="flex gap-2">
                <input
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && newSkill.trim() && addSkillMut.mutate(newSkill.trim())}
                  className="flex-1 rounded-xl border px-3 py-2 text-[12px] outline-none focus:border-[#3730A3]"
                  style={{ borderColor: BORDER }}
                  placeholder="Skill name…"
                />
                <button
                  onClick={() => newSkill.trim() && addSkillMut.mutate(newSkill.trim())}
                  disabled={!newSkill.trim() || addSkillMut.isPending}
                  className="rounded-xl px-3 py-2 text-[12px] font-bold text-white"
                  style={{ background: PLUM, opacity: !newSkill.trim() ? 0.5 : 1 }}
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {COMMON_SKILLS.filter((s) => !skills.some((ws) => ws.skill === s)).slice(0, 6).map((s) => (
                  <button
                    key={s}
                    onClick={() => addSkillMut.mutate(s)}
                    className="rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors hover:bg-[#EDE9FF]"
                    style={{ borderColor: BORDER, color: MUTED }}
                  >
                    + {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
