import { generateDraftPlanFromPrompt } from "../../editor/apply-plan/generateDraftPlan";
import { previewDraftPlan } from "../../editor/apply-plan/previewDraftPlan";
import type { AgentTool } from "./toolRegistry";

export function createDraftTools(): AgentTool[] {
  return [
    {
      name: "draft.generate_plan",
      description: "Generate a minimal schematic draft plan from the user's prompt",
      execute: async (input: {
        userQuery: string;
        selectedDevices?: Array<{
          role: string;
          query: string;
          deviceUuid: string;
          libraryUuid: string;
          name: string;
          manufacturer?: string;
          symbolUuid?: string;
          symbolName?: string;
          footprintUuid?: string;
          footprintName?: string;
        }>;
      }) =>
        generateDraftPlanFromPrompt(input.userQuery, {
          selectedDevices: input.selectedDevices,
        }),
    },
    {
      name: "draft.preview_plan",
      description: "Build a preview summary from a draft plan",
      execute: async (input: {
        plan: ReturnType<typeof generateDraftPlanFromPrompt>;
      }) => previewDraftPlan(input.plan),
    },
  ];
}
