import { useState } from "react";
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
  CardDescription,
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
  FormMessage,
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
import {
  CalendarIcon,
  Clock,
  Activity,
  FileText,
  Check,
  Loader2,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";

const AVAILABLE_TAGS = [
  "Pain",
  "Mobility",
  "Strength",
  "Communication",
  "Behavior",
  "Equipment",
  "Review",
];

const sessionSchema = z.object({
  participant_id: z.string().min(1, "Participant is required"),
  session_date: z.date({
    required_error: "Date is required",
  }),
  duration_minutes: z.coerce
    .number()
    .min(1, "Duration must be at least 1 minute"),
  session_type: z.string().min(1, "Session type is required"),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  goals_addressed: z.string().optional(),
});

type SessionFormValues = z.infer<typeof sessionSchema>;

export default function SessionNew() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: participants, isLoading: participantsLoading } =
    useGetParticipants();
  const createSessionMutation = useCreateSession();

  const form = useForm<SessionFormValues>({
    resolver: zodResolver(sessionSchema),
    defaultValues: {
      duration_minutes: 60,
      tags: [],
      notes: "",
      goals_addressed: "",
    },
  });

  const onSubmit = (data: SessionFormValues, isDraft: boolean) => {
    // Parse goals into array if comma separated
    const goalsArray = data.goals_addressed
      ? data.goals_addressed
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    createSessionMutation.mutate(
      {
        data: {
          participant_id: data.participant_id,
          session_date: format(data.session_date, "yyyy-MM-dd"),
          duration_minutes: data.duration_minutes,
          session_type: data.session_type,
          notes: data.notes,
          tags: data.tags,
          goals_addressed: goalsArray,
          status: isDraft ? "draft" : "completed",
        },
      },
      {
        onSuccess: (response) => {
          toast({
            title: isDraft ? "Draft Saved" : "Session Created",
            description: "Your session has been successfully recorded.",
          });
          setLocation(`/sessions/${response.id}`);
        },
        onError: () => {
          toast({
            title: "Error",
            description: "Failed to create session. Please try again.",
            variant: "destructive",
          });
        },
      },
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">New Session</h1>
        <p className="text-slate-500 dark:text-slate-400">
          Record a new clinical session with a participant.
        </p>
      </div>

      <Form {...form}>
        <form className="space-y-6">
          <Card>
            <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4" /> Session Details
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
              <FormField
                control={form.control}
                name="participant_id"
                render={({ field }) => (
                  <FormItem className="col-span-1 md:col-span-2">
                    <FormLabel>Participant</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger
                          disabled={participantsLoading}
                          data-testid="select-participant"
                        >
                          <SelectValue
                            placeholder={
                              participantsLoading
                                ? "Loading participants..."
                                : "Select a participant"
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {participants?.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="session_date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant={"outline"}
                            className={`w-full pl-3 text-left font-normal ${!field.value && "text-muted-foreground"}`}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) =>
                            date > new Date() || date < new Date("1900-01-01")
                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="duration_minutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Duration (minutes)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Clock className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                        <Input type="number" className="pl-9" {...field} />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="session_type"
                render={({ field }) => (
                  <FormItem className="col-span-1 md:col-span-2">
                    <FormLabel>Session Type</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="e.g., Initial Assessment, Therapy Session" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="Initial Assessment">
                          Initial Assessment
                        </SelectItem>
                        <SelectItem value="Therapy Session">
                          Therapy Session
                        </SelectItem>
                        <SelectItem value="Review">Review</SelectItem>
                        <SelectItem value="Telehealth">Telehealth</SelectItem>
                        <SelectItem value="Report Writing">
                          Report Writing
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-4 border-b border-slate-100 dark:border-slate-800">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4" /> Clinical Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Session Notes</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Document observations, interventions, and outcomes..."
                        className="min-h-[200px] resize-y"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="goals_addressed"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Goals Addressed (comma separated)</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="e.g., Improve core strength, Increase community access"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription className="text-xs text-slate-500 mt-1">
                      Link these notes to the participant's NDIS goals for
                      compliance.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Clinical Tags</FormLabel>
                    <div className="flex flex-wrap gap-2 mt-2">
                      {AVAILABLE_TAGS.map((tag) => {
                        const isSelected = field.value.includes(tag);
                        return (
                          <Badge
                            key={tag}
                            variant={isSelected ? "default" : "outline"}
                            className="cursor-pointer hover:bg-primary/90 transition-colors"
                            onClick={() => {
                              if (isSelected) {
                                field.onChange(
                                  field.value.filter((t) => t !== tag),
                                );
                              } else {
                                field.onChange([...field.value, tag]);
                              }
                            }}
                          >
                            {tag}
                            {isSelected && <Check className="ml-1 h-3 w-3" />}
                          </Badge>
                        );
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
            <CardFooter className="flex justify-between border-t border-slate-100 dark:border-slate-800 pt-6">
              <Button
                variant="ghost"
                type="button"
                onClick={() => window.history.back()}
              >
                Cancel
              </Button>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  type="button"
                  disabled={createSessionMutation.isPending}
                  onClick={form.handleSubmit((data) => onSubmit(data, true))}
                >
                  Save Draft
                </Button>
                <Button
                  type="button"
                  disabled={createSessionMutation.isPending}
                  onClick={form.handleSubmit((data) => onSubmit(data, false))}
                  data-testid="button-save-session"
                >
                  {createSessionMutation.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Complete Session
                </Button>
              </div>
            </CardFooter>
          </Card>
        </form>
      </Form>
    </div>
  );
}

// Minimal stub for form description component
function FormDescription({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={className}>{children}</p>;
}
