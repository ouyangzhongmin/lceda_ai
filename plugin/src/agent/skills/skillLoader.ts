import type { SkillDefinition, SkillName } from "./skillTypes";
import type { AgentTaskType } from "../shared/agentTypes";

const SKILLS: Record<SkillName, SkillDefinition> = {
  "natural-chat-skill": {
    name: "natural-chat-skill",
    description: "Handle natural conversation and requirement clarification",
    allowedTools: [
      "llm.generate",
      "todo_list",
      "editor.get_current_context",
      "editor.get_selection",
      "editor.describe_selection",
      "editor.describe_object",
      "editor.find_object",
      "rag.search",
      "rag.build_citations",
      "library.search_devices",
      "library.get_device",
    ],
    outputMode: "chat_result",
    promptKey: "chat",
  },
  "schematic-analysis-skill": {
    name: "schematic-analysis-skill",
    description: "Analyze schematic issues with evidence",
    allowedTools: [
      "todo_list",
      "editor.get_current_context",
      "schematic.summarize_bom",
      "schematic.identify_key_components",
      "schematic.identify_functional_blocks",
      "schematic.identify_power_domains",
      "schematic.summarize_connectivity",
      "schematic.trace_power_paths",
      "schematic.trace_signal_paths",
      "schematic.trace_control_paths",
      "schematic.build_analysis_evidence",
      "rules.run_schematic_checks",
      "issues.locate_first",
      "library.search_devices",
      "library.get_device",
      "mcp.list_resources",
      "mcp.read_resource",
      "rag.search",
      "rag.build_citations",
      "llm.generate",
    ],
    outputMode: "analysis_result",
    promptKey: "analysis",
  },
  "component-explain-skill": {
    name: "component-explain-skill",
    description: "Explain selected components with RAG evidence",
    allowedTools: ["todo_list", "editor.get_selection", "mcp.list_resources", "mcp.read_resource", "rag.search", "rag.build_citations", "llm.generate"],
    outputMode: "analysis_result",
    promptKey: "analysis",
  },
  "wiring-standards-check-skill": {
    name: "wiring-standards-check-skill",
    description: "Run wiring standards checks and explain risks",
    allowedTools: ["todo_list", "editor.get_current_context", "rules.run_schematic_checks", "issues.locate_first", "mcp.list_resources", "mcp.read_resource", "rag.search"],
    outputMode: "analysis_result",
    promptKey: "analysis",
  },
  "power-module-draft-skill": {
    name: "power-module-draft-skill",
    description: "Generate power-related draft with citations and validation",
    allowedTools: [
      "todo_list",
      "editor.get_current_context",
      "rag.search",
      "rag.build_citations",
      "llm.generate",
      "mcp.list_resources",
      "mcp.read_resource",
      "library.search_devices",
      "library.get_device",
      "library.get_devices_by_lcsc_ids",
      "draft.generate_plan",
      "draft.preview_plan",
      "rules.validate_draft",
      "editor.preview_apply_plan",
    ],
    outputMode: "draft_result",
    promptKey: "draft",
  },
  "generic-schematic-draft-skill": {
    name: "generic-schematic-draft-skill",
    description: "Generate generic schematic draft and validate before apply",
    allowedTools: [
      "todo_list",
      "editor.get_current_context",
      "mcp.list_resources",
      "mcp.read_resource",
      "library.search_devices",
      "library.get_device",
      "library.get_devices_by_lcsc_ids",
      "draft.generate_plan",
      "draft.preview_plan",
      "rules.validate_draft",
      "editor.preview_apply_plan",
    ],
    outputMode: "draft_result",
    promptKey: "draft",
  },
};

export class SkillLoader {
  get(name: SkillName): SkillDefinition {
    return SKILLS[name];
  }

  selectForTask(taskType: AgentTaskType, userQuery: string): SkillDefinition {
    if (taskType === "natural_chat") {
      return SKILLS["natural-chat-skill"];
    }
    if (taskType === "schematic_draft") {
      const normalized = userQuery.toLowerCase();
      if (normalized.includes("ldo") || normalized.includes("power") || normalized.includes("5v")) {
        return SKILLS["power-module-draft-skill"];
      }
      return SKILLS["generic-schematic-draft-skill"];
    }

    if (userQuery.includes("接线标准") || userQuery.toLowerCase().includes("wiring")) {
      return SKILLS["wiring-standards-check-skill"];
    }
    if (userQuery.includes("元件") || userQuery.toLowerCase().includes("component")) {
      return SKILLS["component-explain-skill"];
    }
    return SKILLS["schematic-analysis-skill"];
  }
}
