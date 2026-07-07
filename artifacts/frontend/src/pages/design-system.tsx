import {
  ShieldCheck, AlertTriangle, Info, CircleCheck, Users, BarChart3, List, LayoutDashboard, FileEdit, Columns3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatCard, StatCardGroup } from "@/components/ui/stat-card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/components/ui/empty";
import {
  IndexTemplate, IndexHeader, IndexFilterBar, IndexEmptyState, IndexSkeleton,
  OverviewTemplate,
  DetailTemplate, DetailIdentityHeader, DetailTabBar,
  WorkflowTemplate, WorkflowStepIndicator, WorkflowFooter,
  BoardTemplate, BoardToolbar,
} from "@/components/layout/templates";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-bold tracking-tight" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>{title}</h2>
        {note && <p className="text-sm" style={{ color: MUTED }}>{note}</p>}
      </div>
      <div className="rounded-xl border bg-card p-5" style={{ borderColor: BORDER }}>
        {children}
      </div>
    </section>
  );
}

function Swatch({ name, cssVar, hex, role }: { name: string; cssVar: string; hex: string; role: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-12 w-12 shrink-0 rounded-lg border" style={{ background: `var(${cssVar})`, borderColor: BORDER }} />
      <div className="min-w-0">
        <p className="text-sm font-bold" style={{ color: TEXT }}>{name}</p>
        <p className="text-xs font-mono" style={{ color: MUTED }}>{cssVar} · {hex}</p>
        <p className="text-xs" style={{ color: MUTED }}>{role}</p>
      </div>
    </div>
  );
}

export default function DesignSystem() {
  return (
    <div className="max-w-5xl space-y-10 pb-16">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: "var(--cc-coral)" }}>Internal reference</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>Design system</h1>
        <p className="mt-1 text-sm" style={{ color: MUTED }}>
          Tokens and shared components per DESIGN_BRIEF.md. If a page doesn't match what's shown here, the page is wrong — fix the page, not this reference.
        </p>
      </div>

      <Section title="Brand colours" note="Exactly 4 brand colours. Pink is accent-only — never a large solid fill. The gradient is reserved for at most one primary CTA per screen.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Swatch name="Pink" cssVar="--cc-plum" hex="#E8457A" role="Active nav, focus rings, links, small badges, icon accents, gradient start" />
          <Swatch name="Purple" cssVar="--cc-coral" hex="#7C3AED" role="Small callout backgrounds, selected states, gradient end" />
          <Swatch name="Cream" cssVar="--cc-bg" hex="#FDF6EE" role="Page canvas — never pure white" />
          <Swatch name="Navy" cssVar="--cc-text" hex="#1A1A2E" role="All body text, headings, dark surfaces — never pure black" />
        </div>
        <div className="mt-4 rounded-lg p-3" style={{ background: "var(--cc-soft)" }}>
          <p className="text-xs font-bold" style={{ color: TEXT }}>NO GRADIENT HARD RULE — Navy CTA only, accent is pink text</p>
          <div className="mt-2 h-10 w-48 rounded-md" style={{ background: "var(--cc-text)" }} />
        </div>
      </Section>

      <Section title="Functional status colours" note="Pending founding-team sign-off. Subordinate to brand, used only for compliance/status semantics — never decoratively. Danger is deliberately real red, distinct from the brand's own purple, so users never confuse a destructive brand action with a safety/compliance warning.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Swatch name="Success" cssVar="--cc-status-success" hex="#166534" role="Compliant" />
          <Swatch name="Warning" cssVar="--cc-status-warning" hex="#B45309" role="At risk" />
          <Swatch name="Danger" cssVar="--cc-status-danger" hex="#DC2626" role="Non-compliant / safety severity" />
          <Swatch name="Info" cssVar="--cc-status-info" hex="#0369A1" role="Informational" />
        </div>
      </Section>

      <Section title="Typography" note="Inter is the workhorse (nav, buttons, labels, body). Poppins is for page titles/section headings. Nunito is for large stat/score numbers only. Plus Jakarta Sans is marketing copy only, not the app shell.">
        <div className="space-y-3">
          <p style={{ fontFamily: "var(--app-font-display)", fontSize: 32, fontWeight: 700, color: TEXT }}>Poppins — Page title, 32px</p>
          <p style={{ fontFamily: "var(--app-font-display)", fontSize: 20, fontWeight: 600, color: TEXT }}>Poppins — Section heading, 20px</p>
          <p style={{ fontFamily: "var(--app-font-stat)", fontSize: 48, fontWeight: 900, color: TEXT }}>82<span style={{ fontSize: 16 }}>% — Nunito, large stat</span></p>
          <p style={{ fontFamily: "var(--app-font-sans)", fontSize: 16, color: TEXT }}>Inter — Body text, 16px. The workhorse for nav, forms, tables, and everyday copy.</p>
          <p style={{ fontFamily: "var(--app-font-sans)", fontSize: 14, color: MUTED }}>Inter — Secondary/muted text, 14px.</p>
          <p style={{ fontFamily: "var(--app-font-marketing)", fontSize: 16, color: TEXT }}>Plus Jakarta Sans — marketing/long-form copy only (onboarding, empty states, emails).</p>
        </div>
      </Section>

      <Section title="Buttons" note="Primary = navy (max one per screen). Secondary = subtle fill. Tertiary = pink text link. Destructive = brand purple, for a destructive brand action (not compliance danger — see Badge/Alert below). NO GRADIENT HARD RULE.">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="navy">Primary CTA</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="link">Tertiary link</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="navy" disabled>Disabled</Button>
        </div>
        <p className="mt-3 text-xs" style={{ color: MUTED }}>All sizes meet the 44px minimum touch target. Keyboard focus shows a visible pink ring (tab to a button to check).</p>
      </Section>

      <Section title="Status chips (Badge)" note="Rounded pill. success/warning/danger/info are functional-only. Never rely on colour alone — pair with a label, as shown.">
        <div className="flex flex-wrap gap-2">
          <Badge variant="success"><CircleCheck size={12} className="mr-1" />Compliant</Badge>
          <Badge variant="warning"><AlertTriangle size={12} className="mr-1" />At risk</Badge>
          <Badge variant="danger"><ShieldCheck size={12} className="mr-1" />Non-compliant</Badge>
          <Badge variant="info"><Info size={12} className="mr-1" />Informational</Badge>
          <Badge variant="secondary">Neutral</Badge>
          <Badge variant="destructive">Brand destructive</Badge>
        </div>
      </Section>

      <Section title="Banners (Alert)" note="Soft tint background + coloured left border + navy text — never a full saturated fill.">
        <div className="space-y-3">
          <Alert variant="success"><CircleCheck className="h-4 w-4" /><AlertTitle>All caught up</AlertTitle><AlertDescription>No compliance issues detected this week.</AlertDescription></Alert>
          <Alert variant="warning"><AlertTriangle className="h-4 w-4" /><AlertTitle>2 credentials expiring soon</AlertTitle><AlertDescription>Send a renewal reminder before they lapse.</AlertDescription></Alert>
          <Alert variant="danger"><ShieldCheck className="h-4 w-4" /><AlertTitle>Non-compliant session detected</AlertTitle><AlertDescription>Review before this claim can be submitted.</AlertDescription></Alert>
          <Alert variant="info"><Info className="h-4 w-4" /><AlertTitle>Heads up</AlertTitle><AlertDescription>This is an informational note, not a warning.</AlertDescription></Alert>
        </div>
      </Section>

      <Section title="Stat cards" note="Value uses Nunito. Colour on the number is opt-in — only set `tone` where the number itself carries meaning.">
        <StatCardGroup>
          <StatCard icon={<Users size={14} />} label="Participants" value={9} />
          <StatCard icon={<BarChart3 size={14} />} label="Compliance" value="79%" tone="warning" sub="at risk" />
          <StatCard icon={<ShieldCheck size={14} />} label="Open incidents" value={0} tone="success" />
        </StatCardGroup>
      </Section>

      <Section title="Card">
        <Card>
          <CardHeader>
            <CardTitle>Card title</CardTitle>
            <CardDescription>Card description — muted, secondary text.</CardDescription>
          </CardHeader>
          <CardContent>Card content goes here.</CardContent>
        </Card>
      </Section>

      <Section title="Table">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Worker</TableHead><TableHead>Status</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            <TableRow><TableCell>Amara Worker</TableCell><TableCell><Badge variant="success">Compliant</Badge></TableCell></TableRow>
            <TableRow><TableCell>Haula Grixellou</TableCell><TableCell><Badge variant="warning">Review</Badge></TableCell></TableRow>
          </TableBody>
        </Table>
      </Section>

      <Section title="Tabs">
        <Tabs defaultValue="a">
          <TabsList>
            <TabsTrigger value="a">Overview</TabsTrigger>
            <TabsTrigger value="b">Staff</TabsTrigger>
          </TabsList>
          <TabsContent value="a" className="pt-3 text-sm" style={{ color: TEXT }}>Overview content.</TabsContent>
          <TabsContent value="b" className="pt-3 text-sm" style={{ color: TEXT }}>Staff content.</TabsContent>
        </Tabs>
      </Section>

      <Section title="Avatar">
        <div className="flex gap-2">
          <Avatar><AvatarFallback>SC</AvatarFallback></Avatar>
        </div>
      </Section>

      <Section title="Empty state">
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Info size={20} /></EmptyMedia>
            <EmptyTitle>No sessions scheduled today</EmptyTitle>
            <EmptyDescription>New sessions will appear here once they're booked.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Section>

      {/* ── Page archetypes ── */}
      <div>
        <h2 className="text-xl font-black tracking-tight mb-1" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>
          Page archetypes
        </h2>
        <p className="text-sm mb-6" style={{ color: MUTED }}>
          Every page uses exactly one of these five templates. No page invents its own structure.
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: <LayoutDashboard size={18} />, name: "1 — Overview", desc: "Dashboard, hub landing. Greeting + KPI strip + action feed + today rail.", pages: "dashboard.tsx, hub/HubPage.tsx" },
            { icon: <List size={18} />, name: "2 — Index", desc: "List pages. Page header + filter bar + table/card grid.", pages: "team, patients, sessions, incidents…" },
            { icon: <BarChart3 size={18} />, name: "3 — Detail", desc: "Single-record pages. Identity header + tab bar + content + rail.", pages: "session-detail, incident-detail…" },
            { icon: <FileEdit size={18} />, name: "4 — Workflow", desc: "Create/edit flows. Focus mode, centred column, sticky footer.", pages: "session-new, incident-new, participant-new…" },
            { icon: <Columns3 size={18} />, name: "5 — Board", desc: "Dense operational surfaces. Full-width, sticky toolbar, internal scroll.", pages: "coordinator-rostering, coordinator-live…" },
          ].map((a) => (
            <div key={a.name} className="rounded-xl border p-4 space-y-2" style={{ borderColor: BORDER }}>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--cc-soft)", color: "var(--cc-plum)" }}>
                  {a.icon}
                </div>
                <span className="text-[13px] font-black" style={{ color: TEXT }}>{a.name}</span>
              </div>
              <p className="text-[12px] leading-relaxed" style={{ color: MUTED }}>{a.desc}</p>
              <p className="text-[10px] font-mono" style={{ color: "var(--cc-plum)" }}>{a.pages}</p>
            </div>
          ))}
        </div>
      </div>

      <Section title="Archetype 2 — Index skeleton & empty state" note="Built into every IndexTemplate usage — no per-page implementation needed.">
        <div className="space-y-4">
          <p className="text-[11px] font-bold uppercase" style={{ color: MUTED }}>Loading skeleton</p>
          <IndexSkeleton rows={3} />
          <p className="text-[11px] font-bold uppercase mt-4" style={{ color: MUTED }}>Empty state</p>
          <IndexEmptyState
            icon={<Users size={18} style={{ color: "var(--cc-muted)" }} />}
            title="No team members yet"
            description="Invite your first support worker to get started."
            action={<Button variant="navy" size="sm">Invite worker</Button>}
          />
        </div>
      </Section>

      <Section title="Archetype 2 — Index header" note="Poppins title, count in muted text, single right-aligned primary action.">
        <IndexHeader
          title="Team"
          count={12}
          primaryAction={<Button variant="navy">Invite worker</Button>}
        />
      </Section>
    </div>
  );
}
