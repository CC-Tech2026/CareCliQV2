import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  evaluateWorkerCompliance,
  type ComplianceEvaluation,
} from "@workspace/worker-compliance";
import { FontFamily } from "@/constants/typography";
import { useColors } from "@/hooks/useColors";
import type { SessionNoteRecord, ShiftTask } from "@/lib/worker-api";

export function TaskDocumentationReview({
  tasks,
  notes,
  compliance,
  participantFirstName,
  onOpenTask,
}: {
  tasks: ShiftTask[];
  notes: SessionNoteRecord[];
  compliance: ComplianceEvaluation;
  participantFirstName?: string;
  onOpenTask: (id: string) => void;
}) {
  const c = useColors();
  const [expanded, setExpanded] = useState<string | null>(null);
  const reviews = tasks.map((task) => {
    const linked = notes.filter((n) => n.task_id === task.task_id);
    const textNotes = linked.filter(
      (n) =>
        n.content?.trim() &&
        n.note_type !== "photo" &&
        n.note_type !== "voice" &&
        !/^\[Attachment/i.test(n.content),
    );
    const evidenceNotes = textNotes.length
      ? textNotes
      : task.note?.trim()
        ? [{ note_id: task.task_id, task_id: task.task_id, content: task.note }]
        : [];
    const prompts: string[] = [];
    if (!task.marked_na) {
      if (!evidenceNotes.length)
        prompts.push(
          "Add a note: what support did you provide and how did the participant respond?",
        );
      else {
        const review = evaluateWorkerCompliance({
          tasks: [task],
          notes: evidenceNotes,
          participantFirstName,
        });
        if (review.rules.some((r) => r.id === 3 && r.status !== "pass"))
          prompts.push(
            "Add more detail: describe the support and response in at least 10 words.",
          );
        if (review.rules.some((r) => r.id === 4 && r.status !== "pass"))
          prompts.push("Identify the participant by name or pronoun.");
        if (review.rules.some((r) => r.id === 5 && r.status !== "pass"))
          prompts.push(
            "Describe a specific observation: what happened, for how long, or what changed?",
          );
      }
      if (task.evidence_required?.trim())
        prompts.push("Check required evidence: " + task.evidence_required);
      for (const flag of compliance.noteFlags.filter(
        (f) =>
          linked.some((n) => n.note_id === f.noteId) &&
          ![3, 4, 5].includes(f.ruleId),
      ))
        prompts.push(flag.message);
    }
    return {
      task,
      prompts: [...new Set(prompts)],
      count: evidenceNotes.length,
      photo: task.has_photo || linked.some((n) => n.note_type === "photo"),
      voice: task.has_voice || linked.some((n) => n.note_type === "voice"),
    };
  });
  const needingReview = reviews.filter((r) => r.prompts.length).length;
  return (
    <View style={[s.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={s.header}>
        <Text
          accessibilityRole="header"
          style={[s.title, { color: c.foreground }]}
        >
          Documentation by task
        </Text>
        <Text style={[s.caption, { color: c.mutedForeground }]}>
          {needingReview} to review
        </Text>
      </View>
      <Text style={[s.caption, { color: c.mutedForeground }]}>
        Writing prompts and recorded evidence. The shift quality score covers
        the whole shift.
      </Text>
      {!reviews.length ? (
        <Text style={[s.body, { color: c.mutedForeground }]}>
          No tasks assigned.
        </Text>
      ) : null}
      {reviews.map(({ task, prompts, count, photo, voice }) => {
        const open = expanded === task.task_id;
        const status = task.marked_na
          ? "Not applicable"
          : prompts.length
            ? "Review"
            : "Note recorded";
        return (
          <View
            key={task.task_id}
            style={[s.row, { borderTopColor: c.border }]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              onPress={() => setExpanded(open ? null : task.task_id)}
              style={s.toggle}
            >
              <Text style={[s.rowTitle, { color: c.foreground }]}>
                {task.label}
              </Text>
              <Text
                style={[
                  s.badge,
                  { color: prompts.length ? c.warning : c.mutedForeground },
                ]}
              >
                {status}
              </Text>
              <Feather
                name={open ? "chevron-up" : "chevron-down"}
                size={16}
                color={c.mutedForeground}
              />
            </Pressable>
            {prompts.length && !open ? (
              <Text
                style={[s.body, { color: c.mutedForeground }]}
                numberOfLines={1}
              >
                {prompts[0]}
              </Text>
            ) : null}
            {open ? (
              <View style={s.details}>
                <Text style={[s.caption, { color: c.mutedForeground }]}>
                  {count} text {count === 1 ? "note" : "notes"}
                  {photo ? " · Photo recorded" : ""}
                  {voice ? " · Voice recorded" : ""}
                </Text>
                {task.marked_na ? (
                  <Text style={[s.body, { color: c.mutedForeground }]}>
                    {task.na_reason || "No reason recorded."}
                  </Text>
                ) : (
                  prompts.map((prompt, i) => (
                    <View key={i} style={s.prompt}>
                      <Feather name="edit-3" size={13} color={c.primary} />
                      <Text style={[s.body, { color: c.foreground, flex: 1 }]}>
                        {prompt}
                      </Text>
                    </View>
                  ))
                )}
                {!task.marked_na && !prompts.length ? (
                  <Text style={[s.body, { color: c.mutedForeground }]}>
                    No writing prompts from the current checks. Confirm the note
                    is accurate and complete.
                  </Text>
                ) : null}
              </View>
            ) : null}
            {open ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open documentation for ${task.label}`}
                onPress={() => onOpenTask(task.task_id)}
                style={s.action}
              >
                <Text style={[s.actionText, { color: c.primary }]}>
                  {task.marked_na ? "View task" : "Review / add documentation"}
                </Text>
                <Feather name="arrow-right" size={14} color={c.primary} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
const s = StyleSheet.create({
  card: {
    marginHorizontal: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  title: { fontFamily: FontFamily.interSemiBold, fontSize: 14, lineHeight: 20 },
  caption: {
    fontFamily: FontFamily.interRegular,
    fontSize: 11,
    lineHeight: 17,
  },
  body: { fontFamily: FontFamily.interRegular, fontSize: 12, lineHeight: 18 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6 },
  toggle: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  rowTitle: {
    flex: 1,
    fontFamily: FontFamily.interSemiBold,
    fontSize: 13,
    lineHeight: 19,
  },
  badge: { fontFamily: FontFamily.interMedium, fontSize: 11 },
  details: { gap: 8 },
  prompt: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  action: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  actionText: { fontFamily: FontFamily.interSemiBold, fontSize: 12 },
});
