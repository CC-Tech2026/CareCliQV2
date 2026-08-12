import type { FaqArticle } from "@/lib/help-api";

/** Static fallback when API / migration unavailable. */
export const WORKER_FAQ_FALLBACK: FaqArticle[] = [
  {
    slug: "add-evidence",
    title: "How to add evidence",
    body_markdown:
      "Open your shift, tap a task, then use the camera, voice, or notes buttons to attach evidence.",
    tags: ["evidence"],
    sort_order: 1,
  },
  {
    slug: "offline",
    title: "What to do if offline",
    body_markdown:
      "A yellow banner appears when offline. Open Sync status from the header to review pending items.",
    tags: ["offline"],
    sort_order: 2,
  },
  {
    slug: "compliance-score",
    title: "How compliance score is calculated",
    body_markdown:
      "Your score reflects mandatory tasks, evidence, timely notes, and shift sign-off.",
    tags: ["compliance"],
    sort_order: 3,
  },
  {
    slug: "forgot-clock-out",
    title: "What happens if I forget to clock out",
    body_markdown: "Contact your coordinator to adjust the shift record.",
    tags: ["shifts"],
    sort_order: 4,
  },
  {
    slug: "report-incident",
    title: "How to report an incident",
    body_markdown: "Go to Incidents and tap Report incident. Call 000 in emergencies first.",
    tags: ["incidents"],
    sort_order: 5,
  },
  {
    slug: "clock-in-gps",
    title: "Clock-in and GPS",
    body_markdown:
      "When you clock in, location may be recorded for audit. Enable location permission for accurate check-in.",
    tags: ["shifts", "gps"],
    sort_order: 6,
  },
  {
    slug: "end-shift-signature",
    title: "End shift and signature",
    body_markdown:
      "Complete your tasks, then end the shift and draw or confirm your digital signature.",
    tags: ["shifts", "signature"],
    sort_order: 7,
  },
  {
    slug: "notifications",
    title: "Notifications",
    body_markdown:
      "Enable push notifications in Settings so you receive shift reminders and coordinator messages.",
    tags: ["notifications"],
    sort_order: 8,
  },
  {
    slug: "uploading-credentials",
    title: "Uploading credentials",
    body_markdown:
      "Open Credentials from Profile or Settings, tap Add, and upload your certificate photo or file.",
    tags: ["credentials"],
    sort_order: 9,
  },
];
