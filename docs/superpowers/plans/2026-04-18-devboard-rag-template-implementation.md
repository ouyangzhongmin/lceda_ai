# Devboard RAG Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-phase devboard-oriented RAG template enhancement path that supplements draft plans with high-confidence subcircuit templates for common MCU development boards.

**Architecture:** Keep the current rule-based peripheral completion as the deterministic base layer, then add a local structured template registry and retrieval pipeline that can recall devboard subcircuits by MCU model/family and merge them into the draft plan when confidence is high. Preview surfaces what came from templates and what was only suggested, while the existing apply/layout flow continues to consume one normalized draft plan.

**Tech Stack:** TypeScript, existing draft plan pipeline, node:test, plugin-side local template registry, preview/apply host path

---

## File Structure

- Create: `plugin/src/editor/apply-plan/devboardRagTemplates.ts`
  Responsibility: define the first local structured template registry for devboard subcircuits, retrieval scoring, and typed template metadata.
- Create: `plugin/src/editor/apply-plan/devboardRagCompletion.ts`
  Responsibility: detect devboard anchors, recall candidate templates, score confidence, merge high-confidence templates into a draft plan, and return suggestions for low-confidence templates.
- Modify: `plugin/src/editor/apply-plan/draftPlan.ts`
  Responsibility: extend draft plan and preview types to carry RAG template summary, suggestion items, and per-component source metadata.
- Modify: `plugin/src/editor/apply-plan/draftPeripheralCompletion.ts`
  Responsibility: invoke devboard RAG completion after deterministic rule completion and preserve dedupe semantics.
- Modify: `plugin/src/editor/apply-plan/generateDraftPlan.ts`
  Responsibility: keep normalization flow returning the fully enhanced draft plan from one place.
- Modify: `plugin/src/editor/apply-plan/previewDraftPlan.ts`
  Responsibility: expose RAG template apply/suggestion summaries in user-visible preview text and structured preview fields.
- Create: `plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`
  Responsibility: focused retrieval, confidence, merge, and suggestion behavior tests.
- Modify: `plugin/src/editor/apply-plan/__tests__/previewDraftPlan.test.ts`
  Responsibility: verify preview text and structured fields for template-based completion.
- Modify: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`
  Responsibility: verify template-generated support parts still flow through placement/apply correctly.

### Task 1: Define The Local Devboard Template Registry

**Files:**
- Create: `plugin/src/editor/apply-plan/devboardRagTemplates.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`

- [ ] **Step 1: Write the failing registry test**

```ts
test("getDevboardRagTemplates returns structured templates for supported MCU families", () => {
  const templates = getDevboardRagTemplates();

  assert.equal(templates.some((item) => item.anchorDeviceModel === "ESP32-S3"), true);
  assert.equal(templates.some((item) => item.anchorDeviceFamily === "RP2040"), true);
  assert.equal(templates.some((item) => item.templateType === "mcu_boot_reset"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`
Expected: FAIL with `getDevboardRagTemplates is not defined` or missing module failure.

- [ ] **Step 3: Write the minimal registry types and export**

```ts
export interface DevboardRagTemplateComponent {
  ref: string;
  name: string;
  value?: string;
  completionRole: string;
  attachToNet?: string;
}

export interface DevboardRagTemplate {
  templateId: string;
  templateType:
    | "mcu_power_core"
    | "mcu_boot_reset"
    | "uart_download_header"
    | "usb_power_input"
    | "power_indicator"
    | "button_reset"
    | "expansion_header";
  anchorDeviceFamily: string;
  anchorDeviceModel?: string;
  scenarioTags: string[];
  qualityScore: number;
  components: DevboardRagTemplateComponent[];
}

export function getDevboardRagTemplates(): DevboardRagTemplate[] {
  return [];
}
```

- [ ] **Step 4: Expand the registry with first-phase templates**

```ts
const DEVBOARD_RAG_TEMPLATES: DevboardRagTemplate[] = [
  {
    templateId: "esp32s3-mcu-power-core",
    templateType: "mcu_power_core",
    anchorDeviceFamily: "ESP32",
    anchorDeviceModel: "ESP32-S3",
    scenarioTags: ["devboard", "usb", "3v3"],
    qualityScore: 0.98,
    components: [
      { ref: "C_AUTO_10U", name: "capacitor", value: "10uF", completionRole: "mcu_bulk_decoupling", attachToNet: "3V3" },
      { ref: "C_AUTO_100N", name: "capacitor", value: "100nF", completionRole: "mcu_local_decoupling", attachToNet: "3V3" },
    ],
  },
  {
    templateId: "esp32s3-boot-reset",
    templateType: "mcu_boot_reset",
    anchorDeviceFamily: "ESP32",
    anchorDeviceModel: "ESP32-S3",
    scenarioTags: ["devboard", "boot", "reset"],
    qualityScore: 0.97,
    components: [
      { ref: "R_AUTO_EN", name: "resistor", value: "10k", completionRole: "mcu_en_pullup", attachToNet: "MCU_EN" },
      { ref: "C_AUTO_EN", name: "capacitor", value: "1uF", completionRole: "mcu_en_rc", attachToNet: "MCU_EN" },
    ],
  },
];

export function getDevboardRagTemplates(): DevboardRagTemplate[] {
  return DEVBOARD_RAG_TEMPLATES.map((item) => ({
    ...item,
    components: item.components.map((component) => ({ ...component })),
  }));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/src/editor/apply-plan/devboardRagTemplates.ts plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts
git commit -m "feat: add local devboard rag template registry"
```

### Task 2: Retrieve And Rank Candidate Templates

**Files:**
- Modify: `plugin/src/editor/apply-plan/devboardRagTemplates.ts`
- Create: `plugin/src/editor/apply-plan/devboardRagCompletion.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`

- [ ] **Step 1: Write the failing retrieval test**

```ts
test("recallDevboardRagTemplates ranks exact MCU model matches ahead of family matches", () => {
  const result = recallDevboardRagTemplates({
    components: [
      { id: "u1", ref: "U1", name: "ESP32-S3-WROOM-1-N16R8", properties: {} },
    ],
  } as any);

  assert.equal(result.candidates[0]?.anchorDeviceModel, "ESP32-S3");
  assert.equal(result.candidates[0]?.score > result.candidates[result.candidates.length - 1]!.score, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`
Expected: FAIL with `recallDevboardRagTemplates is not defined`.

- [ ] **Step 3: Write minimal retrieval scaffolding**

```ts
export interface RecalledDevboardTemplate {
  templateId: string;
  anchorDeviceFamily: string;
  anchorDeviceModel?: string;
  score: number;
}

export function recallDevboardRagTemplates(plan: DraftPlan): {
  anchorModel?: string;
  anchorFamily?: string;
  candidates: RecalledDevboardTemplate[];
} {
  return { candidates: [] };
}
```

- [ ] **Step 4: Implement exact-model and family scoring**

```ts
function detectAnchorModel(plan: DraftPlan): { family?: string; model?: string } {
  const text = plan.components.map((item) => `${item.ref || ""} ${item.name || ""}`).join(" ").toUpperCase();
  if (text.includes("ESP32-S3")) return { family: "ESP32", model: "ESP32-S3" };
  if (text.includes("ESP32-C3")) return { family: "ESP32", model: "ESP32-C3" };
  if (text.includes("RP2040")) return { family: "RP2040", model: "RP2040" };
  if (text.includes("STM32F103")) return { family: "STM32", model: "STM32F103" };
  return {};
}

export function recallDevboardRagTemplates(plan: DraftPlan) {
  const anchor = detectAnchorModel(plan);
  const candidates = getDevboardRagTemplates()
    .map((item) => ({
      ...item,
      score:
        item.anchorDeviceModel && anchor.model === item.anchorDeviceModel ? 1 :
        item.anchorDeviceFamily && anchor.family === item.anchorDeviceFamily ? 0.7 :
        0,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.qualityScore - a.qualityScore);
  return {
    anchorModel: anchor.model,
    anchorFamily: anchor.family,
    candidates,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/src/editor/apply-plan/devboardRagTemplates.ts plugin/src/editor/apply-plan/devboardRagCompletion.ts plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts
git commit -m "feat: rank devboard rag template candidates"
```

### Task 3: Merge High-Confidence Templates Into Draft Plans

**Files:**
- Modify: `plugin/src/editor/apply-plan/devboardRagCompletion.ts`
- Modify: `plugin/src/editor/apply-plan/draftPlan.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`

- [ ] **Step 1: Write the failing merge test**

```ts
test("applyDevboardRagCompletion merges high-confidence template parts into the draft plan", () => {
  const completed = applyDevboardRagCompletion({
    title: "devboard",
    rationale: "test",
    components: [
      { id: "u1", ref: "U1", name: "ESP32-S3-WROOM-1", properties: {} },
    ],
    pins: [],
    nets: [{ id: "n-3v3", name: "3V3", nodeIds: [], isPower: true }],
  } as any);

  assert.equal(completed.components.some((item) => item.properties.generated_by === "rag_template"), true);
  assert.equal(completed.components.some((item) => item.properties.template_type === "mcu_power_core"), true);
  assert.equal((completed.ragTemplateSummary?.appliedTemplateIds ?? []).includes("esp32s3-mcu-power-core"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`
Expected: FAIL because no template merge result exists on the plan.

- [ ] **Step 3: Extend draft types for RAG summary**

```ts
export interface DraftPlan {
  // existing fields...
  ragTemplateSummary?: {
    appliedTemplateIds: string[];
    suggestedTemplateIds: string[];
    addedComponentCount: number;
  };
}
```

- [ ] **Step 4: Implement high-confidence template merge**

```ts
const HIGH_CONFIDENCE_THRESHOLD = 0.9;

export function applyDevboardRagCompletion(plan: DraftPlan): DraftPlan {
  const recalled = recallDevboardRagTemplates(plan);
  const applied = recalled.candidates.filter((item) => item.score >= HIGH_CONFIDENCE_THRESHOLD);
  if (applied.length === 0) {
    return plan;
  }

  const nextComponents = [...plan.components];
  for (const template of applied) {
    for (const component of template.components) {
      nextComponents.push({
        id: `rag-${template.templateId}-${component.completionRole}`,
        ref: component.ref,
        name: component.name,
        value: component.value,
        properties: {
          generated_by: "rag_template",
          template_id: template.templateId,
          template_type: template.templateType,
          template_confidence: String(template.score),
          completion_role: component.completionRole,
        },
      } as any);
    }
  }

  return {
    ...plan,
    components: nextComponents,
    ragTemplateSummary: {
      appliedTemplateIds: applied.map((item) => item.templateId),
      suggestedTemplateIds: [],
      addedComponentCount: nextComponents.length - plan.components.length,
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/src/editor/apply-plan/devboardRagCompletion.ts plugin/src/editor/apply-plan/draftPlan.ts plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts
git commit -m "feat: merge high-confidence devboard rag templates"
```

### Task 4: Keep Low-Confidence Matches As Suggestions

**Files:**
- Modify: `plugin/src/editor/apply-plan/devboardRagCompletion.ts`
- Modify: `plugin/src/editor/apply-plan/draftPlan.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`

- [ ] **Step 1: Write the failing suggestion test**

```ts
test("applyDevboardRagCompletion keeps family fallback templates as suggestions instead of auto-merging", () => {
  const completed = applyDevboardRagCompletion({
    title: "family fallback",
    rationale: "test",
    components: [
      { id: "u1", ref: "U1", name: "ESP32-C6", properties: {} },
    ],
    pins: [],
    nets: [],
  } as any);

  assert.equal(completed.components.some((item) => item.properties.generated_by === "rag_template"), false);
  assert.equal((completed.ragTemplateSummary?.suggestedTemplateIds ?? []).length > 0, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`
Expected: FAIL because family fallback templates are either discarded or incorrectly auto-applied.

- [ ] **Step 3: Implement suggestion-only handling**

```ts
export interface DraftPlan {
  // existing fields...
  ragTemplateSummary?: {
    appliedTemplateIds: string[];
    suggestedTemplateIds: string[];
    addedComponentCount: number;
    suggestionReasons?: string[];
  };
}

const HIGH_CONFIDENCE_THRESHOLD = 0.9;

const applied = recalled.candidates.filter((item) => item.score >= HIGH_CONFIDENCE_THRESHOLD);
const suggested = recalled.candidates.filter((item) => item.score < HIGH_CONFIDENCE_THRESHOLD);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/src/editor/apply-plan/devboardRagCompletion.ts plugin/src/editor/apply-plan/draftPlan.ts plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts
git commit -m "feat: keep low-confidence devboard templates as suggestions"
```

### Task 5: Dedupe Template Parts Against Existing Rule Completion

**Files:**
- Modify: `plugin/src/editor/apply-plan/devboardRagCompletion.ts`
- Modify: `plugin/src/editor/apply-plan/draftPeripheralCompletion.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`

- [ ] **Step 1: Write the failing dedupe test**

```ts
test("applyDevboardRagCompletion skips template parts when equivalent rule-completed roles already exist", () => {
  const completed = applyDevboardRagCompletion({
    title: "dedupe",
    rationale: "test",
    components: [
      { id: "u1", ref: "U1", name: "ESP32-S3", properties: {} },
      {
        id: "c-existing",
        ref: "C9",
        name: "capacitor",
        value: "10uF",
        properties: {
          generated_by: "rule_completion",
          completion_role: "mcu_bulk_decoupling",
        },
      },
    ],
    pins: [],
    nets: [{ id: "n-3v3", name: "3V3", nodeIds: [], isPower: true }],
  } as any);

  assert.equal(
    completed.components.filter((item) => item.properties.completion_role === "mcu_bulk_decoupling").length,
    1
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`
Expected: FAIL because equivalent components are duplicated.

- [ ] **Step 3: Implement dedupe by completion role and value**

```ts
function hasEquivalentSupportPart(plan: DraftPlan, role: string, value?: string): boolean {
  return plan.components.some((component) =>
    component.properties.completion_role === role &&
    (!value || !component.value || component.value === value)
  );
}
```

- [ ] **Step 4: Integrate RAG completion into peripheral completion flow**

```ts
export function completeDraftPlanPeripherals(plan: DraftPlan): DraftPlan {
  const completedByRules = completeByRules(plan);
  return applyDevboardRagCompletion(completedByRules);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/src/editor/apply-plan/devboardRagCompletion.ts plugin/src/editor/apply-plan/draftPeripheralCompletion.ts plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts
git commit -m "feat: dedupe devboard templates against rule completion"
```

### Task 6: Surface Template Results In Preview

**Files:**
- Modify: `plugin/src/editor/apply-plan/draftPlan.ts`
- Modify: `plugin/src/editor/apply-plan/previewDraftPlan.ts`
- Modify: `plugin/src/editor/apply-plan/__tests__/previewDraftPlan.test.ts`

- [ ] **Step 1: Write the failing preview summary test**

```ts
test("previewDraftPlan exposes applied and suggested devboard rag templates", () => {
  const preview = previewDraftPlan({
    title: "devboard",
    rationale: "test",
    components: [],
    pins: [],
    nets: [],
    ragTemplateSummary: {
      appliedTemplateIds: ["esp32s3-mcu-power-core"],
      suggestedTemplateIds: ["esp32-family-expansion-header"],
      addedComponentCount: 3,
      suggestionReasons: ["family fallback only"],
    },
  } as any);

  assert.equal(preview.ragTemplateSummary?.appliedTemplateIds?.[0], "esp32s3-mcu-power-core");
  assert.equal(preview.rationale.includes("参考模板"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/previewDraftPlan.test.ts`
Expected: FAIL because preview has no `ragTemplateSummary` field.

- [ ] **Step 3: Extend preview types and rendering**

```ts
export interface DraftPreview {
  // existing fields...
  ragTemplateSummary?: {
    appliedTemplateIds?: string[];
    suggestedTemplateIds?: string[];
    addedComponentCount?: number;
    suggestionReasons?: string[];
  };
}
```

- [ ] **Step 4: Append visible RAG summary text**

```ts
const rationaleWithRag =
  ragTemplateSummary && ragTemplateSummary.addedComponentCount > 0
    ? `${rationaleWithCompletion} 已参考模板补全 ${ragTemplateSummary.addedComponentCount} 个器件。`
    : rationaleWithCompletion;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/previewDraftPlan.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugin/src/editor/apply-plan/draftPlan.ts plugin/src/editor/apply-plan/previewDraftPlan.ts plugin/src/editor/apply-plan/__tests__/previewDraftPlan.test.ts
git commit -m "feat: expose devboard rag template summary in preview"
```

### Task 7: Verify Apply/Layout Compatibility

**Files:**
- Modify: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/previewDraftPlan.test.ts`

- [ ] **Step 1: Write the failing apply compatibility test**

```ts
test("createApiApplyPlanAdapter places rag-template support parts inside the drawing frame", async () => {
  const draft = applyDevboardRagCompletion({
    title: "devboard",
    rationale: "test",
    components: [
      { id: "u1", ref: "U1", name: "ESP32-S3", properties: { device_uuid: "mcu-device", library_uuid: "mcu-lib" } },
    ],
    pins: [],
    nets: [{ id: "n-3v3", name: "3V3", nodeIds: [], isPower: true }],
  } as any);

  const ragParts = draft.components.filter((item) => item.properties.generated_by === "rag_template");
  assert.equal(ragParts.length > 0, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd plugin && npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts`
Expected: FAIL because the new template-generated parts are not covered by a regression test yet.

- [ ] **Step 3: Add regression assertions around generated support-part placement**

```ts
assert.equal(
  createdPlacements.every((item) => item.x >= 80 && item.x <= 1080 && item.y >= 100 && item.y <= 720),
  true
);
```

- [ ] **Step 4: Run targeted regression tests**

Run: `cd plugin && npx tsx --test src/editor/host/__tests__/applyPlanByApi.test.ts src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts src/editor/apply-plan/__tests__/previewDraftPlan.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/src/editor/host/__tests__/applyPlanByApi.test.ts plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts plugin/src/editor/apply-plan/__tests__/previewDraftPlan.test.ts
git commit -m "test: cover apply compatibility for devboard rag templates"
```

### Task 8: Full Verification And Build

**Files:**
- Modify: `plugin/src/editor/apply-plan/devboardRagTemplates.ts`
- Modify: `plugin/src/editor/apply-plan/devboardRagCompletion.ts`
- Modify: `plugin/src/editor/apply-plan/draftPeripheralCompletion.ts`
- Modify: `plugin/src/editor/apply-plan/draftPlan.ts`
- Modify: `plugin/src/editor/apply-plan/previewDraftPlan.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts`
- Test: `plugin/src/editor/apply-plan/__tests__/previewDraftPlan.test.ts`
- Test: `plugin/src/editor/host/__tests__/applyPlanByApi.test.ts`
- Test: `plugin/src/app/__tests__/assistantRuntime.test.ts`

- [ ] **Step 1: Run the focused regression suite**

Run: `cd plugin && npx tsx --test src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts src/editor/apply-plan/__tests__/previewDraftPlan.test.ts src/editor/host/__tests__/applyPlanByApi.test.ts src/app/__tests__/assistantRuntime.test.ts`
Expected: PASS

- [ ] **Step 2: Rebuild plugin artifacts**

Run: `cd plugin && npx ts-node ./config/esbuild.prod.ts && npx ts-node ./build/inlineIframeScript.ts`
Expected: build succeeds and inline iframe runtime refreshes.

- [ ] **Step 3: Re-read the spec and confirm coverage**

```md
- Local structured template registry: covered by Task 1
- Retrieval and reranking: covered by Task 2
- High-confidence auto-merge: covered by Task 3
- Low-confidence suggestion-only behavior: covered by Task 4
- Dedupe with rule completion: covered by Task 5
- Preview transparency: covered by Task 6
- Apply/layout compatibility: covered by Task 7
```

- [ ] **Step 4: Commit**

```bash
git add plugin/src/editor/apply-plan/devboardRagTemplates.ts plugin/src/editor/apply-plan/devboardRagCompletion.ts plugin/src/editor/apply-plan/draftPeripheralCompletion.ts plugin/src/editor/apply-plan/draftPlan.ts plugin/src/editor/apply-plan/previewDraftPlan.ts plugin/src/editor/apply-plan/__tests__/devboardRagCompletion.test.ts plugin/src/editor/apply-plan/__tests__/draftPeripheralCompletion.test.ts plugin/src/editor/apply-plan/__tests__/previewDraftPlan.test.ts plugin/src/editor/host/__tests__/applyPlanByApi.test.ts
git commit -m "feat: add first-phase devboard rag template enhancement"
```
