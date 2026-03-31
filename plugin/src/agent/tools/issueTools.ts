import type { LocateTarget } from "../../types/schematic";
import type { RuleIssue } from "../../rules/models/issue";
import type { AgentTool } from "./toolRegistry";
import type { ToolRegistry } from "./toolRegistry";

export function createIssueTools(tools: ToolRegistry): AgentTool[] {
  return [
    {
      name: "issues.locate_first",
      description: "Locate the first issue that can be mapped to an editor object",
      execute: async (input: { issues: RuleIssue[] }) => {
        const firstLocatable = input.issues.find(
          (issue) => issue.objectId && issue.objectType
        );

        if (!firstLocatable || !firstLocatable.objectId || !firstLocatable.objectType) {
          return {
            located: false,
            issueId: undefined,
          };
        }

        await tools.invoke<LocateTarget, void>("editor.locate", {
          objectId: firstLocatable.objectId,
          objectType: firstLocatable.objectType,
        });

        return {
          located: true,
          issueId: firstLocatable.id,
          objectId: firstLocatable.objectId,
          objectType: firstLocatable.objectType,
        };
      },
    },
  ];
}
