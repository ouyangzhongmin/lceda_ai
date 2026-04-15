import type {
  AgentIterationStep,
  AgentResult,
  AgentStepItem,
  AgentStepState,
  AgentTask,
  AgentToolTrace,
  AgentWorkingMemory,
} from "../shared/agentTypes";

export type ReactEventKind = "task" | "thought" | "tool_call" | "observation" | "final";

export interface AgentReactEvent {
  kind: ReactEventKind;
  label: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  text: string;
  stepKind?: AgentStepState["kind"];
  toolName?: string;
  inputSummary?: string;
  outputSummary?: string;
}

export interface ReactAgentRunResult {
  result: AgentResult;
  reactEvents: AgentReactEvent[];
  stepItems: AgentStepItem[];
}

export interface ReactAgentDeps {
  task: AgentTask;
  allowedTools: string[];
  invokeTool<TInput, TOutput>(toolName: string, input: TInput): Promise<TOutput>;
  listToolNames(): string[];
  signal?: AbortSignal;
  isCancelled?: () => boolean;
  onProgress?: (payload: {
    detail: string;
    textDelta?: string;
    text?: string;
    reasoningDelta?: string;
    reactEvents: AgentReactEvent[];
    stepItems: AgentStepItem[];
    iterationSteps?: AgentIterationStep[];
    stepStates: AgentStepState[];
    workingMemory: AgentWorkingMemory;
  }) => void;
}

export interface ReactAgentState {
  toolTraces: AgentToolTrace[];
  stepStates: AgentStepState[];
  stepItems: AgentStepItem[];
  iterationSteps?: AgentIterationStep[];
  workingMemory: AgentWorkingMemory;
  reactEvents: AgentReactEvent[];
}
