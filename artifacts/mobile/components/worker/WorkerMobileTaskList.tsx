import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { ShiftTask } from "@/lib/worker-api";
import { isMandatoryTask } from "@/lib/shift-utils";

type Props = {
  tasks: ShiftTask[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onToggleTask: (taskId: string) => void;
  taskCanComplete?: (task: ShiftTask) => boolean;
  disabled?: boolean;
};

export function WorkerMobileTaskList({
  tasks,
  activeTaskId,
  onSelectTask,
  onToggleTask,
  taskCanComplete,
  disabled,
}: Props) {
  const colors = useColors();
  const active = tasks.filter((t) => !t.marked_na);

  return (
    <View>
      {active.map((task, index) => {
        const focused = activeTaskId === task.task_id;
        const done = task.completed;
        const canComplete = taskCanComplete?.(task) ?? true;
        const required = isMandatoryTask(task);

        return (
          <View
            key={task.task_id}
            style={[
              styles.row,
              {
                backgroundColor: focused ? colors.primary + "10" : "transparent",
                borderTopWidth: index > 0 ? StyleSheet.hairlineWidth : 0,
                borderTopColor: colors.border,
              },
            ]}
          >
            <Pressable
              disabled={disabled}
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
                  borderColor: done ? "#22C55E" : colors.border,
                  backgroundColor: done ? "#22C55E" : "transparent",
                  opacity: !done && !canComplete ? 0.4 : 1,
                },
              ]}
            >
              {done && <Feather name="check" size={12} color="#FFFFFF" />}
            </Pressable>

            <Pressable
              disabled={disabled}
              onPress={() => onSelectTask(task.task_id)}
              style={styles.taskContent}
            >
              {focused && <View style={[styles.focusDot, { backgroundColor: colors.accent }]} />}
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
              </View>
              {task.description ? (
                <Text style={[styles.description, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  {task.description}
                </Text>
              ) : null}
              {task.goal_title ? (
                <View style={[styles.goalBadge, { backgroundColor: colors.primary + "15" }]}>
                  <Text style={[styles.goalText, { color: colors.primary, fontFamily: "Inter_600SemiBold" }]}>
                    {task.goal_title}
                  </Text>
                </View>
              ) : null}
              {task.evidence_required && task.evidence_required !== "none" ? (
                <Text style={[styles.description, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
                  Evidence: {String(task.evidence_required).replace(/_/g, " ")}
                </Text>
              ) : null}
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
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
  focusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginBottom: 2,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  label: {
    fontSize: 14,
    lineHeight: 20,
  },
  strikethrough: {
    textDecorationLine: "line-through",
  },
  description: {
    fontSize: 12,
    lineHeight: 17,
  },
  requirementBadge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginTop: 1,
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
    marginTop: 4,
  },
  goalText: {
    fontSize: 10,
  },
});
