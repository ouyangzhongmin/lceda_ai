import type { SchematicContext } from "../../types/schematic";
import { runSchematicChecks } from "../../rules/engine/runSchematicChecks";
import { validateDraft } from "../../rules/engine/validateDraft";
import type { AgentTool } from "./toolRegistry";

export function createRuleTools(): AgentTool[] {
  return [
    {
      name: "rules_run_schematic_checks",
      description: "执行本地原理图规则检查，发现连线与属性问题",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => runSchematicChecks(input.context),
    },
    {
      name: "rules_validate_draft",
      description: "在应用前校验生成的原理图草案",
      parameters: {
        type: "object",
        properties: {
          draft: {
            type: "object",
            description: "待校验的草案。若省略，宿主会复用最近生成的 draft plan。",
          },
        },
        additionalProperties: true,
      },
      riskLevel: "high",
      execute: async (input: {
        draft: {
          components: SchematicContext["components"];
          pins: SchematicContext["pins"];
          nets: SchematicContext["nets"];
        };
      }) => validateDraft(input.draft),
    },
  ];
}
