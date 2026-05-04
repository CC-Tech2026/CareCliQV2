import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
  useGetParticipants,
  useGetParticipant,
  useCreateSession,
  type NDISGoal,
} from "@workspace/api-client-react";
import { format } from "date-fns";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
} from "@/components/ui/form";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { SmartInput, SmartTextarea } from "@/components/SmartInput";

import {
  CalendarIcon,
  Clock,
  Activity,
  Loader2,
  Zap,
  Target,
  AlertCircle,
} from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { Calendar } from "@/components/ui/calendar";

/* ---------------- TAGS ---------------- */

const AVAILABLE_TAGS = [
  "Pain",
  "Mobility",
  "Strength",
  "Communication",
  "Behavior",
  "Equipment",
  "Review",
];

/* ---------------- QUICK INTENTS (NEW UX LAYER) ---------------- */

const QUICK_INTENTS = [
  "Improve mobility",
  "Pain management session",
  "Functional assessment",
  "Behavior support",
  "Post-injury rehab",
  "Equipment training",
];

/* ---------------- SCHEMA ---------------- */

const sessionSchema = z.object({
  participant_id: z.string().min(1),
  session_date: z.date(),
  session_time: z.string().min(1),
  duration_minutes: z.coerce.number().min(1),
  session_type: z.string().min(1),
  session_focus: z.string().optional(),
  pre_session_notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

type SessionFormValues = z.infer<typeof sessionSchema>;


/* ---------------- COMPONENT ---------------- */

export default function SessionNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: participants, isLoading } = useGetParticipants();
  const createSessionMutation = useCreateSession();

  // Track selected participant's ID for goal fetching
  const [selectedParticipantId, setSelectedParticipantId] = useState<string>("");
  const [selectedGoalIds, setSelectedGoalIds] = useState<string[]>([]);

  // Fetch selected participant's goals
  const { data: selectedParticipant } = useGetParticipant(selectedParticipantId, {
    query: { enabled: !!selectedParticipantId, queryKey: ["getParticipant", selectedParticipantId] },
  });

  // Parse active goals from participant data (backend always normalises to NDISGoal format)
  const participantGoals: NDISGoal[] = (
    (selectedParticipant?.goals as NDISGoal[] | null | undefined) ?? []
  ).filter((g) => g.status === "active");

  // Reset goal selection when participant changes
  useEffect(() => {
    setSelectedGoalIds([]);
  }, [selectedParticipantId]);

  const form = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      duration_minutes: 60,
      tags: [],
      session_focus: "",
      pre_session_notes: "",
    },
  });

  const setField = (name: any, value: string) => {
    form.setValue(name, value);
  };

  const toggleGoal = (goalId: string) => {
    setSelectedGoalIds((prev) =>
      prev.includes(goalId) ? prev.filter((id) => id !== goalId) : [...prev, goalId],
    );
  };

  /* ---------------- SUBMIT ---------------- */

  const handleSubmit = (data: SessionFormValues, startNow: boolean) => {
    createSessionMutation.mutate(
      {
        data: {
          participant_id: data.participant_id,
          session_date: format(data.session_date, "yyyy-MM-dd"),
          duration_minutes: data.duration_minutes,
          session_type: data.session_type,
          notes: data.pre_session_notes ?? "",
          status: "draft",
          goals_addressed: selectedGoalIds,
        },
      },
      {
        onSuccess: (res) => {
          toast({
            title: "Session Ready",
            description: startNow
              ? "Starting live session..."
              : "Session saved",
          });

          setLocation(
            startNow ? `/sessions/${res.id}/live` : `/sessions/${res.id}`,
          );
        },
      },
    );
  };

  // "Start Session" is disabled whenever a participant is selected and no goals are chosen.
  // Participants with no active goals must add goals on the profile before starting a session.
  const startDisabled = !!selectedParticipantId && selectedGoalIds.length === 0;

  /* ---------------- UI ---------------- */

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* HEADER */}
      <div>
        <h1 className="text-2xl font-bold">Prepare Session</h1>
        <p className="text-slate-500">
          Fast setup — minimal typing, smart assistance enabled.
        </p>
      </div>

      <Form {...form}>
        <form className="space-y-6">
          {/* SESSION CORE */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Session Setup
              </CardTitle>
            </CardHeader>

            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* PARTICIPANT */}
              <FormField
                control={form.control}
                name="participant_id"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Participant</FormLabel>
                    <Select onValueChange={(val) => { field.onChange(val); setSelectedParticipantId(val); }}>
                      <SelectTrigger disabled={isLoading}>
                        <SelectValue placeholder="Select participant" />
                      </SelectTrigger>
                      <SelectContent>
                        {participants?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />

              {/* DATE */}
              <FormField
                control={form.control}
                name="session_date"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full">
                          {field.value
                            ? format(field.value, "PPP")
                            : "Pick date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent>
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                        />
                      </PopoverContent>
                    </Popover>
                  </FormItem>
                )}
              />

              {/* TIME */}
              <FormField
                control={form.control}
                name="session_time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Time</FormLabel>
                    <Input type="time" {...field} />
                  </FormItem>
                )}
              />

              {/* TYPE */}
              <FormField
                control={form.control}
                name="session_type"
                render={({ field }) => (
                  <FormItem className="md:col-span-2">
                    <FormLabel>Session Type</FormLabel>
                    <Select onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Assessment">Assessment</SelectItem>
                        <SelectItem value="Therapy">Therapy</SelectItem>
                        <SelectItem value="Review">Review</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* GOALS SELECTION — shown after participant is selected */}
          {selectedParticipantId && (
            <Card className={selectedGoalIds.length === 0 ? "border-amber-300" : ""}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Target className="h-4 w-4 text-indigo-500" />
                  NDIS Goals for This Session
                  {selectedGoalIds.length === 0 && (
                    <Badge variant="outline" className="ml-auto text-amber-700 border-amber-300 bg-amber-50 text-[10px]">
                      Required
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {participantGoals.length === 0 ? (
                  <div className="flex items-start gap-2 p-3 bg-slate-50 rounded-lg border border-slate-200 text-sm text-slate-600">
                    <AlertCircle className="h-4 w-4 text-slate-400 mt-0.5 shrink-0" />
                    <span>
                      This participant has no active goals. Add goals on the participant profile before starting a session.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {participantGoals.map((goal) => (
                      <label
                        key={goal.id}
                        className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 hover:bg-slate-50 cursor-pointer transition-colors"
                        data-testid={`goal-checkbox-${goal.id}`}
                      >
                        <Checkbox
                          checked={selectedGoalIds.includes(goal.id)}
                          onCheckedChange={() => toggleGoal(goal.id)}
                          id={`goal-${goal.id}`}
                        />
                        <span className="text-sm text-slate-800">{goal.title}</span>
                      </label>
                    ))}
                    {selectedGoalIds.length === 0 && (
                      <p className="text-xs text-amber-700 flex items-center gap-1.5 mt-2">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                        Select at least one participant goal before starting the session to meet NDIS documentation requirements.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* SMART LAYER */}
          <Card>
            <CardHeader>
              <CardTitle>Session Intelligence Layer</CardTitle>
            </CardHeader>

            <CardContent className="space-y-5">
              {/* QUICK INTENT */}
              <div>
                <label className="text-sm font-medium flex items-center gap-2">
                  <Zap className="w-4 h-4 text-indigo-500" />
                  Quick Intent
                </label>

                <div className="flex flex-wrap gap-2 mt-2">
                  {QUICK_INTENTS.map((intent) => (
                    <Badge
                      key={intent}
                      className="cursor-pointer"
                      onClick={() => setField("session_focus", intent)}
                    >
                      {intent}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* SESSION FOCUS */}
              <div>
                <label className="text-sm font-medium block mb-1.5">
                  Session Focus
                </label>
                <SmartInput
                  id="session_focus"
                  placeholder="e.g. improve mobility — or tap the mic to speak"
                  value={form.watch("session_focus") ?? ""}
                  onChange={(v) => form.setValue("session_focus", v)}
                />
              </div>

              {/* NOTES */}
              <div>
                <label className="text-sm font-medium block mb-1.5">
                  Pre-session Notes
                </label>
                <SmartTextarea
                  id="pre_session_notes"
                  placeholder="Anything important to know before starting — or tap the mic to dictate in any language"
                  rows={3}
                  value={form.watch("pre_session_notes") ?? ""}
                  onChange={(v) => form.setValue("pre_session_notes", v)}
                />
              </div>

              {/* TAGS */}
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_TAGS.map((tag) => {
                  const active = form.watch("tags").includes(tag);
                  return (
                    <Badge
                      key={tag}
                      variant={active ? "default" : "outline"}
                      onClick={() => {
                        const cur = form.getValues("tags");
                        form.setValue(
                          "tags",
                          active ? cur.filter((t) => t !== tag) : [...cur, tag],
                        );
                      }}
                      className="cursor-pointer"
                    >
                      {tag}
                    </Badge>
                  );
                })}
              </div>
            </CardContent>

            {/* ACTIONS */}
            <CardFooter className="flex justify-between">
              <Button variant="ghost">Cancel</Button>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={form.handleSubmit((d) => handleSubmit(d, false))}
                >
                  Save
                </Button>

                <Button
                  onClick={form.handleSubmit((d) => handleSubmit(d, true))}
                  disabled={startDisabled || createSessionMutation.isPending}
                  title={startDisabled ? "Select at least one participant goal before starting the session to meet NDIS documentation requirements." : undefined}
                  data-testid="button-start-session"
                >
                  {createSessionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Start Session
                </Button>
              </div>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </div>
  );
}
