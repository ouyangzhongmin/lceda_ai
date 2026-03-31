import type { RuleIssue } from "./issue";

export interface SchematicCheckResult {
  issues: RuleIssue[];
  summary: string;
}
