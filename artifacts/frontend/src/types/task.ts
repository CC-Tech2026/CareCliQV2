/**Task type definitions for shift-based task management.*/

export type TaskCategory =
  | "personal_care"
  | "medication"
  | "domestic_assistance"
  | "community_access"
  | "transport"
  | "other";

export type TaskPriority = "low" | "medium" | "high";

export type ShiftType = "morning" | "afternoon" | "night" | "anytime";

export type RecurrenceType = "one_off" | "recurring";

export type RecurrenceFrequency =
  | "every_matching_shift"
  | "daily_regardless_of_shift"
  | "specific_weekdays";

export type RequirementLevel = "mandatory" | "optional";

export type EvidenceRequired = "none" | "photo" | "notes" | "photo_and_notes";

export type TaskTemplateStatus = "active" | "paused" | "archived";

export type TaskInstanceStatus = "pending" | "completed" | "missed" | "carried_over";

export interface TaskTemplate {
  id: string;
  participant_id: string;
  title: string;
  category: TaskCategory;
  priority: TaskPriority;
  primary_shift_type: ShiftType;
  additional_shift_types: ShiftType[];
  recurrence_type: RecurrenceType;
  recurrence_frequency: RecurrenceFrequency | null;
  recurrence_weekdays: number[] | null;
  due_window_start: string | null;
  due_window_end: string | null;
  assigned_worker_id: string | null;
  linked_goal_id: string | null;
  notes: string | null;
  requirement_level: RequirementLevel;
  evidence_required: EvidenceRequired;
  status: TaskTemplateStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TaskInstance {
  id: string;
  task_template_id: string | null;
  shift_id: string;
  participant_id: string;
  due_window_start: string | null;
  due_window_end: string | null;
  status: TaskInstanceStatus;
  completed_by: string | null;
  completed_at: string | null;
  evidence_photo_url: string | null;
  evidence_notes: string | null;
  completion_notes: string | null;
  carried_over_from_instance_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskSuggestion {
  suggestion_text: string | null;
  evidence_recommendation: EvidenceRequired | null;
  sources: Array<{
    type: string;
    id: string;
    shift_date: string;
    shift_type: ShiftType;
    snippet: string;
  }>;
}

export interface GoalInsight {
  completion_rate: number;
  completed_count: number;
  total_count: number;
  lookback_days: number;
  date_range_start: string;
  date_range_end: string;
}
