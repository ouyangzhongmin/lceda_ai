import { test } from "node:test";
import * as assert from "node:assert/strict";

import { createApiApplyPlanAdapter } from "../applyPlanByApi";
import { generateDraftPlanFromPrompt } from "../../apply-plan/generateDraftPlan";

test("createApiApplyPlanAdapter does not report apply success when no host invoker exists", async () => {
  const adapter = createApiApplyPlanAdapter(undefined);
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");

  const result = await adapter.apply(draft);

  assert.equal(result.applied, false);
  assert.equal(result.rollbackSupported, false);
});

test("createApiApplyPlanAdapter does not report shape apply success when createShape returns undefined", async () => {
  const calls: string[] = [];
  const adapter = createApiApplyPlanAdapter(async (name: string, ..._args: unknown[]) => {
    calls.push(name);
    if (name === "getSource" || name === "getSchSource" || name === "getCurrentSchematic") {
      throw new Error("source unavailable");
    }
    if (name === "getShape") {
      return undefined;
    }
    if (name === "createShape" || name === "updateShape") {
      return undefined;
    }
    throw new Error(`unsupported call: ${name}`);
  });
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");

  await assert.rejects(() => adapter.apply(draft), /cannot create shape/);
  assert.equal(calls.includes("createShape"), true);
});
