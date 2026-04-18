# Schematic Net Label And Layout Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prefer network labels over long cross-area wires and keep all auto-placed components inside the schematic frame safe area.

**Architecture:** Extend the typed placement apply path with deterministic routing heuristics. Named long-distance nets use paired labels plus short stubs when the host supports label primitives, while local nets still use wires. Functional-zone placement remains the source of fallback coordinates, but all generated coordinates are clamped into a drawing-safe bounding box.

**Tech Stack:** TypeScript, node:test, existing typed placement host path

---

## File Structure

- Modify: `plugin/src/editor/host/applyPlanByApi.ts`
  Responsibility: decide when to labelize nets, create short stub wires, clamp fallback placements, and preserve rollback behavior.
- Modify: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`
  Responsibility: lock down long-net label behavior and in-frame placement bounds.

### Task 1: Labelize Long-Distance Named Nets

**Files:**
- Modify: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`
- Modify: `plugin/src/editor/host/applyPlanByApi.ts`

- [ ] **Step 1: Write the failing host test for long-distance named nets**

```ts
test("createApiApplyPlanAdapter prefers net labels for long-distance nets when host label api is available", async () => {
  // host stub exposes sch_PrimitiveNetLabel.create
  // assert: 2 labels + 2 short wires for a long named net
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test --test-name-pattern='prefers net labels' src/editor/host/__tests__/applyPlanByApi.test.ts`
Expected: FAIL because no label primitives are created.

- [ ] **Step 3: Implement minimal label-routing logic**

```ts
function shouldUseNetLabelsForNet(netName: string | undefined, points: Array<{ x: number; y: number }>): boolean {
  return Boolean(netName && points.length === 2 && hostSupportsNetLabels() && manhattanDistance(points) >= NET_LABEL_DISTANCE_THRESHOLD);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugin && npx tsx --test --test-name-pattern='prefers net labels' src/editor/host/__tests__/applyPlanByApi.test.ts`
Expected: PASS

### Task 2: Clamp Auto Placement Into Drawing Bounds

**Files:**
- Modify: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`
- Modify: `plugin/src/editor/host/applyPlanByApi.ts`

- [ ] **Step 1: Write the failing host test for bounded fallback placements**

```ts
test("createApiApplyPlanAdapter keeps fallback placements inside the drawing frame", async () => {
  // assert every auto-created component x/y stays inside the configured safe bounds
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test --test-name-pattern='drawing frame' src/editor/host/__tests__/applyPlanByApi.test.ts`
Expected: FAIL because some fallback coordinates exceed the safe area.

- [ ] **Step 3: Implement minimal bounds clamping**

```ts
const DRAWING_BOUNDS = { minX: 80, minY: 100, maxX: 1080, maxY: 720 };
function clampToDrawingBoundsX(value: number): number { ... }
function clampToDrawingBoundsY(value: number): number { ... }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugin && npx tsx --test --test-name-pattern='drawing frame' src/editor/host/__tests__/applyPlanByApi.test.ts`
Expected: PASS

### Task 3: Regression Verification

**Files:**
- Modify: `plugin/src/editor/host/applyPlanByApi.ts`
- Test: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/previewDraftPlan.test.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Run targeted regression tests**

Run: `cd plugin && npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts src/editor/apply-plan/__tests__/previewDraftPlan.test.ts src/app/__tests__/assistantRuntime.test.ts`
Expected: PASS

- [ ] **Step 2: Rebuild plugin artifacts**

Run: `cd plugin && npx ts-node ./config/esbuild.prod.ts && npx ts-node ./build/inlineIframeScript.ts`
Expected: build succeeds and inline iframe runtime refreshes.
