import { useState, type ComponentType, type CSSProperties } from "react";
import { Search } from "lucide-react";

type NavigationItem<T extends string> = {
  id: T;
  label: string;
  icon: ComponentType<{ className?: string; style?: CSSProperties }>;
};
const GROUPS = [
  { title: "Personal", ids: ["account", "privacy", "accessibility"] },
  { title: "Organisation", ids: ["provider", "branding", "billing", "branches", "team", "delegatedAccess"] },
  { title: "Preferences", ids: ["defaults", "compliance", "notifications"] },
  { title: "Help & feedback", ids: ["bugReport", "improvementFeedback"] },
];
export function SettingsNavigation<T extends string>({
  items,
  active,
  onChange,
}: {
  items: NavigationItem<T>[];
  active: T;
  onChange: (id: T) => void;
}) {
  const [search, setSearch] = useState("");
  const groups = GROUPS.map((group) => ({
    ...group,
    items: items.filter((item) => group.ids.includes(item.id)),
  })).filter((group) => group.items.length);
  return (
    <nav
      aria-label="Settings sections"
      className="w-full min-w-0 lg:w-60 lg:shrink-0"
    >
      <div
        className="rounded-xl border border-cc-border p-3 lg:hidden"
        style={{ background: "var(--cc-surface)" }}
      >
        <label
          htmlFor="settings-section-picker"
          className="mb-1.5 block text-xs font-medium text-cc-muted"
        >
          Settings section
        </label>
        <select
          id="settings-section-picker"
          value={active}
          onChange={(e) => onChange(e.target.value as T)}
          className="h-11 w-full min-w-0 rounded-lg border border-cc-border bg-transparent px-3 text-sm font-medium text-cc-text"
        >
          {groups.map((group) => (
            <optgroup key={group.title} label={group.title}>
              {group.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div
        className="sticky top-[160px] hidden max-h-[calc(100dvh-180px)] space-y-4 overflow-y-auto rounded-xl border border-cc-border p-3 lg:block"
        style={{ background: "var(--cc-surface)" }}
      >
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-cc-muted" />
          <input
            aria-label="Find a setting"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a setting"
            className="h-11 w-full rounded-lg border border-cc-border bg-transparent pl-9 pr-2 text-sm text-cc-text"
          />
        </div>
        {groups.map((group) => {
          const visible = group.items.filter((item) =>
            item.label.toLowerCase().includes(search.trim().toLowerCase()),
          );
          if (!visible.length) return null;
          return (
            <div key={group.title}>
              <p className="px-3 pb-1.5 text-xs font-medium text-cc-muted">
                {group.title}
              </p>
              <div className="space-y-0.5">
                {visible.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    aria-current={active === id ? "page" : undefined}
                    onClick={() => onChange(id)}
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-cc-soft"
                    style={{
                      background:
                        active === id ? "var(--cc-active-bg)" : undefined,
                      color:
                        active === id ? "var(--cc-plum)" : "var(--cc-text)",
                    }}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 break-words">{label}</span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        {!items.some((item) =>
          item.label.toLowerCase().includes(search.trim().toLowerCase()),
        ) && (
          <div className="px-3 text-sm text-cc-muted" role="status">
            No matching sections.
            <button
              type="button"
              onClick={() => setSearch("")}
              className="mt-2 block min-h-11 font-medium text-cc-plum"
            >
              Clear search
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
