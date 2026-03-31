export type SkillName =
  | "natural-chat-skill"
  | "schematic-analysis-skill"
  | "component-explain-skill"
  | "wiring-standards-check-skill"
  | "power-module-draft-skill"
  | "generic-schematic-draft-skill";

export interface SkillDefinition {
  name: SkillName;
  description: string;
  allowedTools: string[];
  outputMode: "chat_result" | "analysis_result" | "draft_result";
  promptKey: "chat" | "analysis" | "draft";
}
