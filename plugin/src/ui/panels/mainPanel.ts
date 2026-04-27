import type { DraftPlan } from "../../editor/apply-plan/draftPlan";
import type {
  AppliedDraftSnapshot,
  DraftObjectBindings,
  DraftPatchPlan,
} from "../../editor/apply-plan/draftPatchPlan";
import type { AgentIterationStep, AgentStepItem } from "../../agent/shared/agentTypes";

export interface MainPanelState {
  __stateVersion?: number;
  loggedIn: boolean;
  llmMode?: "custom" | "proxy";
  llmLastRoute?: "custom" | "proxy";
  llmLastModel?: string;
  llmLastAt?: string;
  llmDebugEnabled?: boolean;
  sessionTitle?: string;
  agentRunState?: "idle" | "planning" | "running_tools" | "waiting_llm" | "awaiting_confirmation" | "completed" | "failed";
  agentRunRoute?: "chat" | "analysis" | "draft" | "modify";
  agentRunDetail?: string;
  loginStatus?: string;
  summary?: string;
  userDisplayName?: string;
  userEmail?: string;
  creditsBalance?: number;
  creditsCurrency?: string;
  channel?: string;
  componentCount?: number;
  netCount?: number;
  selectionCount?: number;
  issueCount?: number;
  topIssueTitle?: string;
  locateStatus?: string;
  issueItems?: Array<{
    title: string;
    severity?: string;
    objectId?: string;
    objectType?: string;
  }>;
  draftPreview?: {
    title: string;
    rationale: string;
    componentRefs: string[];
    netNames: string[];
    componentCount: number;
    netCount: number;
    selectedDeviceDetails?: string[];
    unresolvedDeviceDetails?: string[];
    guidanceSummary?: {
      templateId: string;
      rationale: string;
      preferredSearches?: string[];
      requiredNets?: string[];
      requiredConnections?: string[];
      evidence?: string[];
    };
  };
  draftPlan?: DraftPlan;
  appliedDraftSnapshot?: AppliedDraftSnapshot;
  draftObjectBindings?: DraftObjectBindings;
  draftPatchPlan?: DraftPatchPlan;
  devicePicker?: {
    open: boolean;
    items: Array<{
      componentId: string;
      componentRef: string;
      role: string;
      roleLabel?: string;
      query?: string;
      status: "resolved" | "unresolved";
      reason?: string;
      reasonLabel?: string;
      usageHint?: string;
      manualQueryExpanded?: boolean;
      manualQueryDraft?: string;
      selectedDeviceLabel?: string;
      candidates?: Array<{
        uuid: string;
        name: string;
        libraryUuid: string;
        footprintName?: string;
        manufacturer?: string;
        supplier?: string;
        supplierId?: string;
        description?: string;
        typeLabel?: string;
        fitLabel?: string;
        fitLevel?: "recommended" | "possible" | "weak";
        summary?: string;
        reasons?: string[];
        cautions?: string[];
      }>;
    }>;
  };
  chatMessages?: Array<{
    role: "assistant" | "user" | "system";
    title?: string;
    content: string;
    contextCompaction?: {
      compressedTurns: number;
      keptRecentTurns: number;
      createdAt: string;
      version: number;
    };
    structuredContent?: Array<
      | {
          kind: "paragraph";
          text: string;
        }
      | {
          kind: "section";
          title: string;
          text: string;
        }
      | {
          kind: "list";
          title?: string;
          items: string[];
        }
      | {
          kind: "kv";
          title?: string;
          entries: Array<{
            key: string;
            value: string;
          }>;
        }
    >;
    evidenceItems?: Array<{
      label: string;
      detail: string;
      source?: "tool" | "react" | "planner" | "executor";
    }>;
    tone?: "default" | "success" | "warning";
    toolTraces?: Array<{
      toolName: string;
      status: "success" | "blocked";
      note?: string;
    }>;
    executionTraces?: Array<{
      phase: "reason" | "act" | "observe" | "finish";
      message: string;
    }>;
    uiEvents?: Array<{
      kind: "plan" | "think" | "read" | "search" | "call" | "update" | "validate" | "finish" | "memory";
      label: string;
      status: "pending" | "running" | "done" | "failed" | "skipped";
      text: string;
      prominent?: boolean;
      source?: "planner" | "executor" | "tool" | "memory";
      toolName?: string;
      stepKind?: "context" | "mcp" | "rules" | "library" | "llm" | "draft";
    }>;
    reactEvents?: Array<{
      kind: "task" | "thought" | "tool_call" | "observation" | "final";
      label: string;
      status: "pending" | "running" | "done" | "failed" | "skipped";
      text: string;
      stepKind?: "context" | "mcp" | "rules" | "library" | "llm" | "draft";
      toolName?: string;
      inputSummary?: string;
      outputSummary?: string;
    }>;
    stepItems?: AgentStepItem[];
    iterationSteps?: AgentIterationStep[];
    stepTranscript?: string[];
    stepStates?: Array<{
      kind: "context" | "mcp" | "rules" | "library" | "llm" | "draft";
      required: boolean;
      note: string;
      status: "pending" | "running" | "done" | "failed" | "skipped";
      observation?: string;
    }>;
    workingMemory?: {
      hasContext: boolean;
      mcpReady: boolean;
      libraryReady: boolean;
      llmReady: boolean;
      rulesReady: boolean;
      draftReady: boolean;
      lastObservation?: string;
    };
    reasoningContent?: string;
    suggestions?: Array<{
      label: string;
      actionType: "rerun_analysis" | "regenerate_draft" | "ask_followup";
      prompt?: string;
    }>;
    streaming?: boolean;
    actions?: Array<{
      label: string;
      action: "login" | "rerun" | "locate" | "apply_draft" | "apply_patch_draft" | "rollback" | "select_devices";
      payload?: string;
    }>;
    analysisMarkdown?: string;
    reportMarkdown?: string;
  }>;
  creditsTransactions?: Array<{
    id: string;
    type: string;
    amount: number;
    balanceAfter: number;
    remark?: string;
    createdAt: string;
  }>;
  customLlmConfig?: {
    provider: string;
    baseUrl: string;
    apiKeyMasked: string;
    model: string;
    preferredOutputLanguage: string;
  };
  toast?: {
    id: number;
    message: string;
  };
  nextActions?: string[];
  capabilityReport?: {
    channel: "standard" | "professional";
    available: boolean;
    missing: string[];
    optionalMissing: string[];
  };
}

export function createInitialMainPanelState(): MainPanelState {
  return {
    loggedIn: false,
  };
}
