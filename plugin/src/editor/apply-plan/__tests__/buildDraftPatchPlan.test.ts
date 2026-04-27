import { test } from "node:test";
import * as assert from "node:assert/strict";

import {
  type AppliedDraftSnapshot,
  type DraftObjectBindings,
  summarizeDraftPatchPlan,
  type DraftPatchConflict,
  type DraftPatchOperation,
  type DraftPatchPlan,
} from "../draftPatchPlan";
import { buildDraftPatchPlan } from "../buildDraftPatchPlan";

function createPreviousSnapshot(
  overrides: Partial<AppliedDraftSnapshot> = {}
): AppliedDraftSnapshot {
  return {
    draftVersionId: "v1",
    title: "draft",
    rationale: "r1",
    appliedAt: "2026-04-25T00:00:00.000Z",
    pageId: "p1",
    components: [],
    pins: [],
    nets: [],
    ...overrides,
  };
}

function createBindings(
  overrides: Partial<DraftObjectBindings> = {}
): DraftObjectBindings {
  return {
    pageId: "p1",
    componentBindings: [],
    wireBindings: [],
    ...overrides,
  };
}

test("summarizeDraftPatchPlan reports replacement and conflict counts", () => {
  const plan: DraftPatchPlan = {
    baseDraftVersionId: "v1",
    nextDraftVersionId: "v2",
    summary: {
      addComponentCount: 1,
      removeComponentCount: 0,
      replaceDeviceCount: 1,
      updatePropCount: 0,
      addWireCount: 0,
      removeWireCount: 1,
      conflictCount: 2,
    },
    operations: [],
    conflicts: [],
  };

  assert.equal(
    summarizeDraftPatchPlan(plan),
    "新增器件 1，替换器件 1，删除连线 1，待处理冲突 2。"
  );
});

test("summarizeDraftPatchPlan keeps zero-count formatting stable with wider patch unions", () => {
  const operations: DraftPatchOperation[] = [
    {
      kind: "update_component_props",
      componentId: "draft-u1",
      primitiveId: "schcomp-1",
      nextProperties: { value: "10k" },
    },
    {
      kind: "add_wire",
      netId: "draft-net-1",
      netName: "I2C_SCL",
      nodeIds: ["draft-u1-1", "draft-u2-3"],
    },
    {
      kind: "rewire_endpoint",
      netId: "draft-net-2",
      wireIds: ["wire-1"],
      fromNodeId: "draft-u3-1",
      toNodeId: "draft-u3-2",
    },
    { kind: "mark_conflict", conflictId: "conflict-1" },
  ];
  const conflicts: DraftPatchConflict[] = [
    {
      id: "conflict-1",
      type: "net_semantics_changed",
      level: "warning",
      netName: "I2C_SCL",
      message: "net semantics changed",
    },
    {
      id: "conflict-2",
      type: "user_edit_detected",
      level: "blocking",
      componentRef: "U1",
      message: "user edit detected",
    },
  ];
  const plan: DraftPatchPlan = {
    baseDraftVersionId: "v2",
    nextDraftVersionId: "v3",
    summary: {
      addComponentCount: 0,
      removeComponentCount: 0,
      replaceDeviceCount: 0,
      updatePropCount: 0,
      addWireCount: 0,
      removeWireCount: 0,
      conflictCount: 0,
    },
    operations,
    conflicts,
  };

  assert.equal(
    summarizeDraftPatchPlan(plan),
    "新增器件 0，替换器件 0，删除连线 0，待处理冲突 0。"
  );
});

test("buildDraftPatchPlan marks same-ref same-class device change as replace_component_device", () => {
  const patch = buildDraftPatchPlan({
    previous: createPreviousSnapshot({
      components: [
        {
          id: "u1",
          ref: "U1",
          name: "LDO",
          properties: {
            completion_role: "regulator",
            device_uuid: "old-dev",
          },
        },
      ],
    }),
    next: {
      title: "draft",
      rationale: "r2",
      components: [
        {
          id: "u1",
          ref: "U1",
          name: "LDO",
          properties: {
            completion_role: "regulator",
            device_uuid: "new-dev",
            library_uuid: "lib-new",
          },
        },
        {
          id: "c1",
          ref: "C1",
          name: "Cap",
          properties: {},
        },
      ],
      pins: [],
      nets: [],
    },
    bindings: createBindings({
      componentBindings: [
        {
          draftComponentId: "u1",
          ref: "U1",
          primitiveId: "prim-u1",
          deviceUuid: "old-dev",
        },
      ],
    }),
  });

  assert.equal(patch.summary.replaceDeviceCount, 1);
  assert.equal(patch.summary.addComponentCount, 1);
  assert.equal(patch.summary.removeComponentCount, 0);
  assert.deepEqual(patch.operations[0], {
    kind: "replace_component_device",
    componentId: "u1",
    primitiveId: "prim-u1",
    mode: "same_class",
    keepRef: true,
    keepPlacement: true,
    nextDeviceUuid: "new-dev",
    nextLibraryUuid: "lib-new",
  });
  assert.deepEqual(patch.operations[1], {
    kind: "add_component",
    componentId: "c1",
  });
});

test("buildDraftPatchPlan emits remove_component when previous component is absent in next draft", () => {
  const patch = buildDraftPatchPlan({
    previous: createPreviousSnapshot({
      components: [
        {
          id: "u1",
          ref: "U1",
          name: "LDO",
          properties: {
            completion_role: "regulator",
            device_uuid: "old-dev",
          },
        },
        {
          id: "r1",
          ref: "R1",
          name: "Res",
          properties: {},
        },
      ],
    }),
    next: {
      title: "draft",
      rationale: "r2",
      components: [
        {
          id: "u1",
          ref: "U1",
          name: "LDO",
          properties: {
            completion_role: "regulator",
            device_uuid: "old-dev",
          },
        },
      ],
      pins: [],
      nets: [],
    },
    bindings: createBindings({
      componentBindings: [
        {
          draftComponentId: "r1",
          ref: "R1",
          primitiveId: "prim-r1",
        },
      ],
    }),
  });

  assert.equal(patch.summary.removeComponentCount, 1);
  assert.deepEqual(patch.operations, [
    {
      kind: "remove_component",
      componentId: "r1",
      primitiveId: "prim-r1",
    },
  ]);
});

test("buildDraftPatchPlan emits conflict for cross-class replacement", () => {
  const patch = buildDraftPatchPlan({
    previous: createPreviousSnapshot({
      components: [
        {
          id: "u1",
          ref: "U1",
          name: "LDO",
          properties: {
            completion_role: "regulator",
            device_uuid: "old-dev",
          },
        },
      ],
    }),
    next: {
      title: "draft",
      rationale: "r2",
      components: [
        {
          id: "u1",
          ref: "U1",
          name: "Buck",
          properties: {
            completion_role: "buck_converter",
            device_uuid: "new-dev",
          },
        },
      ],
      pins: [],
      nets: [],
    },
    bindings: createBindings({
      componentBindings: [
        {
          draftComponentId: "u1",
          primitiveId: "prim-u1",
        },
      ],
    }),
  });

  assert.equal(patch.summary.replaceDeviceCount, 1);
  assert.equal(patch.summary.conflictCount, 1);
  assert.deepEqual(patch.operations, [
    {
      kind: "replace_component_device",
      componentId: "u1",
      primitiveId: "prim-u1",
      mode: "cross_class",
      keepRef: true,
      keepPlacement: true,
      nextDeviceUuid: "new-dev",
      nextLibraryUuid: undefined,
    },
    { kind: "mark_conflict", conflictId: "conflict-u1" },
  ]);
  assert.equal(patch.conflicts[0]?.type, "device_class_changed");
  assert.equal(patch.conflicts[0]?.componentRef, "U1");
});

test("buildDraftPatchPlan prefers stable id matching when ref changes", () => {
  const patch = buildDraftPatchPlan({
    previous: createPreviousSnapshot({
      components: [
        {
          id: "u1",
          ref: "U1",
          name: "LDO",
          properties: {
            completion_role: "regulator",
            device_uuid: "old-dev",
          },
        },
      ],
    }),
    next: {
      title: "draft",
      rationale: "r2",
      components: [
        {
          id: "u1",
          ref: "U9",
          name: "LDO",
          properties: {
            completion_role: "regulator",
            device_uuid: "new-dev",
          },
        },
      ],
      pins: [],
      nets: [],
    },
    bindings: createBindings({
      componentBindings: [
        {
          draftComponentId: "u1",
          ref: "U1",
          primitiveId: "prim-u1",
        },
      ],
    }),
  });

  assert.equal(patch.summary.addComponentCount, 0);
  assert.equal(patch.summary.removeComponentCount, 0);
  assert.deepEqual(patch.operations, [
    {
      kind: "replace_component_device",
      componentId: "u1",
      primitiveId: "prim-u1",
      mode: "same_class",
      keepRef: true,
      keepPlacement: true,
      nextDeviceUuid: "new-dev",
      nextLibraryUuid: undefined,
    },
  ]);
});

test("buildDraftPatchPlan does not treat missing completion_role as cross-class when ids match and device changes", () => {
  const patch = buildDraftPatchPlan({
    previous: createPreviousSnapshot({
      components: [
        {
          id: "u1",
          ref: "U1",
          name: "LDO",
          properties: {
            device_uuid: "old-dev",
          },
        },
      ],
    }),
    next: {
      title: "draft",
      rationale: "r2",
      components: [
        {
          id: "u1",
          ref: "U1",
          name: "LDO",
          properties: {
            device_uuid: "new-dev",
          },
        },
      ],
      pins: [],
      nets: [],
    },
    bindings: createBindings({
      componentBindings: [
        {
          draftComponentId: "u1",
          primitiveId: "prim-u1",
        },
      ],
    }),
  });

  assert.equal(patch.summary.replaceDeviceCount, 1);
  assert.equal(patch.summary.conflictCount, 0);
  assert.deepEqual(patch.operations, [
    {
      kind: "replace_component_device",
      componentId: "u1",
      primitiveId: "prim-u1",
      mode: "same_class",
      keepRef: true,
      keepPlacement: true,
      nextDeviceUuid: "new-dev",
      nextLibraryUuid: undefined,
    },
  ]);
});

test("buildDraftPatchPlan falls back to binding ref lookup when draft id binding is unavailable", () => {
  const patch = buildDraftPatchPlan({
    previous: createPreviousSnapshot({
      components: [
        {
          id: "u-old",
          ref: "U1",
          name: "Buck",
          properties: {
            completion_role: "regulator",
            device_uuid: "old-dev",
          },
        },
      ],
    }),
    next: {
      title: "draft",
      rationale: "r2",
      components: [
        {
          id: "u-next",
          ref: "U1",
          name: "Buck",
          properties: {
            completion_role: "buck_converter",
            device_uuid: "new-dev",
          },
        },
      ],
      pins: [],
      nets: [],
    },
    bindings: createBindings({
      componentBindings: [
        {
          draftComponentId: "stale-id",
          ref: "U1",
          primitiveId: "prim-u1",
        },
      ],
    }),
  });

  assert.deepEqual(patch.operations[0], {
    kind: "replace_component_device",
    componentId: "u-next",
    primitiveId: "prim-u1",
    mode: "cross_class",
    keepRef: true,
    keepPlacement: true,
    nextDeviceUuid: "new-dev",
    nextLibraryUuid: undefined,
  });
});
