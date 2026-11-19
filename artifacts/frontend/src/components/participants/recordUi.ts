// One look for the forms inside a participant's record (Support needs and the
// sections around it): plain titled subsections on the page's one surface,
// sentence-case labels, one input style, navy save buttons. No boxes inside
// boxes, no small uppercase coloured headings.

/** A part of a section, separated by a rule from the one above. */
export const SUBSECTION = "space-y-4 border-t border-cc-border pt-5 first:border-t-0 first:pt-0";
export const SUBHEADING = "text-sm font-semibold text-cc-text";
export const HELP = "text-sm text-cc-muted";

export const LABEL = "block text-sm font-medium text-cc-text";
export const INPUT =
  "w-full rounded-lg border border-cc-border bg-cc-surface px-3 py-2 text-sm text-cc-text placeholder:text-cc-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-cc-plum/40 disabled:opacity-60";
export const TEXTAREA = `${INPUT} min-h-[84px] resize-y`;

export const PRIMARY_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full bg-[var(--cc-cta)] px-5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50";
export const SECONDARY_BUTTON =
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-cc-border bg-cc-surface px-4 text-sm font-medium text-cc-text transition hover:bg-cc-soft disabled:opacity-50";

/** A short note that something is sensitive or important: a rule on the left,
 * not a coloured box. */
export const NOTE = "border-l-4 border-cc-border pl-3 text-sm text-cc-muted";
