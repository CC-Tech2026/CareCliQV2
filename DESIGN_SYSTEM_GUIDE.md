/**
 * CareCliQ Design System Implementation Guide
 * 
 * This guide shows how to cautiously update CARECLIQ components
 * to use the new healthcare-focused design system.
 * 
 * IMPORTANT: Make changes incrementally, test thoroughly, maintain consistency
 */

# CareCliQ Healthcare UI/UX Enhancement

## 🎯 Overview

The enhanced design system transforms CARECLIQ from a trendy interface to a professional, healthcare-focused platform. Changes are semantic, accessible, and maintain brand consistency.

## 📚 New Files Created

### 1. **Design System** (`src/lib/design-system.ts`)
- Centralized color tokens
- Semantic status colors (green/red/amber/blue)
- Typography, spacing, shadows, radius
- Healthcare-specific role colors
- Utility functions for status colors

**Usage:**
```typescript
import { DESIGN_SYSTEM as DS } from "@/lib/design-system";

// Color usage
style={{ color: DS.TEXT.primary }}
style={{ backgroundColor: DS.STATUS.success }}
style={{ boxShadow: DS.SHADOWS.card }}

// Semantic status
color={getStatusColor(participant.status)}  // Returns appropriate color
```

### 2. **Healthcare Components** (`src/components/healthcare/HealthcareCards.tsx`)
- `StatusCard` - KPI metrics with status indicators
- `AlertBanner` - Semantic alerts (success/warning/critical/info)
- `ContextCard` - Patient/participant information
- `DataRow` - List items with status badges
- `SectionDivider` - Visual section breaks
- `EmptyState` - No-data states

**Usage:**
```typescript
<StatusCard
  label="Compliance Score"
  value="87%"
  status="success"
  trend={{ direction: "up", percentage: 5 }}
/>

<AlertBanner
  type="warning"
  title="Credential Expiring"
  message="First Aid expires in 30 days"
  icon={<AlertTriangle />}
/>
```

### 3. **Page Header Component** (`src/components/healthcare/PageHeader.tsx`)
- Professional page titles with icons
- Status badges
- Action buttons
- Breadcrumb navigation
- Info bars for contextual data

**Usage:**
```typescript
<PageHeader
  title="Dashboard"
  subtitle="Support Coordinator"
  icon={LayoutDashboard}
  description="Team overview and critical alerts"
  badge={{ text: "Active", status: "success" }}
/>
```

### 4. **Design Guidelines** (`src/lib/design-guidelines.ts`)
- Philosophy and principles
- Color usage rules
- Typography hierarchy
- Spacing system
- Accessibility standards
- Anti-patterns to avoid

## 🎨 Key Design Changes

### Color Palette

**Old (Trendy):**
- PLUM #5533CC - Too saturated
- CORAL #F03060 - Trendy, not healthcare
- Generic grays

**New (Healthcare):**
- Brand Colors: Kept but used sparingly
- Status Colors: Industry-standard green/red/amber/blue
- Text Hierarchy: High-contrast slate/gray
- Semantic Meaning: Every color conveys status

### Typography

**Old:** Inconsistent token names across files
**New:** Unified system with clear hierarchy:
- Page Title: 28px bold
- Section Title: 18px bold
- Card Title: 16px semibold
- Body: 14px regular
- Caption: 12px regular
- Label: 11px bold uppercase

### Cards & Components

**Old:** Decorative, trendy appearance
**New:** Professional, clinical context:
- Clean white backgrounds
- Subtle borders and shadows
- Clear visual hierarchy
- Status indicators built-in
- Accessible focus states

## 🚀 Implementation Strategy

### Phase 1: Foundation (Safe)
1. Import design system in 1-2 pages
2. Replace hardcoded colors with tokens
3. No breaking changes
4. Test thoroughly

```typescript
// BEFORE
const PLUM = "#5533CC";
style={{ color: PLUM }}

// AFTER
import { DESIGN_SYSTEM as DS } from "@/lib/design-system";
style={{ color: DS.BRAND.primary }}
```

### Phase 2: Components (Cautious)
1. Use new healthcare card components for new features
2. Don't immediately replace existing components
3. Side-by-side deployment acceptable
4. Test user feedback

```typescript
// Use new StatusCard for new KPI displays
<StatusCard ... />

// Keep existing cards while testing new design
```

### Phase 3: Pages (Gradual)
1. Update one page type at a time (dashboards first)
2. Monitor no breaking changes
3. Gather feedback before next page
4. Maintain backward compatibility

**Update Order (Recommended):**
1. Dashboard pages (highest impact, safest)
2. Patient/Participant lists
3. Status/Compliance pages
4. Forms and inputs
5. Navigation and headers

### Phase 4: Full Rollout (Complete)
1. Remaining pages
2. Consistent experience
3. Performance testing
4. Accessibility audit (WCAG AA)

## 📋 Update Checklist for Each Page

When updating a page to use new design system:

- [ ] Import design tokens: `import { DESIGN_SYSTEM as DS } from "@/lib/design-system";`
- [ ] Replace color definitions
  - `const PLUM = "#5533CC"` → use `DS.BRAND.primary`
  - Hardcoded hex → tokens
- [ ] Replace component colors
  - Text colors → `DS.TEXT.*`
  - Borders → `DS.BORDER.*`
  - Backgrounds → `DS.BACKGROUND.*`
  - Status colors → `DS.STATUS.*`
- [ ] Use semantic status colors
  - Success (green), Warning (amber), Critical (red), Info (blue)
- [ ] Add/update shadows
  - Card shadows → `DS.SHADOWS.card`
  - Hover shadows → `DS.SHADOWS.md`
- [ ] Verify spacing
  - Use multiples of 8px
  - Check mobile/tablet/desktop
- [ ] Test accessibility
  - Color contrast ratios
  - Keyboard navigation
  - Screen reader compatibility
- [ ] Test in light/dark environments
- [ ] User feedback before rollout

## ✅ Verification Checklist

After updating components, verify:

```typescript
// ✓ Colors semantic
const color = getStatusColor("expiring");  // Returns warning (amber)

// ✓ Spacing consistent  
className="gap-4 p-6"  // Uses 8px base

// ✓ Typography hierarchy
<h1>Title</h1>       // 28px
<h2>Section</h2>     // 18px
<p>Body</p>          // 14px

// ✓ Shadows appropriate
style={{ boxShadow: DS.SHADOWS.card }}

// ✓ Accessibility high
// Contrast: 7:1 minimum
// Focus: Clear outlines
// Motion: Respects prefers-reduced-motion

// ✓ Responsive
// Mobile: Single column
// Tablet: Two columns
// Desktop: Full width max 1280px
```

## 🔍 Before/After Example: Dashboard

### BEFORE (Current)
```typescript
const PLUM = "#5533CC";
const CORAL = "#F03060";
const BORDER = "#E2DEF2";

function Dashboard() {
  return (
    <div className="space-y-6">
      <div className="flex gap-4">
        <div 
          className="rounded-lg border p-4"
          style={{ 
            borderColor: BORDER,
            background: "linear-gradient(135deg, " + PLUM + ", " + CORAL + ")"
          }}
        >
          <span style={{ color: "#FFFFFF" }}>87%</span>
        </div>
      </div>
    </div>
  );
}
```

### AFTER (Enhanced)
```typescript
import { DESIGN_SYSTEM as DS } from "@/lib/design-system";
import { StatusCard } from "@/components/healthcare/HealthcareCards";
import { PageHeader } from "@/components/healthcare/PageHeader";

function Dashboard() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        subtitle="Support Coordinator"
        description="Team overview and critical alerts"
      />
      
      <div className="grid grid-cols-3 gap-4">
        <StatusCard
          label="Compliance Score"
          value="87%"
          status="success"
          trend={{ direction: "up", percentage: 5 }}
        />
      </div>
    </div>
  );
}
```

## 🎓 Best Practices

### DO ✓
- Use design system tokens for everything
- Make changes incrementally
- Test on multiple screen sizes
- Verify accessibility
- Gather user feedback
- Document decisions
- Keep brand consistent
- Maintain backward compatibility

### DON'T ✗
- Hardcode colors
- Mix old and new design in same page
- Change too many things at once
- Skip accessibility testing
- Remove existing functionality
- Ignore performance
- Use gradients
- Override design tokens

## 📞 Support & Questions

When implementing:
1. Reference design guidelines: `src/lib/design-guidelines.ts`
2. Check example components: `src/components/healthcare/`
3. Test in browser DevTools
4. Compare with WCAG standards
5. Ask for peer review

## 🚀 Ready to Update?

Start small:
1. Pick one page (e.g., Dashboard)
2. Import design system
3. Replace 3-5 colors
4. Add new PageHeader component
5. Test thoroughly
6. Get feedback
7. Move to next page

**Remember:** This is an enhancement, not a breaking change.
Existing functionality must continue working perfectly.

---

**Last Updated:** 2026-06-22
**Version:** 1.0 - Healthcare UX Enhancement
**Status:** Ready for Phase 1 Implementation
