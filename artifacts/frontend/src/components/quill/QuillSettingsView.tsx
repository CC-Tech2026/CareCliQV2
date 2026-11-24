import { useId } from "react";
import { Trash2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { QuillSettings } from "./quillSettings";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SELECTED_BG = "var(--cc-brand-purple-soft)";
const SELECTED_TEXT = "var(--cc-brand-purple)";
const DISPLAY = "var(--app-font-display)";

/** Quill's settings: one surface, sections as rows. */
export function QuillSettingsView({
  settings,
  onChange,
  onDeleteAll,
  hasConversations,
  full,
}: {
  settings: QuillSettings;
  onChange: <K extends keyof QuillSettings>(key: K, value: QuillSettings[K]) => void;
  onDeleteAll: () => void;
  hasConversations: boolean;
  full: boolean;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={`mx-auto w-full ${full ? "max-w-[768px] px-6 py-8" : "px-4 py-4"}`}>
        {full && (
          <h2 className="mb-1 text-[22px] font-semibold" style={{ color: TEXT, fontFamily: DISPLAY }}>
            Settings
          </h2>
        )}
        <p className="text-[12.5px]" style={{ color: MUTED }}>
          These are saved in this browser and only change Quill for you.
        </p>

        <Section title="Answers">
          <Row label="Answer length" hint="Brief gives the answer in a sentence or two. Detailed adds what's behind the figures.">
            <Choice
              label="Answer length"
              value={settings.answerLength}
              options={[
                ["brief", "Brief"],
                ["detailed", "Detailed"],
              ]}
              onChange={(v) => onChange("answerLength", v)}
            />
          </Row>
          <ToggleRow
            label="Follow-up questions"
            hint="Suggest questions to ask next under each answer."
            checked={settings.followUps}
            onChange={(v) => onChange("followUps", v)}
          />
        </Section>

        <Section title="Display">
          <Row label="Text size" hint="The size of questions and answers.">
            <Choice
              label="Text size"
              value={settings.textSize}
              options={[
                ["standard", "Standard"],
                ["large", "Larger"],
              ]}
              onChange={(v) => onChange("textSize", v)}
            />
          </Row>
          <Row label="Open Quill in" hint="Where Quill opens from the button.">
            <Choice
              label="Open Quill in"
              value={settings.openIn}
              options={[
                ["last", "Last used"],
                ["panel", "Panel"],
                ["full", "Full screen"],
              ]}
              onChange={(v) => onChange("openIn", v)}
            />
          </Row>
        </Section>

        <Section title="Typing">
          <ToggleRow
            label="Enter sends"
            hint={settings.enterSends ? "Enter sends. Shift + Enter starts a new line." : "Ctrl + Enter sends. Enter starts a new line."}
            checked={settings.enterSends}
            onChange={(v) => onChange("enterSends", v)}
          />
        </Section>

        <Section title="Conversations">
          <Row label="Delete all conversations" hint="Removes every conversation you've had with Quill. This can't be undone.">
            <button
              type="button"
              onClick={onDeleteAll}
              disabled={!hasConversations}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-semibold transition-colors hover:bg-[var(--cc-soft)] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ borderColor: BORDER, color: "var(--cc-danger-text)" }}
            >
              <Trash2 size={13} /> Delete all
            </button>
          </Row>
        </Section>

        <p className="mt-8 text-[12px]" style={{ color: MUTED }}>
          Quill reads your organisation's live data to answer questions. It can't change any records.
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="pb-1 text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: MUTED }}>
        {title}
      </h3>
      <div className="divide-y border-y" style={{ borderColor: BORDER }}>
        {children}
      </div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3" style={{ borderColor: BORDER }}>
      <div className="min-w-[180px] flex-1">
        <p className="text-[13px] font-medium" style={{ color: TEXT }}>
          {label}
        </p>
        <p className="mt-0.5 text-[12px] leading-snug" style={{ color: MUTED }}>
          {hint}
        </p>
      </div>
      {children}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-3" style={{ borderColor: BORDER }}>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-[13px] font-medium" style={{ color: TEXT }}>
          {label}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug" style={{ color: MUTED }}>
          {hint}
        </span>
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 rounded-lg border p-0.5" style={{ borderColor: BORDER }}>
      {options.map(([v, text]) => {
        const selected = v === value;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(v)}
            className="h-7 rounded-md px-3 text-[12.5px] transition-colors hover:bg-[var(--cc-soft)] focus-visible:outline-none focus-visible:ring-2"
            style={{
              background: selected ? SELECTED_BG : undefined,
              color: selected ? SELECTED_TEXT : TEXT,
              fontWeight: selected ? 600 : 400,
              ["--tw-ring-color" as string]: "var(--cc-plum)",
            }}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}
