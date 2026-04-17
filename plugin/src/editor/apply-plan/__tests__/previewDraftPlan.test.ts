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
