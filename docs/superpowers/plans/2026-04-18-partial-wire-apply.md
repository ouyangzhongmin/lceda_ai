# Partial Wire Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change draft apply so typed placement places components and creates whatever connections are resolvable, while skipping unresolved connections and reporting manual follow-up instead of failing the whole apply.

**Architecture:** Refactor typed-placement apply in `applyPlanByApi.ts` from hard prevalidation into partial execution with skipped-connection reporting. Keep `ApplyPlanResult` backward compatible for core fields, extend it with optional partial-apply metadata, and let runtime turn that metadata into success summaries and structured follow-up hints.

**Tech Stack:** TypeScript, node:test via `tsx --test`, typed placement host adapter in `plugin/src/editor/host/applyPlanByApi.ts`, runtime state/messages in `plugin/src/app/assistantRuntime.ts`

---

## File Map

**Modify**
- `plugin/src/editor/adapters/editorAdapter.ts`
  Extend `ApplyPlanResult` with optional partial-apply metadata.
- `plugin/src/editor/host/applyPlanByApi.ts`
  Replace hard unresolved-pin failure in typed placement with partial wire application and skipped-connection reporting.
- `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`
  Add failing tests for partial apply success and skipped connections.
- `plugin/src/app/assistantRuntime.ts`
  Surface partial-apply success summaries and manual wiring guidance to the user.
- `plugin/src/app/__tests__/assistantRuntime.test.ts`
  Add focused runtime tests for new apply summary/message behavior.

## Task 1: Add Partial Apply Result Metadata

**Files:**
- Modify: `plugin/src/editor/adapters/editorAdapter.ts`
- Test: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`

- [ ] **Step 1: Add optional skipped-connection metadata to `ApplyPlanResult`**

```ts
export interface ApplyPlanResult {
  applied: boolean;
  componentCount: number;
  netCount: number;
  transactionId?: string;
  rollbackSupported?: boolean;
  partialWiring?: {
    connectedNetCount: number;
    skippedConnectionCount: number;
    skippedConnections?: Array<{
      fromComponentRef?: string;
      fromPin?: string;
      toComponentRef?: string;
      toPin?: string;
      netName?: string;
      reason: string;
    }>;
  };
}
```

- [ ] **Step 2: Run the host apply test file to ensure type changes fail only where behavior is still missing**

Run:

```bash
cd plugin && npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts
```

Expected:
- Existing tests still compile, or upcoming Task 2 tests fail because the metadata is not populated yet.

## Task 2: Make Typed Placement Apply Components And Skip Unresolvable Connections

**Files:**
- Modify: `plugin/src/editor/host/applyPlanByApi.ts`
- Test: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`

- [ ] **Step 1: Write a failing test for partial success when some connections are unresolved**

Add a test that:
- sets up a typed-placement runtime with component creation succeeding
- leaves one draft pin unresolved or unmapped to runtime pins
- expects `adapter.apply(draft)` to return `applied === true`
- expects component placement to happen
- expects only resolvable wires to be created
- expects `partialWiring.skippedConnectionCount > 0`

- [ ] **Step 2: Write a failing test for “all wires skipped but components placed” still succeeding**

Add a test that:
- places components successfully
- produces zero wire creations because endpoints are unresolved
- expects `applied === true`
- expects `partialWiring.connectedNetCount === 0`
- expects `partialWiring.skippedConnectionCount > 0`

- [ ] **Step 3: Verify RED**

Run:

```bash
cd plugin && npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts
```

Expected:
- FAIL because current implementation throws `unresolved draft pin mappings` or `unmapped required nets`.

- [ ] **Step 4: Replace hard unresolved-pin precheck with per-net/per-connection skip accounting**

Implement a partial-apply path in `applyPlanByApi.ts`:
- remove `ensureResolvedDraftPinsForTypedPlacement(plan)` from the top of `applyTypedSchematicPlan`
- do not call `validateMappedNets` / `validateRequiredConnections` as hard failures for typed placement apply
- build `placedPins` from whatever runtime pins can be matched
- for each net:
  - compute placed endpoints
  - if at least two endpoints exist, create wire and count it as connected
  - if fewer than two endpoints exist, record a skipped-connection entry instead of throwing
- if `plan.guidance.requiredConnections` exists, also emit skipped entries for unresolved required connections

- [ ] **Step 5: Return partial wiring metadata from typed apply**

Refactor the typed result shape:

```ts
type TypedApplyResult = {
  componentIds: string[];
  wireIds: string[];
  connectedNetCount: number;
  skippedConnections: Array<{
    fromComponentRef?: string;
    fromPin?: string;
    toComponentRef?: string;
    toPin?: string;
    netName?: string;
    reason: string;
  }>;
};
```

Use it in `createApiApplyPlanAdapter.apply`:

```ts
const placed = await applyTypedSchematicPlan(plan);
const applied =
  placed.componentIds.length > 0 ||
  placed.wireIds.length > 0;
...
return summarizeApply(plan, transactionId, applied, applied, {
  connectedNetCount: placed.connectedNetCount,
  skippedConnections: placed.skippedConnections,
});
```

- [ ] **Step 6: Keep hard failure only for true placement/runtime failures**

Preserve hard failure for:
- no typed placement runtime
- component creation fatal errors
- transaction/rollback fatal exceptions

Do not fail only because some net endpoints are unresolved.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
cd plugin && npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts
```

Expected:
- PASS, including the new partial-apply tests.

## Task 3: Surface Partial Apply Success In Runtime Messages

**Files:**
- Modify: `plugin/src/app/assistantRuntime.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Write a failing runtime-focused test for partial apply summary formatting**

Add a test for a new pure helper that formats apply success text from `ApplyPlanResult`, for example:

```ts
test("formatDraftApplySuccessSummary includes manual wiring follow-up for partial wiring", () => {
  assert.equal(
    formatDraftApplySuccessSummary({
      componentCount: 9,
      netCount: 6,
      partialWiring: {
        connectedNetCount: 4,
        skippedConnectionCount: 2,
      },
    }),
    "草案已应用：已放置 9 个器件，已自动连接 4 条网络，2 条连接需手动处理。"
  );
});
```

- [ ] **Step 2: Write a failing runtime-focused test for structured skipped-connection guidance**

Add a test for a helper that turns skipped connections into chat message blocks, limiting list size if needed.

- [ ] **Step 3: Verify RED**

Run:

```bash
cd plugin && npx tsx --test src/app/__tests__/assistantRuntime.test.ts
```

Expected:
- FAIL because the formatting helpers do not exist yet.

- [ ] **Step 4: Implement minimal runtime helpers and integrate them into apply success handling**

In `assistantRuntime.ts` add exported helpers such as:

```ts
export function formatDraftApplySuccessSummary(result: ApplyPlanResult): string {
  const partial = result.partialWiring;
  if (partial && partial.skippedConnectionCount > 0) {
    return `草案已应用：已放置 ${result.componentCount} 个器件，已自动连接 ${partial.connectedNetCount} 条网络，${partial.skippedConnectionCount} 条连接需手动处理。`;
  }
  return `草案已应用：器件 ${result.componentCount}，网络 ${result.netCount}。`;
}
```

And a helper that returns structured content / list items from `partialWiring.skippedConnections`.

Then update `applyCurrentDraftPlan()` success path to:
- use the new summary helper
- keep `agentRunState = "completed"`
- emit success-toned message title like `已应用，部分连接需手动处理` when skipped connections exist

- [ ] **Step 5: Verify GREEN**

Run:

```bash
cd plugin && npx tsx --test src/app/__tests__/assistantRuntime.test.ts
```

Expected:
- PASS with the new runtime tests and existing tests still green.

## Task 4: End-to-End Build And Verification

**Files:**
- Modify: `docs/superpowers/specs/2026-04-18-partial-wire-apply-design.md` only if implementation reveals a true mismatch

- [ ] **Step 1: Run both focused test files**

Run:

```bash
cd plugin && npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts
cd plugin && npx tsx --test src/app/__tests__/assistantRuntime.test.ts
```

Expected:
- PASS on both files.

- [ ] **Step 2: Rebuild inline iframe runtime if runtime code changed**

Run:

```bash
cd plugin && npx ts-node ./config/esbuild.prod.ts && npx ts-node ./build/inlineIframeScript.ts
```

Expected:
- `✓ Refreshed inline iframe runtime in index.html`

- [ ] **Step 3: Spot-check final result shape in generated iframe bundle**

Run:

```bash
node -e "const fs=require('fs'); const s=fs.readFileSync('plugin/iframe/index.html','utf8'); console.log(s.includes('部分连接需手动处理'), s.includes('partialWiring'))"
```

Expected:
- both checks print `true`

- [ ] **Step 4: If implementation reveals a genuine design mismatch, update the spec inline**

Only update:

```text
docs/superpowers/specs/2026-04-18-partial-wire-apply-design.md
```

Do not expand scope.

## Self-Review

Spec coverage:
- components should still place: Task 2
- resolvable wires still connect: Task 2
- unresolved wires skip instead of failing: Task 2
- success summary + manual follow-up messaging: Task 3
- no regression in runtime build artifact: Task 4

Placeholder scan:
- No TODO/TBD markers.
- Every verification step has an exact command.

Type consistency:
- `partialWiring`, `connectedNetCount`, `skippedConnectionCount`, and `skippedConnections` are named consistently across adapter, runtime, tests, and final bundle verification.
