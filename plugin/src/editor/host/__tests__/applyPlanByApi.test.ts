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

test("createApiApplyPlanAdapter rejects typed placement when required nets cannot be fully mapped", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async () => ({
        getState_PrimitiveId: () => "cmp-1",
      }),
      getAllPinsByPrimitiveId: async () => [
        {
          getState_PinName: () => "1",
          getState_PinNumber: () => "1",
          getState_X: () => 100,
          getState_Y: () => 100,
          getState_PrimitiveId: () => "pin-1",
        },
      ],
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-1",
      }),
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  for (const component of draft.components) {
    component.properties.device_uuid = `${component.id}-device`;
    component.properties.library_uuid = `${component.id}-library`;
  }

  await assert.rejects(() => adapter.apply(draft), /unmapped required nets/i);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter writes back designators when typed placement succeeds", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  const assignedDesignators: string[] = [];
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async () => ({
        getState_PrimitiveId: () => "cmp-1",
        setState_Designator: (value: string) => {
          assignedDesignators.push(value);
        },
      }),
      getAllPinsByPrimitiveId: async () => [
        {
          getState_PinName: () => "1",
          getState_PinNumber: () => "1",
          getState_X: () => 100,
          getState_Y: () => 100,
          getState_PrimitiveId: () => "pin-1",
        },
        {
          getState_PinName: () => "2",
          getState_PinNumber: () => "2",
          getState_X: () => 140,
          getState_Y: () => 100,
          getState_PrimitiveId: () => "pin-2",
        },
      ],
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-1",
      }),
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  for (const component of draft.components) {
    component.properties.device_uuid = `${component.id}-device`;
    component.properties.library_uuid = `${component.id}-library`;
  }

  await adapter.apply(draft);

  assert.equal(assignedDesignators.includes("J1"), true);
  assert.equal(assignedDesignators.includes("R1"), true);
  assert.equal(assignedDesignators.includes("D1"), true);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter rejects typed placement when guidance requiredConnections cannot be resolved", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async () => ({
        getState_PrimitiveId: () => `cmp-${Math.random()}`,
      }),
      getAllPinsByPrimitiveId: async () => [
        {
          getState_PinName: () => "1",
          getState_PinNumber: () => "1",
          getState_X: () => 100,
          getState_Y: () => 100,
          getState_PrimitiveId: () => `pin-${Math.random()}`,
        },
        {
          getState_PinName: () => "2",
          getState_PinNumber: () => "2",
          getState_X: () => 140,
          getState_Y: () => 100,
          getState_PrimitiveId: () => `pin-${Math.random()}`,
        },
      ],
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-1",
      }),
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  draft.guidance = {
    templateId: "led_indicator_minimal",
    rationale: "test",
    requiredConnections: [
      {
        fromComponentRef: "X1",
        fromPin: "1",
        toComponentRef: "R1",
        toPin: "1",
        netName: "5V",
      },
    ],
  };
  for (const component of draft.components) {
    component.properties.device_uuid = `${component.id}-device`;
    component.properties.library_uuid = `${component.id}-library`;
  }

  await assert.rejects(() => adapter.apply(draft), /required connection unresolved/i);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});
