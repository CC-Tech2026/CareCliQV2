# NDIS Claim Types Backlog

Prerequisites that need to exist before specific NDIS claim types can be built —
logged when confirmed missing, not when about to be built. See CLAUDE.md /
project memory for the platform-catalogue work this was surfaced alongside.

---

## 1. `service_agreements` concept — missing, confirmed dormant

**Status**: 🔴 Does not exist anywhere in the schema. Confirmed dormant (nothing
currently built depends on it) as of 2026-09-24.

**What's missing**: No `service_agreements` or `participant_agreements` table,
nor any per-item or per-claim-type agreement/consent record. The only
structured agreement tracking anywhere is `ndis_plans.agreement_status` /
`agreement_signed_at` (`094_ndis_plan_agreement_status.sql`) — a plan-level
signed/unsigned/expired flag, not a document that specifies which supports,
rates, or claim types the participant agreed to.

**Why it's dormant, not blocking**: CareCliQ does not currently generate any
of the claim types whose NDIS pricing rules require a service agreement to
back them — confirmed via repo-wide search, zero matches for Non-Face-to-Face
support, Provider Travel, or short-notice-cancellation claim generation
anywhere in `backend/app`. Today's invoicing path only ever bills for
verified, actually-delivered direct support (`task_completions` →
`aggregate_line_items()`), which doesn't require this. So the gap exists but
isn't currently costing anything.

**Why it will matter**: the NDIS Pricing Arrangements document requires a
service agreement (or equivalent participant consent record) to exist before
a provider can validly claim:
- Non-Face-to-Face support time
- Provider Travel (non-labour costs / travel time)
- Short-notice cancellations

None of these claim types should be built without this existing first — the
agreement is what would make the claim legitimate, not an afterthought to
attach once the claim type is already generating invoices.

**Trigger to revisit**: the day any of the three claim types above gets
scoped for real, not before.

---

## 2. NDIA bulk claiming (myplace Provider Portal) — scoped, not started

See conversation history / commit log around 2026-09-24 for the full scoping
note: no PRODA integration or bulk-claim CSV generation exists; `suggest_invoice_recipient()`
correctly stops at "don't invoice a person" for NDIA-managed participants with
no automated next step. Rough shape confirmed: a fixed-column CSV generator
mirroring the existing PDF-invoice download pattern (not a live API
integration — myplace itself is a manual file upload). Exact column spec
needs pulling from the official NDIS template directly (ndis.gov.au blocks
automated fetching from this environment); two third-party summaries
consulted disagreed with each other on date format and a few column names,
so neither should be trusted as final without checking the real template.
Blocked in part on the GST question below (GSTCode is a required column).

---

## 3. GST handling — open question, not yet resolved

`gst_applicable` is stored per invoice line item but never read;
`billing_service._calculate_totals` hardcodes `tax = 0`. Working assessment
(pending explicit confirmation): every current support ties to an NDIS price
item, and NDIS-funded supports are GST-free under Div 38-38 of the GST Act,
so there's likely nothing to wire in — but this needs the org's explicit
confirmation that nothing is ever invoiced outside NDIS-funded supports
before treating the flag as intentionally inert rather than broken.
