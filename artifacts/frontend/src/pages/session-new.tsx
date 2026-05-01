import { useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import {
  useGetParticipants,
  useCreateSession,
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
import { useToast } from "@/hooks/use-toast";
import { SmartInput, SmartTextarea } from "@/components/SmartInput";

import {
  CalendarIcon,
  Clock,
  Activity,
  Loader2,
  Zap,
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
                    <Select onValueChange={field.onChange}>
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
                >
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
