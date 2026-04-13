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

  await assert.rejects(() => adapter.apply(draft), /unmapped required nets/i);
  assert.equal(wireCreateCount, 0);

  (globalThis as typeof globalThis & { eda?: unknown }).eda = originalEda;
});

test("createApiApplyPlanAdapter rolls back typed placed components when net mapping fails after placement", async () => {
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

  await assert.rejects(() => adapter.apply(draft), /unmapped required nets/i);
  assert.equal(deletedComponentIds.length > 0, true);
  assert.equal(deletedComponentIds[0]?.length, draft.components.length);

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
      },
      {
        id: "draft-b1-neg",
        componentId: "draft-b1",
        pinNumber: "2",
        pinName: "NEG",
        electricalType: "power_out",
      },
      {
        id: "draft-u2-bat",
        componentId: "draft-u2",
        pinNumber: "1",
        pinName: "BAT",
        electricalType: "power_in",
      },
      {
        id: "draft-u2-gnd",
        componentId: "draft-u2",
        pinNumber: "2",
        pinName: "GND",
        electricalType: "power_in",
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

test("createApiApplyPlanAdapter maps I2C semantic pin names to runtime SDA/SCL pins", async () => {
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
  assert.equal(result.netCount, 2);

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

test("createApiApplyPlanAdapter maps I2S semantic pin aliases such as I2S_SCK to runtime BCLK", async () => {
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
  assert.equal(result.netCount, 1);

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
