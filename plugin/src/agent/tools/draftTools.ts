import { generateDraftPlanFromPrompt } from "../../editor/apply-plan/generateDraftPlan";
import { buildDraftGuidanceFromRag } from "../../editor/apply-plan/ragDraftGuidance";
import { previewDraftPlan } from "../../editor/apply-plan/previewDraftPlan";
import { resolveDraftPlanDevices } from "../../editor/apply-plan/resolveDraftPlanDevices";
import { draftSpecToPlan, isDraftDesignSpec } from "../../editor/apply-plan/draftSpecToPlan";
import type { RagClient } from "../../services/rag/ragClient";
import type { AgentTool } from "./toolRegistry";
import type { DraftDesignSpec, DraftPlanGuidance, DraftPlanningMode } from "../../editor/apply-plan/draftPlan";
import type { LibraryDeviceDetail, LibrarySearchResultItem } from "../../editor/host/runtime";

function mergeGuidanceEvidence(
  guidance: DraftPlanGuidance | undefined,
  citations?: Awaited<ReturnType<RagClient["buildCitations"]>>
): DraftPlanGuidance | undefined {
  if (!guidance) {
    return guidance;
  }
  const mergedEvidence = [
    ...(guidance.evidence ?? []),
    ...((citations?.results ?? []).map((item) => ({
      title: item.title,
      snippet: item.snippet,
      sourceRef: item.source_ref,
    })) ?? []),
  ];
  const dedupedEvidence = mergedEvidence.filter((item, index, list) => {
    const key = `${item.title}|${item.snippet}|${item.sourceRef}`;
    return list.findIndex((candidate) => `${candidate.title}|${candidate.snippet}|${candidate.sourceRef}` === key) === index;
  });
  return {
    ...guidance,
    evidence: dedupedEvidence.length > 0 ? dedupedEvidence : guidance.evidence,
  };
}

type SearchLibraryDevices = (input: {
  query: string;
  scope?: "system" | "project" | "personal" | "favorite";
  pageSize?: number;
  page?: number;
}) => Promise<LibrarySearchResultItem[]>;

type GetLibraryDevice = (input: {
  deviceUuid: string;
  libraryUuid?: string;
  scope?: "system" | "project" | "personal" | "favorite";
}) => Promise<LibraryDeviceDetail>;

export function createDraftTools(
  ragClient?: RagClient,
  searchLibraryDevices?: SearchLibraryDevices,
  getLibraryDevice?: GetLibraryDevice
): AgentTool[] {
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
          guidance: {
            type: "object",
            description: "可选。来自 RAG/模板的草案约束。",
          },
          spec: {
            type: "object",
            description: "可选。由 LLM 先行决策并生成的结构化 DraftDesignSpec。",
          },
          planningMode: {
            type: "string",
            enum: ["auto", "structured_spec_required"],
            description: "可选。由宿主显式指定草案生成模式。",
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
        guidance?: ReturnType<typeof buildDraftGuidanceFromRag>;
        spec?: DraftDesignSpec;
        planningMode?: DraftPlanningMode;
      }) => {
        if (!input.spec && input.planningMode === "structured_spec_required") {
          throw new Error("planningMode=structured_spec_required requires llm-authored spec before draft_generate_plan");
        }
        if (input.spec && input.planningMode === "structured_spec_required" && !isDraftDesignSpec(input.spec)) {
          throw new Error(
            "planningMode=structured_spec_required requires spec to match DraftDesignSpec (components/nets/connections arrays with structured pins and pinIds)"
          );
        }
        const query = `${input.userQuery} 电路模板 器件选择 连接约束`;
        const ragResults = ragClient ? (await ragClient.search(query, 3)).results : [];
        const resolvedGuidance =
          input.guidance ??
          (ragClient ? buildDraftGuidanceFromRag(input.userQuery, ragResults) : undefined);
        const citations =
          ragClient && !input.guidance ? await ragClient.buildCitations(query, 3) : undefined;
        const mergedGuidance = mergeGuidanceEvidence(resolvedGuidance, citations);
        let plan =
          input.spec && isDraftDesignSpec(input.spec)
            ? draftSpecToPlan({
                spec: input.spec,
                guidance: mergedGuidance,
              })
            : generateDraftPlanFromPrompt(input.userQuery, {
          selectedDevices: input.selectedDevices,
          guidance: mergedGuidance,
        });
        if (searchLibraryDevices) {
          plan = await resolveDraftPlanDevices(plan, async (query) =>
            searchLibraryDevices({ query, scope: "system", pageSize: 5 }),
            getLibraryDevice
              ? async ({ deviceUuid, libraryUuid }) =>
                  getLibraryDevice({
                    deviceUuid,
                    libraryUuid,
                    scope: "system",
                  })
              : undefined
          );
        }
        return plan;
      },
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
