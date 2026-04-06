import type { AgentResult, AgentStepState, AgentTask, AgentToolTrace, AgentWorkingMemory } from "../shared/agentTypes";

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
}

export interface ReactAgentDeps {
  task: AgentTask;
  allowedTools: string[];
  invokeTool<TInput, TOutput>(toolName: string, input: TInput): Promise<TOutput>;
  listToolNames(): string[];
  onProgress?: (payload: {
    detail: string;
    textDelta?: string;
    text?: string;
    reasoningDelta?: string;
    reactEvents: AgentReactEvent[];
    stepStates: AgentStepState[];
    workingMemory: AgentWorkingMemory;
  }) => void;
}

export interface ReactAgentState {
  toolTraces: AgentToolTrace[];
  stepStates: AgentStepState[];
  workingMemory: AgentWorkingMemory;
  reactEvents: AgentReactEvent[];
}
