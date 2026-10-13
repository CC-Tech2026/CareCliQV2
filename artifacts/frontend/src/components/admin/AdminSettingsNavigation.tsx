import { Link } from "wouter";

export function AdminSettingsNavigation({ active }: { active: "layout" | "accessibility" }) {
  return <header className="space-y-4">
    <div>
      <p className="text-xs font-medium text-cc-muted">Administrator account</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight text-cc-text">Settings</h1>
      <p className="mt-2 text-sm text-cc-muted">Adjust your workspace layout and accessibility preferences.</p>
    </div>
    <nav aria-label="Administrator settings" className="flex flex-wrap gap-2 border-b border-cc-border pb-3">
      {([ ["layout", "Workspace layout"], ["accessibility", "Display & accessibility"] ] as const).map(([id, label]) =>
        <Link key={id} href={"/admin/settings/" + id} aria-current={active === id ? "page" : undefined} className={"inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum " + (active === id ? "bg-cc-soft text-cc-plum" : "text-cc-muted hover:bg-cc-soft")}>{label}</Link>
      )}
    </nav>
  </header>;
}
