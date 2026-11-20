import type { Feather } from "@expo/vector-icons";

import type { TranslationKey } from "@/lib/i18n/translations";

/**
 * The in-app manual: one short, step-by-step guide per part of the app.
 * Screens show a "?" button that opens their guide; the Guides screen lists
 * them all. Each step is a title and one or two plain sentences.
 */
export type GuideId =
  | "home"
  | "shifts"
  | "doingShift"
  | "notes"
  | "incidents"
  | "compliance"
  | "calendar"
  | "todo"
  | "credentials"
  | "training"
  | "availability"
  | "profile"
  | "contactOffice";

export type Guide = {
  id: GuideId;
  icon: keyof typeof Feather.glyphMap;
  title: TranslationKey;
  summary: TranslationKey;
  steps: number;
};

/** Step text lives at guide.<id>.<n>.title / guide.<id>.<n>.body (n from 1). */
export const GUIDES: Guide[] = [
  {
    id: "home",
    icon: "home",
    title: "guide.home.title",
    summary: "guide.home.summary",
    steps: 4,
  },
  {
    id: "doingShift",
    icon: "briefcase",
    title: "guide.doingShift.title",
    summary: "guide.doingShift.summary",
    steps: 5,
  },
  {
    id: "notes",
    icon: "edit-3",
    title: "guide.notes.title",
    summary: "guide.notes.summary",
    steps: 4,
  },
  {
    id: "shifts",
    icon: "calendar",
    title: "guide.shifts.title",
    summary: "guide.shifts.summary",
    steps: 3,
  },
  {
    id: "contactOffice",
    icon: "phone",
    title: "guide.contactOffice.title",
    summary: "guide.contactOffice.summary",
    steps: 3,
  },
  {
    id: "incidents",
    icon: "alert-circle",
    title: "guide.incidents.title",
    summary: "guide.incidents.summary",
    steps: 4,
  },
  {
    id: "compliance",
    icon: "shield",
    title: "guide.compliance.title",
    summary: "guide.compliance.summary",
    steps: 3,
  },
  {
    id: "todo",
    icon: "check-square",
    title: "guide.todo.title",
    summary: "guide.todo.summary",
    steps: 3,
  },
  {
    id: "calendar",
    icon: "calendar",
    title: "guide.calendar.title",
    summary: "guide.calendar.summary",
    steps: 3,
  },
  {
    id: "credentials",
    icon: "award",
    title: "guide.credentials.title",
    summary: "guide.credentials.summary",
    steps: 3,
  },
  {
    id: "training",
    icon: "book-open",
    title: "guide.training.title",
    summary: "guide.training.summary",
    steps: 3,
  },
  {
    id: "availability",
    icon: "clock",
    title: "guide.availability.title",
    summary: "guide.availability.summary",
    steps: 2,
  },
  {
    id: "profile",
    icon: "user",
    title: "guide.profile.title",
    summary: "guide.profile.summary",
    steps: 3,
  },
];

export function guideById(id: GuideId): Guide {
  return GUIDES.find((g) => g.id === id) ?? GUIDES[0];
}

export function stepKeys(
  id: GuideId,
  n: number,
): { title: TranslationKey; body: TranslationKey } {
  return {
    title: `guide.${id}.${n}.title` as TranslationKey,
    body: `guide.${id}.${n}.body` as TranslationKey,
  };
}
