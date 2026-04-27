import { test } from "node:test";
import * as assert from "node:assert/strict";

import { HostBackedEditorAdapter, UnimplementedEditorAdapter } from "../editorAdapter";
import type { DraftPatchPlan } from "../../apply-plan/draftPatchPlan";

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

test("HostBackedEditorAdapter.applyPlan rejects applying a draft into a non-empty schematic page", async () => {
  const adapter = new HostBackedEditorAdapter("professional", {
    getCurrentContext: async () => ({
      project: { channel: "professional", pageId: "p1", pageName: "Sheet 1" },
      components: [{ id: "u1", properties: {} }],
      pins: [],
      nets: [],
      selection: { objectIds: [] },
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    applyPlan: async () => ({
      applied: true,
      componentCount: 1,
      netCount: 1,
      rollbackSupported: true,
    }),
  });

  await assert.rejects(
    () =>
      adapter.applyPlan({
        title: "draft",
        rationale: "test",
        components: [{ id: "c1", properties: {} }],
        pins: [],
        nets: [],
      } as any),
    /requires an empty schematic page/i
  );
});

test("HostBackedEditorAdapter.applyPlan forwards draft apply when the current schematic page is empty", async () => {
  let applyCalled = false;
  const adapter = new HostBackedEditorAdapter("professional", {
    getCurrentContext: async () => ({
      project: { channel: "professional", pageId: "p1", pageName: "Sheet 1" },
      components: [],
      pins: [],
      nets: [],
      selection: { objectIds: [] },
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    applyPlan: async () => {
      applyCalled = true;
      return {
        applied: true,
        componentCount: 1,
        netCount: 1,
        rollbackSupported: true,
      };
    },
  });

  const result = await adapter.applyPlan({
    title: "draft",
    rationale: "test",
    components: [{ id: "c1", properties: {} }],
    pins: [],
    nets: [],
  } as any);

  assert.equal(applyCalled, true);
  assert.equal(result.applied, true);
});

test("HostBackedEditorAdapter.applyPlan treats page frame sheet component as empty schematic content", async () => {
  let applyCalled = false;
  const adapter = new HostBackedEditorAdapter("professional", {
    getCurrentContext: async () => ({
      project: { channel: "professional", pageId: "p1", pageName: "P1" },
      components: [
        {
          id: "sheet-frame",
          componentType: "sheet",
          properties: {},
        },
      ],
      pins: [],
      nets: [],
      selection: { objectIds: [] },
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    applyPlan: async () => {
      applyCalled = true;
      return {
        applied: true,
        componentCount: 1,
        netCount: 1,
        rollbackSupported: true,
      };
    },
  });

  const result = await adapter.applyPlan({
    title: "draft",
    rationale: "test",
    components: [{ id: "c1", properties: {} }],
    pins: [],
    nets: [],
  } as any);

  assert.equal(applyCalled, true);
  assert.equal(result.applied, true);
});

test("HostBackedEditorAdapter.applyPlan creates an empty schematic page before applying when supported by the host", async () => {
  let createPageCalled = false;
  let applyCalled = false;
  let currentContext = {
    project: { channel: "professional" as const, pageId: "p1", pageName: "Existing Sheet" },
    components: [{ id: "u1", properties: {} }],
    pins: [],
    nets: [],
    selection: { objectIds: [] },
  };
  const adapter = new HostBackedEditorAdapter("professional", {
    getCurrentContext: async () => currentContext,
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    createEmptySchematicPage: async () => {
      createPageCalled = true;
      currentContext = {
        project: { channel: "professional", pageId: "p2", pageName: "Draft Plan" },
        components: [],
        pins: [],
        nets: [],
        selection: { objectIds: [] },
      };
    },
    applyPlan: async () => {
      applyCalled = true;
      return {
        applied: true,
        componentCount: 1,
        netCount: 1,
        rollbackSupported: true,
      };
    },
  });

  const result = await adapter.applyPlan({
    title: "Draft Plan",
    rationale: "test",
    components: [{ id: "c1", properties: {} }],
    pins: [],
    nets: [],
  } as any);

  assert.equal(createPageCalled, true);
  assert.equal(applyCalled, true);
  assert.equal(result.applied, true);
});

test("HostBackedEditorAdapter.applyPlan rolls back the previous apply transaction before re-applying into a non-empty page", async () => {
  let applyCalled = false;
  let createPageCalled = false;
  let rollbackCalledWith: string | undefined;
  let currentContext = {
    project: { channel: "professional" as const, pageId: "p1", pageName: "P1" },
    components: [{ id: "u1", properties: {} }],
    pins: [],
    nets: [],
    selection: { objectIds: [] },
  };
  const adapter = new HostBackedEditorAdapter("professional", {
    getCurrentContext: async () => currentContext,
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    createEmptySchematicPage: async () => {
      createPageCalled = true;
    },
    rollbackApplyPlan: async (transactionId) => {
      rollbackCalledWith = transactionId;
      currentContext = {
        project: { channel: "professional", pageId: "p1", pageName: "P1" },
        components: [],
        pins: [],
        nets: [],
        selection: { objectIds: [] },
      };
      return { rolledBack: true, transactionId };
    },
    applyPlan: async () => {
      applyCalled = true;
      return {
        applied: true,
        componentCount: 2,
        netCount: 1,
        rollbackSupported: true,
        transactionId: "tx-2",
      };
    },
  });

  const result = await adapter.applyPlan(
    {
      title: "Revised Draft",
      rationale: "test",
      components: [{ id: "c1", properties: {} }],
      pins: [],
      nets: [],
    } as any,
    { replaceTransactionId: "tx-1" }
  );

  assert.equal(rollbackCalledWith, "tx-1");
  assert.equal(createPageCalled, false);
  assert.equal(applyCalled, true);
  assert.equal(result.transactionId, "tx-2");
});

test("HostBackedEditorAdapter.applyPlan still rejects a non-empty page when replaceTransactionId is provided but rollback is unavailable", async () => {
  const adapter = new HostBackedEditorAdapter("professional", {
    getCurrentContext: async () => ({
      project: { channel: "professional", pageId: "p1", pageName: "P1" },
      components: [{ id: "u1", properties: {} }],
      pins: [],
      nets: [],
      selection: { objectIds: [] },
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    applyPlan: async () => ({
      applied: true,
      componentCount: 1,
      netCount: 1,
      rollbackSupported: false,
    }),
  });

  await assert.rejects(
    () =>
      adapter.applyPlan(
        {
          title: "Revised Draft",
          rationale: "test",
          components: [{ id: "c1", properties: {} }],
          pins: [],
          nets: [],
        } as any,
        { replaceTransactionId: "tx-1" }
      ),
    /requires an empty schematic page/i
  );
});

test("HostBackedEditorAdapter.patchDraftPlan forwards patch plans to the host bridge", async () => {
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
  const adapter = new HostBackedEditorAdapter("professional", {
    getCurrentContext: async () => ({
      project: { channel: "professional", pageId: "p1", pageName: "P1" },
      components: [],
      pins: [],
      nets: [],
      selection: { objectIds: [] },
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    patchDraftPlan: async (plan) => {
      receivedPlan = plan;
      return {
        applied: true,
        transactionId: "patch-tx-1",
        bindings: {
          pageId: "p1",
          componentBindings: [
            {
              draftComponentId: "c1",
              primitiveId: "u1",
            },
          ],
          wireBindings: [],
        },
      };
    },
  });

  const result = await adapter.patchDraftPlan(patchPlan);

  assert.equal(receivedPlan, patchPlan);
  assert.equal(result.applied, true);
  assert.equal(result.transactionId, "patch-tx-1");
  assert.equal(result.bindings?.componentBindings[0]?.primitiveId, "u1");
});

test("HostBackedEditorAdapter.patchDraftPlan rejects when the host bridge does not support patchDraftPlan", async () => {
  const adapter = new HostBackedEditorAdapter("professional", {
    getCurrentContext: async () => ({
      project: { channel: "professional", pageId: "p1", pageName: "P1" },
      components: [],
      pins: [],
      nets: [],
      selection: { objectIds: [] },
    }),
    getSelection: async () => ({ objectIds: [] }),
    locate: async () => {},
    getCapabilityReport: async () => ({
      channel: "professional",
      available: true,
      missing: [],
      optionalMissing: ["patchDraftPlan"],
    }),
  });

  await assert.rejects(() => adapter.patchDraftPlan({
    baseDraftVersionId: "draft-v1",
    nextDraftVersionId: "draft-v2",
    summary: {
      addComponentCount: 0,
      removeComponentCount: 0,
      replaceDeviceCount: 0,
      updatePropCount: 0,
      addWireCount: 0,
      removeWireCount: 0,
      conflictCount: 0,
    },
    operations: [],
    conflicts: [],
  }), /host missing capability: patchDraftPlan|patch_draft_plan is not available/i);
});
