import type { SchematicContext } from "../../types/schematic";
import { runSchematicChecks } from "../../rules/engine/runSchematicChecks";
import { validateDraft } from "../../rules/engine/validateDraft";
import type { AgentTool } from "./toolRegistry";

export function createRuleTools(): AgentTool[] {
  return [
    {
      name: "rules.run_schematic_checks",
      description: "Run local schematic rule checks for wiring and attribute issues",
      riskLevel: "low",
      execute: async (input: { context: SchematicContext }) => runSchematicChecks(input.context),
    },
    {
      name: "rules.validate_draft",
      description: "Validate a generated schematic draft before apply",
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
