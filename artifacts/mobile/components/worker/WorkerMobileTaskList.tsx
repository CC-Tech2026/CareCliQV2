import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { WorkerMobileComposer } from "@/components/worker/WorkerMobileComposer";
import { WorkerMobileMedicationChecklist } from "@/components/worker/WorkerMobileMedicationChecklist";
import { WorkerMobileNoteBubble } from "@/components/worker/WorkerMobileNoteBubble";
import { WorkerMobilePrnMedications } from "@/components/worker/WorkerMobilePrnMedications";
import type { SessionNoteRecord, ShiftTask } from "@/lib/worker-api";
import { isMandatoryTask } from "@/lib/shift-utils";
import type { ComplianceEvaluation } from "@workspace/worker-compliance";

type Props = {
  tasks: ShiftTask[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string | null) => void;
  onToggleTask: (taskId: string) => void;
  taskCanComplete?: (task: ShiftTask) => boolean;
  disabled?: boolean;
  shiftId?: string;
  sessionId: string | null;
  participantName: string;
  sessionNotes: SessionNoteRecord[];
  compliance: ComplianceEvaluation;
  onNoteSaved: (note: SessionNoteRecord) => void | Promise<void>;
  onOpenIncidentReport?: (noteId?: string, content?: string) => void;
};

/**
 * One task = one chat thread, matching the web app's per-task evidence
 * panel (ShiftTaskEvidencePanel, variant="thread"): tap a task to expand it
 * and get its own notes thread with an embedded composer (type, record
 * voice, attach a photo/file) scoped to that task - not a single shared
 * composer pinned across the whole screen that the worker has to keep
 * re-aiming at whichever task they meant by re-selecting it.
 */
export function WorkerMobileTaskList({
  tasks,
  activeTaskId,
  onSelectTask,
  onToggleTask,
  taskCanComplete,
  disabled,
  shiftId,
  sessionId,
  participantName,
  sessionNotes,
  compliance,
  onNoteSaved,
  onOpenIncidentReport,
}: Props) {
  const colors = useColors();
  const active = tasks.filter((t) => !t.marked_na);

  return (
    <View>
      {active.map((task, index) => {
        const expanded = activeTaskId === task.task_id;
        const done = task.completed;
        const isMedication = task.category === "medication";
        const canComplete = taskCanComplete?.(task) ?? true;
        const required = isMandatoryTask(task);
        const taskNotes = sessionNotes.filter((n) => n.task_id === task.task_id);

        return (
          <View
            key={task.task_id}
            style={[
              styles.item,
              {
                borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                borderTopColor: colors.border,
                backgroundColor: done ? colors.success + "10" : expanded ? colors.primary + "08" : "transparent",
                borderLeftWidth: done ? 3 : 0,
                borderLeftColor: colors.success,
              },
            ]}
          >
            <View style={styles.row}>
              <Pressable
                disabled={disabled || isMedication}
                onPress={() => {
                  if (!done && !canComplete) {
                    onSelectTask(task.task_id);
                    onToggleTask(task.task_id);
                    return;
                  }
                  onToggleTask(task.task_id);
                }}
                style={[
                  styles.checkbox,
                  {
                    borderColor: done ? colors.success : colors.border,
                    backgroundColor: done ? colors.success : "transparent",
                    opacity: !done && (isMedication || !canComplete) ? 0.4 : 1,
                  },
                ]}
              >
                {done && <Feather name="check" size={12} color="#FFFFFF" />}
              </Pressable>

              <Pressable
                disabled={disabled}
                onPress={() => onSelectTask(expanded ? null : task.task_id)}
                style={styles.taskContent}
              >
                <View style={styles.titleRow}>
                  <Text
                    style={[
                      styles.label,
                      { color: done ? colors.mutedForeground : colors.foreground, fontFamily: "Inter_600SemiBold", flex: 1 },
                      done && styles.strikethrough,
                    ]}
                  >
                    {task.label}
                  </Text>
                  <View
                    style={[
                      styles.requirementBadge,
                      {
                        backgroundColor: required ? "#FEE2E2" : colors.muted,
                        borderColor: required ? "#FECACA" : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.requirementText,
                        {
                          color: required ? "#B91C1C" : colors.mutedForeground,
                          fontFamily: "Inter_600SemiBold",
                        },
                      ]}
                    >
                      {required ? "Required" : "Optional"}
                    </Text>
                  </View>
                  <Feather
                    name={expanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.mutedForeground}
                  />
                </View>
                {task.goal_title ? (
                  <View style={[styles.goalBadge, { backgroundColor: colors.primary + "15" }]}>
                    <Text style={[styles.goalText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                      {task.goal_title}
                    </Text>
                  </View>
                ) : null}
                {!expanded && (
                  <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    {isMedication
                      ? "Tap to log doses · completes automatically"
                      : taskNotes.length > 0
                        ? `${taskNotes.length} update${taskNotes.length === 1 ? "" : "s"} · Tap to add more`
                        : "Tap to add updates"}
                  </Text>
                )}
              </Pressable>
            </View>

            {expanded && (
              <View style={styles.expanded}>
                {task.description ? (
                  <Text style={[styles.description, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                    {task.description}
                  </Text>
                ) : null}
                {task.evidence_required && task.evidence_required !== "none" ? (
                  <Text style={[styles.evidenceHint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                    Evidence: {String(task.evidence_required).replace(/_/g, " ")}
                  </Text>
                ) : null}

                {isMedication && shiftId && (
                  <View style={[styles.medicationBox, { borderColor: colors.border }]}>
                    <WorkerMobileMedicationChecklist
                      shiftId={shiftId}
                      disabled={disabled}
                      onStatusChange={(allLogged, hasScheduled) => {
                        if (allLogged && hasScheduled && !task.completed) {
                          onToggleTask(task.task_id);
                        }
                      }}
                    />
                    <WorkerMobilePrnMedications shiftId={shiftId} sessionId={sessionId} disabled={disabled} />
                  </View>
                )}

                <View style={[styles.thread, { borderColor: colors.border, backgroundColor: colors.background }]}>
                  {taskNotes.length === 0 ? (
                    <View style={styles.emptyThread}>
                      <View style={[styles.emptyIcon, { backgroundColor: colors.primary + "15" }]}>
                        <Feather name="message-circle" size={18} color={colors.primary} />
                      </View>
                      <Text style={[styles.emptyTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
                        No updates yet.
                      </Text>
                      <Text style={[styles.emptyBody, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}>
                        Type a note, take a photo, or record your voice below.
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.threadNotes}>
                      {taskNotes.map((note) => (
                        <WorkerMobileNoteBubble
                          key={note.note_id}
                          note={note}
                          participantName={participantName}
                          goalTitle={task.goal_title ?? undefined}
                          flag={compliance.noteFlags.find((f) => f.noteId === note.note_id)}
                          onIncidentReport={
                            compliance.noteFlags.find((f) => f.noteId === note.note_id)?.severity === "fail"
                              ? onOpenIncidentReport
                              : undefined
                          }
                        />
                      ))}
                    </View>
                  )}
                </View>

                <WorkerMobileComposer
                  sessionId={sessionId}
                  taskId={task.task_id}
                  taskLabel={task.label}
                  participantName={participantName}
                  disabled={disabled || !sessionId}
                  onNoteSaved={onNoteSaved}
                />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  item: {
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  taskContent: {
    flex: 1,
    gap: 4,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
  },
  strikethrough: {
    textDecorationLine: "line-through",
  },
  hint: {
    fontSize: 11,
    lineHeight: 15,
  },
  requirementBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  requirementText: {
    fontSize: 10,
    lineHeight: 14,
  },
  goalBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
    marginTop: 2,
  },
  goalText: {
    fontSize: 10,
  },
  expanded: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
  },
  description: {
    fontSize: 12,
    lineHeight: 18,
    fontStyle: "italic",
  },
  evidenceHint: {
    fontSize: 11,
    lineHeight: 16,
  },
  medicationBox: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  thread: {
    minHeight: 110,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: 12,
    padding: 12,
  },
  emptyThread: {
    flex: 1,
    minHeight: 86,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  emptyIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 12,
  },
  emptyBody: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    maxWidth: 220,
  },
  threadNotes: {
    gap: 8,
  },
});
