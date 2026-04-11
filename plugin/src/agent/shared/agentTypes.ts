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
  analysisMarkdown?: string;
  analysisReport?: {
    schematicInfo?: {
      pageName?: string;
      projectId?: string;
      pageId?: string;
      channel?: string;
      componentCount?: number;
      netCount?: number;
      selectionCount?: number;
    };
    issueGroups?: Array<{
      severity: "low" | "medium" | "high";
      title: string;
      count: number;
      examples: string[];
      suggestion?: string;
    }>;
    issueSamples?: Array<{
      severity: "low" | "medium" | "high";
      title: string;
      label: string;
      message: string;
      suggestion?: string;
    }>;
    overview: string;
    executiveSummary?: string;
    ercSummary?: string[];
    bomOverview?: string[];
    functionalBlocks?: string[];
    powerDomains?: string[];
    powerPaths?: string[];
    signalPaths?: string[];
    controlPaths?: string[];
    connectivityChecks?: string[];
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
    objectLabel?: string;
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
    pageName?: string;
    projectId?: string;
    pageId?: string;
    componentCount: number;
    netCount: number;
    selectionCount: number;
  };
  locateLabel?: string;
  uiEvents?: AgentUiEvent[];
  reactEvents?: AgentReactEvent[];
  stepStates?: AgentStepState[];
  workingMemory?: AgentWorkingMemory;
}

export interface AgentTurnResult {
  route: AgentRoute;
  result: AgentResult;
}
