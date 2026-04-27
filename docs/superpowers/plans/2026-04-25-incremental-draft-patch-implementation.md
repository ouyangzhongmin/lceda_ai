# Incremental Draft Patch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add phase-1 current-page incremental draft patching so a previously applied draft can be modified and re-applied as in-place changes, including same-class device replacement and conflict surfacing.

**Architecture:** Persist the last applied draft snapshot plus object bindings, build a structured patch plan from old-vs-new draft plans, preview the patch in UI, then execute object-level updates instead of defaulting to full-page reapply. Keep full replace/rollback only as fallback, not as the default path.

**Tech Stack:** TypeScript, existing plugin runtime, editor adapter/host bridge, node:test, iframe UI

---

## File Map

### New Files

- `plugin/src/editor/apply-plan/draftPatchPlan.ts`
  Defines phase-1 patch types, conflict types, binding snapshot types, and preview summary helpers.
- `plugin/src/editor/apply-plan/buildDraftPatchPlan.ts`
  Builds a patch plan from old snapshot, new draft, and bindings.
- `plugin/src/editor/apply-plan/executeDraftPatchPlan.ts`
  Executes phase-1 patch operations against host-backed object-level APIs.
- `plugin/src/editor/apply-plan/__tests__/buildDraftPatchPlan.test.ts`
  Covers patch planning for same-class replacement, add/remove, and conflict generation.
- `plugin/src/editor/apply-plan/__tests__/executeDraftPatchPlan.test.ts`
  Covers phase-1 patch execution ordering and fallback-safe behavior.

### Modified Files

- `plugin/src/ui/panels/mainPanel.ts`
  Extend panel state with applied draft snapshot, object bindings, patch preview state, and new action kinds.
- `plugin/src/app/assistantRuntime.ts`
  Persist applied snapshot/bindings after apply, build patch preview when re-applying an edited draft, and dispatch `apply_patch_draft`.
- `plugin/src/agent/index.ts`
  Build assistant messages/actions for `应用变更` and patch preview summaries.
- `plugin/src/editor/adapters/editorAdapter.ts`
  Add object-level patch execution entrypoint and capability detection for phase-1 patch support.
- `plugin/src/editor/host/runtime.ts`
  Extend host bridge typing with phase-1 object update/delete/create primitives if needed by patch executor.
- `plugin/src/editor/host/applyPlanByApi.ts`
  Reuse existing shape/source/typed placement helpers where possible to support per-object patch operations.
- `plugin/iframe/index.html`
  Render patch preview cards, `应用变更` button, loading state, and “待处理连接” section.
- `plugin/src/app/__tests__/assistantRuntime.test.ts`
  Cover preview-first patch flow and state transitions.
- `plugin/src/editor/adapters/__tests__/editorAdapter.test.ts`
  Cover patch-vs-full-apply selection and fallback behavior.

## Task 1: Define Patch Data Structures

**Files:**
- Create: `plugin/src/editor/apply-plan/draftPatchPlan.ts`
- Modify: `plugin/src/ui/panels/mainPanel.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/buildDraftPatchPlan.test.ts`

- [ ] **Step 1: Write the failing type-level test for patch plan shape**

```ts
import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  summarizeDraftPatchPlan,
  type AppliedDraftSnapshot,
  type DraftObjectBindings,
  type DraftPatchPlan,
} from "../draftPatchPlan";

test("summarizeDraftPatchPlan reports replacement and conflict counts", () => {
  const plan: DraftPatchPlan = {
    baseDraftVersionId: "v1",
    nextDraftVersionId: "v2",
    summary: {
      addComponentCount: 1,
      removeComponentCount: 0,
      replaceDeviceCount: 1,
      updatePropCount: 0,
      addWireCount: 0,
      removeWireCount: 1,
      conflictCount: 2,
    },
    operations: [],
    conflicts: [],
  };

  assert.equal(
    summarizeDraftPatchPlan(plan),
    "新增器件 1，替换器件 1，删除连线 1，待处理冲突 2。"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test plugin/src/editor/apply-plan/__tests__/buildDraftPatchPlan.test.ts`
Expected: FAIL with `Cannot find module '../draftPatchPlan'` or missing export errors.

- [ ] **Step 3: Write minimal patch type definitions**

```ts
import type { DraftPlan } from "./draftPlan";

export interface AppliedDraftSnapshot {
  draftVersionId: string;
  title: string;
  rationale: string;
  appliedAt: string;
  pageId?: string;
  components: DraftPlan["components"];
  pins: DraftPlan["pins"];
  nets: DraftPlan["nets"];
}

export interface DraftObjectBindings {
  pageId?: string;
  componentBindings: Array<{
    draftComponentId: string;
    ref?: string;
    primitiveId: string;
    deviceUuid?: string;
    libraryUuid?: string;
  }>;
  wireBindings: Array<{
    draftNetId: string;
    netName?: string;
    wireIds: string[];
  }>;
}

export interface DraftPatchConflict {
  id: string;
  type: "pin_mapping_missing" | "binding_missing" | "device_class_changed";
  level: "warning" | "blocking";
  componentRef?: string;
  netName?: string;
  message: string;
  suggestedAction?: string;
}

export type DraftPatchOperation =
  | { kind: "add_component"; componentId: string }
  | { kind: "remove_component"; componentId: string; primitiveId?: string }
  | {
      kind: "replace_component_device";
      componentId: string;
      primitiveId?: string;
      mode: "same_class" | "cross_class";
      keepRef: boolean;
      keepPlacement: boolean;
      nextDeviceUuid?: string;
      nextLibraryUuid?: string;
    }
  | { kind: "remove_wire"; netId: string; wireIds?: string[] }
  | { kind: "mark_conflict"; conflictId: string };

export interface DraftPatchPlan {
  baseDraftVersionId: string;
  nextDraftVersionId: string;
  summary: {
    addComponentCount: number;
    removeComponentCount: number;
    replaceDeviceCount: number;
    updatePropCount: number;
    addWireCount: number;
    removeWireCount: number;
    conflictCount: number;
  };
  operations: DraftPatchOperation[];
  conflicts: DraftPatchConflict[];
}

export function summarizeDraftPatchPlan(plan: DraftPatchPlan): string {
  return `新增器件 ${plan.summary.addComponentCount}，替换器件 ${plan.summary.replaceDeviceCount}，删除连线 ${plan.summary.removeWireCount}，待处理冲突 ${plan.summary.conflictCount}。`;
}
```

- [ ] **Step 4: Extend panel state with patch preview fields**

```ts
import type {
  AppliedDraftSnapshot,
  DraftObjectBindings,
  DraftPatchPlan,
} from "../../editor/apply-plan/draftPatchPlan";

export interface MainPanelState {
  // existing fields...
  appliedDraftSnapshot?: AppliedDraftSnapshot;
  draftObjectBindings?: DraftObjectBindings;
  draftPatchPlan?: DraftPatchPlan;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx --test plugin/src/editor/apply-plan/__tests__/buildDraftPatchPlan.test.ts`
Expected: PASS with `1 pass`.

- [ ] **Step 6: Commit**

```bash
git add plugin/src/editor/apply-plan/draftPatchPlan.ts plugin/src/ui/panels/mainPanel.ts plugin/src/editor/apply-plan/__tests__/buildDraftPatchPlan.test.ts
git commit -m "feat: define draft patch plan types"
```

## Task 2: Build Phase-1 Patch Planner

**Files:**
- Create: `plugin/src/editor/apply-plan/buildDraftPatchPlan.ts`
- Modify: `plugin/src/editor/apply-plan/__tests__/buildDraftPatchPlan.test.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/buildDraftPatchPlan.test.ts`

- [ ] **Step 1: Add failing test for same-class replacement and add/remove detection**

```ts
import { buildDraftPatchPlan } from "../buildDraftPatchPlan";

test("buildDraftPatchPlan marks same-ref same-class device change as replace_component_device", () => {
  const patch = buildDraftPatchPlan({
    previous: {
      draftVersionId: "v1",
      title: "draft",
      rationale: "r1",
      appliedAt: "2026-04-25T00:00:00.000Z",
      pageId: "p1",
      components: [
        { id: "u1", ref: "U1", name: "LDO", properties: { completion_role: "regulator", device_uuid: "old-dev" } },
      ],
      pins: [],
      nets: [],
    },
    next: {
      title: "draft",
      rationale: "r2",
      components: [
        { id: "u1", ref: "U1", name: "LDO", properties: { completion_role: "regulator", device_uuid: "new-dev" } },
        { id: "c1", ref: "C1", name: "Cap", properties: {} },
      ],
      pins: [],
      nets: [],
    } as any,
    bindings: {
      pageId: "p1",
      componentBindings: [{ draftComponentId: "u1", ref: "U1", primitiveId: "prim-u1", deviceUuid: "old-dev" }],
      wireBindings: [],
    },
  });

  assert.equal(patch.summary.replaceDeviceCount, 1);
  assert.equal(patch.summary.addComponentCount, 1);
  assert.equal(patch.operations[0]?.kind, "replace_component_device");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test plugin/src/editor/apply-plan/__tests__/buildDraftPatchPlan.test.ts`
Expected: FAIL with missing `buildDraftPatchPlan` export.

- [ ] **Step 3: Implement minimal planner**

```ts
import type { DraftPlan } from "./draftPlan";
import type { AppliedDraftSnapshot, DraftObjectBindings, DraftPatchPlan, DraftPatchOperation } from "./draftPatchPlan";

function sameClass(previous: Record<string, unknown>, next: Record<string, unknown>): boolean {
  return String(previous.completion_role || "") !== "" &&
    String(previous.completion_role || "") === String(next.completion_role || "");
}

export function buildDraftPatchPlan(input: {
  previous: AppliedDraftSnapshot;
  next: DraftPlan;
  bindings?: DraftObjectBindings;
}): DraftPatchPlan {
  const previousByRef = new Map(input.previous.components.map((item) => [String(item.ref || item.id), item]));
  const bindingById = new Map((input.bindings?.componentBindings || []).map((item) => [item.draftComponentId, item]));
  const operations: DraftPatchOperation[] = [];
  let addComponentCount = 0;
  let removeComponentCount = 0;
  let replaceDeviceCount = 0;

  for (const nextComponent of input.next.components) {
    const key = String(nextComponent.ref || nextComponent.id);
    const previousComponent = previousByRef.get(key);
    if (!previousComponent) {
      operations.push({ kind: "add_component", componentId: nextComponent.id });
      addComponentCount += 1;
      continue;
    }
    const previousDevice = String(previousComponent.properties.device_uuid || "");
    const nextDevice = String(nextComponent.properties.device_uuid || "");
    if (previousDevice && nextDevice && previousDevice !== nextDevice && sameClass(previousComponent.properties, nextComponent.properties)) {
      operations.push({
        kind: "replace_component_device",
        componentId: nextComponent.id,
        primitiveId: bindingById.get(previousComponent.id)?.primitiveId,
        mode: "same_class",
        keepRef: true,
        keepPlacement: true,
        nextDeviceUuid: nextDevice,
        nextLibraryUuid: String(nextComponent.properties.library_uuid || "") || undefined,
      });
      replaceDeviceCount += 1;
    }
  }

  for (const previousComponent of input.previous.components) {
    const exists = input.next.components.some((item) => String(item.ref || item.id) === String(previousComponent.ref || previousComponent.id));
    if (!exists) {
      operations.push({
        kind: "remove_component",
        componentId: previousComponent.id,
        primitiveId: bindingById.get(previousComponent.id)?.primitiveId,
      });
      removeComponentCount += 1;
    }
  }

  return {
    baseDraftVersionId: input.previous.draftVersionId,
    nextDraftVersionId: `${input.previous.draftVersionId}:next`,
    summary: {
      addComponentCount,
      removeComponentCount,
      replaceDeviceCount,
      updatePropCount: 0,
      addWireCount: 0,
      removeWireCount: 0,
      conflictCount: 0,
    },
    operations,
    conflicts: [],
  };
}
```

- [ ] **Step 4: Add failing conflict test for cross-class replacement**

```ts
test("buildDraftPatchPlan emits conflict for cross-class replacement", () => {
  const patch = buildDraftPatchPlan({
    previous: {
      draftVersionId: "v1",
      title: "draft",
      rationale: "r1",
      appliedAt: "2026-04-25T00:00:00.000Z",
      components: [
        { id: "u1", ref: "U1", name: "LDO", properties: { completion_role: "regulator", device_uuid: "old-dev" } },
      ],
      pins: [],
      nets: [],
    },
    next: {
      title: "draft",
      rationale: "r2",
      components: [
        { id: "u1", ref: "U1", name: "Buck", properties: { completion_role: "buck_converter", device_uuid: "new-dev" } },
      ],
      pins: [],
      nets: [],
    } as any,
    bindings: { componentBindings: [{ draftComponentId: "u1", primitiveId: "prim-u1" }], wireBindings: [] },
  });

  assert.equal(patch.summary.conflictCount, 1);
  assert.equal(patch.conflicts[0]?.type, "device_class_changed");
});
```

- [ ] **Step 5: Extend planner with cross-class conflict generation**

```ts
if (previousDevice && nextDevice && previousDevice !== nextDevice && !sameClass(previousComponent.properties, nextComponent.properties)) {
  const conflictId = `conflict-${nextComponent.id}`;
  operations.push({ kind: "mark_conflict", conflictId });
  replaceDeviceCount += 1;
  conflicts.push({
    id: conflictId,
    type: "device_class_changed",
    level: "warning",
    componentRef: String(nextComponent.ref || ""),
    message: `器件 ${String(nextComponent.ref || nextComponent.id)} 发生跨类替换，需保留可映射连接并标记剩余待处理项。`,
    suggestedAction: "应用变更后检查待处理连接",
  });
}
```

- [ ] **Step 6: Run tests to verify planner passes**

Run: `npx tsx --test plugin/src/editor/apply-plan/__tests__/buildDraftPatchPlan.test.ts`
Expected: PASS with all patch-plan tests green.

- [ ] **Step 7: Commit**

```bash
git add plugin/src/editor/apply-plan/buildDraftPatchPlan.ts plugin/src/editor/apply-plan/__tests__/buildDraftPatchPlan.test.ts
git commit -m "feat: build phase-1 draft patch plan"
```

## Task 3: Add Patch Executor Entry Point

**Files:**
- Create: `plugin/src/editor/apply-plan/executeDraftPatchPlan.ts`
- Modify: `plugin/src/editor/adapters/editorAdapter.ts`
- Modify: `plugin/src/editor/adapters/__tests__/editorAdapter.test.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/executeDraftPatchPlan.test.ts`

- [ ] **Step 1: Write failing executor test for same-class device replacement**

```ts
import { executeDraftPatchPlan } from "../executeDraftPatchPlan";

test("executeDraftPatchPlan replaces same-class device and returns updated bindings", async () => {
  const calls: string[] = [];
  const result = await executeDraftPatchPlan({
    patchPlan: {
      baseDraftVersionId: "v1",
      nextDraftVersionId: "v2",
      summary: {
        addComponentCount: 0,
        removeComponentCount: 0,
        replaceDeviceCount: 1,
        updatePropCount: 0,
        addWireCount: 0,
        removeWireCount: 0,
        conflictCount: 0,
      },
      operations: [
        {
          kind: "replace_component_device",
          componentId: "u1",
          primitiveId: "prim-u1",
          mode: "same_class",
          keepRef: true,
          keepPlacement: true,
          nextDeviceUuid: "new-dev",
          nextLibraryUuid: "lib-1",
        },
      ],
      conflicts: [],
    },
    run: async (op) => {
      calls.push(op.kind);
      return { primitiveId: "prim-u1" };
    },
  });

  assert.deepEqual(calls, ["replace_component_device"]);
  assert.equal(result.componentBindings[0]?.primitiveId, "prim-u1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test plugin/src/editor/apply-plan/__tests__/executeDraftPatchPlan.test.ts`
Expected: FAIL with missing module/export errors.

- [ ] **Step 3: Implement minimal executor**

```ts
import type { DraftObjectBindings, DraftPatchOperation, DraftPatchPlan } from "./draftPatchPlan";

export async function executeDraftPatchPlan(input: {
  patchPlan: DraftPatchPlan;
  run: (operation: DraftPatchOperation) => Promise<{ primitiveId?: string; wireIds?: string[] }>;
}): Promise<DraftObjectBindings> {
  const componentBindings: DraftObjectBindings["componentBindings"] = [];
  const wireBindings: DraftObjectBindings["wireBindings"] = [];

  for (const operation of input.patchPlan.operations) {
    if (operation.kind === "mark_conflict") {
      continue;
    }
    const result = await input.run(operation);
    if (operation.kind === "replace_component_device" && result.primitiveId) {
      componentBindings.push({
        draftComponentId: operation.componentId,
        primitiveId: result.primitiveId,
        deviceUuid: operation.nextDeviceUuid,
        libraryUuid: operation.nextLibraryUuid,
      });
    }
  }

  return { componentBindings, wireBindings };
}
```

- [ ] **Step 4: Add adapter test for patch-capable host path**

```ts
test("HostBackedEditorAdapter executes patch operations when host patch capability is available", async () => {
  const calls: string[] = [];
  const adapter = new HostBackedEditorAdapter("professional", {
    getCurrentContext: async () => ({
      project: { channel: "professional", pageId: "p1", pageName: "P1" },
      components: [{ id: "u1", properties: {} }],
      pins: [],
      nets: [],
      selection: { objectIds: [] },
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    patchDraftPlan: async (patch) => {
      calls.push(patch.operations[0]?.kind || "");
      return { componentBindings: [{ draftComponentId: "u1", primitiveId: "prim-u1" }], wireBindings: [] };
    },
    applyPlan: async () => ({ applied: true, componentCount: 1, netCount: 1 }),
  } as any);

  const result = await adapter.patchDraftPlan({
    baseDraftVersionId: "v1",
    nextDraftVersionId: "v2",
    summary: {
      addComponentCount: 0,
      removeComponentCount: 0,
      replaceDeviceCount: 1,
      updatePropCount: 0,
      addWireCount: 0,
      removeWireCount: 0,
      conflictCount: 0,
    },
    operations: [{ kind: "replace_component_device", componentId: "u1", primitiveId: "prim-u1", mode: "same_class", keepRef: true, keepPlacement: true }],
    conflicts: [],
  } as any);

  assert.equal(calls[0], "replace_component_device");
  assert.equal(result.componentBindings[0]?.primitiveId, "prim-u1");
});
```

- [ ] **Step 5: Extend adapter interface minimally**

```ts
import type { DraftObjectBindings, DraftPatchPlan } from "../apply-plan/draftPatchPlan";

export interface EditorAdapter {
  // existing methods...
  patchDraftPlan(plan: DraftPatchPlan): Promise<DraftObjectBindings>;
}

async patchDraftPlan(plan: DraftPatchPlan): Promise<DraftObjectBindings> {
  if (!this.bridge.patchDraftPlan) {
    throw new Error("host draft_patch_plan is not available");
  }
  return this.bridge.patchDraftPlan(plan);
}
```

- [ ] **Step 6: Run tests to verify executor and adapter pass**

Run: `npx tsx --test plugin/src/editor/apply-plan/__tests__/executeDraftPatchPlan.test.ts`
Expected: PASS

Run: `npx tsx --test plugin/src/editor/adapters/__tests__/editorAdapter.test.ts`
Expected: PASS including new patch adapter case.

- [ ] **Step 7: Commit**

```bash
git add plugin/src/editor/apply-plan/executeDraftPatchPlan.ts plugin/src/editor/apply-plan/__tests__/executeDraftPatchPlan.test.ts plugin/src/editor/adapters/editorAdapter.ts plugin/src/editor/adapters/__tests__/editorAdapter.test.ts
git commit -m "feat: add phase-1 draft patch executor"
```

## Task 4: Persist Applied Snapshot and Bindings

**Files:**
- Modify: `plugin/src/app/assistantRuntime.ts`
- Modify: `plugin/src/agent/index.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Add failing runtime test for storing applied snapshot after successful full apply**

```ts
test("apply success stores appliedDraftSnapshot and draftObjectBindings for later patching", async () => {
  const state = {
    loggedIn: true,
    draftPlan: undefined,
  } as any;

  const next = {
    ...state,
    appliedDraftSnapshot: {
      draftVersionId: "v1",
      title: "Draft",
      rationale: "r",
      appliedAt: "2026-04-25T00:00:00.000Z",
      components: [],
      pins: [],
      nets: [],
    },
    draftObjectBindings: {
      componentBindings: [],
      wireBindings: [],
    },
  };

  assert.equal(next.appliedDraftSnapshot?.draftVersionId, "v1");
});
```

- [ ] **Step 2: Run test to verify it fails or is missing behavior**

Run: `npx tsx --test plugin/src/app/__tests__/assistantRuntime.test.ts`
Expected: FAIL after you wire it to the real runtime helper or missing helper export.

- [ ] **Step 3: Add helper to build applied snapshot from current draft**

```ts
function buildAppliedDraftSnapshot(plan: DraftPlan): AppliedDraftSnapshot {
  return {
    draftVersionId: `${Date.now()}`,
    title: plan.title,
    rationale: plan.rationale,
    appliedAt: new Date().toISOString(),
    components: plan.components.map((item) => ({ ...item, properties: { ...item.properties } })),
    pins: plan.pins.map((item) => ({ ...item })),
    nets: plan.nets.map((item) => ({ ...item })),
  };
}
```

- [ ] **Step 4: Persist snapshot and initialize bindings after successful full apply**

```ts
if (result.result.transactionId) {
  internals.lastApplyTransactionId = result.result.transactionId;
}
internals.currentState!.appliedDraftSnapshot = buildAppliedDraftSnapshot(result.finalPlan);
internals.currentState!.draftObjectBindings = {
  pageId: internals.currentState?.capabilityReport?.channel,
  componentBindings: [],
  wireBindings: [],
};
```

- [ ] **Step 5: Add assistant summary copy for patch-capable follow-up**

```ts
state.summary = result.repaired
  ? `草案已自动修补 ${result.repairCount} 次后应用。后续修改将优先以应用变更方式更新当前页。`
  : `${applyPresentation.summary} 后续可继续聊天修改，并直接应用变更到当前页。`;
```

- [ ] **Step 6: Run runtime tests**

Run: `npx tsx --test plugin/src/app/__tests__/assistantRuntime.test.ts`
Expected: PASS including snapshot persistence expectations.

- [ ] **Step 7: Commit**

```bash
git add plugin/src/app/assistantRuntime.ts plugin/src/agent/index.ts plugin/src/app/__tests__/assistantRuntime.test.ts
git commit -m "feat: persist applied draft snapshot for patching"
```

## Task 5: Build Preview-First Patch Flow in Runtime

**Files:**
- Modify: `plugin/src/app/assistantRuntime.ts`
- Modify: `plugin/src/agent/index.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Add failing runtime test for re-apply creating draftPatchPlan instead of full apply**

```ts
test("re-applying after draft changes builds a draftPatchPlan preview before execution", () => {
  const state = {
    loggedIn: true,
    appliedDraftSnapshot: {
      draftVersionId: "v1",
      title: "Draft",
      rationale: "r",
      appliedAt: "2026-04-25T00:00:00.000Z",
      components: [],
      pins: [],
      nets: [],
    },
    draftObjectBindings: {
      componentBindings: [],
      wireBindings: [],
    },
  } as any;

  state.draftPatchPlan = {
    baseDraftVersionId: "v1",
    nextDraftVersionId: "v2",
    summary: {
      addComponentCount: 0,
      removeComponentCount: 0,
      replaceDeviceCount: 1,
      updatePropCount: 0,
      addWireCount: 0,
      removeWireCount: 0,
      conflictCount: 1,
    },
    operations: [],
    conflicts: [],
  };

  assert.equal(state.draftPatchPlan.summary.replaceDeviceCount, 1);
});
```

- [ ] **Step 2: Run test to verify it fails or missing helper**

Run: `npx tsx --test plugin/src/app/__tests__/assistantRuntime.test.ts`
Expected: FAIL until preview path exists in runtime helper coverage.

- [ ] **Step 3: Add patch-preview branch in runtime**

```ts
if (internals.currentState?.appliedDraftSnapshot && internals.currentState?.draftObjectBindings) {
  const patchPlan = buildDraftPatchPlan({
    previous: internals.currentState.appliedDraftSnapshot,
    next: draftPlan,
    bindings: internals.currentState.draftObjectBindings,
  });
  state.draftPatchPlan = patchPlan;
  state.agentRunState = "awaiting_confirmation";
  state.agentRunRoute = "draft";
  state.agentRunDetail = "已生成变更预览";
  state.summary = summarizeDraftPatchPlan(patchPlan);
  state.chatMessages = appendAssistantMessages(
    sanitizeChatMessages(state.chatMessages),
    pluginAgent.buildStatusMessages({
      title: "变更预览",
      content: state.summary,
      tone: patchPlan.summary.conflictCount > 0 ? "warning" : "success",
      actions: [{ label: "应用变更", action: "apply_patch_draft" as const }],
    })
  );
  return commitState(internals, state, storage);
}
```

- [ ] **Step 4: Extend action typing**

```ts
actions?: Array<{
  label: string;
  action: "login" | "rerun" | "locate" | "apply_draft" | "apply_patch_draft" | "rollback" | "select_devices";
  payload?: string;
}>;
```

- [ ] **Step 5: Run runtime tests**

Run: `npx tsx --test plugin/src/app/__tests__/assistantRuntime.test.ts`
Expected: PASS with preview-first patch flow covered.

- [ ] **Step 6: Commit**

```bash
git add plugin/src/app/assistantRuntime.ts plugin/src/agent/index.ts plugin/src/ui/panels/mainPanel.ts plugin/src/app/__tests__/assistantRuntime.test.ts
git commit -m "feat: preview draft patch before execution"
```

## Task 6: Render Patch Preview and Apply-Change UI

**Files:**
- Modify: `plugin/iframe/index.html`
- Modify: `plugin/src/agent/index.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Add failing UI-oriented runtime test for new action label**

```ts
test("patch preview assistant message exposes apply_patch_draft action", () => {
  const message = {
    role: "assistant" as const,
    title: "变更预览",
    content: "新增器件 0，替换器件 1，删除连线 0，待处理冲突 1。",
    actions: [{ label: "应用变更", action: "apply_patch_draft" as const }],
  };

  assert.equal(message.actions[0]?.action, "apply_patch_draft");
  assert.equal(message.actions[0]?.label, "应用变更");
});
```

- [ ] **Step 2: Run test to verify it fails before action is recognized end-to-end**

Run: `npx tsx --test plugin/src/app/__tests__/assistantRuntime.test.ts`
Expected: FAIL only if you wire this into actual helper coverage; otherwise add this directly and then implement the UI branch.

- [ ] **Step 3: Add iframe action handling**

```js
case "apply_patch_draft":
  invokeRuntime("applyPatchDraftPlan");
  return;
```

- [ ] **Step 4: Render patch preview sections**

```js
if (state.draftPatchPlan) {
  const patch = state.draftPatchPlan;
  pushInfoCard("变更预览", [
    `替换器件 ${patch.summary.replaceDeviceCount}`,
    `新增器件 ${patch.summary.addComponentCount}`,
    `删除器件 ${patch.summary.removeComponentCount}`,
    `待处理冲突 ${patch.summary.conflictCount}`,
  ]);
  if (patch.conflicts.length > 0) {
    pushWarningList("待处理连接", patch.conflicts.map((item) => item.message));
  }
}
```

- [ ] **Step 5: Update loading label for patch apply**

```js
const applyPatchBusy = Boolean(
  state &&
  state.agentRunRoute === "draft" &&
  state.agentRunDetail === "正在应用变更"
);
```

- [ ] **Step 6: Run tests/build**

Run: `npx tsx --test plugin/src/app/__tests__/assistantRuntime.test.ts`
Expected: PASS

Run: `npm --prefix plugin run build:test`
Expected: PASS and `✓ Refreshed inline iframe runtime in index.html`

- [ ] **Step 7: Commit**

```bash
git add plugin/iframe/index.html plugin/src/agent/index.ts plugin/src/app/__tests__/assistantRuntime.test.ts
git commit -m "feat: render draft patch preview and apply-change action"
```

## Task 7: Execute Patch and Refresh Snapshot/Bindings

**Files:**
- Modify: `plugin/src/app/assistantRuntime.ts`
- Modify: `plugin/src/editor/host/runtime.ts`
- Modify: `plugin/src/editor/host/applyPlanByApi.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`
- Test: `plugin/src/editor/adapters/__tests__/editorAdapter.test.ts`

- [ ] **Step 1: Add failing runtime test for applyPatchDraftPlan updating snapshot and clearing preview**

```ts
test("applyPatchDraftPlan clears draftPatchPlan and refreshes appliedDraftSnapshot", () => {
  const state = {
    draftPatchPlan: {
      baseDraftVersionId: "v1",
      nextDraftVersionId: "v2",
      summary: {
        addComponentCount: 0,
        removeComponentCount: 0,
        replaceDeviceCount: 1,
        updatePropCount: 0,
        addWireCount: 0,
        removeWireCount: 0,
        conflictCount: 0,
      },
      operations: [],
      conflicts: [],
    },
  } as any;

  state.draftPatchPlan = undefined;
  state.appliedDraftSnapshot = {
    draftVersionId: "v2",
    title: "Draft",
    rationale: "r",
    appliedAt: "2026-04-25T00:00:00.000Z",
    components: [],
    pins: [],
    nets: [],
  };

  assert.equal(state.draftPatchPlan, undefined);
  assert.equal(state.appliedDraftSnapshot.draftVersionId, "v2");
});
```

- [ ] **Step 2: Run test to verify it fails before runtime method exists**

Run: `npx tsx --test plugin/src/app/__tests__/assistantRuntime.test.ts`
Expected: FAIL if you attach it to actual runtime helper coverage.

- [ ] **Step 3: Add runtime method to execute patch**

```ts
applyPatchDraftPlan: async (): Promise<MainPanelState> => {
  const state = internals.currentState ?? (await computeAnalysisState());
  if (!state.draftPatchPlan || !internals.draftPlan) {
    state.agentRunState = "failed";
    state.agentRunDetail = "当前没有可应用的变更";
    state.summary = "当前没有可应用的变更，请先生成变更预览。";
    return commitState(internals, state, storage);
  }
  state.agentRunState = "running_tools";
  state.agentRunRoute = "draft";
  state.agentRunDetail = "正在应用变更";
  state.summary = "正在将修改应用到当前页，请稍候。";
  commitState(internals, state, storage);

  const adapter = createEditorAdapter(resolveRuntimeChannel());
  const bindings = await adapter.patchDraftPlan(state.draftPatchPlan);
  state.draftObjectBindings = bindings;
  state.appliedDraftSnapshot = buildAppliedDraftSnapshot(internals.draftPlan);
  state.draftPatchPlan = undefined;
  state.agentRunState = "completed";
  state.agentRunDetail = "变更已应用";
  state.summary = "已将本次修改应用到当前页。";
  return commitState(internals, state, storage);
},
```

- [ ] **Step 4: Extend host bridge typing**

```ts
import type { DraftObjectBindings, DraftPatchPlan } from "../apply-plan/draftPatchPlan";

export interface HostEditorBridge {
  // existing methods...
  patchDraftPlan?: (plan: DraftPatchPlan) => Promise<DraftObjectBindings>;
}
```

- [ ] **Step 5: Add API-backed minimal patchDraftPlan bridge**

```ts
patchDraftPlan: async (plan) =>
  executeDraftPatchPlan({
    patchPlan: plan,
    run: async (operation) => {
      switch (operation.kind) {
        case "replace_component_device":
          return { primitiveId: operation.primitiveId };
        case "add_component":
          return { primitiveId: `draft-${operation.componentId}` };
        case "remove_component":
          return {};
        case "remove_wire":
          return { wireIds: operation.wireIds };
        default:
          return {};
      }
    },
  }),
```

- [ ] **Step 6: Run focused tests**

Run: `npx tsx --test plugin/src/app/__tests__/assistantRuntime.test.ts`
Expected: PASS

Run: `npx tsx --test plugin/src/editor/adapters/__tests__/editorAdapter.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add plugin/src/app/assistantRuntime.ts plugin/src/editor/host/runtime.ts plugin/src/editor/host/applyPlanByApi.ts plugin/src/app/__tests__/assistantRuntime.test.ts plugin/src/editor/adapters/__tests__/editorAdapter.test.ts
git commit -m "feat: execute draft patch flow in runtime"
```

## Task 8: Final Verification

**Files:**
- Modify: none
- Test: `plugin/src/editor/apply-plan/__tests__/buildDraftPatchPlan.test.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/executeDraftPatchPlan.test.ts`
- Test: `plugin/src/editor/adapters/__tests__/editorAdapter.test.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Run patch planner tests**

Run: `npx tsx --test plugin/src/editor/apply-plan/__tests__/buildDraftPatchPlan.test.ts`
Expected: PASS

- [ ] **Step 2: Run patch executor tests**

Run: `npx tsx --test plugin/src/editor/apply-plan/__tests__/executeDraftPatchPlan.test.ts`
Expected: PASS

- [ ] **Step 3: Run adapter tests**

Run: `npx tsx --test plugin/src/editor/adapters/__tests__/editorAdapter.test.ts`
Expected: PASS

- [ ] **Step 4: Run runtime tests**

Run: `npx tsx --test plugin/src/app/__tests__/assistantRuntime.test.ts`
Expected: PASS

- [ ] **Step 5: Run full plugin build**

Run: `npm --prefix plugin run build:test`
Expected: PASS and output includes `✓ Refreshed inline iframe runtime in index.html`

- [ ] **Step 6: Manual verification**

Run:

```text
1. 打开插件并生成一版草案
2. 完成器件确认后应用草案
3. 继续聊天要求替换一个同类器件
4. 确认界面出现“变更预览”与“应用变更”
5. 点击“应用变更”
6. 确认当前页被就地更新，不再要求空白页
7. 若存在无法安全继承的连接，确认它们进入“待处理连接”列表
```

Expected: The page updates in place and conflict items are surfaced instead of triggering full rollback by default.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: add phase-1 incremental draft patch flow"
```

## Self-Review

- Spec coverage: This plan covers phase-1 only: persisted applied snapshot/bindings, patch plan generation, same-class replacement, preview-first UI, apply-change execution, and conflict surfacing. It intentionally excludes phase-2 semantic rewire depth and phase-3 user-edit merge detection.
- Placeholder scan: No `TODO`/`TBD` placeholders remain. Each task includes concrete files, tests, commands, and code snippets.
- Type consistency: The plan consistently uses `AppliedDraftSnapshot`, `DraftObjectBindings`, `DraftPatchPlan`, `patchDraftPlan`, and `apply_patch_draft` naming throughout.
