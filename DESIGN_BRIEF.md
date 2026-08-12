# CareCliQ UI Refactor — Claude Code Prompt

> **How to use this:** Save this file in the root of your repo as `DESIGN_BRIEF.md`, then open Claude Code in VS Code and say:
> *"Read DESIGN_BRIEF.md and follow it. Start with Phase 1 (audit) and show me your findings before changing any code."*
>
> Alternatively, paste everything below the line directly into Claude Code as your first message.

---

## Your role

Act as a senior product designer and frontend engineer doing a full UI/UX refactor of CareCliQ, an AI-powered NDIS compliance documentation SaaS built by CC Tech Australia. You are not redesigning the brand — the brand is fixed and documented below. Your job is to apply it *correctly*, because the current UI misuses it, and to build a design system so every page in the platform looks and behaves consistently.

Users are NDIS support coordinators and support workers, many from CALD (culturally and linguistically diverse) backgrounds working in English as a second language. They are busy, often on mobile between sessions, and not highly technical. Clarity, calm, and legibility beat visual excitement every time. This is a professional compliance tool they use all day — it should feel like a trustworthy workspace, not a marketing page.

## The core problem to fix

The current UI treats CareCliQ Pink (#E8457A) as the dominant surface colour: pink top bar, pink alert banners, pink buttons, pink badges, pink links everywhere. This directly violates our own brand handbook, which states: **"Never use pink as a solid fill for large background sections."** The result is visually loud, hierarchy is flat (everything screams), and important signals like compliance warnings get lost in the noise.

The fix in one sentence: **neutral, calm chrome (cream/white/navy) for 95% of the interface, with pink/purple used sparingly and deliberately as accent, identity, and primary action — and the brand gradient reserved almost exclusively for the single primary CTA on any screen.**

## Brand tokens (non-negotiable — from the official brand handbook)

### Colours (exactly these 4 brand colours)
| Token | Hex | Role in the app UI |
|---|---|---|
| `--cq-pink` | #E8457A | Accent only: active nav state, focus indicators, links, small badges, icon highlights, gradient start. **Never a large solid fill or background.** |
| `--cq-purple` | #7C3AED | Secondary accent: small callout backgrounds, selected states, gradient end. May fill *small* callout sections only. |
| `--cq-cream` | #FDF6EE | Primary light background for the app canvas and page background. **Never use pure white #FFFFFF as the page background** — cards may sit slightly lighter/whiter than the canvas for elevation, but the canvas is cream. |
| `--cq-navy` | #1A1A2E | All body text, headings on light backgrounds, dark surfaces (footer, optional dark mode base). **Never pure black #000000.** |

Brand gradient (primary CTA buttons, key brand moments only — max one gradient element in view at a time):
```css
background: linear-gradient(110deg, #E8457A 0%, #7C3AED 100%);
```
Never reverse the gradient direction. Never use greyscale versions of the logo.

### Functional/status colours (needed for a compliance dashboard, not in the brand palette)
The brand handbook only defines 4 colours, but a compliance product needs semantic status colours. Define a *functional palette* that is clearly subordinate to the brand: muted, desaturated tones that harmonise with cream/navy — e.g. a calm green for Compliant, amber for At Risk, and a red-leaning tone for Non-Compliant that is visibly distinct from brand pink (this matters: pink = brand/action, red = danger, and users must never confuse the two). Also define matching soft tint backgrounds for status chips. Document these tokens with a note that they are functional UI colours, pending founding-team sign-off, and use them *only* for status semantics — never decoratively.

### Typography (all free on Google Fonts)
| Font | Role |
|---|---|
| **Inter** (Regular/Medium/SemiBold) | The workhorse: all platform UI — nav, buttons, labels, tables, forms, body text inside the app |
| **Poppins** (Medium/SemiBold/Bold) | Page titles and section headings only |
| **Nunito** (ExtraBold/Black) | Large display numbers only — compliance scores, big dashboard stats |
| **Plus Jakarta Sans** | Marketing/long-form copy (onboarding, empty states, emails) — minimal use inside the app |

Set a proper type scale (e.g. 12/14/16/20/24/32/48) as tokens. Body text is navy or #333333 on light backgrounds; secondary text may use a muted navy, never light grey below WCAG AA contrast.

## Design system requirements

1. **Tokens first.** Create a single source of truth (CSS custom properties, Tailwind theme config, or theme file — match whatever the codebase already uses). Every colour, font, radius, shadow, and spacing value in every component must reference tokens. No hardcoded hex values anywhere in components after this refactor.
2. **Shared app shell.** One layout component: sidebar + top bar + content area, used by every page. The chrome is neutral — cream canvas, white/near-white sidebar and top bar with subtle borders, navy text and icons. The logo and the active nav item carry the brand colour; nothing else in the chrome does.
3. **Component library.** Build/refactor a small set of shared components and use them everywhere: Button (primary = gradient, secondary = navy outline or subtle fill, tertiary = text link in pink), Card, StatCard, Badge/StatusChip, Table, Tabs, Banner/Alert, EmptyState, Modal, Form inputs, Avatar. No page may hand-roll its own version of these.
4. **Hierarchy rules.**
   - One gradient primary CTA per screen, maximum.
   - Alerts/banners use status colours at low intensity (soft tint background + coloured left border + navy text), not full saturated fills. The current full-width hot-pink banner becomes a calm amber/purple-tinted notice.
   - Stat numbers use Nunito, large, in navy — colour is added only where it carries meaning (e.g. an at-risk count in amber), not decoration.
5. **States and accessibility.** Every interactive element has visible hover, focus (keyboard-visible focus ring — pink is fine here), active, and disabled states. Meet WCAG 2.1 AA contrast throughout. Touch targets minimum 44px. Respect `prefers-reduced-motion`. This user base includes people reading English as a second language — prefer plain words over jargon, sentence case everywhere, and never rely on colour alone to convey status (pair every status colour with a label or icon).
6. **Spacing & shape.** Pick one spacing scale (4/8/12/16/24/32/48) and one radius language (e.g. 8px inputs, 12px cards, full-round pills for chips) and apply them everywhere. Soft, small shadows for elevation — no heavy drop shadows.
7. **Empty states and microcopy.** Empty states (like "No sessions scheduled today") get a light illustration or icon, one plain sentence, and where useful one action. Buttons say exactly what they do ("Review compliance", not "Submit"). Error messages say what happened and how to fix it.

## Pages that must be consistent

Apply the shell, tokens, and components to every page in the platform, including: Dashboard, Team, Participants (list + profile), Compliance, Rostering, Settings, plus any auth/onboarding screens. Same page-title pattern, same card style, same table style, same tab style, same button hierarchy on all of them. A user should never be able to tell that two pages were built at different times.

## Process — work in phases and check in between each

**Phase 1 — Audit.** Read the codebase. Produce a short written audit: current stack/styling approach, every place brand colours are misused (especially large pink fills), inconsistencies between pages, hardcoded values, and accessibility issues. Do not change code yet. Show me the audit and your proposed token structure.

**Phase 2 — Foundations.** Implement the design tokens, load the four fonts, and build/refactor the app shell (sidebar, top bar) to the new neutral chrome. Show me the shell before proceeding.

**Phase 3 — Component library.** Build the shared components listed above using only tokens. Create a simple internal style-guide page (e.g. `/design-system` route or a Storybook if one exists) showing every component and its states, so we can review the system in one place.

**Phase 4 — Page refactor.** Refactor each page one at a time to use the shell and components, starting with the Dashboard. After each page, summarise what changed.

**Phase 5 — Self-critique pass.** Review the whole app against this brief: any remaining hardcoded colours? Any screen with more than one gradient element? Any pink solid fills? Any contrast failures? Any page that deviates from the shared patterns? Fix what you find and report.

At every phase, if the brief conflicts with something in the existing code (e.g. a component library already in use), tell me the trade-off and recommend an option before proceeding. Do not invent new brand colours, fonts, or logo treatments — where you need something the brand handbook doesn't cover, propose it explicitly and mark it as "pending approval".

## Definition of done

- Cream canvas, neutral chrome, navy text everywhere; pink/purple appear only as deliberate accents and the single gradient CTA per screen.
- Zero large pink solid fills anywhere in the product.
- All pages share one shell, one component set, one type scale, one spacing scale — full visual consistency.
- All colour/type/spacing values come from tokens; no hardcoded hex in components.
- WCAG 2.1 AA contrast, visible keyboard focus, 44px touch targets, status never conveyed by colour alone.
- A `/design-system` reference page exists showing all components and tokens.
- The product still unmistakably feels like CareCliQ — the brand is present through the logo, the accent system, the gradient CTA, and the typography, not through saturation.
