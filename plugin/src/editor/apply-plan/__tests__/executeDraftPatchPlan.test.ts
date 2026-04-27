import { test } from "node:test";
import * as assert from "node:assert/strict";

import { executeDraftPatchPlan } from "../executeDraftPatchPlan";
import type { DraftPatchPlan, DraftObjectBindings } from "../draftPatchPlan";

test("executeDraftPatchPlan delegates phase-1 draft patch plans to adapter.patchDraftPlan", async () => {
  const patchPlan: DraftPatchPlan = {
    baseDraftVersionId: "draft-v1",
    nextDraftVersionId: "draft-v2",
    summary: {
      addComponentCount: 1,
      removeComponentCount: 0,
      replaceDeviceCount: 0,
      updatePropCount: 0,
      addWireCount: 0,
      removeWireCount: 0,
      conflictCount: 0,
    },
    operations: [{ kind: "add_component", componentId: "c1" }],
    conflicts: [],
  };
  let receivedPlan: DraftPatchPlan | undefined;
  const bindings: DraftObjectBindings = {
    pageId: "page-1",
    componentBindings: [
      {
        draftComponentId: "c1",
        primitiveId: "u1",
      },
    ],
    wireBindings: [],
  };

  const result = await executeDraftPatchPlan({
    adapter: {
      patchDraftPlan: async (plan: DraftPatchPlan) => {
        receivedPlan = plan;
        return {
          applied: true,
          transactionId: "patch-tx-1",
          bindings,
        };
      },
    },
    plan: patchPlan,
  });

  assert.equal(receivedPlan, patchPlan);
  assert.equal(result.applied, true);
  assert.equal(result.transactionId, "patch-tx-1");
  assert.equal(result.bindings, bindings);
});

test("executeDraftPatchPlan rejects blocking conflicts before calling the adapter", async () => {
  let called = false;

  await assert.rejects(
    () =>
      executeDraftPatchPlan({
        adapter: {
          patchDraftPlan: async () => {
            called = true;
            return {
              applied: true,
            };
          },
        },
        plan: {
          baseDraftVersionId: "draft-v1",
          nextDraftVersionId: "draft-v2",
          summary: {
            addComponentCount: 0,
            removeComponentCount: 0,
            replaceDeviceCount: 0,
            updatePropCount: 0,
            addWireCount: 0,
            removeWireCount: 0,
            conflictCount: 1,
          },
          operations: [{ kind: "mark_conflict", conflictId: "conflict-1" }],
          conflicts: [
            {
              id: "conflict-1",
              type: "device_class_changed",
              level: "blocking",
              message: "manual resolution required",
            },
          ],
        },
      }),
    /blocking draft patch conflicts/i
  );

  assert.equal(called, false);
});
