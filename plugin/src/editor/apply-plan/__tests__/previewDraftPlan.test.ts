import { test } from "node:test";
import * as assert from "node:assert/strict";

import { previewDraftPlan } from "../previewDraftPlan";

test("previewDraftPlan surfaces unresolved pin resolution details before apply", () => {
  const preview = previewDraftPlan({
    title: "pin preview",
    rationale: "test",
    components: [
      {
        id: "draft-d1",
        ref: "D1",
        properties: {},
      },
    ],
    pins: [
      {
        id: "draft-d1-a",
        componentId: "draft-d1",
        pinName: "A",
        pinNumber: "1",
        pinResolutionStatus: "resolved",
        resolvedPinName: "A",
        resolvedPinNumber: "1",
      },
      {
        id: "draft-d1-c",
        componentId: "draft-d1",
        pinName: "C",
        pinNumber: "2",
        pinResolutionStatus: "unresolved",
        pinResolutionReason: "no_matching_library_pin",
      },
    ],
    nets: [],
  } as any);

  assert.deepEqual(preview.unresolvedPinDetails, ["D1：该器件仍有连接需要系统继续自动校正后才能应用。"]);
});

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
      appliedSourceKinds: ["local_seed"],
      suggestedSourceKinds: ["lceda_open_source_extract"],
      appliedSourceRefs: ["local_seed:local-devboard-seed/esp32s3-core-power"],
      suggestedSourceRefs: ["lceda_open_source_extract:oshw-esp32-family/sheet-2"],
    },
  } as any);

  assert.deepEqual(preview.ragTemplateSummary, {
    appliedTemplateIds: ["esp32s3-mcu-power-core"],
    suggestedTemplateIds: ["esp32-family-expansion-header"],
    addedComponentCount: 3,
    suggestionReasons: ["family fallback only"],
    appliedSourceKinds: ["local_seed"],
    suggestedSourceKinds: ["lceda_open_source_extract"],
    appliedSourceRefs: ["local_seed:local-devboard-seed/esp32s3-core-power"],
    suggestedSourceRefs: ["lceda_open_source_extract:oshw-esp32-family/sheet-2"],
  });
  assert.equal(preview.rationale.includes("已参考模板"), true);
  assert.equal(preview.rationale.includes("已应用 1 个"), true);
  assert.equal(preview.rationale.includes("建议 1 个"), true);
  assert.equal(preview.rationale.includes("本地种子"), true);
  assert.equal(preview.rationale.includes("外部开源语料"), true);
});

test("previewDraftPlan tolerates malformed rag template summary arrays", () => {
  const preview = previewDraftPlan({
    title: "devboard malformed",
    rationale: "test",
    components: [],
    pins: [],
    nets: [],
    ragTemplateSummary: {
      addedComponentCount: 2,
    },
  } as any);

  assert.deepEqual(preview.ragTemplateSummary, {
    appliedTemplateIds: [],
    suggestedTemplateIds: [],
    addedComponentCount: 2,
    suggestionReasons: [],
    appliedSourceKinds: [],
    suggestedSourceKinds: [],
    appliedSourceRefs: [],
    suggestedSourceRefs: [],
  });
  assert.equal(preview.rationale.includes("已参考模板"), false);
});
