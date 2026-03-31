import type { SchematicContext } from "../../types/schematic";
import type { SchematicCheckResult } from "../../rules/models/checkResult";
import type { DraftPlan, DraftPreview } from "../../editor/apply-plan/draftPlan";

export type AgentTaskType = "natural_chat" | "schematic_analysis" | "schematic_draft";

export interface AgentTask {
  type: AgentTaskType;
  userQuery: string;
  context?: SchematicContext;
  planSteps?: Array<{ kind: AgentPlanStepKind; note: string }>;
}

export interface AgentToolTrace {
  toolName: string;
  status: "success" | "blocked";
  note?: string;
}

export interface AgentExecutionTrace {
  phase: "reason" | "act" | "observe" | "finish";
  message: string;
}

export interface AgentUiEvent {
  kind: "plan" | "task" | "think" | "read" | "search" | "call" | "update" | "validate" | "finish" | "memory";
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  text: string;
  prominent?: boolean;
  source?: "planner" | "executor" | "tool" | "memory";
  toolName?: string;
  stepKind?: AgentPlanStepKind;
}

export interface AgentReactEvent {
  kind: "task" | "thought" | "tool_call" | "observation" | "final";
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  text: string;
  stepKind?: AgentPlanStepKind;
  toolName?: string;
  inputSummary?: string;
  outputSummary?: string;
}

export type AgentRoute = "chat" | "analysis" | "draft";

export type AgentPlanStepKind = "context" | "mcp" | "rules" | "library" | "llm" | "draft";

export interface AgentPlanStep {
  kind: AgentPlanStepKind;
  required: boolean;
  note: string;
}

export type AgentStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface AgentStepState extends AgentPlanStep {
  status: AgentStepStatus;
  observation?: string;
}

export interface AgentTurnPlan {
  intent: "chat" | "analysis" | "draft";
  route: AgentRoute;
  requiresContext: boolean;
  steps: AgentPlanStep[];
  followup?: {
    route: AgentRoute;
    requiresContext: boolean;
    steps: AgentPlanStep[];
    when?: string;
  };
}

export interface AgentWorkingMemory {
  hasContext: boolean;
  mcpReady: boolean;
  libraryReady: boolean;
  llmReady: boolean;
  rulesReady: boolean;
  draftReady: boolean;
  lastObservation?: string;
}

export interface AgentNextSuggestion {
  label: string;
  actionType: "rerun_analysis" | "regenerate_draft" | "ask_followup";
  prompt?: string;
}

export interface AgentEvidenceItem {
  label: string;
  detail: string;
  source?: "tool" | "react" | "planner" | "executor";
}

export interface AgentResult {
  summary: string;
  analysisReport?: {
    overview: string;
    executiveSummary?: string;
    ercSummary?: string[];
    bomOverview?: string[];
    functionalBlocks?: string[];
    powerDomains?: string[];
    powerPaths?: string[];
    signalPaths?: string[];
    controlPaths?: string[];
    keyComponents?: string[];
    riskGroups?: {
      high: string[];
      medium: string[];
      low: string[];
    };
    keyFindings: string[];
    nextSteps: string[];
  };
  nextSuggestions?: string[];
  structuredSuggestions?: AgentNextSuggestion[];
  evidenceItems?: AgentEvidenceItem[];
  selectedSkill?: string;
  llmDraftHint?: string;
  toolTraceNames: string[];
  toolTraces?: AgentToolTrace[];
  executionTraces?: AgentExecutionTrace[];
  mcpResources?: Array<{
    uri: string;
    description: string;
  }>;
  mcpResourceReads?: Array<{
    uri: string;
    title: string;
    summary: string;
  }>;
  libraryInsights?: Array<{
    query: string;
    title: string;
    summary: string;
  }>;
  naturalReply?: string;
  checkResult?: SchematicCheckResult;
  locateResult?: {
    located: boolean;
    issueId?: string;
    objectId?: string;
    objectType?: string;
  };
  draftPlan?: DraftPlan;
  draftPreview?: DraftPreview;
  draftValidation?: SchematicCheckResult;
  draftRisk?: {
    level: "safe" | "warning" | "blocked";
    issueCount: number;
    highSeverityCount: number;
    message: string;
  };
  contextDigest?: {
    channel: string;
    componentCount: number;
    netCount: number;
    selectionCount: number;
  };
  uiEvents?: AgentUiEvent[];
  reactEvents?: AgentReactEvent[];
  stepStates?: AgentStepState[];
  workingMemory?: AgentWorkingMemory;
}

export interface AgentTurnResult {
  route: AgentRoute;
  intent: "chat" | "analysis" | "draft";
  plan: AgentTurnPlan;
  result: AgentResult;
}
