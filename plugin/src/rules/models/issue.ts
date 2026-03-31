export type IssueSeverity = "low" | "medium" | "high";

export interface RuleIssue {
  id: string;
  ruleId: string;
  severity: IssueSeverity;
  title: string;
  message: string;
  objectId?: string;
  objectType?: "component" | "pin" | "net";
  suggestion?: string;
}
