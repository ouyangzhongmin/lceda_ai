import type { RuleIssue } from "./issue";

export interface LocatableIssue extends RuleIssue {
  canLocate: boolean;
}
