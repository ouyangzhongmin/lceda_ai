# Unified Step Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fragmented process rendering with a unified `stepItems` timeline and a separate final report area, while preserving compatibility with existing chat history.

**Architecture:** Add `stepItems` as the primary process protocol in agent/runtime/UI, keep `reactEvents` only as a compatibility bridge, and stop rendering standalone thought-summary blocks. Process updates stream into stable timeline items by `id`, while final route output renders in a dedicated report section after completion.

**Tech Stack:** TypeScript, Node test runner, existing plugin iframe renderer, runtime state persistence

---

## File Map

- Modify: `plugin/src/agent/shared/agentTypes.ts`
  Responsibility: define `stepItems` types and extend `AgentResult`.
- Modify: `plugin/src/agent/core/reactTypes.ts`
  Responsibility: carry `stepItems` in ReAct state.
- Modify: `plugin/src/agent/core/reactLoopAgent.ts`
  Responsibility: emit stable process items during ReAct streaming and suppress `final` as a visible step item.
- Modify: `plugin/src/agent/core/unifiedReactAgent.ts`
  Responsibility: propagate `stepItems` into final agent results and compatibility backfill.
- Modify: `plugin/src/app/assistantRuntime.ts`
  Responsibility: normalize, merge, sanitize, persist, and recover `stepItems`; convert legacy `reactEvents` on read.
- Modify: `plugin/src/ui/panels/mainPanel.ts`
  Responsibility: extend message state shape with `stepItems`.
- Modify: `plugin/iframe/iframe-app.js`
  Responsibility: render unified process timeline from `stepItems`, remove standalone thought-summary block, and keep final report in a separate section.
- Modify: `plugin/src/agent/core/__tests__/reactLoopAgent.test.ts`
  Responsibility: cover `stepItems` emission and final suppression.
- Modify: `plugin/src/app/__tests__/assistantRuntime.test.ts`
  Responsibility: cover legacy conversion, merge behavior, final report separation, and control-text stripping.

### Task 1: Add Unified Step Item Types

**Files:**
- Modify: `plugin/src/agent/shared/agentTypes.ts`
- Modify: `plugin/src/ui/panels/mainPanel.ts`
- Modify: `plugin/src/agent/core/reactTypes.ts`
- Test: `plugin/src/agent/core/__tests__/reactLoopAgent.test.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Write the failing type-level tests by extending existing fixtures**

Add assertions in `plugin/src/app/__tests__/assistantRuntime.test.ts` that construct assistant messages with `stepItems` and expect those arrays to survive merge helpers unchanged:

```ts
test("mergeAssistantFinalMessage preserves stepItems from the pending message", () => {
  const pending = {
    role: "assistant" as const,
    title: "分析中",
    content: "",
    streaming: true,
    stepItems: [
      {
        id: "thought-1",
        phase: "llm" as const,
        type: "thought" as const,
        status: "running" as const,
        title: "思考",
        text: "正在分析",
        streaming: true,
      },
    ],
  };
  const finalMessage = {
    role: "assistant" as const,
    title: "分析结果",
    content: "报告内容",
  };

  const merged = mergeAssistantFinalMessage(pending, finalMessage);
  assert.equal(merged.stepItems?.length, 1);
  assert.equal(merged.stepItems?.[0]?.id, "thought-1");
});
```

- [ ] **Step 2: Run the targeted runtime test and verify it fails on missing `stepItems` types**

Run:

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/plugin
node --test src/app/__tests__/assistantRuntime.test.ts
```

Expected: FAIL with TypeScript/runtime fixture mismatch because `stepItems` is not part of the message shape or merge helpers.

- [ ] **Step 3: Add the unified `stepItems` types**

Update `plugin/src/agent/shared/agentTypes.ts` with the new process item type and add it to `AgentResult`:

```ts
export type AgentStepItemPhase = "context" | "mcp" | "rules" | "library" | "llm" | "draft" | "system";

export type AgentStepItemType = "task" | "thought" | "tool_call" | "observation" | "status";

export interface AgentStepItem {
  id: string;
  phase: AgentStepItemPhase;
  type: AgentStepItemType;
  status: AgentStepStatus;
  title: string;
  text: string;
  toolName?: string;
  inputSummary?: string;
  outputSummary?: string;
  startedAt?: string;
  updatedAt?: string;
  streaming?: boolean;
}
```

And add:

```ts
stepItems?: AgentStepItem[];
```

inside `AgentResult`.

Update `plugin/src/ui/panels/mainPanel.ts` message shape with:

```ts
stepItems?: Array<{
  id: string;
  phase: "context" | "mcp" | "rules" | "library" | "llm" | "draft" | "system";
  type: "task" | "thought" | "tool_call" | "observation" | "status";
  status: "pending" | "running" | "done" | "failed" | "skipped";
  title: string;
  text: string;
  toolName?: string;
  inputSummary?: string;
  outputSummary?: string;
  startedAt?: string;
  updatedAt?: string;
  streaming?: boolean;
}>;
```

Update `plugin/src/agent/core/reactTypes.ts` state shape so the in-flight state stores `stepItems: AgentStepItem[]`.

- [ ] **Step 4: Run the targeted runtime test and verify the shape compiles**

Run:

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/plugin
node --test src/app/__tests__/assistantRuntime.test.ts
```

Expected: either PASS for the new type-only fixture or FAIL later in merge logic, but no longer fail because `stepItems` is unknown.

- [ ] **Step 5: Commit the type additions**

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
git add plugin/src/agent/shared/agentTypes.ts plugin/src/ui/panels/mainPanel.ts plugin/src/agent/core/reactTypes.ts plugin/src/app/__tests__/assistantRuntime.test.ts
git commit -m "feat: add unified step item types"
```

### Task 2: Emit Step Items from ReAct and Unified Agent

**Files:**
- Modify: `plugin/src/agent/core/reactTypes.ts`
- Modify: `plugin/src/agent/core/reactLoopAgent.ts`
- Modify: `plugin/src/agent/core/unifiedReactAgent.ts`
- Test: `plugin/src/agent/core/__tests__/reactLoopAgent.test.ts`

- [ ] **Step 1: Write the failing ReAct tests for `stepItems` emission**

Add two tests in `plugin/src/agent/core/__tests__/reactLoopAgent.test.ts`:

```ts
test("runReActLoop updates a single thought step item during reasoning deltas", async () => {
  const state = createState();
  let onEvent: ((event: { type: string; reasoning_delta?: string }) => void) | undefined;

  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "分析原理图" },
    allowedTools: ["editor_get_current_context"],
    listToolNames: () => ["editor_get_current_context", "llm_generate"],
    invokeTool: async (toolName, input) => {
      if (toolName === "llm_generate") {
        onEvent = (input as { onEvent?: typeof onEvent }).onEvent;
        onEvent?.({ type: "reasoning_delta", reasoning_delta: "先读取上下文" });
        onEvent?.({ type: "reasoning_delta", reasoning_delta: "，再判断问题" });
        return { output_text: '{"type":"final","route":"analysis","output":"完成"}' } as never;
      }
      throw new Error(`unexpected tool: ${toolName}`);
    },
  };

  await runReActLoop({ deps, state, system: "system", user: "user", toolDefinitions: [] });

  const thoughtItems = state.stepItems.filter((item) => item.type === "thought");
  assert.equal(thoughtItems.length, 1);
  assert.equal(thoughtItems[0]?.text, "先读取上下文，再判断问题");
});

test("runReActLoop does not append final as a visible step item", async () => {
  const state = createState();
  const deps: ReactAgentDeps = {
    task: { type: "natural_chat", userQuery: "分析原理图" },
    allowedTools: [],
    listToolNames: () => ["llm_generate"],
    invokeTool: async () => ({ output_text: '{"type":"final","route":"analysis","output":"完成"}' } as never),
  };

  await runReActLoop({ deps, state, system: "system", user: "user", toolDefinitions: [] });

  assert.equal(state.stepItems.some((item) => item.type === "status" && item.text.includes("完成")), false);
});
```

- [ ] **Step 2: Run the targeted ReAct test and verify it fails**

Run:

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/plugin
node --test src/agent/core/__tests__/reactLoopAgent.test.ts
```

Expected: FAIL because `state.stepItems` is not emitted yet and `final` is still modeled only through `reactEvents`.

- [ ] **Step 3: Add `stepItems` mutation helpers in the ReAct loop**

In `plugin/src/agent/core/reactLoopAgent.ts`, add focused helpers near the existing event helpers:

```ts
function upsertStepItem(
  items: AgentStepItem[],
  next: AgentStepItem
): AgentStepItem {
  const index = items.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    items[index] = { ...items[index], ...next, updatedAt: next.updatedAt ?? new Date().toISOString() };
    return items[index]!;
  }
  const created = {
    ...next,
    startedAt: next.startedAt ?? new Date().toISOString(),
    updatedAt: next.updatedAt ?? new Date().toISOString(),
  };
  items.push(created);
  return created;
}

function stepPhase(stepKind?: AgentPlanStepKind): AgentStepItem["phase"] {
  return stepKind ?? "system";
}
```

Use these helpers where the loop currently pushes `reactEvents`:

- iteration start: create/update a `task` item
- reasoning delta: update a single `thought` item using the iteration-scoped id
- tool call: add `tool_call`
- observation success/failure: add `observation`
- retry/status transitions: add `status` items only for real retry/error states

Do not create any `stepItems` entry when `decision.type === "final"`.

- [ ] **Step 4: Propagate `stepItems` through the unified agent result**

In `plugin/src/agent/core/unifiedReactAgent.ts`:

- initialize `state.stepItems = []`
- return `stepItems: state.stepItems`
- where compatibility is needed, derive `reactEvents` from `stepItems` instead of treating `reactEvents` as primary

Use a focused adapter function:

```ts
function buildCompatReactEvents(stepItems: AgentStepItem[]): AgentReactEvent[] {
  return stepItems.flatMap((item) => {
    if (item.type === "status") return [];
    return [{
      kind: item.type,
      label: item.title,
      status: item.status,
      text: item.text,
      stepKind: item.phase === "system" ? undefined : item.phase,
      toolName: item.toolName,
      inputSummary: item.inputSummary,
      outputSummary: item.outputSummary,
    }];
  });
}
```

- [ ] **Step 5: Run the ReAct tests and verify they pass**

Run:

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/plugin
node --test src/agent/core/__tests__/reactLoopAgent.test.ts
```

Expected: PASS, including the new `stepItems` assertions.

- [ ] **Step 6: Commit the agent-layer step item emission**

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
git add plugin/src/agent/core/reactTypes.ts plugin/src/agent/core/reactLoopAgent.ts plugin/src/agent/core/unifiedReactAgent.ts plugin/src/agent/core/__tests__/reactLoopAgent.test.ts
git commit -m "feat: emit unified step items from react agent"
```

### Task 3: Normalize, Merge, and Persist Step Items in Runtime

**Files:**
- Modify: `plugin/src/app/assistantRuntime.ts`
- Modify: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Write the failing runtime tests for conversion and merge**

Add tests in `plugin/src/app/__tests__/assistantRuntime.test.ts`:

```ts
test("legacy reactEvents are converted into stepItems without final entries", () => {
  const normalized = normalizeLegacyStepItems([
    { kind: "thought", label: "Reasoning", status: "done", text: "先看上下文", stepKind: "llm" },
    { kind: "final", label: "Finish", status: "done", text: "完成" },
  ]);

  assert.deepEqual(normalized, [
    {
      id: "thought:llm:Reasoning:0",
      phase: "llm",
      type: "thought",
      status: "done",
      title: "Reasoning",
      text: "先看上下文",
      streaming: false,
    },
  ]);
});

test("replaceTrailingPendingAssistant preserves streamed stepItems when final message omits them", () => {
  const previousMessages = [
    { role: "user" as const, title: "你", content: "分析一下" },
    {
      role: "assistant" as const,
      title: "分析中",
      content: "",
      streaming: true,
      stepItems: [
        {
          id: "thought-1",
          phase: "llm" as const,
          type: "thought" as const,
          status: "running" as const,
          title: "思考",
          text: "正在分析",
          streaming: true,
        },
      ],
    },
  ];

  const merged = finalizeDraftTurnMessages(previousMessages, [
    { role: "assistant" as const, title: "分析结果", content: "最终报告" },
  ]);

  assert.equal(merged[1]?.stepItems?.[0]?.id, "thought-1");
});
```

- [ ] **Step 2: Run the targeted runtime test and verify it fails**

Run:

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/plugin
node --test src/app/__tests__/assistantRuntime.test.ts
```

Expected: FAIL because conversion helpers and merge preservation for `stepItems` do not exist yet.

- [ ] **Step 3: Implement runtime normalization and compatibility helpers**

In `plugin/src/app/assistantRuntime.ts`, add focused helpers:

```ts
export function convertReactEventsToStepItems(
  reactEvents: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"]
): NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"] {
  if (!Array.isArray(reactEvents)) {
    return undefined;
  }
  const converted = reactEvents.flatMap((event, index) => {
    if (!event || event.kind === "final") {
      return [];
    }
    return [{
      id: `${event.kind}:${event.stepKind ?? "system"}:${event.label || "item"}:${index}`,
      phase: event.stepKind ?? "system",
      type: event.kind,
      status: event.status,
      title: event.label || "步骤",
      text: stripFinalControlLikeText(event.text),
      toolName: event.toolName,
      inputSummary: event.inputSummary,
      outputSummary: event.outputSummary,
      streaming: event.status === "running",
    }];
  });
  return converted.length > 0 ? converted : undefined;
}

function preferStepItems(
  nextStepItems: NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"],
  fallbackReactEvents: NonNullable<MainPanelState["chatMessages"]>[number]["reactEvents"]
): NonNullable<MainPanelState["chatMessages"]>[number]["stepItems"] {
  return Array.isArray(nextStepItems) && nextStepItems.length > 0
    ? nextStepItems
    : convertReactEventsToStepItems(fallbackReactEvents);
}
```

Use them in:

- streaming event application
- `replaceTrailingPendingAssistant`
- `mergeAssistantFinalMessage`
- persistence normalization
- history restoration

Also ensure `createPendingAssistantMessage` creates initial `stepItems` rather than only `reactEvents`.

- [ ] **Step 4: Stop using `stepTranscript` as the primary process source**

Update runtime persistence helpers so:

- `stepItems` is preserved on save
- `stepTranscript` remains optional compatibility output only
- sanitized `thought` text and final control stripping happen before `stepItems` enter message state

Use this pattern in normalization:

```ts
const stepItems = preferStepItems(message.stepItems, message.reactEvents);
return {
  ...message,
  stepItems,
  reactEvents,
  stepTranscript: buildStepTranscriptFromStepItems(stepItems) ?? buildStepTranscriptFromReactEvents(reactEvents),
  streaming: false,
};
```

- [ ] **Step 5: Run the runtime tests and verify they pass**

Run:

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/plugin
node --test src/app/__tests__/assistantRuntime.test.ts
```

Expected: PASS, including legacy conversion and merge preservation.

- [ ] **Step 6: Commit the runtime normalization changes**

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
git add plugin/src/app/assistantRuntime.ts plugin/src/app/__tests__/assistantRuntime.test.ts
git commit -m "feat: normalize unified step items in runtime"
```

### Task 4: Rewrite Iframe Rendering to Use the Timeline + Final Report Split

**Files:**
- Modify: `plugin/iframe/iframe-app.js`
- Modify: `plugin/src/ui/panels/mainPanel.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Write the failing rendering-oriented runtime fixture**

Add a fixture-oriented test in `plugin/src/app/__tests__/assistantRuntime.test.ts` that prepares an assistant message with `stepItems` and verifies the message shape distinguishes process data from final report data:

```ts
test("assistant final messages can carry both stepItems and analysisMarkdown without stepTranscript dependence", () => {
  const message: MainPanelState["chatMessages"][number] = {
    role: "assistant",
    title: "分析结果",
    content: "",
    analysisMarkdown: "## 报告",
    stepItems: [
      {
        id: "tool-1",
        phase: "context",
        type: "tool_call",
        status: "done",
        title: "Action",
        text: "读取当前原理图上下文",
      },
    ],
  };

  assert.equal(message.stepItems?.length, 1);
  assert.equal(message.analysisMarkdown, "## 报告");
});
```

- [ ] **Step 2: Run the runtime tests and verify the new fixture passes before UI changes**

Run:

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/plugin
node --test src/app/__tests__/assistantRuntime.test.ts
```

Expected: PASS. This is a guard fixture before the renderer rewrite.

- [ ] **Step 3: Rewrite the process renderer in `plugin/iframe/iframe-app.js`**

Replace the current process rendering branches so the message card:

- reads `message.stepItems` first
- falls back to converting `message.reactEvents` only when `stepItems` is absent
- renders a single timeline container for process items
- never renders a standalone thought-summary card
- renders final report content below the timeline only after selecting the route-specific final content

Use a structure like:

```js
function getMessageStepItems(message) {
  if (Array.isArray(message.stepItems) && message.stepItems.length > 0) {
    return message.stepItems;
  }
  return convertLegacyReactEvents(message.reactEvents);
}

function getFinalReportText(message) {
  return String(
    message.analysisMarkdown ||
    message.reportMarkdown ||
    message.content ||
    ""
  ).trim();
}
```

Then render:

```js
const stepItems = getMessageStepItems(message);
if (stepItems.length > 0) {
  renderStepTimeline(stepItems);
}
const finalReport = getFinalReportText(message);
if (finalReport) {
  renderFinalReport(finalReport);
}
```

- [ ] **Step 4: Remove the standalone thought-summary and transcript branches**

Delete or disable the renderer branches that:

- create the “思考摘要” card from `thought`
- render `stepTranscript` as a separate block when process items already exist
- show leaked control text under the main content area

Keep only one process visualization path.

- [ ] **Step 5: Build the plugin bundle to verify the iframe compiles**

Run:

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/plugin
npm run build:test
```

Expected: build completes successfully and regenerates the iframe bundle without syntax errors.

- [ ] **Step 6: Commit the iframe timeline rewrite**

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
git add plugin/iframe/iframe-app.js plugin/src/ui/panels/mainPanel.ts plugin/src/app/__tests__/assistantRuntime.test.ts
git commit -m "feat: render unified step item timeline"
```

### Task 5: Final Cleanup and Full Verification

**Files:**
- Modify: `plugin/src/agent/core/reactLoopAgent.ts`
- Modify: `plugin/src/agent/core/unifiedReactAgent.ts`
- Modify: `plugin/src/app/assistantRuntime.ts`
- Modify: `plugin/iframe/iframe-app.js`
- Test: `plugin/src/agent/core/__tests__/reactLoopAgent.test.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Write the failing control-text regression test**

Add this test to `plugin/src/app/__tests__/assistantRuntime.test.ts`:

```ts
test("convertReactEventsToStepItems strips leaked final control text", () => {
  const stepItems = convertReactEventsToStepItems([
    {
      kind: "thought",
      label: "Reasoning",
      status: "done",
      text: '先分析\\n{"type":"final","route":"analysis"}',
      stepKind: "llm",
    },
  ]);

  assert.equal(stepItems?.[0]?.text, "先分析");
});
```

- [ ] **Step 2: Run the focused runtime test and verify it fails if cleanup is incomplete**

Run:

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/plugin
node --test src/app/__tests__/assistantRuntime.test.ts
```

Expected: FAIL if any conversion path still leaks control text.

- [ ] **Step 3: Finalize cleanup across agent and runtime**

Ensure all of the following are true:

- `createPendingAssistantMessage` seeds `stepItems`
- stream progress updates prefer `stepItems`
- `mergeAssistantFinalMessage` preserves `stepItems`
- final route rendering does not inspect `final` process events
- `reactEvents` remains compatibility-only and is never the primary UI path

For compatibility, keep this fallback in final message assembly:

```ts
const mergedStepItems = preferNonEmptyArray(
  finalMessage.stepItems,
  pendingMessage.stepItems ?? convertReactEventsToStepItems(pendingMessage.reactEvents)
);
```

- [ ] **Step 4: Run the full targeted verification suite**

Run:

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai/plugin
node --test src/agent/core/__tests__/reactLoopAgent.test.ts
node --test src/app/__tests__/assistantRuntime.test.ts
npm run build:test
```

Expected:

- both test files PASS
- `npm run build:test` exits 0

- [ ] **Step 5: Inspect the diff for scope drift**

Run:

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
git diff -- plugin/src/agent/shared/agentTypes.ts plugin/src/agent/core/reactTypes.ts plugin/src/agent/core/reactLoopAgent.ts plugin/src/agent/core/unifiedReactAgent.ts plugin/src/app/assistantRuntime.ts plugin/src/ui/panels/mainPanel.ts plugin/iframe/iframe-app.js plugin/src/agent/core/__tests__/reactLoopAgent.test.ts plugin/src/app/__tests__/assistantRuntime.test.ts
```

Expected: only the unified `stepItems` protocol, compatibility conversion, timeline rendering, and related tests are changed.

- [ ] **Step 6: Commit the completed feature**

```bash
cd /Users/oyzm/workspace5/agents/lceda_ai
git add plugin/src/agent/shared/agentTypes.ts plugin/src/agent/core/reactTypes.ts plugin/src/agent/core/reactLoopAgent.ts plugin/src/agent/core/unifiedReactAgent.ts plugin/src/app/assistantRuntime.ts plugin/src/ui/panels/mainPanel.ts plugin/iframe/iframe-app.js plugin/src/agent/core/__tests__/reactLoopAgent.test.ts plugin/src/app/__tests__/assistantRuntime.test.ts
git commit -m "feat: unify assistant process steps into timeline items"
```
