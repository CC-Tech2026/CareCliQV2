import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
  useGetParticipants, useGetParticipant, useCreateSession, type NDISGoal,
} from "@workspace/api-client-react";
import { format } from "date-fns";
import {
  Form, FormField, FormItem, FormLabel,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { SmartInput, SmartTextarea } from "@/components/SmartInput";
import {
  CalendarIcon, Clock, Activity, Loader2, Zap, Target, AlertCircle,
} from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { useAccessibility } from "@/contexts/AccessibilityContext";

// -- Design tokens -------------------------------------------------------------
const PLUM   = "var(--cc-plum)";
const CORAL  = "#F1738A";
const T1     = "var(--cc-text)";
const T2     = "#374151";
const T3     = "#7A6A8A";
const BORDER = "var(--cc-border)";
const CARD_SHADOW = "0 1px 4px rgba(55,48,163,0.06), 0 0 0 1px rgba(232,213,232,0.5)";

// -- Quick intents -------------------------------------------------------------
const QUICK_INTENT_KEYS = [
  "sessions.new.intent.mobility", "sessions.new.intent.pain", "sessions.new.intent.assessment",
  "sessions.new.intent.behaviour", "sessions.new.intent.rehab", "sessions.new.intent.equipment",
] as const;

const TAG_KEYS = [
  "sessions.new.tag.pain", "sessions.new.tag.mobility", "sessions.new.tag.strength",
  "sessions.new.tag.communication", "sessions.new.tag.behavior", "sessions.new.tag.equipment", "sessions.new.tag.review",
] as const;

// -- Schema --------------------------------------------------------------------
const sessionSchema = z.object({
  participant_id:    z.string().min(1),
  session_date:      z.date(),
  session_time:      z.string().min(1),
  duration_minutes:  z.coerce.number().min(1),
  session_type:      z.string().min(1),
  session_focus:     z.string().optional(),
  pre_session_notes: z.string().optional(),
  tags:              z.array(z.string()).default([]),
});
type SessionFormValues = z.infer<typeof sessionSchema>;

// -- Card wrapper --------------------------------------------------------------
function FormCard({
  icon, title, children, accent = false,
}: { icon?: React.ReactNode; title: string; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: CARD_SHADOW }}>
      <div
        className="flex items-center gap-2.5 px-6 py-4 border-b"
        style={{ borderColor: "rgba(232,213,232,0.4)" }}
      >
        {icon && (
          <span className="shrink-0" style={{ color: accent ? CORAL : PLUM }}>{icon}</span>
        )}
        <h2 className="text-[16px] font-semibold" style={{ color: T1 }}>{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

// -- Label ---------------------------------------------------------------------
function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] font-semibold uppercase tracking-widest mb-1.5" style={{ color: T3 }}>
      {children}
    </p>
  );
}

// -- Page ----------------------------------------------------------------------
export default function SessionNew() {
  const { translate } = useAccessibility();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: participants, isLoading } = useGetParticipants();
  const createSessionMutation = useCreateSession();

  const [selectedParticipantId, setSelectedParticipantId] = useState<string>("");
  const [selectedGoalIds,        setSelectedGoalIds       ] = useState<string[]>([]);

  const { data: selectedParticipant } = useGetParticipant(selectedParticipantId, {
    query: { enabled: !!selectedParticipantId, queryKey: ["getParticipant", selectedParticipantId] },
  });

  const participantGoals: NDISGoal[] = (
    (selectedParticipant?.goals as NDISGoal[] | null | undefined) ?? []
  ).filter(g => g.status === "active");

  useEffect(() => { setSelectedGoalIds([]); }, [selectedParticipantId]);

  const form = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: { duration_minutes: 60, tags: [], session_focus: "", pre_session_notes: "" },
  });

  const toggleGoal = (id: string) =>
    setSelectedGoalIds(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);

  const handleSubmit = (data: SessionFormValues, startNow: boolean) => {
    createSessionMutation.mutate(
      {
        data: {
          participant_id:   data.participant_id,
          session_date:     format(data.session_date, "yyyy-MM-dd"),
          duration_minutes: data.duration_minutes,
          session_type:     data.session_type,
          notes:            data.pre_session_notes ?? "",
          status:           "draft",
          goals_addressed:  selectedGoalIds,
        },
      },
      {
        onSuccess: (res: any) => {
          toast({ title: translate("sessions.new.toast.ready"), description: startNow ? translate("sessions.new.toast.opened") : translate("sessions.new.toast.saved") });
          setLocation(`/sessions/${res.id}`);
        },
      },
    );
  };

  const startDisabled = !!selectedParticipantId && selectedGoalIds.length === 0;

  return (
    <div className="space-y-6 pb-10">

      {/* -- Header -- */}
      <div>
        <h1 className="text-[24px] font-bold leading-tight tracking-tight" style={{ color: T1 }}>
          {translate("sessions.new.title")}
        </h1>
        <p className="text-[14px] mt-1" style={{ color: T2 }}>
          {translate("sessions.new.subtitle")}
        </p>
      </div>

      <Form {...form}>
        <form className="space-y-5">

          {/* -- Session Setup -- */}
          <FormCard icon={<Activity size={16} />} title={translate("sessions.new.setup")}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">

              {/* Participant */}
              <FormField
                control={form.control}
                name="participant_id"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FieldLabel>{translate("sessions.new.participant")}</FieldLabel>
                    <Select onValueChange={val => { field.onChange(val); setSelectedParticipantId(val); }}>
                      <SelectTrigger
                        disabled={isLoading}
                        className="rounded-xl h-[42px] text-[13px]"
                        style={{ borderColor: BORDER }}
                      >
                        <SelectValue placeholder={translate("sessions.new.selectParticipant")} />
                      </SelectTrigger>
                      <SelectContent>
                        {participants?.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />

              {/* Date */}
              <FormField
                control={form.control}
                name="session_date"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel>{translate("sessions.new.date")}</FieldLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="w-full flex items-center gap-2 px-3 h-[42px] rounded-xl border text-[13px] text-left transition-colors hover:bg-[#F6F4FB]"
                          style={{ borderColor: BORDER, color: field.value ? T1 : T3 }}
                        >
                          <CalendarIcon size={14} style={{ color: T3 }} />
                          {field.value ? format(field.value, "PPP") : translate("sessions.new.pickDate")}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent>
                        <Calendar mode="single" selected={field.value} onSelect={field.onChange} />
                      </PopoverContent>
                    </Popover>
                  </FormItem>
                )}
              />

              {/* Time */}
              <FormField
                control={form.control}
                name="session_time"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel>{translate("sessions.new.time")}</FieldLabel>
                    <div className="relative">
                      <Clock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: T3 }} />
                      <Input
                        type="time"
                        {...field}
                        className="pl-9 h-[42px] rounded-xl text-[13px]"
                        style={{ borderColor: BORDER }}
                      />
                    </div>
                  </FormItem>
                )}
              />

              {/* Duration */}
              <FormField
                control={form.control}
                name="duration_minutes"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel>{translate("sessions.new.duration")}</FieldLabel>
                    <Input
                      type="number"
                      {...field}
                      className="h-[42px] rounded-xl text-[13px]"
                      style={{ borderColor: BORDER }}
                    />
                  </FormItem>
                )}
              />

              {/* Session Type */}
              <FormField
                control={form.control}
                name="session_type"
                render={({ field }) => (
                  <FormItem>
                    <FieldLabel>{translate("sessions.new.sessionType")}</FieldLabel>
                    <Select onValueChange={field.onChange}>
                      <SelectTrigger
                        className="rounded-xl h-[42px] text-[13px]"
                        style={{ borderColor: BORDER }}
                      >
                        <SelectValue placeholder={translate("sessions.new.selectType")} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Assessment">{translate("sessions.new.type.assessment")}</SelectItem>
                        <SelectItem value="Therapy">{translate("sessions.new.type.therapy")}</SelectItem>
                        <SelectItem value="Review">{translate("sessions.new.type.review")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </div>
          </FormCard>

          {/* -- Goals � only after participant selected -- */}
          {selectedParticipantId && (
            <div
              className="bg-white rounded-2xl overflow-hidden"
              style={{
                boxShadow: selectedGoalIds.length === 0
                  ? `0 1px 4px rgba(217,119,6,0.12), 0 0 0 1.5px rgba(245,158,11,0.35)`
                  : CARD_SHADOW,
              }}
            >
              <div
                className="flex items-center justify-between px-6 py-4 border-b"
                style={{ borderColor: "rgba(232,213,232,0.4)" }}
              >
                <div className="flex items-center gap-2.5">
                  <Target size={16} style={{ color: PLUM }} />
                  <h2 className="text-[16px] font-semibold" style={{ color: T1 }}>{translate("sessions.new.goalsTitle")}</h2>
                </div>
                {selectedGoalIds.length === 0 && (
                  <span
                    className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide"
                    style={{ background: "rgba(245,158,11,0.10)", color: "#D97706" }}
                  >
                    {translate("common.required")}
                  </span>
                )}
              </div>

              <div className="p-6">
                {participantGoals.length === 0 ? (
                  <div
                    className="flex items-start gap-2.5 rounded-xl px-4 py-3.5"
                    style={{ background: `${PLUM}06`, border: `1px solid ${PLUM}18` }}
                  >
                    <AlertCircle size={14} className="shrink-0 mt-0.5" style={{ color: T3 }} />
                    <p className="text-[13px]" style={{ color: T2 }}>
                      {translate("sessions.new.noGoals")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {participantGoals.map(goal => (
                      <label
                        key={goal.id}
                        data-testid={`goal-checkbox-${goal.id}`}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors duration-150"
                        style={{
                          borderColor: selectedGoalIds.includes(goal.id)
                            ? `${PLUM}30`
                            : BORDER,
                          background: selectedGoalIds.includes(goal.id)
                            ? `${PLUM}06`
                            : "transparent",
                        }}
                      >
                        <Checkbox
                          checked={selectedGoalIds.includes(goal.id)}
                          onCheckedChange={() => toggleGoal(goal.id)}
                          id={`goal-${goal.id}`}
                        />
                        <span className="text-[13px] font-medium" style={{ color: T2 }}>{goal.title}</span>
                      </label>
                    ))}
                    {selectedGoalIds.length === 0 && (
                      <p className="flex items-center gap-1.5 text-[12px] mt-2" style={{ color: "#D97706" }}>
                        <AlertCircle size={12} className="shrink-0" />
                        {translate("sessions.new.selectGoalHint")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* -- Intelligence layer -- */}
          <FormCard icon={<Zap size={16} />} title={translate("sessions.new.intelligence")} accent>
            <div className="space-y-6">

              {/* Quick intents */}
              <div>
                <FieldLabel>{translate("sessions.new.quickIntent")}</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {QUICK_INTENT_KEYS.map(intentKey => {
                    const intent = translate(intentKey);
                    return (
                    <button
                      key={intentKey}
                      type="button"
                      onClick={() => form.setValue("session_focus", intent)}
                      className="px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all duration-150 hover:-translate-y-0.5"
                      style={{
                        borderColor: form.watch("session_focus") === intent ? CORAL : BORDER,
                        color: form.watch("session_focus") === intent ? CORAL : T2,
                        background: form.watch("session_focus") === intent ? `${CORAL}08` : "transparent",
                      }}
                    >
                      {intent}
                    </button>
                  );})}
                </div>
              </div>

              {/* Session focus */}
              <div>
                <FieldLabel>{translate("sessions.new.sessionFocus")}</FieldLabel>
                <SmartInput
                  id="session_focus"
                  placeholder={translate("sessions.new.sessionFocusPlaceholder")}
                  value={form.watch("session_focus") ?? ""}
                  onChange={v => form.setValue("session_focus", v)}
                />
              </div>

              {/* Pre-session notes */}
              <div>
                <FieldLabel>{translate("sessions.new.preSessionNotes")}</FieldLabel>
                <SmartTextarea
                  id="pre_session_notes"
                  placeholder={translate("sessions.new.preSessionNotesPlaceholder")}
                  rows={3}
                  value={form.watch("pre_session_notes") ?? ""}
                  onChange={v => form.setValue("pre_session_notes", v)}
                />
              </div>

              {/* Tags */}
              <div>
                <FieldLabel>{translate("sessions.new.tags")}</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {TAG_KEYS.map(tagKey => {
                    const tag = translate(tagKey);
                    const active = form.watch("tags").includes(tag);
                    return (
                      <button
                        key={tagKey}
                        type="button"
                        onClick={() => {
                          const cur = form.getValues("tags");
                          form.setValue("tags", active ? cur.filter(t => t !== tag) : [...cur, tag]);
                        }}
                        className="px-3 py-1.5 rounded-full text-[12px] font-medium border transition-all duration-150"
                        style={{
                          background: active ? PLUM : "transparent",
                          color:      active ? "white" : T2,
                          borderColor: active ? PLUM : BORDER,
                        }}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </FormCard>

          {/* -- Actions -- */}
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => history.back()}
              className="px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-colors duration-150 hover:bg-[#F6F4FB]"
              style={{ borderColor: BORDER, color: T2 }}
            >
              {translate("common.cancel")}
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={form.handleSubmit(d => handleSubmit(d, false))}
                className="px-4 py-2.5 rounded-xl text-[13px] font-semibold border transition-all duration-150 hover:bg-[#F6F4FB]"
                style={{ borderColor: BORDER, color: T2 }}
              >
                {translate("sessions.new.saveDraft")}
              </button>

              <button
                type="button"
                data-testid="button-start-session"
                onClick={form.handleSubmit(d => handleSubmit(d, true))}
                disabled={startDisabled || createSessionMutation.isPending}
                title={startDisabled ? translate("sessions.new.startDisabled") : undefined}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-white text-[13px] font-bold transition-all duration-200 hover:opacity-90 disabled:opacity-40"
                style={{ background: "var(--cc-cta)" }}
              >
                {createSessionMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                {translate("sessions.new.startSession")}
              </button>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
