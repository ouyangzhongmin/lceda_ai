import { test } from "node:test";
import * as assert from "node:assert/strict";

import { createApiApplyPlanAdapter } from "../applyPlanByApi";
import { generateDraftPlanFromPrompt } from "../../apply-plan/generateDraftPlan";
import { resolveHostEditorBridge } from "../runtime";

function markAllPinsResolved<T extends { pins: Array<Record<string, any>> }>(draft: T): T {
  for (const pin of draft.pins) {
    pin.resolvedPinName = pin.pinName ?? pin.resolvedPinName;
    pin.resolvedPinNumber = pin.pinNumber ?? pin.resolvedPinNumber;
    pin.resolvedElectricalType = pin.electricalType ?? pin.resolvedElectricalType;
    pin.pinResolutionStatus = "resolved";
  }
  return draft;
}

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

test("createApiApplyPlanAdapter applies typed placement and reports skipped required nets when some endpoints cannot be mapped", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  let wireCreateCount = 0;
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
      create: async () => {
        wireCreateCount += 1;
        return {
          getState_PrimitiveId: () => "wire-1",
        };
      },
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  for (const component of draft.components) {
    component.properties.device_uuid = `${component.id}-device`;
    component.properties.library_uuid = `${component.id}-library`;
  }
  markAllPinsResolved(draft);

  const result = await adapter.apply(draft);
  assert.equal(result.applied, true);
  assert.equal((result.partialWiring?.skippedConnectionCount ?? 0) > 0, true);
  assert.equal((result.partialWiring?.connectedNetCount ?? 0) >= 0, true);
  assert.equal(wireCreateCount <= draft.nets.length, true);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter does not roll back typed placed components when some nets are skipped", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  const deletedComponentIds: string[][] = [];
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (...args: unknown[]) => {
        const payload = args[0] as { uuid?: string };
        return {
          getState_PrimitiveId: () => `cmp-${payload.uuid}`,
        };
      },
      getAllPinsByPrimitiveId: async () => [
        {
          getState_PinName: () => "1",
          getState_PinNumber: () => "1",
          getState_X: () => 100,
          getState_Y: () => 100,
          getState_PrimitiveId: () => "pin-1",
        },
      ],
      delete: async (ids: string[]) => {
        deletedComponentIds.push(ids.slice());
        return true;
      },
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-1",
      }),
      delete: async () => true,
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  for (const component of draft.components) {
    component.properties.device_uuid = `${component.id}-device`;
    component.properties.library_uuid = `${component.id}-library`;
  }
  markAllPinsResolved(draft);

  const result = await adapter.apply(draft);
  assert.equal(result.applied, true);
  assert.equal((result.partialWiring?.skippedConnectionCount ?? 0) > 0, true);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter applies components and skips unresolved connections instead of failing", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  const createdWireNames: string[] = [];
  const createdPlacedComponentIds: string[] = [];
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => {
        const primitiveId = `cmp-${payload.uuid}`;
        if (payload.uuid === "resistor-device" || payload.uuid === "led-device") {
          createdPlacedComponentIds.push(primitiveId);
        }
        return {
          getState_PrimitiveId: () => primitiveId,
        };
      },
      getAllPinsByPrimitiveId: async (primitiveId: string) => {
        if (primitiveId.includes("led-device")) {
          return [
            {
              getState_PinName: () => "A",
              getState_PinNumber: () => "1",
              getState_X: () => 100,
              getState_Y: () => 100,
              getState_PrimitiveId: () => "pin-led-a",
            },
          ];
        }
        return [
          {
            getState_PinName: () => "1",
            getState_PinNumber: () => "1",
            getState_X: () => 200,
            getState_Y: () => 100,
            getState_PrimitiveId: () => "pin-r1-1",
          },
          {
            getState_PinName: () => "2",
            getState_PinNumber: () => "2",
            getState_X: () => 240,
            getState_Y: () => 100,
            getState_PrimitiveId: () => "pin-r1-2",
          },
        ];
      },
      delete: async () => true,
    },
    sch_PrimitiveWire: {
      create: async (_line: number[], netName?: string) => {
        createdWireNames.push(String(netName || ""));
        return {
          getState_PrimitiveId: () => `wire-${createdWireNames.length}`,
        };
      },
      delete: async () => true,
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = {
    title: "partial wiring",
    rationale: "test",
    components: [
      {
        id: "draft-r1",
        ref: "R1",
        properties: {
          device_uuid: "resistor-device",
          library_uuid: "resistor-lib",
        },
      },
      {
        id: "draft-d1",
        ref: "D1",
        properties: {
          device_uuid: "led-device",
          library_uuid: "led-lib",
        },
      },
    ],
    pins: [
      {
        id: "draft-r1-1",
        componentId: "draft-r1",
        pinNumber: "1",
        pinName: "1",
        resolvedPinNumber: "1",
        resolvedPinName: "1",
        pinResolutionStatus: "resolved",
      },
      {
        id: "draft-r1-2",
        componentId: "draft-r1",
        pinNumber: "2",
        pinName: "2",
        resolvedPinNumber: "2",
        resolvedPinName: "2",
        pinResolutionStatus: "resolved",
      },
      {
        id: "draft-d1-a",
        componentId: "draft-d1",
        pinNumber: "1",
        pinName: "A",
        resolvedPinNumber: "1",
        resolvedPinName: "A",
        pinResolutionStatus: "resolved",
      },
      {
        id: "draft-d1-k",
        componentId: "draft-d1",
        pinNumber: "2",
        pinName: "K",
        pinResolutionStatus: "unresolved",
      },
    ],
    nets: [
      {
        id: "net-signal",
        name: "SIG",
        nodeIds: ["draft-r1-1", "draft-d1-a"],
      },
      {
        id: "net-gnd",
        name: "GND",
        nodeIds: ["draft-r1-2", "draft-d1-k"],
      },
    ],
  } as any;

  const result = await adapter.apply(draft);

  assert.equal(result.applied, true);
  assert.equal(new Set(createdPlacedComponentIds).size, 2);
  assert.deepEqual(createdWireNames, ["SIG"]);
  assert.equal(result.partialWiring?.connectedNetCount, 1);
  assert.equal(result.partialWiring?.skippedConnectionCount, 1);
  assert.equal(result.partialWiring?.skippedConnections?.[0]?.netName, "GND");

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter still succeeds when components are placed even if pin metadata is incomplete", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  const createdPlacedComponentIds: string[] = [];
  let createdWireCount = 0;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => {
        if (payload.uuid === "u1-device" || payload.uuid === "u2-device") {
          createdPlacedComponentIds.push(`cmp-${payload.uuid}`);
        }
        return {
          getState_PrimitiveId: () => `cmp-${payload.uuid}`,
        };
      },
      getAllPinsByPrimitiveId: async (_primitiveId: string) => [
        {
          getState_PinName: () => "1",
          getState_PinNumber: () => "1",
          getState_X: () => 100,
          getState_Y: () => 100,
          getState_PrimitiveId: () => "pin-only-1",
        },
      ],
      delete: async () => true,
    },
    sch_PrimitiveWire: {
      create: async () => {
        createdWireCount += 1;
        return {
          getState_PrimitiveId: () => `wire-${createdWireCount}`,
        };
      },
      delete: async () => true,
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = {
    title: "all skipped",
    rationale: "test",
    components: [
      {
        id: "draft-u1",
        ref: "U1",
        properties: {
          device_uuid: "u1-device",
          library_uuid: "u1-lib",
        },
      },
      {
        id: "draft-u2",
        ref: "U2",
        properties: {
          device_uuid: "u2-device",
          library_uuid: "u2-lib",
        },
      },
    ],
    pins: [
      {
        id: "draft-u1-out",
        componentId: "draft-u1",
        pinNumber: "1",
        pinName: "OUT",
        pinResolutionStatus: "unresolved",
      },
      {
        id: "draft-u2-in",
        componentId: "draft-u2",
        pinNumber: "1",
        pinName: "IN",
        pinResolutionStatus: "unresolved",
      },
    ],
    nets: [
      {
        id: "net-vout",
        name: "VOUT",
        nodeIds: ["draft-u1-out", "draft-u2-in"],
      },
    ],
  } as any;

  const result = await adapter.apply(draft);

  assert.equal(result.applied, true);
  assert.equal(createdPlacedComponentIds.length > 0, true);
  assert.equal((result.partialWiring?.connectedNetCount ?? 0) >= 0, true);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter places power on the left, controller in the middle, and audio path on the right by default", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  const placements = new Map<string, { x: number; y: number }>();
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }, x: number, y: number) => {
        placements.set(String(payload.uuid || ""), { x, y });
        return {
          getState_PrimitiveId: () => `cmp-${payload.uuid}`,
        };
      },
      getAllPinsByPrimitiveId: async (primitiveId: string) => [
        {
          getState_PinName: () => "1",
          getState_PinNumber: () => "1",
          getState_X: () => placements.get(primitiveId.replace(/^cmp-/, ""))?.x ?? 0,
          getState_Y: () => placements.get(primitiveId.replace(/^cmp-/, ""))?.y ?? 0,
          getState_PrimitiveId: () => `pin-${primitiveId}-1`,
        },
      ],
      delete: async () => true,
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-1",
      }),
      delete: async () => true,
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = {
    title: "functional layout",
    rationale: "test",
    components: [
      {
        id: "draft-b1",
        ref: "B1",
        name: "battery",
        properties: {
          device_uuid: "battery-device",
          library_uuid: "power-lib",
        },
      },
      {
        id: "draft-u1",
        ref: "U1",
        name: "charger",
        properties: {
          device_uuid: "charger-device",
          library_uuid: "power-lib",
        },
      },
      {
        id: "draft-u2",
        ref: "U2",
        name: "esp32-s3",
        properties: {
          device_uuid: "mcu-device",
          library_uuid: "mcu-lib",
        },
      },
      {
        id: "draft-u3",
        ref: "U3",
        name: "audio codec",
        properties: {
          device_uuid: "codec-device",
          library_uuid: "audio-lib",
        },
      },
      {
        id: "draft-u4",
        ref: "U4",
        name: "speaker amp",
        properties: {
          device_uuid: "amp-device",
          library_uuid: "audio-lib",
        },
      },
    ],
    pins: [
      { id: "p1", componentId: "draft-b1", pinName: "1", pinNumber: "1", resolvedPinName: "1", resolvedPinNumber: "1", pinResolutionStatus: "resolved" },
      { id: "p2", componentId: "draft-u1", pinName: "1", pinNumber: "1", resolvedPinName: "1", resolvedPinNumber: "1", pinResolutionStatus: "resolved" },
      { id: "p3", componentId: "draft-u2", pinName: "1", pinNumber: "1", resolvedPinName: "1", resolvedPinNumber: "1", pinResolutionStatus: "resolved" },
      { id: "p4", componentId: "draft-u3", pinName: "1", pinNumber: "1", resolvedPinName: "1", resolvedPinNumber: "1", pinResolutionStatus: "resolved" },
      { id: "p5", componentId: "draft-u4", pinName: "1", pinNumber: "1", resolvedPinName: "1", resolvedPinNumber: "1", pinResolutionStatus: "resolved" },
    ],
    nets: [
      { id: "n1", name: "VBAT", nodeIds: ["p1", "p2"] },
      { id: "n2", name: "3V3", nodeIds: ["p2", "p3"] },
      { id: "n3", name: "I2S", nodeIds: ["p3", "p4"] },
      { id: "n4", name: "SPK", nodeIds: ["p4", "p5"] },
    ],
  } as any;

  const result = await adapter.apply(draft);

  assert.equal(result.applied, true);
  assert.equal((placements.get("battery-device")?.x ?? 0) < (placements.get("mcu-device")?.x ?? 0), true);
  assert.equal((placements.get("charger-device")?.x ?? 0) < (placements.get("mcu-device")?.x ?? 0), true);
  assert.equal((placements.get("codec-device")?.x ?? 0) > (placements.get("mcu-device")?.x ?? 0), true);
  assert.equal((placements.get("amp-device")?.x ?? 0) >= (placements.get("codec-device")?.x ?? 0), true);

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
  markAllPinsResolved(draft);

  await adapter.apply(draft);

  assert.equal(assignedDesignators.includes("J1"), true);
  assert.equal(assignedDesignators.includes("R1"), true);
  assert.equal(assignedDesignators.includes("D1"), true);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter maps battery holder POS/NEG pins to runtime BAT+/BAT- aliases", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => ({
        getState_PrimitiveId: () => `cmp-${payload.uuid}`,
      }),
      getAllPinsByPrimitiveId: async (primitiveId: string) => {
        if (primitiveId.includes("battery-device")) {
          return [
            {
              getState_PinName: () => "BAT+",
              getState_PinNumber: () => "P",
              getState_X: () => 100,
              getState_Y: () => 100,
              getState_PrimitiveId: () => "pin-bat-plus",
            },
            {
              getState_PinName: () => "BAT-",
              getState_PinNumber: () => "N",
              getState_X: () => 100,
              getState_Y: () => 140,
              getState_PrimitiveId: () => "pin-bat-minus",
            },
          ];
        }
        return [
          {
            getState_PinName: () => "BAT",
            getState_PinNumber: () => "1",
            getState_X: () => 220,
            getState_Y: () => 100,
            getState_PrimitiveId: () => "pin-chg-bat",
          },
          {
            getState_PinName: () => "GND",
            getState_PinNumber: () => "2",
            getState_X: () => 220,
            getState_Y: () => 140,
            getState_PrimitiveId: () => "pin-chg-gnd",
          },
        ];
      },
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-1",
      }),
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = {
    title: "battery test",
    rationale: "test",
    components: [
      {
        id: "draft-b1",
        ref: "B1",
        properties: {
          device_uuid: "battery-device",
          library_uuid: "battery-lib",
        },
      },
      {
        id: "draft-u2",
        ref: "U2",
        properties: {
          device_uuid: "charger-device",
          library_uuid: "charger-lib",
        },
      },
    ],
    pins: [
      {
        id: "draft-b1-pos",
        componentId: "draft-b1",
        pinNumber: "1",
        pinName: "POS",
        electricalType: "power_out",
        resolvedPinName: "BAT+",
        resolvedPinNumber: "P",
        pinResolutionStatus: "resolved",
      },
      {
        id: "draft-b1-neg",
        componentId: "draft-b1",
        pinNumber: "2",
        pinName: "NEG",
        electricalType: "power_out",
        resolvedPinName: "BAT-",
        resolvedPinNumber: "N",
        pinResolutionStatus: "resolved",
      },
      {
        id: "draft-u2-bat",
        componentId: "draft-u2",
        pinNumber: "1",
        pinName: "BAT",
        electricalType: "power_in",
        resolvedPinName: "BAT",
        resolvedPinNumber: "1",
        pinResolutionStatus: "resolved",
      },
      {
        id: "draft-u2-gnd",
        componentId: "draft-u2",
        pinNumber: "2",
        pinName: "GND",
        electricalType: "power_in",
        resolvedPinName: "GND",
        resolvedPinNumber: "2",
        pinResolutionStatus: "resolved",
      },
    ],
    nets: [
      {
        id: "net-bat",
        name: "BAT_3V7",
        nodeIds: ["draft-b1-pos", "draft-u2-bat"],
        isPower: true,
      },
      {
        id: "net-gnd",
        name: "GND",
        nodeIds: ["draft-b1-neg", "draft-u2-gnd"],
        isPower: true,
      },
    ],
  } as any;

  const result = await adapter.apply(draft);

  assert.equal(result.applied, true);
  assert.equal(result.netCount, 2);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter prefers resolved runtime pin mapping over abstract draft pin labels", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => ({
        getState_PrimitiveId: () => `cmp-${payload.uuid}`,
      }),
      getAllPinsByPrimitiveId: async () => [
        {
          getState_PinName: () => "A",
          getState_PinNumber: () => "1",
          getState_X: () => 100,
          getState_Y: () => 100,
          getState_PrimitiveId: () => "pin-led-anode",
        },
        {
          getState_PinName: () => "K",
          getState_PinNumber: () => "2",
          getState_X: () => 100,
          getState_Y: () => 140,
          getState_PrimitiveId: () => "pin-led-cathode",
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
  const draft = {
    title: "led resolved pin test",
    rationale: "test",
    components: [
      {
        id: "draft-d1",
        ref: "D1",
        properties: {
          device_uuid: "led-device",
          library_uuid: "led-lib",
        },
      },
      {
        id: "draft-j1",
        ref: "J1",
        properties: {
          device_uuid: "conn-device",
          library_uuid: "conn-lib",
        },
      },
    ],
    pins: [
      {
        id: "draft-j1-pos",
        componentId: "draft-j1",
        pinName: "POS",
        pinNumber: "1",
        resolvedPinName: "1",
        resolvedPinNumber: "1",
        pinResolutionStatus: "resolved",
      },
      {
        id: "draft-j1-neg",
        componentId: "draft-j1",
        pinName: "NEG",
        pinNumber: "2",
        resolvedPinName: "2",
        resolvedPinNumber: "2",
        pinResolutionStatus: "resolved",
      },
      {
        id: "draft-d1-a",
        componentId: "draft-d1",
        pinName: "PIN_ALPHA",
        pinNumber: "11",
        resolvedPinName: "A",
        resolvedPinNumber: "1",
        pinResolutionStatus: "resolved",
      },
      {
        id: "draft-d1-c",
        componentId: "draft-d1",
        pinName: "PIN_BETA",
        pinNumber: "22",
        resolvedPinName: "K",
        resolvedPinNumber: "2",
        pinResolutionStatus: "resolved",
      },
    ],
    nets: [
      {
        id: "net-vcc",
        name: "3V3",
        nodeIds: ["draft-j1-pos", "draft-d1-a"],
        isPower: true,
      },
      {
        id: "net-gnd",
        name: "GND",
        nodeIds: ["draft-j1-neg", "draft-d1-c"],
        isPower: true,
      },
    ],
  } as any;

  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => ({
        getState_PrimitiveId: () => `cmp-${payload.uuid}`,
      }),
      getAllPinsByPrimitiveId: async (primitiveId: string) => {
        if (primitiveId.includes("header-device")) {
          return [
            {
              getState_PinName: () => "1",
              getState_PinNumber: () => "1",
              getState_X: () => 20,
              getState_Y: () => 20,
              getState_PrimitiveId: () => "pin-j1-1",
            },
            {
              getState_PinName: () => "2",
              getState_PinNumber: () => "2",
              getState_X: () => 20,
              getState_Y: () => 60,
              getState_PrimitiveId: () => "pin-j1-2",
            },
          ];
        }
        return [
          {
            getState_PinName: () => "A",
            getState_PinNumber: () => "1",
            getState_X: () => 100,
            getState_Y: () => 100,
            getState_PrimitiveId: () => "pin-led-anode",
          },
          {
            getState_PinName: () => "K",
            getState_PinNumber: () => "2",
            getState_X: () => 100,
            getState_Y: () => 140,
            getState_PrimitiveId: () => "pin-led-cathode",
          },
        ];
      },
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-1",
      }),
    },
  };

  const result = await adapter.apply(draft);

  assert.equal(result.applied, true);
  assert.equal(result.netCount, 2);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter enriches missing pin mappings through host symbol lookup before typed placement", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  const originalBridge = (globalThis as typeof globalThis & { LCEDA_HOST_BRIDGE?: unknown }).LCEDA_HOST_BRIDGE;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => ({
        getState_PrimitiveId: () => `cmp-${payload.uuid}`,
      }),
      getAllPinsByPrimitiveId: async (primitiveId: string) => {
        if (primitiveId.includes("draft-j1-device")) {
          return [
            {
              getState_PinName: () => "VCC",
              getState_PinNumber: () => "1",
              getState_X: () => 80,
              getState_Y: () => 80,
              getState_PrimitiveId: () => "pin-j1-vcc",
            },
            {
              getState_PinName: () => "GND",
              getState_PinNumber: () => "2",
              getState_X: () => 80,
              getState_Y: () => 120,
              getState_PrimitiveId: () => "pin-j1-gnd",
            },
          ];
        }
        if (primitiveId.includes("draft-r1-device")) {
          return [
            {
              getState_PinName: () => "1",
              getState_PinNumber: () => "1",
              getState_X: () => 180,
              getState_Y: () => 80,
              getState_PrimitiveId: () => "pin-r1-1",
            },
            {
              getState_PinName: () => "2",
              getState_PinNumber: () => "2",
              getState_X: () => 220,
              getState_Y: () => 80,
              getState_PrimitiveId: () => "pin-r1-2",
            },
          ];
        }
        return [
          {
            getState_PinName: () => "A",
            getState_PinNumber: () => "1",
            getState_X: () => 320,
            getState_Y: () => 80,
            getState_PrimitiveId: () => "pin-d1-a",
          },
          {
            getState_PinName: () => "K",
            getState_PinNumber: () => "2",
            getState_X: () => 320,
            getState_Y: () => 120,
            getState_PrimitiveId: () => "pin-d1-k",
          },
        ];
      },
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-1",
      }),
    },
  };

  (globalThis as typeof globalThis & { LCEDA_HOST_BRIDGE?: unknown }).LCEDA_HOST_BRIDGE = {
    getLibraryDevice: async ({ deviceUuid }: { deviceUuid: string }) => ({
      uuid: deviceUuid,
      raw: {
        association: {
          symbolUuid: `${deviceUuid}-symbol`,
        },
      },
    }),
    getLibrarySymbol: async ({ symbolUuid }: { symbolUuid: string }) => {
      if (symbolUuid.includes("draft-j1-device")) {
        return {
          uuid: symbolUuid,
          raw: {
            pins: [
              { pinName: "VCC", pinNumber: "1", electricalType: "passive" },
              { pinName: "GND", pinNumber: "2", electricalType: "passive" },
            ],
          },
        } as any;
      }
      if (symbolUuid.includes("draft-r1-device")) {
        return {
          uuid: symbolUuid,
          raw: {
            pins: [
              { pinName: "1", pinNumber: "1", electricalType: "passive" },
              { pinName: "2", pinNumber: "2", electricalType: "passive" },
            ],
          },
        } as any;
      }
      return {
        uuid: symbolUuid,
        raw: {
          pins: [
            { pinName: "A", pinNumber: "1", electricalType: "passive" },
            { pinName: "K", pinNumber: "2", electricalType: "passive" },
          ],
        },
      } as any;
    },
  };

  assert.ok(resolveHostEditorBridge()?.getLibrarySymbol);

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  for (const component of draft.components) {
    component.properties.device_uuid = `${component.id}-device`;
    component.properties.library_uuid = `${component.id}-library`;
  }

  const result = await adapter.apply(draft);

  assert.equal(result.applied, true);
  assert.equal(result.componentCount, 3);
  assert.equal(result.netCount, 3);

  (globalThis as typeof globalThis & { LCEDA_HOST_BRIDGE?: unknown }).LCEDA_HOST_BRIDGE = originalBridge;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter enriches missing pin mappings through transient placement before typed placement", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  const deletedComponentIds: string[][] = [];
  const createdWireLabels: string[] = [];
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => ({
        getState_PrimitiveId: () => `cmp-${payload.uuid}`,
      }),
      getAllPinsByPrimitiveId: async (primitiveId: string) => {
        if (primitiveId.includes("draft-j1-device")) {
          return [
            {
              getState_PinName: () => "VCC",
              getState_PinNumber: () => "1",
              getState_X: () => 80,
              getState_Y: () => 80,
              getState_PrimitiveId: () => "pin-j1-vcc",
            },
            {
              getState_PinName: () => "GND",
              getState_PinNumber: () => "2",
              getState_X: () => 80,
              getState_Y: () => 120,
              getState_PrimitiveId: () => "pin-j1-gnd",
            },
          ];
        }
        if (primitiveId.includes("draft-r1-device")) {
          return [
            {
              getState_PinName: () => "1",
              getState_PinNumber: () => "1",
              getState_X: () => 180,
              getState_Y: () => 80,
              getState_PrimitiveId: () => "pin-r1-1",
            },
            {
              getState_PinName: () => "2",
              getState_PinNumber: () => "2",
              getState_X: () => 220,
              getState_Y: () => 80,
              getState_PrimitiveId: () => "pin-r1-2",
            },
          ];
        }
        return [
          {
            getState_PinName: () => "A",
            getState_PinNumber: () => "1",
            getState_X: () => 320,
            getState_Y: () => 80,
            getState_PrimitiveId: () => "pin-d1-a",
          },
          {
            getState_PinName: () => "K",
            getState_PinNumber: () => "2",
            getState_X: () => 320,
            getState_Y: () => 120,
            getState_PrimitiveId: () => "pin-d1-k",
          },
        ];
      },
      delete: async (ids: string[]) => {
        deletedComponentIds.push(ids.slice());
        return true;
      },
    },
    sch_PrimitiveWire: {
      create: async (_line: number[], name?: string) => {
        createdWireLabels.push(String(name || ""));
        return {
          getState_PrimitiveId: () => `wire-${createdWireLabels.length}`,
        };
      },
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  for (const component of draft.components) {
    component.properties.device_uuid = `${component.id}-device`;
    component.properties.library_uuid = `${component.id}-library`;
  }

  const result = await adapter.apply(draft);

  assert.equal(result.applied, true);
  assert.equal(result.componentCount, 3);
  assert.equal(result.netCount, 3);
  assert.equal(createdWireLabels.includes("3V3") || createdWireLabels.includes("5V") || createdWireLabels.includes("VCC"), true);
  assert.equal(createdWireLabels.includes("GND"), true);
  assert.equal(deletedComponentIds.length > 0, true);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter skips connections when a draft pin has no resolved library pin mapping", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => ({
        getState_PrimitiveId: () => `cmp-${payload.uuid}`,
      }),
      getAllPinsByPrimitiveId: async (primitiveId: string) => {
        if (primitiveId.includes("header-device")) {
          return [
            {
              getState_PinName: () => "1",
              getState_PinNumber: () => "1",
              getState_X: () => 20,
              getState_Y: () => 20,
              getState_PrimitiveId: () => "pin-j1-1",
            },
            {
              getState_PinName: () => "2",
              getState_PinNumber: () => "2",
              getState_X: () => 20,
              getState_Y: () => 60,
              getState_PrimitiveId: () => "pin-j1-2",
            },
          ];
        }
        return [
          {
            getState_PinName: () => "A",
            getState_PinNumber: () => "1",
            getState_X: () => 100,
            getState_Y: () => 100,
            getState_PrimitiveId: () => "pin-led-anode",
          },
          {
            getState_PinName: () => "K",
            getState_PinNumber: () => "2",
            getState_X: () => 100,
            getState_Y: () => 140,
            getState_PrimitiveId: () => "pin-led-cathode",
          },
        ];
      },
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-1",
      }),
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = {
    title: "led unresolved pin test",
    rationale: "test",
    components: [
      {
        id: "draft-d1",
        ref: "D1",
        properties: {
          device_uuid: "led-device",
          library_uuid: "led-lib",
        },
      },
      {
        id: "draft-j1",
        ref: "J1",
        properties: {
          device_uuid: "header-device",
          library_uuid: "conn-lib",
        },
      },
    ],
    pins: [
      {
        id: "draft-j1-pos",
        componentId: "draft-j1",
        pinName: "PIN_PWR_1",
        pinNumber: "101",
        resolvedPinName: "1",
        resolvedPinNumber: "1",
        pinResolutionStatus: "resolved",
      },
      {
        id: "draft-j1-neg",
        componentId: "draft-j1",
        pinName: "PIN_PWR_2",
        pinNumber: "102",
        resolvedPinName: "2",
        resolvedPinNumber: "2",
        pinResolutionStatus: "resolved",
      },
      {
        id: "draft-d1-a",
        componentId: "draft-d1",
        pinName: "PIN_ALPHA",
        pinNumber: "11",
      },
      {
        id: "draft-d1-c",
        componentId: "draft-d1",
        pinName: "PIN_BETA",
        pinNumber: "22",
      },
    ],
    nets: [
      {
        id: "net-vcc",
        name: "3V3",
        nodeIds: ["draft-j1-pos", "draft-d1-a"],
        isPower: true,
      },
      {
        id: "net-gnd",
        name: "GND",
        nodeIds: ["draft-j1-neg", "draft-d1-c"],
        isPower: true,
      },
    ],
  } as any;

  const result = await adapter.apply(draft);
  assert.equal(result.applied, true);
  assert.equal(result.partialWiring?.connectedNetCount, 0);
  assert.equal(result.partialWiring?.skippedConnectionCount, 2);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter auto-resolves draft pins from library detail before typed placement", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  const originalBridge = (globalThis as typeof globalThis & { LCEDA_HOST_BRIDGE?: unknown }).LCEDA_HOST_BRIDGE;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => ({
        getState_PrimitiveId: () => `cmp-${payload.uuid}`,
      }),
      getAllPinsByPrimitiveId: async (primitiveId: string) => {
        if (primitiveId.includes("header-device")) {
          return [
            {
              getState_PinName: () => "1",
              getState_PinNumber: () => "1",
              getState_X: () => 20,
              getState_Y: () => 20,
              getState_PrimitiveId: () => "pin-j1-1",
            },
            {
              getState_PinName: () => "2",
              getState_PinNumber: () => "2",
              getState_X: () => 20,
              getState_Y: () => 60,
              getState_PrimitiveId: () => "pin-j1-2",
            },
          ];
        }
        return [
          {
            getState_PinName: () => "A",
            getState_PinNumber: () => "1",
            getState_X: () => 100,
            getState_Y: () => 100,
            getState_PrimitiveId: () => "pin-led-anode",
          },
          {
            getState_PinName: () => "K",
            getState_PinNumber: () => "2",
            getState_X: () => 100,
            getState_Y: () => 140,
            getState_PrimitiveId: () => "pin-led-cathode",
          },
        ];
      },
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-1",
      }),
    },
  };
  (globalThis as typeof globalThis & { LCEDA_HOST_BRIDGE?: unknown }).LCEDA_HOST_BRIDGE = {
    getLibraryDevice: async ({ deviceUuid }: { deviceUuid: string }) => {
      if (deviceUuid === "led-device") {
        return {
          uuid: "led-device",
          pins: [
            { pinName: "A", pinNumber: "1", electricalType: "passive" },
            { pinName: "K", pinNumber: "2", electricalType: "passive" },
          ],
        };
      }
      if (deviceUuid === "header-device") {
        return {
          uuid: "header-device",
          pins: [
            { pinName: "1", pinNumber: "1", electricalType: "passive" },
            { pinName: "2", pinNumber: "2", electricalType: "passive" },
          ],
        };
      }
      return null;
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = {
    title: "auto resolve before apply",
    rationale: "test",
    components: [
      {
        id: "draft-d1",
        ref: "D1",
        properties: {
          device_uuid: "led-device",
          library_uuid: "led-lib",
        },
      },
      {
        id: "draft-j1",
        ref: "J1",
        properties: {
          device_uuid: "header-device",
          library_uuid: "conn-lib",
        },
      },
    ],
    pins: [
      {
        id: "draft-j1-pos",
        componentId: "draft-j1",
        pinName: "POS",
        pinNumber: "1",
      },
      {
        id: "draft-j1-neg",
        componentId: "draft-j1",
        pinName: "NEG",
        pinNumber: "2",
      },
      {
        id: "draft-d1-a",
        componentId: "draft-d1",
        pinName: "A",
        pinNumber: "1",
      },
      {
        id: "draft-d1-c",
        componentId: "draft-d1",
        pinName: "C",
        pinNumber: "2",
      },
    ],
    nets: [
      {
        id: "net-vcc",
        name: "3V3",
        nodeIds: ["draft-j1-pos", "draft-d1-a"],
        isPower: true,
      },
      {
        id: "net-gnd",
        name: "GND",
        nodeIds: ["draft-j1-neg", "draft-d1-c"],
        isPower: true,
      },
    ],
  } as any;

  const result = await adapter.apply(draft);

  assert.equal(result.applied, true);
  assert.equal(result.netCount, 2);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
  (globalThis as typeof globalThis & { LCEDA_HOST_BRIDGE?: unknown }).LCEDA_HOST_BRIDGE = originalBridge;
});

test("createApiApplyPlanAdapter skips connections when a draft pin is explicitly marked unresolved", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => ({
        getState_PrimitiveId: () => `cmp-${payload.uuid}`,
      }),
      getAllPinsByPrimitiveId: async () => [
        {
          getState_PinName: () => "1",
          getState_PinNumber: () => "1",
          getState_X: () => 20,
          getState_Y: () => 20,
          getState_PrimitiveId: () => "pin-1",
        },
        {
          getState_PinName: () => "2",
          getState_PinNumber: () => "2",
          getState_X: () => 20,
          getState_Y: () => 60,
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
  const draft = {
    title: "pin status unresolved",
    rationale: "test",
    components: [
      {
        id: "draft-j1",
        ref: "J1",
        properties: {
          device_uuid: "header-device",
          library_uuid: "conn-lib",
        },
      },
    ],
    pins: [
      {
        id: "draft-j1-1",
        componentId: "draft-j1",
        pinName: "P1",
        pinNumber: "1",
        resolvedPinName: "1",
        resolvedPinNumber: "1",
        pinResolutionStatus: "resolved",
      },
      {
        id: "draft-j1-2",
        componentId: "draft-j1",
        pinName: "P2",
        pinNumber: "2",
        resolvedPinName: "2",
        resolvedPinNumber: "2",
        pinResolutionStatus: "unresolved",
        pinResolutionReason: "no_matching_library_pin",
      },
    ],
    nets: [
      {
        id: "net-test",
        name: "TEST",
        nodeIds: ["draft-j1-1", "draft-j1-2"],
      },
    ],
  } as any;

  const result = await adapter.apply(draft);
  assert.equal(result.applied, true);
  assert.equal(result.partialWiring?.connectedNetCount, 0);
  assert.equal(result.partialWiring?.skippedConnectionCount, 1);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter skips I2C connections when draft pins still cannot be mapped", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => ({
        getState_PrimitiveId: () => `cmp-${payload.uuid}`,
      }),
      getAllPinsByPrimitiveId: async (primitiveId: string) => {
        if (primitiveId.includes("mcu-device")) {
          return [
            {
              getState_PinName: () => "SDA",
              getState_PinNumber: () => "21",
              getState_X: () => 100,
              getState_Y: () => 100,
              getState_PrimitiveId: () => "pin-mcu-sda",
            },
            {
              getState_PinName: () => "SCL",
              getState_PinNumber: () => "22",
              getState_X: () => 100,
              getState_Y: () => 140,
              getState_PrimitiveId: () => "pin-mcu-scl",
            },
          ];
        }
        return [
          {
            getState_PinName: () => "SDA",
            getState_PinNumber: () => "5",
            getState_X: () => 220,
            getState_Y: () => 100,
            getState_PrimitiveId: () => "pin-codec-sda",
          },
          {
            getState_PinName: () => "SCL",
            getState_PinNumber: () => "6",
            getState_X: () => 220,
            getState_Y: () => 140,
            getState_PrimitiveId: () => "pin-codec-scl",
          },
        ];
      },
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-1",
      }),
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = {
    title: "i2c test",
    rationale: "test",
    components: [
      {
        id: "draft-u1",
        ref: "U1",
        properties: {
          device_uuid: "mcu-device",
          library_uuid: "mcu-lib",
        },
      },
      {
        id: "draft-u3",
        ref: "U3",
        properties: {
          device_uuid: "codec-device",
          library_uuid: "codec-lib",
        },
      },
    ],
    pins: [
      {
        id: "draft-u1-i2c-sda",
        componentId: "draft-u1",
        pinName: "I2C_SDA",
        electricalType: "bidirectional",
      },
      {
        id: "draft-u1-i2c-scl",
        componentId: "draft-u1",
        pinName: "I2C_SCL",
        electricalType: "bidirectional",
      },
      {
        id: "draft-u3-i2c-sda",
        componentId: "draft-u3",
        pinName: "I2C_SDA",
        electricalType: "bidirectional",
      },
      {
        id: "draft-u3-i2c-scl",
        componentId: "draft-u3",
        pinName: "I2C_SCL",
        electricalType: "bidirectional",
      },
    ],
    nets: [
      {
        id: "net-sda",
        name: "I2C_SDA",
        nodeIds: ["draft-u1-i2c-sda", "draft-u3-i2c-sda"],
      },
      {
        id: "net-scl",
        name: "I2C_SCL",
        nodeIds: ["draft-u1-i2c-scl", "draft-u3-i2c-scl"],
      },
    ],
  } as any;

  const result = await adapter.apply(draft);
  assert.equal(result.applied, true);
  assert.equal(result.partialWiring?.connectedNetCount, 0);
  assert.equal(result.partialWiring?.skippedConnectionCount, 4);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter reports skipped requiredConnections instead of failing", async () => {
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
  markAllPinsResolved(draft);

  const result = await adapter.apply(draft);
  assert.equal(result.applied, true);
  assert.equal(result.partialWiring?.connectedNetCount, 3);
  assert.equal(result.partialWiring?.skippedConnectionCount, 1);
  assert.equal(
    result.partialWiring?.skippedConnections?.some((item) => item.reason === "required_connection_definition_unresolved"),
    true
  );

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter skips I2S connections when draft pins still cannot be mapped", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => ({
        getState_PrimitiveId: () => `cmp-${payload.uuid}`,
      }),
      getAllPinsByPrimitiveId: async (primitiveId: string) => {
        if (primitiveId.includes("mcu-device")) {
          return [
            {
              getState_PinName: () => "BCLK",
              getState_PinNumber: () => "12",
              getState_X: () => 100,
              getState_Y: () => 100,
              getState_PrimitiveId: () => "pin-mcu-bclk",
            },
          ];
        }
        return [
          {
            getState_PinName: () => "SCLK",
            getState_PinNumber: () => "7",
            getState_X: () => 220,
            getState_Y: () => 100,
            getState_PrimitiveId: () => "pin-codec-sclk",
          },
        ];
      },
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-i2s",
      }),
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = {
    title: "i2s alias test",
    rationale: "test",
    components: [
      {
        id: "draft-u1",
        ref: "U1",
        properties: {
          device_uuid: "mcu-device",
          library_uuid: "mcu-lib",
        },
      },
      {
        id: "draft-u3",
        ref: "U3",
        properties: {
          device_uuid: "codec-device",
          library_uuid: "codec-lib",
        },
      },
    ],
    pins: [
      {
        id: "draft-u1-i2s-sck",
        componentId: "draft-u1",
        pinName: "I2S_SCK",
        electricalType: "output",
      },
      {
        id: "draft-u3-i2s-sck",
        componentId: "draft-u3",
        pinName: "I2S_SCK",
        electricalType: "input",
      },
    ],
    nets: [
      {
        id: "net-i2s-sck",
        name: "I2S_SCK",
        nodeIds: ["draft-u1-i2s-sck", "draft-u3-i2s-sck"],
      },
    ],
  } as any;

  const result = await adapter.apply(draft);
  assert.equal(result.applied, true);
  assert.equal(result.partialWiring?.connectedNetCount, 0);
  assert.equal(result.partialWiring?.skippedConnectionCount, 2);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter skips LED connections when draft pins still cannot be mapped", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async (payload: { uuid?: string }) => ({
        getState_PrimitiveId: () => `cmp-${payload.uuid}`,
      }),
      getAllPinsByPrimitiveId: async (primitiveId: string) => {
        if (primitiveId.includes("led-device")) {
          return [
            {
              getState_PinName: () => "A",
              getState_PinNumber: () => "1",
              getState_X: () => 220,
              getState_Y: () => 100,
              getState_PrimitiveId: () => "pin-led-a",
            },
            {
              getState_PinName: () => "K",
              getState_PinNumber: () => "2",
              getState_X: () => 220,
              getState_Y: () => 140,
              getState_PrimitiveId: () => "pin-led-k",
            },
          ];
        }
        return [
          {
            getState_PinName: () => "1",
            getState_PinNumber: () => "1",
            getState_X: () => 100,
            getState_Y: () => 100,
            getState_PrimitiveId: () => "pin-r1-1",
          },
          {
            getState_PinName: () => "2",
            getState_PinNumber: () => "2",
            getState_X: () => 140,
            getState_Y: () => 100,
            getState_PrimitiveId: () => "pin-r1-2",
          },
        ];
      },
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-led",
      }),
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = {
    title: "led alias test",
    rationale: "test",
    components: [
      {
        id: "draft-r1",
        ref: "R1",
        properties: {
          device_uuid: "resistor-device",
          library_uuid: "resistor-lib",
        },
      },
      {
        id: "draft-d1",
        ref: "D1",
        properties: {
          device_uuid: "led-device",
          library_uuid: "led-lib",
        },
      },
    ],
    pins: [
      {
        id: "draft-r1-1",
        componentId: "draft-r1",
        pinName: "1",
        pinNumber: "1",
        electricalType: "passive",
      },
      {
        id: "draft-r1-2",
        componentId: "draft-r1",
        pinName: "2",
        pinNumber: "2",
        electricalType: "passive",
      },
      {
        id: "draft-d1-a",
        componentId: "draft-d1",
        pinName: "A",
        electricalType: "passive",
        netName: "LED_NET",
      },
      {
        id: "draft-d1-c",
        componentId: "draft-d1",
        pinName: "C",
        electricalType: "passive",
        netName: "GND",
      },
    ],
    nets: [
      {
        id: "net-led",
        name: "LED_NET",
        nodeIds: ["draft-r1-2", "draft-d1-a"],
      },
      {
        id: "net-gnd",
        name: "GND",
        isPower: true,
        nodeIds: ["draft-r1-1", "draft-d1-c"],
      },
    ],
  } as any;

  const result = await adapter.apply(draft);
  assert.equal(result.applied, true);
  assert.equal(result.partialWiring?.connectedNetCount, 0);
  assert.equal(result.partialWiring?.skippedConnectionCount, 4);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter does not enter typed placement when some draft components still lack placement devices", async () => {
  const originalEda = (globalThis as typeof globalThis & { eda?: unknown }).eda;
  let typedCreateCalled = false;
  (globalThis as typeof globalThis & { eda?: unknown }).eda = {
    sch_PrimitiveComponent: {
      create: async () => {
        typedCreateCalled = true;
        return {
          getState_PrimitiveId: () => "cmp-1",
        };
      },
      getAllPinsByPrimitiveId: async () => [],
    },
    sch_PrimitiveWire: {
      create: async () => ({
        getState_PrimitiveId: () => "wire-1",
      }),
    },
  };

  const adapter = createApiApplyPlanAdapter(undefined, { typedPlacementEnabled: true });
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  draft.components[0]!.properties.device_uuid = "j1-device";
  draft.components[0]!.properties.library_uuid = "j1-library";

  await assert.rejects(
    () => adapter.apply(draft),
    /typed placement requires all draft components to have resolved devices/i
  );
  assert.equal(typedCreateCalled, false);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});
