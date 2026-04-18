# Transient Pin Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a transient-placement-based pin resolution flow that reads real host pins before formal draft apply, then uses rule-based and optional RAG-enhanced matching to create reliable auto-wiring mappings for simple components.

**Architecture:** Add a pre-apply resolver in the typed-placement path. It temporarily places selected devices in an isolated area, reads real pins via host APIs, matches draft pins to real pins with deterministic rules first, and writes resolved runtime pin metadata back into the draft plan before formal apply. RAG remains an optional scoring enhancer and is not the source of truth.

**Tech Stack:** TypeScript, existing typed schematic placement APIs (`eda.sch_PrimitiveComponent.*`), current draft/apply runtime, node:test, plugin build pipeline

---

## File Map

**Create:**
- `plugin/src/editor/host/transientPinResolver.ts`
- `plugin/src/editor/host/__tests__/transientPinResolver.test.ts`
- `plugin/src/editor/host/pinMatchEngine.ts`
- `plugin/src/editor/host/__tests__/pinMatchEngine.test.ts`

**Modify:**
- `plugin/src/editor/host/applyPlanByApi.ts`
- `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`
- `plugin/src/editor/apply-plan/resolveDraftPlanDevices.ts`
- `plugin/src/editor/apply-plan/__tests__/resolveDraftPlanDevices.test.ts`
- `plugin/src/agent/tools/draftTools.ts`
- `plugin/src/agent/tools/__tests__/draftTools.test.ts`
- `plugin/src/app/assistantRuntime.ts`

## Task 1: Add Transient Placement Resolver

**Files:**
- Create: `plugin/src/editor/host/transientPinResolver.ts`
- Test: `plugin/src/editor/host/__tests__/transientPinResolver.test.ts`

- [ ] **Step 1: Write the failing tests for transient placement read/cleanup**

```ts
import { test } from "node:test";
import * as assert from "node:assert/strict";

import { resolveTransientComponentPins } from "../transientPinResolver";

test("resolveTransientComponentPins places components, reads pins, and cleans up", async () => {
  const calls: string[] = [];
  const result = await resolveTransientComponentPins(
    {
      components: [
        { componentId: "draft-r1", ref: "R1", deviceUuid: "dev-r1", libraryUuid: "lib-r1" },
      ],
    },
    {
      createComponent: async () => {
        calls.push("create");
        return { primitiveId: "cmp-r1" };
      },
      getPinsByPrimitiveId: async () => {
        calls.push("getPins");
        return [
          { primitiveId: "pin-r1-1", pinName: "1", pinNumber: "1", x: 100, y: 100 },
          { primitiveId: "pin-r1-2", pinName: "2", pinNumber: "2", x: 140, y: 100 },
        ];
      },
      deleteComponents: async (ids) => {
        calls.push(`delete:${ids.join(",")}`);
        return true;
      },
    }
  );

  assert.deepEqual(result.componentPins.get("draft-r1"), [
    { primitiveId: "pin-r1-1", pinName: "1", pinNumber: "1", x: 100, y: 100 },
    { primitiveId: "pin-r1-2", pinName: "2", pinNumber: "2", x: 140, y: 100 },
  ]);
  assert.deepEqual(calls, ["create", "getPins", "delete:cmp-r1"]);
});

test("resolveTransientComponentPins cleans up already placed components when later reads fail", async () => {
  const deleted: string[][] = [];
  await assert.rejects(() =>
    resolveTransientComponentPins(
      {
        components: [
          { componentId: "draft-d1", ref: "D1", deviceUuid: "dev-d1", libraryUuid: "lib-d1" },
          { componentId: "draft-j1", ref: "J1", deviceUuid: "dev-j1", libraryUuid: "lib-j1" },
        ],
      },
      {
        createComponent: async ({ componentId }) => ({ primitiveId: componentId === "draft-d1" ? "cmp-d1" : "cmp-j1" }),
        getPinsByPrimitiveId: async (primitiveId) => {
          if (primitiveId === "cmp-j1") {
            throw new Error("pin read failed");
          }
          return [{ primitiveId: "pin-d1-a", pinName: "A", pinNumber: "1", x: 50, y: 50 }];
        },
        deleteComponents: async (ids) => {
          deleted.push(ids.slice());
          return true;
        },
      }
    ),
    /pin read failed/
  );

  assert.deepEqual(deleted, [["cmp-d1", "cmp-j1"]]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/editor/host/__tests__/transientPinResolver.test.ts`

Expected: FAIL with `Cannot find module '../transientPinResolver'` or missing export.

- [ ] **Step 3: Write minimal transient placement resolver**

```ts
export type TransientPinRecord = {
  primitiveId: string;
  pinName?: string;
  pinNumber?: string;
  x: number;
  y: number;
};

export async function resolveTransientComponentPins(
  input: {
    components: Array<{ componentId: string; ref?: string; deviceUuid: string; libraryUuid: string }>;
  },
  deps: {
    createComponent: (input: { componentId: string; ref?: string; deviceUuid: string; libraryUuid: string; index: number }) => Promise<{ primitiveId: string } | null>;
    getPinsByPrimitiveId: (primitiveId: string) => Promise<TransientPinRecord[]>;
    deleteComponents: (primitiveIds: string[]) => Promise<boolean>;
  }
): Promise<{ componentPins: Map<string, TransientPinRecord[]> }> {
  const placed: string[] = [];
  const componentPins = new Map<string, TransientPinRecord[]>();
  try {
    for (const [index, component] of input.components.entries()) {
      const created = await deps.createComponent({ ...component, index });
      if (!created?.primitiveId) {
        throw new Error(`transient placement failed: ${component.ref || component.componentId}`);
      }
      placed.push(created.primitiveId);
      const pins = await deps.getPinsByPrimitiveId(created.primitiveId);
      componentPins.set(component.componentId, pins);
    }
    return { componentPins };
  } finally {
    if (placed.length > 0) {
      await deps.deleteComponents(placed);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/editor/host/__tests__/transientPinResolver.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/editor/host/transientPinResolver.ts src/editor/host/__tests__/transientPinResolver.test.ts
git commit -m "feat: add transient placement pin resolver"
```

## Task 2: Add Deterministic Pin Match Engine

**Files:**
- Create: `plugin/src/editor/host/pinMatchEngine.ts`
- Test: `plugin/src/editor/host/__tests__/pinMatchEngine.test.ts`

- [ ] **Step 1: Write the failing tests for simple component matching**

```ts
import { test } from "node:test";
import * as assert from "node:assert/strict";

import { matchDraftPinsToRealPins } from "../pinMatchEngine";

test("matchDraftPinsToRealPins resolves LED A/K pins by name", () => {
  const result = matchDraftPinsToRealPins({
    role: "led",
    planPins: [
      { id: "draft-led1-a", pinName: "A" },
      { id: "draft-led1-k", pinName: "K" },
    ],
    realPins: [
      { primitiveId: "pin-a", pinName: "A", pinNumber: "1", x: 0, y: 0 },
      { primitiveId: "pin-k", pinName: "K", pinNumber: "2", x: 0, y: 0 },
    ],
  });

  assert.equal(result.get("draft-led1-a")?.resolvedPinName, "A");
  assert.equal(result.get("draft-led1-k")?.resolvedPinName, "K");
  assert.equal(result.get("draft-led1-k")?.confidence, 1);
});

test("matchDraftPinsToRealPins resolves resistor pins by number fallback", () => {
  const result = matchDraftPinsToRealPins({
    role: "resistor",
    planPins: [
      { id: "draft-r1-1", pinName: "1" },
      { id: "draft-r1-2", pinName: "2" },
    ],
    realPins: [
      { primitiveId: "pin-1", pinName: "P1", pinNumber: "1", x: 0, y: 0 },
      { primitiveId: "pin-2", pinName: "P2", pinNumber: "2", x: 0, y: 0 },
    ],
  });

  assert.equal(result.get("draft-r1-1")?.resolvedPinNumber, "1");
  assert.equal(result.get("draft-r1-2")?.resolvedPinNumber, "2");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx tsx --test src/editor/host/__tests__/pinMatchEngine.test.ts`

Expected: FAIL with missing module/export.

- [ ] **Step 3: Write minimal pin match engine**

```ts
type PlanPin = { id: string; pinName?: string; pinNumber?: string };
type RealPin = { primitiveId: string; pinName?: string; pinNumber?: string; x: number; y: number };

export function matchDraftPinsToRealPins(input: {
  role?: string;
  planPins: PlanPin[];
  realPins: RealPin[];
}): Map<string, { resolvedPinName?: string; resolvedPinNumber?: string; confidence: number; reason: string }> {
  const out = new Map<string, { resolvedPinName?: string; resolvedPinNumber?: string; confidence: number; reason: string }>();
  const used = new Set<string>();

  for (const planPin of input.planPins) {
    let best: RealPin | undefined;
    let bestScore = -1;
    for (const realPin of input.realPins) {
      const key = `${realPin.pinNumber || ""}:${realPin.pinName || ""}`;
      if (used.has(key)) continue;
      let score = 0;
      if (planPin.pinNumber && realPin.pinNumber && planPin.pinNumber === realPin.pinNumber) score += 100;
      if (planPin.pinName && realPin.pinName && planPin.pinName === realPin.pinName) score += 90;
      if (score > bestScore) {
        bestScore = score;
        best = realPin;
      }
    }
    if (best && bestScore > 0) {
      used.add(`${best.pinNumber || ""}:${best.pinName || ""}`);
      out.set(planPin.id, {
        resolvedPinName: best.pinName,
        resolvedPinNumber: best.pinNumber,
        confidence: Math.min(1, bestScore / 100),
        reason: bestScore >= 100 ? "matched_pin_number" : "matched_pin_name",
      });
    }
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/editor/host/__tests__/pinMatchEngine.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/editor/host/pinMatchEngine.ts src/editor/host/__tests__/pinMatchEngine.test.ts
git commit -m "feat: add deterministic pin match engine"
```

## Task 3: Integrate Transient Resolution Into Apply Flow

**Files:**
- Modify: `plugin/src/editor/host/applyPlanByApi.ts`
- Test: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`

- [ ] **Step 1: Write a failing integration test for apply-time transient resolution**

```ts
test("createApiApplyPlanAdapter resolves simple draft pins from transient placement before apply", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => ({
        getState_PrimitiveId: () => `cmp-${payload.uuid}`,
      }),
      getAllPinsByPrimitiveId: async (primitiveId: string) => {
        if (primitiveId.includes("dev-d1")) {
          return [
            { getState_PinName: () => "A", getState_PinNumber: () => "1", getState_X: () => 0, getState_Y: () => 0, getState_PrimitiveId: () => "pin-a" },
            { getState_PinName: () => "K", getState_PinNumber: () => "2", getState_X: () => 10, getState_Y: () => 0, getState_PrimitiveId: () => "pin-k" },
          ];
        }
        return [
          { getState_PinName: () => "1", getState_PinNumber: () => "1", getState_X: () => 0, getState_Y: () => 0, getState_PrimitiveId: () => "pin-1" },
          { getState_PinName: () => "2", getState_PinNumber: () => "2", getState_X: () => 10, getState_Y: () => 0, getState_PrimitiveId: () => "pin-2" },
        ];
      },
      delete: async () => true,
    },
    sch_PrimitiveWire: {
      create: async () => ({ getState_PrimitiveId: () => "wire-1" }),
      delete: async () => true,
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  for (const component of draft.components) {
    component.properties.device_uuid = component.ref === "D1" ? "dev-d1" : `dev-${component.ref?.toLowerCase()}`;
    component.properties.library_uuid = "lib-system";
  }

  const result = await adapter.apply(draft);
  assert.equal(result.applied, true);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts`

Expected: FAIL with `unresolved draft pin mappings` or `unmapped required nets`.

- [ ] **Step 3: Implement apply-time transient resolution hook**

```ts
import { resolveTransientComponentPins } from "./transientPinResolver";
import { matchDraftPinsToRealPins } from "./pinMatchEngine";

async function resolveDraftPinsFromTransientPlacement(plan: DraftPlan): Promise<DraftPlan> {
  const components = plan.components
    .filter((component) => component.properties.device_uuid && component.properties.library_uuid)
    .map((component) => ({
      componentId: component.id,
      ref: component.ref,
      deviceUuid: component.properties.device_uuid!,
      libraryUuid: component.properties.library_uuid!,
    }));

  const transient = await resolveTransientComponentPins(
    { components },
    {
      createComponent: async ({ deviceUuid, libraryUuid, index }) => {
        const created = await eda.sch_PrimitiveComponent.create({ uuid: deviceUuid, libraryUuid }, -5000, -5000 - index * 120, undefined, 0, false, true, true);
        return created ? { primitiveId: created.getState_PrimitiveId() } : null;
      },
      getPinsByPrimitiveId: async (primitiveId) => {
        const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(primitiveId);
        return (pins || []).map((pin) => ({
          primitiveId: pin.getState_PrimitiveId(),
          pinName: pin.getState_PinName(),
          pinNumber: pin.getState_PinNumber(),
          x: pin.getState_X(),
          y: pin.getState_Y(),
        }));
      },
      deleteComponents: async (primitiveIds) => eda.sch_PrimitiveComponent.delete(primitiveIds),
    }
  );

  return {
    ...plan,
    pins: plan.pins.map((pin) => {
      const component = plan.components.find((item) => item.id === pin.componentId);
      const realPins = transient.componentPins.get(pin.componentId) ?? [];
      const matched = matchDraftPinsToRealPins({
        role: component?.ref,
        planPins: plan.pins.filter((item) => item.componentId === pin.componentId),
        realPins,
      }).get(pin.id);
      return matched
        ? {
            ...pin,
            resolvedPinName: matched.resolvedPinName,
            resolvedPinNumber: matched.resolvedPinNumber,
            pinResolutionStatus: "resolved",
            pinResolutionConfidence: matched.confidence,
            pinResolutionReason: matched.reason,
          }
        : pin;
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/editor/host/applyPlanByApi.ts src/editor/host/__tests__/applyPlanByApi.test.ts
git commit -m "feat: resolve draft pins from transient placement before apply"
```

## Task 4: Add Diagnostics And User-Safe Failure Reasons

**Files:**
- Modify: `plugin/src/editor/host/applyPlanByApi.ts`
- Modify: `plugin/src/app/assistantRuntime.ts`
- Test: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`

- [ ] **Step 1: Write a failing test for structured transient resolution failure messaging**

```ts
test("createApiApplyPlanAdapter reports transient pin resolution failure without exposing internal jargon", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async () => ({ getState_PrimitiveId: () => "cmp-x" }),
      getAllPinsByPrimitiveId: async () => [],
      delete: async () => true,
    },
    sch_PrimitiveWire: { create: async () => ({ getState_PrimitiveId: () => "wire-x" }) },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  for (const component of draft.components) {
    component.properties.device_uuid = `dev-${component.id}`;
    component.properties.library_uuid = "lib";
  }

  await assert.rejects(() => adapter.apply(draft), /current device pin information is insufficient/i);
  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts`

Expected: FAIL because current error still mentions unmapped nets or unresolved pin mappings.

- [ ] **Step 3: Add structured error wrapping and runtime formatting**

```ts
if (unresolvedPins.length > 0) {
  throw new Error("transient pin resolution failed: current device pin information is insufficient for automatic apply");
}
```

```ts
if (/transient pin resolution failed:/i.test(message)) {
  return "应用草案失败：当前器件的引脚信息不足，暂时无法自动完成连线。";
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts src/app/__tests__/assistantRuntime.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/editor/host/applyPlanByApi.ts src/editor/host/__tests__/applyPlanByApi.test.ts src/app/assistantRuntime.ts
git commit -m "feat: add transient pin resolution diagnostics"
```

## Task 5: Add RAG Hint Hook For Low-Confidence Simple Pins

**Files:**
- Modify: `plugin/src/agent/tools/draftTools.ts`
- Modify: `plugin/src/agent/tools/__tests__/draftTools.test.ts`
- Modify: `plugin/src/editor/host/pinMatchEngine.ts`
- Test: `plugin/src/editor/host/__tests__/pinMatchEngine.test.ts`

- [ ] **Step 1: Write a failing test for low-confidence connector matching enhanced by hints**

```ts
test("matchDraftPinsToRealPins uses hint data to favor VCC/GND over generic 1/2 labels", () => {
  const result = matchDraftPinsToRealPins({
    role: "power_connector",
    planPins: [
      { id: "draft-j1-vcc", pinName: "VCC" },
      { id: "draft-j1-gnd", pinName: "GND" },
    ],
    realPins: [
      { primitiveId: "pin-1", pinName: "1", pinNumber: "1", x: 0, y: 0 },
      { primitiveId: "pin-2", pinName: "2", pinNumber: "2", x: 0, y: 0 },
    ],
    hints: {
      commonMappings: [
        { planPinName: "VCC", preferredRealPinNumber: "1" },
        { planPinName: "GND", preferredRealPinNumber: "2" },
      ],
    },
  });

  assert.equal(result.get("draft-j1-vcc")?.resolvedPinNumber, "1");
  assert.equal(result.get("draft-j1-gnd")?.resolvedPinNumber, "2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx --test src/editor/host/__tests__/pinMatchEngine.test.ts`

Expected: FAIL because hints are ignored.

- [ ] **Step 3: Implement minimal hint weighting**

```ts
type PinHint = {
  commonMappings?: Array<{ planPinName: string; preferredRealPinNumber?: string; preferredRealPinName?: string }>;
};

const hinted = input.hints?.commonMappings?.find((item) => item.planPinName === planPin.pinName);
if (hinted?.preferredRealPinNumber && realPin.pinNumber === hinted.preferredRealPinNumber) score += 40;
if (hinted?.preferredRealPinName && realPin.pinName === hinted.preferredRealPinName) score += 40;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsx --test src/editor/host/__tests__/pinMatchEngine.test.ts src/agent/tools/__tests__/draftTools.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/editor/host/pinMatchEngine.ts src/editor/host/__tests__/pinMatchEngine.test.ts src/agent/tools/draftTools.ts src/agent/tools/__tests__/draftTools.test.ts
git commit -m "feat: add rag hint weighting for simple pin matching"
```

## Task 6: Run Final Verification

**Files:**
- Modify: none

- [ ] **Step 1: Run focused tests**

Run: `npx tsx --test src/editor/host/__tests__/transientPinResolver.test.ts src/editor/host/__tests__/pinMatchEngine.test.ts src/editor/host/__tests__/applyPlanByApi.test.ts src/agent/tools/__tests__/draftTools.test.ts src/app/__tests__/assistantRuntime.test.ts`

Expected: PASS

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: build succeeds and refreshes inline iframe runtime

- [ ] **Step 3: Commit final integration state**

```bash
git add src/editor/host/transientPinResolver.ts src/editor/host/__tests__/transientPinResolver.test.ts src/editor/host/pinMatchEngine.ts src/editor/host/__tests__/pinMatchEngine.test.ts src/editor/host/applyPlanByApi.ts src/editor/host/__tests__/applyPlanByApi.test.ts src/agent/tools/draftTools.ts src/agent/tools/__tests__/draftTools.test.ts src/app/assistantRuntime.ts
git commit -m "feat: add transient pin resolution for simple draft apply"
```
