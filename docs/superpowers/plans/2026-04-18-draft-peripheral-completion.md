# Draft Peripheral Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rule-driven post-processing stage that expands draft plans with near-production peripheral R/C/support parts before preview and apply.

**Architecture:** Keep LLM output focused on core modules, then run a deterministic peripheral completion pass over the draft plan. The completion layer identifies known module types, appends missing support parts and nets with dedupe rules, and marks generated parts so preview/apply/layout can treat them consistently.

**Tech Stack:** TypeScript, existing draft plan pipeline, node:test, plugin host apply path

---

## File Structure

- Modify: `plugin/src/editor/apply-plan/generateDraftPlan.ts`
  Responsibility: integrate peripheral completion into normalized draft generation flow.
- Create: `plugin/src/editor/apply-plan/draftPeripheralCompletion.ts`
  Responsibility: module recognition, rule templates, dedupe, and plan mutation helpers.
- Create: `plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
  Responsibility: focused completion behavior tests.
- Modify: `plugin/src/editor/apply-plan/previewDraftPlan.ts`
  Responsibility: expose completion summary into preview output.
- Modify: `plugin/src/editor/apply-plan/draftPlan.ts`
  Responsibility: extend preview/model types for completion metadata when needed.
- Modify: `plugin/src/app/assistantRuntime.ts`
  Responsibility: surface completion summary in draft/apply messaging if preview exposes it.
- Modify: `plugin/src/app/__tests__/assistantRuntime.test.ts`
  Responsibility: verify runtime summary text for completed peripherals when relevant.
- Modify: `plugin/src/editor/host/applyPlanByApi.ts`
  Responsibility: ensure completed support parts participate in functional layout.
- Modify: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`
  Responsibility: verify completed support parts are laid out and applied.

### Task 1: Peripheral Completion Engine

**Files:**
- Create: `plugin/src/editor/apply-plan/draftPeripheralCompletion.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`

- [ ] **Step 1: Write the failing test for ESP32-S3 + USB-C + audio peripheral completion**

```ts
test("completeDraftPlanPeripherals adds near-production support parts for esp32-s3 voice device drafts", () => {
  const plan = {
    title: "voice device",
    rationale: "test",
    components: [
      { id: "u-mcu", ref: "U1", name: "ESP32-S3", properties: {} },
      { id: "j-usb", ref: "J1", name: "USB-C", properties: {} },
      { id: "u-mic", ref: "U2", name: "INMP441", properties: {} },
      { id: "u-amp", ref: "U3", name: "MAX98357A", properties: {} },
    ],
    pins: [],
    nets: [],
  } as any;

  const completed = completeDraftPlanPeripherals(plan);

  const refs = completed.components.map((item) => item.ref);
  assert.equal(refs.includes("C1"), true);
  assert.equal(refs.includes("R1"), true);
  assert.equal(completed.completionSummary?.addedComponentCount > 0, true);
  assert.equal(completed.components.some((item) => item.properties.generated_by === "rule_completion"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
Expected: FAIL with `completeDraftPlanPeripherals is not defined` or equivalent missing export failure.

- [ ] **Step 3: Write minimal implementation**

```ts
export function completeDraftPlanPeripherals(plan: DraftPlan): DraftPlan & {
  completionSummary?: { addedComponentCount: number; templateIds: string[] };
} {
  return {
    ...plan,
    completionSummary: {
      addedComponentCount: 0,
      templateIds: [],
    },
  };
}
```

- [ ] **Step 4: Expand implementation to add real support parts**

```ts
type CompletionTemplateId =
  | "esp32_s3_support"
  | "usb_c_power_input"
  | "i2s_mic_support"
  | "max98357a_support";

function inferCompletionTemplates(plan: DraftPlan): CompletionTemplateId[] {
  const text = plan.components.map((item) => `${item.ref || ""} ${item.name || ""}`).join(" ").toLowerCase();
  const templates: CompletionTemplateId[] = [];
  if (text.includes("esp32-s3")) templates.push("esp32_s3_support");
  if (text.includes("usb-c") || text.includes("type-c")) templates.push("usb_c_power_input");
  if (text.includes("inmp441") || text.includes("microphone")) templates.push("i2s_mic_support");
  if (text.includes("max98357")) templates.push("max98357a_support");
  return templates;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/src/editor/apply-plan/draftPeripheralCompletion.ts plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts
git commit -m "feat: add draft peripheral completion engine"
```

### Task 2: Dedupe And Template Coverage

**Files:**
- Modify: `plugin/src/editor/apply-plan/draftPeripheralCompletion.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`

- [ ] **Step 1: Write the failing dedupe test**

```ts
test("completeDraftPlanPeripherals does not duplicate equivalent support parts already present", () => {
  const plan = {
    title: "esp32",
    rationale: "test",
    components: [
      { id: "u1", ref: "U1", name: "ESP32-S3", properties: {} },
      { id: "c-existing", ref: "C1", name: "0.1uF", properties: { generated_by: "llm" } },
    ],
    pins: [],
    nets: [],
  } as any;

  const completed = completeDraftPlanPeripherals(plan);

  assert.equal(completed.components.filter((item) => item.ref === "C1").length, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
Expected: FAIL because duplicate support parts are still added.

- [ ] **Step 3: Implement dedupe by ref/role/template**

```ts
function hasEquivalentCompletionPart(
  plan: DraftPlan,
  input: { ref: string; completionRole: string }
): boolean {
  return plan.components.some((component) =>
    component.ref === input.ref ||
    component.properties.completion_role === input.completionRole
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/src/editor/apply-plan/draftPeripheralCompletion.ts plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts
git commit -m "feat: dedupe completed peripheral parts"
```

### Task 3: Integrate Completion Into Draft Pipeline

**Files:**
- Modify: `plugin/src/editor/apply-plan/generateDraftPlan.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`

- [ ] **Step 1: Write the failing integration test**

```ts
test("normalizeDraftPlan runs peripheral completion before preview/apply consumers read the plan", () => {
  const draft = generateDraftPlanFromPrompt("帮我设计一个基于esp32-s3的语音设备");
  const refs = draft.components.map((item) => item.ref);
  assert.equal(refs.some((ref) => String(ref || "").startsWith("C")), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
Expected: FAIL because generated draft still only contains core parts.

- [ ] **Step 3: Integrate completion in normalize flow**

```ts
import { completeDraftPlanPeripherals } from "./draftPeripheralCompletion";

export function normalizeDraftPlan(plan: DraftPlan): DraftPlan {
  const normalized = existingNormalizeLogic(plan);
  return completeDraftPlanPeripherals(normalized);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/src/editor/apply-plan/generateDraftPlan.ts plugin/src/editor/apply-plan/draftPeripheralCompletion.ts plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts
git commit -m "feat: integrate peripheral completion into draft normalization"
```

### Task 4: Preview Summary For Completed Peripherals

**Files:**
- Modify: `plugin/src/editor/apply-plan/draftPlan.ts`
- Modify: `plugin/src/editor/apply-plan/previewDraftPlan.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`

- [ ] **Step 1: Write the failing preview summary test**

```ts
test("previewDraftPlan reports automatically completed peripherals", () => {
  const draft = completeDraftPlanPeripherals({
    title: "voice",
    rationale: "test",
    components: [{ id: "u1", ref: "U1", name: "ESP32-S3", properties: {} }],
    pins: [],
    nets: [],
  } as any);

  const preview = previewDraftPlan(draft);

  assert.equal((preview.completedPeripheralCount ?? 0) > 0, true);
  assert.equal((preview.completedPeripheralTemplates ?? []).length > 0, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
Expected: FAIL because preview has no completion summary fields.

- [ ] **Step 3: Extend preview types and implementation**

```ts
export interface DraftPreview {
  // existing fields...
  completedPeripheralCount?: number;
  completedPeripheralTemplates?: string[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/src/editor/apply-plan/draftPlan.ts plugin/src/editor/apply-plan/previewDraftPlan.ts plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts
git commit -m "feat: expose completed peripheral summary in preview"
```

### Task 5: Runtime Messaging For Completed Peripherals

**Files:**
- Modify: `plugin/src/app/assistantRuntime.ts`
- Modify: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Write the failing runtime summary test**

```ts
test("draft runtime summary mentions auto-completed peripheral parts", () => {
  const preview = {
    title: "voice device",
    rationale: "test",
    componentRefs: ["U1", "J1", "C1"],
    netNames: ["3V3"],
    componentCount: 3,
    netCount: 1,
    completedPeripheralCount: 2,
    completedPeripheralTemplates: ["esp32_s3_support"],
  } as any;

  const summary = buildDraftPreviewSummary(preview);

  assert.match(summary, /自动补全/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/app/__tests__/assistantRuntime.test.ts`
Expected: FAIL because runtime text does not mention completion summary.

- [ ] **Step 3: Implement minimal messaging update**

```ts
function buildDraftPreviewSummary(preview: DraftPreview): string {
  const completionHint =
    preview.completedPeripheralCount && preview.completedPeripheralCount > 0
      ? `，并自动补全 ${preview.completedPeripheralCount} 个外围器件`
      : "";
  return `草案已生成：${preview.title}，共 ${preview.componentCount} 个器件，${preview.netCount} 条网络${completionHint}。`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugin && npx tsx --test src/app/__tests__/assistantRuntime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/src/app/assistantRuntime.ts plugin/src/app/__tests__/assistantRuntime.test.ts
git commit -m "feat: surface completed peripherals in runtime summary"
```

### Task 6: Layout Support For Completed Parts

**Files:**
- Modify: `plugin/src/editor/host/applyPlanByApi.ts`
- Modify: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`

- [ ] **Step 1: Write the failing layout test for support parts near owning module**

```ts
test("functional layout keeps completed support parts near their owning controller", async () => {
  // assert support capacitor/resistor x/y stay close to MCU anchor rather than random fallback grid
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts`
Expected: FAIL because support parts are not grouped tightly by owner role.

- [ ] **Step 3: Extend functional layout to respect completion_role/completion_template**

```ts
if (component.properties.completion_template === "esp32_s3_support") {
  return "support";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugin && npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/src/editor/host/applyPlanByApi.ts plugin/src/editor/host/__tests__/applyPlanByApi.test.ts
git commit -m "feat: keep completed support parts near owning module"
```

### Task 7: Final Verification And Build Artifact Refresh

**Files:**
- Modify: `plugin/iframe/index.html`

- [ ] **Step 1: Run focused draft completion tests**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
Expected: PASS

- [ ] **Step 2: Run host apply tests**

Run: `cd plugin && npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts`
Expected: PASS

- [ ] **Step 3: Run runtime tests**

Run: `cd plugin && npx tsx --test src/app/__tests__/assistantRuntime.test.ts`
Expected: PASS

- [ ] **Step 4: Refresh inline iframe runtime**

Run: `cd plugin && npx ts-node ./config/esbuild.prod.ts && npx ts-node ./build/inlineIframeScript.ts`
Expected: `✓ Refreshed inline iframe runtime in index.html`

- [ ] **Step 5: Commit**

```bash
git add plugin/src/editor/apply-plan plugin/src/editor/host/applyPlanByApi.ts plugin/src/editor/host/__tests__/applyPlanByApi.test.ts plugin/src/app/assistantRuntime.ts plugin/src/app/__tests__/assistantRuntime.test.ts plugin/iframe/index.html
git commit -m "feat: complete near-production draft peripherals"
```
