/**
 * Barrel export for all 5 archetype layout templates.
 *
 * Import from here:
 *   import { IndexTemplate, IndexHeader, IndexFilterBar } from "@/components/layout/templates";
 */

export {
  IndexTemplate,
  IndexHeader,
  IndexFilterBar,
  IndexEmptyState,
  IndexSkeleton,
} from "./IndexTemplate";

export {
  OverviewTemplate,
} from "./OverviewTemplate";

export {
  DetailTemplate,
  DetailIdentityHeader,
  DetailTabBar,
} from "./DetailTemplate";

export {
  WorkflowTemplate,
  WorkflowStepIndicator,
  WorkflowFooter,
} from "./WorkflowTemplate";

export {
  BoardTemplate,
  BoardToolbar,
} from "./BoardTemplate";
