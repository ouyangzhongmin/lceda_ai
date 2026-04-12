import { test } from "node:test";
import * as assert from "node:assert/strict";

import { HostBackedEditorAdapter, UnimplementedEditorAdapter } from "../editorAdapter";

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
