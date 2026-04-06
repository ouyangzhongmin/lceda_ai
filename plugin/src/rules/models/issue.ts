export type IssueSeverity = "low" | "medium" | "high";

export interface RuleIssue {
  id: string;
  ruleId: string;
  severity: IssueSeverity;
  title: string;
  message: string;
  objectId?: string;
  objectType?: "component" | "pin" | "net";
  // Human-friendly label generated from context (ref/value/net name etc.).
  // Used for report rendering; objectId stays as the editor object id.
  objectLabel?: string;
  suggestion?: string;
}
