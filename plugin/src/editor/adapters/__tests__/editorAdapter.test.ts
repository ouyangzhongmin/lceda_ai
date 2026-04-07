import { test } from "node:test";
import * as assert from "node:assert/strict";

import { UnimplementedEditorAdapter } from "../editorAdapter";

test("UnimplementedEditorAdapter.applyPlan reports failure instead of pretending the draft was applied", async () => {
  const adapter = new UnimplementedEditorAdapter("professional");

  const result = await adapter.applyPlan({
    title: "draft",
    rationale: "test",
    components: [
      {
        id: "c1",
        properties: {},
      },
    ],
    pins: [],
    nets: [],
  });

  assert.equal(result.applied, false);
  assert.equal(result.componentCount, 1);
});
