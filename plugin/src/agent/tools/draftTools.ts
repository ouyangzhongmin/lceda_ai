import { generateDraftPlanFromPrompt } from "../../editor/apply-plan/generateDraftPlan";
import { buildDraftGuidanceFromRag } from "../../editor/apply-plan/ragDraftGuidance";
import { previewDraftPlan } from "../../editor/apply-plan/previewDraftPlan";
import { resolveDraftPlanDevices } from "../../editor/apply-plan/resolveDraftPlanDevices";
import { draftSpecToPlan, isDraftDesignSpec } from "../../editor/apply-plan/draftSpecToPlan";
import { classifyDraftApplyError, repairDraftPlanPowerConnectivity } from "../../editor/apply-plan/repairDraftPlan";
import type { RagClient } from "../../services/rag/ragClient";
import type { AgentTool } from "./toolRegistry";
import type { DraftDesignSpec, DraftPlanGuidance, DraftPlanningMode } from "../../editor/apply-plan/draftPlan";
import type { DevboardRagTemplateCorpusEntry } from "../../editor/apply-plan/devboardRagTemplates";
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

type GetLibrarySymbol = (input: {
  symbolUuid: string;
  libraryUuid?: string;
  scope?: "system" | "project" | "personal" | "favorite";
}) => Promise<LibraryDeviceDetail>;

export function createDraftTools(
  ragClient?: RagClient,
  searchLibraryDevices?: SearchLibraryDevices,
  getLibraryDevice?: GetLibraryDevice,
  getLibrarySymbol?: GetLibrarySymbol
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
          externalRagTemplateCorpus: {
            type: "array",
            items: { type: "object" },
            description: "可选。服务端返回的外部 devboard RAG 子电路模板语料。",
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
        externalRagTemplateCorpus?: DevboardRagTemplateCorpusEntry[];
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
        const ragResultsResponse = ragClient ? await ragClient.search(query, 3) : undefined;
        const ragResults = ragResultsResponse?.results ?? [];
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
          externalRagTemplateCorpus: input.externalRagTemplateCorpus ?? ragResultsResponse?.external_rag_template_corpus,
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
              : undefined,
            getLibrarySymbol
              ? async ({ symbolUuid, libraryUuid }) =>
                  getLibrarySymbol({
                    symbolUuid,
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
    {
      name: "draft_repair_plan",
      description: "基于结构化应用错误，对当前草案做受限的局部修补，而不是整版重生成",
      parameters: {
        type: "object",
        properties: {
          plan: {
            type: "object",
            description: "待修补的草案计划",
          },
          applyError: {
            type: "string",
            description: "应用草案失败时返回的原始错误信息",
          },
        },
        required: ["plan", "applyError"],
        additionalProperties: false,
      },
      execute: async (input: {
        plan: ReturnType<typeof generateDraftPlanFromPrompt>;
        applyError: string;
      }) => {
        const classification = classifyDraftApplyError(input.applyError);
        if (classification.kind !== "unknown") {
          const repaired = repairDraftPlanPowerConnectivity(input.plan);
          return {
            classification,
            repaired: repaired.changed,
            plan: repaired.plan,
          };
        }
        return {
          classification,
          repaired: false,
          plan: input.plan,
        };
      },
    },
  ];
}
