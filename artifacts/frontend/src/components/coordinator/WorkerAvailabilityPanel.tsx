/**
 * WorkerAvailabilityPanel — CARECLIQV2-235
 * Availability settings and skill management for a worker.
 */
import { useEffect, useState } from "react";
import { format } from "date-fns";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Calendar,
  Clock,
  Plus,
  Trash2,
  Check,
  X,
  ChevronDown,
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
import { TimePicker } from "@/components/ui/time-picker";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";

const DAY_KEYS = [
  "coordinator.bulkShift.day.mon",
  "coordinator.bulkShift.day.tue",
  "coordinator.bulkShift.day.wed",
  "coordinator.bulkShift.day.thu",
  "coordinator.bulkShift.day.fri",
  "coordinator.bulkShift.day.sat",
  "coordinator.bulkShift.day.sun",
];

const COMMON_SKILL_KEYS = [
  "coordinator.availability.skill.mobility",
  "coordinator.availability.skill.continence",
  "coordinator.availability.skill.medication",
  "coordinator.availability.skill.mentalHealth",
  "coordinator.availability.skill.dementia",
  "coordinator.availability.skill.autism",
  "coordinator.availability.skill.behaviour",
  "coordinator.availability.skill.manualHandling",
  "coordinator.availability.skill.firstAid",
  "coordinator.availability.skill.epilepsy",
];

interface WorkerAvailabilityPanelProps {
  worker: WorkerStats;
  onClose?: () => void;
}

export function WorkerAvailabilityPanel({
  worker,
  onClose,
}: WorkerAvailabilityPanelProps) {
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const [tab, setTab] = useState<"availability" | "skills">("availability");

  // Availability
  const {
    data: availData,
    isLoading: availLoading,
    isError: availError,
    refetch: refetchAvail,
  } = useQuery({
    queryKey: ["worker-availability", worker.id],
    queryFn: () => getWorkerAvailability(worker.id),
    staleTime: 60_000,
  });

  const [availDays, setAvailDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("18:00");
  const [maxHours, setMaxHours] = useState(40);
  const [blackouts, setBlackouts] = useState<BlackoutDate[]>([]);
  const [newBlackout, setNewBlackout] = useState({
    start_date: "",
    end_date: "",
    reason: "",
  });

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
      toast({ title: translate("coordinator.availability.saved") });
      refetchAvail();
    },
    onError: (e: Error) =>
      toast({
        title: translate("coordinator.availability.saveFailed"),
        description: e.message,
        variant: "destructive",
      }),
  });

  const addBlackout = () => {
    if (!newBlackout.start_date || !newBlackout.end_date) return;
    setBlackouts((prev) => [...prev, newBlackout]);
    setNewBlackout({ start_date: "", end_date: "", reason: "" });
  };

  const removeBlackout = (i: number) =>
    setBlackouts((prev) => prev.filter((_, idx) => idx !== i));

  const toggleDay = (d: number) =>
    setAvailDays((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );

  // Implied hours = selected days x the single start/end window (v1 model: one window
  // applies to every selected day, there's no per-day override yet) — surfaced against
  // the max-hours cap so a coordinator can see when the window itself allows more than
  // the cap permits, rather than discovering it only once rostering is blocked.
  const windowHours = (() => {
    const [sh, sm] = startTime.split(":").map(Number);
    const [eh, em] = endTime.split(":").map(Number);
    const diff = (eh * 60 + em - (sh * 60 + sm)) / 60;
    return diff > 0 ? diff : 0;
  })();
  const impliedMaxHours = Math.round(windowHours * availDays.length * 10) / 10;

  // Skills
  const { data: skills = [], refetch: refetchSkills } = useQuery({
    queryKey: ["worker-skills", worker.id],
    queryFn: () => getWorkerSkills(worker.id),
    staleTime: 60_000,
  });

  const [newSkill, setNewSkill] = useState("");
  // Qualification-backed vs informal/lived-experience skills need to read as visually distinct
  // (spec: "a small label or icon difference is enough") so a coordinator can tell at a glance
  // which are formally evidenced vs self- or coordinator-reported — is_certified already exists
  // on the backend for exactly this, it just wasn't exposed as a choice before.
  const [newSkillCertified, setNewSkillCertified] = useState(true);

  const addSkillMut = useMutation({
    mutationFn: ({ skill, certified }: { skill: string; certified: boolean }) =>
      addWorkerSkill(worker.id, { skill, is_certified: certified }),
    onSuccess: () => {
      refetchSkills();
      setNewSkill("");
    },
    onError: (e: Error) =>
      toast({
        title: "Failed to add skill",
        description: e.message,
        variant: "destructive",
      }),
  });

  const removeSkillMut = useMutation({
    mutationFn: (skill: string) => removeWorkerSkill(worker.id, skill),
    onSuccess: () => refetchSkills(),
    onError: (e: Error) =>
      toast({
        title: "Failed to remove skill",
        description: e.message,
        variant: "destructive",
      }),
  });

  return (
    <div
      className="rounded-2xl border bg-white shadow-sm overflow-hidden"
      style={{ borderColor: BORDER }}
    >
      {/* Header — only shown when this panel is used standalone (rostering modal), since
          WorkerDetail's own page header already shows the worker's name right above it. */}
      {onClose && (
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <div>
            <h3 className="text-[15px] font-semibold" style={{ color: TEXT }}>
              {worker.full_name}
            </h3>
            <p className="text-sm" style={{ color: MUTED }}>
              {translate("coordinator.availability.subtitle")}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 hover:bg-gray-100"
            title="Close panel"
            aria-label="Close availability panel"
          >
            <X size={14} style={{ color: MUTED }} />
          </button>
        </div>
      )}

      {/* Sub-tab — a small contained pill, deliberately smaller/lower-contrast than the real
          page-level tabs above this panel, so it reads as a toggle within Availability rather
          than another row of top-level tabs. Purple (--cc-coral) is scoped to this control only;
          the page's real tabs and primary actions stay on the app's pink primary. */}
      <div className="px-5 pt-3 pb-1">
        <div
          className="inline-flex gap-0.5 rounded-full p-0.5"
          style={{ background: SOFT }}
        >
          {(["availability", "skills"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className="min-h-10 rounded-lg px-3 py-1 text-sm font-bold capitalize transition-colors"
              style={{
                background: tab === t ? CORAL : "transparent",
                color: tab === t ? "white" : MUTED,
              }}
            >
              {translate(`coordinator.availability.tab.${t}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 py-4 sm:px-5">
        {tab === "availability" && availLoading ? (
          <p role="status" className="py-4 text-sm" style={{ color: MUTED }}>
            {translate("common.loading")}
          </p>
        ) : tab === "availability" && availError ? (
          <div
            role="alert"
            className="space-y-3 rounded-lg border p-4"
            style={{ borderColor: BORDER }}
          >
            <p className="text-sm">
              Availability could not be loaded. Reload it before making changes.
            </p>
            <button
              type="button"
              onClick={() => void refetchAvail()}
              className="min-h-10 rounded-lg border px-3 text-sm"
              style={{ borderColor: BORDER }}
            >
              Retry availability
            </button>
          </div>
        ) : tab === "availability" ? (
          <div className="space-y-3">
            {/* Days of week */}
            <div>
              <p
                className="text-sm font-semibold mb-1.5"
                style={{ color: TEXT }}
              >
                {translate("coordinator.availability.availableDays")}
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {DAY_KEYS.map((dayKey, i) => {
                  const val = i + 1;
                  const active = availDays.includes(val);
                  return (
                    <button
                      key={val}
                      onClick={() => toggleDay(val)}
                      aria-pressed={active}
                      className="h-11 w-11 rounded-lg text-sm font-semibold"
                      style={{
                        background: active ? CORAL : SOFT,
                        color: active ? "white" : MUTED,
                        border: `1px solid ${active ? CORAL : BORDER}`,
                      }}
                    >
                      {translate(dayKey)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Hours */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p
                  className="text-sm font-semibold mb-1"
                  style={{ color: TEXT }}
                >
                  {translate("coordinator.availability.dayStart")}
                </p>
                <TimePicker
                  value={startTime}
                  onChange={setStartTime}
                  className="rounded-xl px-3 py-1.5 text-sm"
                  style={{ borderColor: BORDER }}
                />
              </div>
              <div>
                <p
                  className="text-sm font-semibold mb-1"
                  style={{ color: TEXT }}
                >
                  {translate("coordinator.availability.dayEnd")}
                </p>
                <TimePicker
                  value={endTime}
                  onChange={setEndTime}
                  className="rounded-xl px-3 py-1.5 text-sm"
                  style={{ borderColor: BORDER }}
                />
              </div>
              <p className="text-xs mt-1 col-span-2" style={{ color: MUTED }}>
                Same window applies to every selected day.
              </p>
            </div>

            {/* Max hours */}
            <div>
              <p className="text-sm font-semibold mb-1" style={{ color: TEXT }}>
                {translate("coordinator.availability.maxHours")}
              </p>
              <input
                type="number"
                min={1}
                max={80}
                value={maxHours}
                onChange={(e) => setMaxHours(parseInt(e.target.value) || 40)}
                className="w-28 rounded-xl border px-3 py-1.5 text-sm outline-none"
                style={{ borderColor: BORDER }}
              />
              {windowHours > 0 && availDays.length > 0 && (
                <p
                  className="text-xs mt-1"
                  style={{ color: impliedMaxHours > maxHours ? CORAL : MUTED }}
                >
                  {impliedMaxHours > maxHours
                    ? `Selected days allow up to ${impliedMaxHours} hrs, capped at ${maxHours}.`
                    : `Selected days allow up to ${impliedMaxHours} hrs, within the ${maxHours} hr cap.`}
                </p>
              )}
            </div>

            {/* Unavailability */}
            <div>
              <p
                className="text-sm font-semibold mb-1.5"
                style={{ color: TEXT }}
              >
                {translate("coordinator.availability.blackoutDates")}
              </p>
              <p className="mb-3 text-sm" style={{ color: MUTED }}>Dates this staff member is not available for shifts.</p>
              {blackouts.map((b, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border px-3 py-1 mb-1"
                  style={{ borderColor: BORDER }}
                >
                  <div>
                    <p className="text-sm font-bold" style={{ color: TEXT }}>
                      {b.start_date} – {b.end_date}
                    </p>
                    {b.reason && (
                      <p className="text-xs" style={{ color: MUTED }}>
                        {b.reason}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => removeBlackout(i)}
                    className="rounded p-0.5 hover:bg-red-50"
                  >
                    <Trash2 size={11} style={{ color: CORAL }} />
                  </button>
                </div>
              ))}
              <div
                className="space-y-1 rounded-xl border p-2.5"
                style={{ borderColor: BORDER, background: SOFT }}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <input
                    type="date"
                    value={newBlackout.start_date}
                    onChange={(e) =>
                      setNewBlackout((b) => ({
                        ...b,
                        start_date: e.target.value,
                      }))
                    }
                    className="rounded-lg border px-2.5 py-1 text-sm outline-none"
                    style={{ borderColor: BORDER }}
                    aria-label={translate(
                      "coordinator.availability.blackoutStart",
                    )}
                    title={translate("coordinator.availability.blackoutStart")}
                  />
                  <input
                    type="date"
                    value={newBlackout.end_date}
                    onChange={(e) =>
                      setNewBlackout((b) => ({
                        ...b,
                        end_date: e.target.value,
                      }))
                    }
                    className="rounded-lg border px-2.5 py-1 text-sm outline-none"
                    style={{ borderColor: BORDER }}
                    aria-label={translate(
                      "coordinator.availability.blackoutEnd",
                    )}
                    title={translate("coordinator.availability.blackoutEnd")}
                  />
                </div>
                <input
                  value={newBlackout.reason}
                  onChange={(e) =>
                    setNewBlackout((b) => ({ ...b, reason: e.target.value }))
                  }
                  className="w-full rounded-lg border px-2.5 py-1 text-sm outline-none"
                  style={{ borderColor: BORDER }}
                  placeholder={translate(
                    "coordinator.availability.reasonOptional",
                  )}
                  aria-label={translate(
                    "coordinator.availability.reasonOptional",
                  )}
                />
                <button
                  onClick={addBlackout}
                  disabled={!newBlackout.start_date || !newBlackout.end_date}
                  className="flex items-center gap-1 rounded-lg px-3 py-1 text-sm font-bold text-white"
                  style={{
                    background: PLUM,
                    opacity: !newBlackout.start_date ? 0.5 : 1,
                  }}
                  title={translate("coordinator.availability.addDate")}
                  aria-label={translate("coordinator.availability.addDate")}
                >
                  <Plus size={10} />{" "}
                  {translate("coordinator.availability.addDate")}
                </button>
              </div>
            </div>

            <button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending}
              className="rounded-xl px-4 py-1.5 text-sm font-semibold text-white"
              style={{
                background: PLUM,
                opacity: saveMut.isPending ? 0.65 : 1,
              }}
            >
              {saveMut.isPending
                ? translate("common.saving")
                : translate("coordinator.availability.saveAvailability")}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Current skills — qualification-backed (solid purple, check icon) vs informal /
                self-reported (outlined, no check) are visually distinct at a glance. */}
            <div>
              <p
                className="text-sm font-semibold mb-1.5"
                style={{ color: TEXT }}
              >
                {translate("coordinator.availability.certifiedSkills")}
              </p>
              {skills.length === 0 ? (
                <p className="text-sm" style={{ color: MUTED }}>
                  {translate("coordinator.availability.noSkills")}
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {skills.map((s) => (
                    <span
                      key={s.skill}
                      className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-bold"
                      style={
                        s.is_certified
                          ? { background: "var(--cc-coral-soft)", color: CORAL }
                          : {
                              background: "transparent",
                              color: MUTED,
                              border: `1px dashed ${BORDER}`,
                            }
                      }
                      title={
                        s.is_certified
                          ? "Qualification-backed"
                          : "Informal / self-reported"
                      }
                    >
                      {s.is_certified && <Check size={9} />}
                      {s.skill}
                      <button
                        onClick={() => removeSkillMut.mutate(s.skill)}
                        className="ml-0.5 rounded-full hover:bg-[var(--cc-coral-ring)] transition-colors"
                        title={`Remove ${s.skill} skill`}
                        aria-label={`Remove ${s.skill} skill`}
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
              <p
                className="text-sm font-semibold mb-1.5"
                style={{ color: TEXT }}
              >
                {translate("coordinator.availability.addSkill")}
              </p>
              <div className="flex gap-2">
                <input
                  value={newSkill}
                  onChange={(e) => setNewSkill(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" &&
                    newSkill.trim() &&
                    addSkillMut.mutate({
                      skill: newSkill.trim(),
                      certified: newSkillCertified,
                    })
                  }
                  className="flex-1 rounded-xl border px-3 py-1.5 text-sm outline-none focus:border-[var(--cc-coral)]"
                  style={{ borderColor: BORDER }}
                  placeholder={translate(
                    "coordinator.availability.skillPlaceholder",
                  )}
                />
                <button
                  onClick={() =>
                    newSkill.trim() &&
                    addSkillMut.mutate({
                      skill: newSkill.trim(),
                      certified: newSkillCertified,
                    })
                  }
                  disabled={!newSkill.trim() || addSkillMut.isPending}
                  className="rounded-xl px-3 py-1.5 text-sm font-bold text-white"
                  style={{
                    background: PLUM,
                    opacity: !newSkill.trim() ? 0.5 : 1,
                  }}
                  title="Add skill"
                  aria-label="Add skill"
                >
                  <Plus size={12} />
                </button>
              </div>
              <div className="mt-1 flex gap-1">
                {(
                  [
                    [true, "Qualification-backed"],
                    [false, "Informal"],
                  ] as const
                ).map(([val, label]) => (
                  <button
                    key={label}
                    onClick={() => setNewSkillCertified(val)}
                    className="rounded-full px-2.5 py-1 text-xs font-bold transition-colors"
                    style={{
                      background: newSkillCertified === val ? CORAL : SOFT,
                      color: newSkillCertified === val ? "white" : MUTED,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {COMMON_SKILL_KEYS.filter(
                  (key) => !skills.some((ws) => ws.skill === translate(key)),
                )
                  .slice(0, 6)
                  .map((key) => (
                    <button
                      key={key}
                      onClick={() =>
                        addSkillMut.mutate({
                          skill: translate(key),
                          certified: newSkillCertified,
                        })
                      }
                      className="rounded-full border px-2 py-0.5 text-xs font-medium transition-colors hover:bg-[var(--cc-coral-soft)]"
                      style={{ borderColor: BORDER, color: MUTED }}
                    >
                      + {translate(key)}
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
