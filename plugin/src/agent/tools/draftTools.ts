import { generateDraftPlanFromPrompt } from "../../editor/apply-plan/generateDraftPlan";
import { previewDraftPlan } from "../../editor/apply-plan/previewDraftPlan";
import type { AgentTool } from "./toolRegistry";

export function createDraftTools(): AgentTool[] {
  return [
    {
      name: "draft_generate_plan",
      description: "根据用户需求生成最小可用的原理图草案计划",
      parameters: {
        type: "object",
        properties: {
          userQuery: { type: "string", description: "用户的草案需求描述" },
          selectedDevices: {
            type: "array",
            items: { type: "object" },
            description: "可选。用户已挑选的器件列表。",
          },
        },
        required: ["userQuery"],
        additionalProperties: true,
      },
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
      name: "draft_preview_plan",
      description: "根据草案计划生成预览摘要",
      parameters: {
        type: "object",
        properties: {
          plan: {
            type: "object",
            description: "草案计划。若省略，宿主会复用最近生成的 draft plan。",
          },
        },
        additionalProperties: true,
      },
      execute: async (input: {
        plan: ReturnType<typeof generateDraftPlanFromPrompt>;
      }) => previewDraftPlan(input.plan),
    },
  ];
}
