import type { MainPanelState } from "../ui/panels/mainPanel";
import type { EditorAdapter } from "../editor/adapters/editorAdapter";
import type { SchematicContext } from "../types/schematic";
import { classifyAgentIntent } from "./intent/intentClassifier";
import type {
  AgentExecutionTrace,
  AgentPlanStep,
  AgentResult,
  AgentStepState,
  AgentTurnPlan,
  AgentUiEvent,
  AgentWorkingMemory,
} from "./shared/agentTypes";
import type { AgentReactEvent } from "./shared/agentTypes";

interface ExecuteAgentTurnDeps {
  runNaturalChat(
    input: string,
    panelState: MainPanelState,
    adapter?: EditorAdapter,
    context?: SchematicContext
  ): Promise<AgentResult>;
  runAnalysis(
    input: string,
    context: SchematicContext,
    adapter: EditorAdapter,
    planSteps?: Array<{ kind: AgentPlanStep["kind"]; note: string }>
  ): Promise<AgentResult>;
  runDraft(
    input: string,
    context: SchematicContext,
    adapter: EditorAdapter,
    planSteps?: Array<{ kind: AgentPlanStep["kind"]; note: string }>
  ): Promise<AgentResult>;
}

interface ExecuteAgentTurnInput {
  plan: AgentTurnPlan;
  userQuery: string;
  panelState: MainPanelState;
  context?: SchematicContext;
  adapter?: EditorAdapter;
  intentHint?: string;
}

export function planUserTurn(userQuery: string): AgentTurnPlan {
  const intent = classifyAgentIntent(userQuery);
  if (intent === "draft") {
    return {
      intent,
      route: "draft",
      requiresContext: true,
      steps: [
        planStep("context", true, "read current schematic context"),
        planStep("mcp", true, "load engineering knowledge references"),
        planStep("library", true, "search library devices and candidate parts"),
        planStep("llm", true, "ask llm to plan the draft structure"),
        planStep("rules", true, "validate draft constraints against schematic state"),
        planStep("draft", true, "build draft plan and preview"),
      ],
    };
  }
  if (intent === "analysis") {
    return {
      intent,
      route: "analysis",
      requiresContext: true,
      steps: [
        planStep("context", true, "read current schematic context"),
        planStep("mcp", true, "load relevant engineering knowledge references"),
        planStep("rules", true, "run schematic checks and issue location"),
      ],
    };
  }
  return {
    intent,
    route: "chat",
    requiresContext: false,
    steps: [planStep("llm", true, "reply naturally with conversation memory and optional host context")],
  };
}

export async function executeAgentTurn(
  input: ExecuteAgentTurnInput,
  deps: ExecuteAgentTurnDeps
): Promise<AgentResult> {
  const planSteps = input.plan.steps.filter((step) => step.required).map((step) => ({
    kind: step.kind,
    note: step.note,
  }));
  const stepStates = input.plan.steps.map<AgentStepState>((step) => ({
    ...step,
    status: "pending",
  }));
  const workingMemory: AgentWorkingMemory = {
    hasContext: Boolean(input.context && input.adapter),
    mcpReady: false,
    libraryReady: false,
    llmReady: false,
    rulesReady: false,
    draftReady: false,
  };
  const plannerTraces: AgentExecutionTrace[] = [
    {
      phase: "reason",
      message: buildPlanTraceMessage(input.plan),
    },
  ];
  const plannerUiEvents: AgentUiEvent[] = [];
  if (input.intentHint) {
    plannerUiEvents.push({
      kind: "think",
      label: "意图分析",
      status: "done",
      text: input.intentHint,
      source: "planner",
    });
  }
  if (input.plan.route !== "chat") {
    plannerUiEvents.push({
      kind: "plan",
      label: "计划",
      status: "done",
      text: buildPlanUiMessage(input.plan),
      source: "planner",
    });
  }

  if (input.plan.route === "chat") {
    const result = await deps.runNaturalChat(input.userQuery, input.panelState, input.adapter, input.context);
    return finalizePlanResult({
      plan: input.plan,
      route: input.plan.route,
      result,
      userQuery: input.userQuery,
      panelState: input.panelState,
      context: input.context,
      adapter: input.adapter,
      deps,
      plannerTraces,
      plannerUiEvents,
      stepStates: [],
      workingMemory,
      intentHint: input.intentHint,
    });
  }

  if (input.plan.route !== "chat") {
    for (const [index, step] of input.plan.steps.entries()) {
      if (!step.required) {
        stepStates[index].status = "skipped";
        stepStates[index].observation = "optional step skipped by planner";
        plannerTraces.push({
          phase: "observe",
          message: `planner skipped optional step=${step.kind}`,
        });
        plannerUiEvents.push({
          kind: mapPlannerStepKind(step.kind),
          label: mapPlannerStepLabel(step.kind),
          status: "skipped",
          text: "optional step skipped by planner",
          source: "planner",
          stepKind: step.kind,
        });
        continue;
      }

    stepStates[index].status = "running";
    plannerTraces.push({
      phase: "reason",
      message: `planner selected step=${step.kind} note=${step.note}; memory=${summarizeMemory(workingMemory)}`,
    });
    plannerUiEvents.push({
      kind: mapPlannerStepKind(step.kind),
      label: mapPlannerStepLabel(step.kind),
      status: "running",
      text: step.note,
      source: "planner",
      stepKind: step.kind,
    });

      try {
        if (step.kind === "context") {
        assertContextAvailable(input.plan, input.context, input.adapter);
        workingMemory.hasContext = true;
        markStepObserved(stepStates, index, "done", "schematic context ready");
        workingMemory.lastObservation = "schematic context ready";
        plannerTraces.push({
          phase: "observe",
          message: "planner confirmed schematic context is available",
        });
        plannerUiEvents.push({
          kind: "read",
          label: "Context",
          status: "done",
          text: "schematic context ready",
          source: "planner",
          stepKind: "context",
        });
        continue;
      }

        if (step.kind === "mcp") {
        workingMemory.mcpReady = true;
        markStepObserved(stepStates, index, "done", "mcp capability delegated to executor");
        workingMemory.lastObservation = "mcp capability delegated";
        plannerTraces.push({
          phase: "observe",
          message: "planner delegated mcp collection to executor",
        });
        plannerUiEvents.push({
          kind: "read",
          label: "Knowledge",
          status: "done",
          text: "mcp capability delegated to executor",
          source: "planner",
          stepKind: "mcp",
        });
        continue;
      }

        if (step.kind === "library") {
        workingMemory.libraryReady = true;
        markStepObserved(stepStates, index, "done", "library capability delegated to executor");
        workingMemory.lastObservation = "library capability delegated";
        plannerTraces.push({
          phase: "observe",
          message: "planner delegated library lookup to executor",
        });
        plannerUiEvents.push({
          kind: "search",
          label: "Library",
          status: "done",
          text: "library capability delegated to executor",
          source: "planner",
          stepKind: "library",
        });
        continue;
      }

        if (step.kind === "llm") {
          workingMemory.llmReady = true;
        markStepObserved(stepStates, index, "done", "llm capability delegated to executor");
        workingMemory.lastObservation = "llm capability delegated";
        plannerTraces.push({
          phase: "observe",
          message: "planner delegated llm reasoning to executor",
        });
        plannerUiEvents.push({
          kind: "call",
          label: "LLM",
          status: "done",
          text: "llm capability delegated to executor",
          source: "planner",
          stepKind: "llm",
        });
        continue;
      }

        if (step.kind === "rules") {
          workingMemory.rulesReady = true;
          if (input.plan.route === "analysis") {
            assertContextAvailable(input.plan, input.context, input.adapter);
          const result = await deps.runAnalysis(input.userQuery, input.context!, input.adapter!, planSteps);
          return finalizePlanResult({
            plan: input.plan,
            route: input.plan.route,
            result,
            userQuery: input.userQuery,
            panelState: input.panelState,
            context: input.context,
            adapter: input.adapter,
            deps,
            plannerTraces,
            plannerUiEvents,
            stepStates,
            workingMemory,
          });
        }
        markStepObserved(stepStates, index, "done", "rules validation delegated to executor");
        workingMemory.lastObservation = "rules validation delegated";
        plannerTraces.push({
          phase: "observe",
          message: "planner delegated rules validation to executor",
        });
        plannerUiEvents.push({
          kind: "validate",
          label: "Validate",
          status: "done",
          text: "rules validation delegated to executor",
          source: "planner",
          stepKind: "rules",
        });
        continue;
      }

        if (step.kind === "draft") {
          workingMemory.draftReady = true;
          if (input.plan.route === "draft") {
            assertContextAvailable(input.plan, input.context, input.adapter);
          const result = await deps.runDraft(input.userQuery, input.context!, input.adapter!, planSteps);
          return finalizePlanResult({
            plan: input.plan,
            route: input.plan.route,
            result,
            userQuery: input.userQuery,
            panelState: input.panelState,
            context: input.context,
            adapter: input.adapter,
            deps,
            plannerTraces,
            plannerUiEvents,
            stepStates,
            workingMemory,
          });
        }
        markStepObserved(stepStates, index, "done", "draft capability marked ready");
        workingMemory.lastObservation = "draft capability marked ready";
        plannerTraces.push({
          phase: "observe",
          message: "planner confirmed draft capability is ready",
        });
        plannerUiEvents.push({
          kind: "update",
          label: "Draft",
          status: "done",
          text: "draft capability marked ready",
          source: "planner",
          stepKind: "draft",
        });
        continue;
      }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        markStepObserved(stepStates, index, "failed", message);
        workingMemory.lastObservation = message;
        plannerUiEvents.push({
          kind: mapPlannerStepKind(step.kind),
          label: mapPlannerStepLabel(step.kind),
          status: "failed",
          text: message,
          source: "planner",
          stepKind: step.kind,
        });
        throw error;
      }
    }
  }

  return prependPlannerState(
    {
      summary: "planner produced no executable terminal step",
      toolTraceNames: [],
      executionTraces: [
        {
          phase: "finish",
          message: "planner produced no executable terminal step",
        },
      ],
      uiEvents: [
        ...plannerUiEvents,
        {
          kind: "finish",
          label: "Finish",
          status: "done",
          text: "planner produced no executable terminal step",
          source: "planner",
        },
      ],
    },
    plannerTraces,
    plannerUiEvents,
    stepStates,
    workingMemory,
    input.plan,
    input.intentHint
  );
}

async function finalizePlanResult(input: {
  plan: AgentTurnPlan;
  route: AgentTurnPlan["route"];
  result: AgentResult;
  userQuery: string;
  panelState: MainPanelState;
  context?: SchematicContext;
  adapter?: EditorAdapter;
  deps: ExecuteAgentTurnDeps;
  plannerTraces: AgentExecutionTrace[];
  plannerUiEvents: AgentUiEvent[];
  stepStates: AgentStepState[];
  workingMemory: AgentWorkingMemory;
  intentHint?: string;
}): Promise<AgentResult> {
  const baseResult = prependPlannerState(
    input.result,
    input.plannerTraces,
    input.plannerUiEvents,
    input.stepStates,
    input.workingMemory,
    input.plan,
    input.intentHint
  );
  const followup = input.plan.followup;
  if (!shouldExecuteFollowup(input.plan.route, followup, baseResult)) {
    return baseResult;
  }

  if (followup.requiresContext) {
    assertContextAvailable(
      {
        ...input.plan,
        route: followup.route,
        requiresContext: followup.requiresContext,
        steps: followup.steps,
      },
      input.context,
      input.adapter
    );
  }

  const followupStart = createFollowupStartTrace(input.plan.route, followup);
  let followupResult: AgentResult;
  if (followup.route === "draft") {
    followupResult = await input.deps.runDraft(input.userQuery, input.context!, input.adapter!, input.plan.steps.map((step) => ({ kind: step.kind, note: step.note })));
  } else if (followup.route === "analysis") {
    followupResult = await input.deps.runAnalysis(input.userQuery, input.context!, input.adapter!, input.plan.steps.map((step) => ({ kind: step.kind, note: step.note })));
  } else {
    followupResult = await input.deps.runNaturalChat(input.userQuery, input.panelState);
  }

  return mergeFollowupResult(baseResult, followupResult, followupStart, input.plan.route, followup.route);
}

function assertContextAvailable(
  plan: AgentTurnPlan,
  context?: SchematicContext,
  adapter?: EditorAdapter
): void {
  if (!context || !adapter) {
    throw new Error(`context and adapter are required for ${plan.route} route`);
  }
}

function prependPlannerState(
  result: AgentResult,
  plannerTraces: AgentExecutionTrace[],
  plannerUiEvents: AgentUiEvent[],
  stepStates: AgentStepState[],
  workingMemory: AgentWorkingMemory,
  plan: AgentTurnPlan,
  intentHint?: string
): AgentResult {
  const mergedStepStates = mergeStepStates(stepStates, result.stepStates ?? []);
  const mergedWorkingMemory: AgentWorkingMemory = {
    ...workingMemory,
    ...(result.workingMemory ?? {}),
  };
  const prelude = buildPlannerReactPrelude(plan, intentHint);
  return {
    ...result,
    executionTraces: [...plannerTraces, ...(result.executionTraces ?? [])],
    uiEvents: [...plannerUiEvents, ...(result.uiEvents ?? [])],
    reactEvents: [...prelude, ...(result.reactEvents ?? [])],
    stepStates: mergedStepStates,
    workingMemory: mergedWorkingMemory,
  };
}

function shouldExecuteFollowup(
  route: AgentTurnPlan["route"],
  followup: AgentTurnPlan["followup"] | undefined,
  result: AgentResult
): followup is NonNullable<AgentTurnPlan["followup"]> {
  if (!followup) {
    return false;
  }
  if (route === "analysis" && followup.route === "draft") {
    return !result.draftRisk || result.draftRisk.level !== "blocked";
  }
  return false;
}

function createFollowupStartTrace(
  route: AgentTurnPlan["route"],
  followup: NonNullable<AgentTurnPlan["followup"]>
): { execution: AgentExecutionTrace[]; ui: AgentUiEvent[] } {
  const requiredSteps = followup.steps.filter((step) => step.required).map((step) => step.kind).join(">") || "none";
  return {
    execution: [
      {
        phase: "reason",
        message: `planner followup executing ${route}->${followup.route} steps=${requiredSteps}${
          followup.when ? ` when=${followup.when}` : ""
        }`,
      },
    ],
    ui: [
      {
        kind: "plan",
        label: "Follow-up",
        status: "running",
        text: `执行后续阶段 ${route} -> ${followup.route}`,
        source: "planner",
      },
    ],
  };
}

function mergeFollowupResult(
  primary: AgentResult,
  followup: AgentResult,
  startTrace: { execution: AgentExecutionTrace[]; ui: AgentUiEvent[] },
  fromRoute: AgentTurnPlan["route"],
  toRoute: AgentTurnPlan["route"]
): AgentResult {
  const summary = followup.summary || primary.summary;
  const executionTraces = [
    ...(primary.executionTraces ?? []),
    ...startTrace.execution,
    ...(followup.executionTraces ?? []),
    {
      phase: "finish" as const,
      message: `planner followup executed ${fromRoute}->${toRoute}`,
    },
  ];
  const uiEvents = [
    ...(primary.uiEvents ?? []),
    ...startTrace.ui,
    ...(followup.uiEvents ?? []),
    {
      kind: "finish" as const,
      label: "Follow-up",
      status: "done" as const,
      text: `后续阶段已完成：${fromRoute} -> ${toRoute}`,
      source: "planner" as const,
    },
  ];

  return {
    ...primary,
    ...followup,
    summary,
    toolTraceNames: dedupeStrings([...(primary.toolTraceNames ?? []), ...(followup.toolTraceNames ?? [])]),
    toolTraces: [...(primary.toolTraces ?? []), ...(followup.toolTraces ?? [])],
    executionTraces,
    uiEvents,
    reactEvents: [...(primary.reactEvents ?? []), ...(followup.reactEvents ?? [])],
    stepStates: mergeStepStates(primary.stepStates, followup.stepStates),
    workingMemory: {
      ...(primary.workingMemory ?? emptyWorkingMemory()),
      ...(followup.workingMemory ?? {}),
    },
    nextSuggestions: dedupeStrings([...(primary.nextSuggestions ?? []), ...(followup.nextSuggestions ?? [])]),
    structuredSuggestions: [...(primary.structuredSuggestions ?? []), ...(followup.structuredSuggestions ?? [])],
    mcpResources: [...(primary.mcpResources ?? []), ...(followup.mcpResources ?? [])],
    mcpResourceReads: [...(primary.mcpResourceReads ?? []), ...(followup.mcpResourceReads ?? [])],
    libraryInsights: [...(primary.libraryInsights ?? []), ...(followup.libraryInsights ?? [])],
  };
}

function buildPlanTraceMessage(plan: AgentTurnPlan): string {
  const mainSteps = plan.steps.filter((step) => step.required).map((step) => step.kind).join(">") || "none";
  const followup =
    plan.followup
      ? ` followup=${plan.followup.route}:${plan.followup.steps.filter((step) => step.required).map((step) => step.kind).join(">") || "none"}`
      : "";
  return `planner route=${plan.route} context=${plan.requiresContext} steps=${mainSteps}${followup}`;
}

function buildPlanUiMessage(plan: AgentTurnPlan): string {
  const steps = plan.steps
    .filter((step) => step.required)
    .map((step, index) => `${index + 1}. ${step.note || mapPlannerStepLabel(step.kind)}`);
  const followup = plan.followup
    ? `后续：${plan.followup.route}${plan.followup.when ? `（${plan.followup.when}）` : ""}`
    : "";
  return [
    `Route: ${plan.route}`,
    steps.length > 0 ? `任务列表：\n${steps.join("\n")}` : "",
    followup,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildPlannerReactPrelude(plan: AgentTurnPlan, intentHint?: string): AgentReactEvent[] {
  const events: AgentReactEvent[] = [];
  if (intentHint) {
    events.push({
      kind: "thought",
      label: "意图分析",
      status: "done",
      text: intentHint,
    });
  }
  const requiredSteps = plan.steps.filter((step) => step.required);
  if (plan.route !== "chat" && requiredSteps.length > 0) {
    const tasks = requiredSteps.map((step, index) => `${index + 1}. ${step.note || mapPlannerStepLabel(step.kind)}`);
    const taskText = `任务列表：\n${tasks.join("\n")}`;
    events.push({
      kind: "thought",
      label: "计划",
      status: "done",
      text: `将执行以下任务。\n${taskText}`,
    });
  }
  return events;
}

function planStep(kind: AgentPlanStep["kind"], required: boolean, note: string): AgentPlanStep {
  return { kind, required, note };
}

function markStepObserved(
  stepStates: AgentStepState[],
  index: number,
  status: AgentStepState["status"],
  observation: string
): void {
  stepStates[index].status = status;
  stepStates[index].observation = observation;
}

function summarizeMemory(memory: AgentWorkingMemory): string {
  return [
    `ctx=${memory.hasContext}`,
    `mcp=${memory.mcpReady}`,
    `library=${memory.libraryReady}`,
    `llm=${memory.llmReady}`,
    `rules=${memory.rulesReady}`,
    `draft=${memory.draftReady}`,
  ].join(",");
}

function mapPlannerStepKind(kind: AgentPlanStep["kind"]): AgentUiEvent["kind"] {
  switch (kind) {
    case "context":
      return "read";
    case "mcp":
      return "read";
    case "library":
      return "search";
    case "llm":
      return "call";
    case "rules":
      return "validate";
    case "draft":
      return "update";
    default:
      return "update";
  }
}

function mapPlannerStepLabel(kind: AgentPlanStep["kind"]): string {
  switch (kind) {
    case "context":
      return "Context";
    case "mcp":
      return "Knowledge";
    case "library":
      return "Library";
    case "llm":
      return "LLM";
    case "rules":
      return "Validate";
    case "draft":
      return "Draft";
    default:
      return kind;
  }
}

function mergeStepStates(plannerStates: AgentStepState[], executorStates: AgentStepState[]): AgentStepState[] {
  const plannerList = Array.isArray(plannerStates) ? plannerStates : [];
  const executorList = Array.isArray(executorStates) ? executorStates : [];
  const merged = new Map<AgentStepState["kind"], AgentStepState>();
  for (const step of plannerList) {
    merged.set(step.kind, { ...step });
  }
  for (const step of executorList) {
    const existing = merged.get(step.kind);
    merged.set(step.kind, {
      ...(existing ?? step),
      ...step,
    });
  }
  return Array.from(merged.values());
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function emptyWorkingMemory(): AgentWorkingMemory {
  return {
    hasContext: false,
    mcpReady: false,
    libraryReady: false,
    llmReady: false,
    rulesReady: false,
    draftReady: false,
  };
}
