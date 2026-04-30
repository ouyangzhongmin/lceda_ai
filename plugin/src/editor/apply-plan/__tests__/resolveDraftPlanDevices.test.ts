import { test } from "node:test";
import * as assert from "node:assert/strict";

import { generateDraftPlanFromPrompt } from "../generateDraftPlan";
import {
  buildDraftDeviceSearchQuery,
  resolveDraftPlanDevices,
  summarizeLibraryDeviceDetailShape,
} from "../resolveDraftPlanDevices";

test("buildDraftDeviceSearchQuery infers practical library queries for LED drafts", () => {
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");

  assert.equal(buildDraftDeviceSearchQuery(draft.components[0]!), "header 2pin HDR-TH_1X2");
  assert.equal(buildDraftDeviceSearchQuery(draft.components[1]!), "150Ω resistor R0805");
  assert.equal(buildDraftDeviceSearchQuery(draft.components[2]!), "RED LED LED-TH_BD3.9-P2.54-RD_RED");
});

test("resolveDraftPlanDevices fills device/library UUIDs for unresolved draft components", async () => {
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  const resolved = await resolveDraftPlanDevices(draft, async (query) => {
    if (query.includes("header 2pin")) {
      return [{ uuid: "dev-j1", name: "HDR2", libraryUuid: "lib-j1", footprintName: "HDR-TH_1X2" }];
    }
    if (query.includes("resistor")) {
      return [{ uuid: "dev-r1", name: "R150", libraryUuid: "lib-r1", footprintName: "R0805" }];
    }
    if (query.includes("LED")) {
      return [{ uuid: "dev-d1", name: "LED", libraryUuid: "lib-d1", footprintName: "LED-TH_BD3.9-P2.54-RD_RED" }];
    }
    return [];
  });

  assert.equal(resolved.components[0]?.properties.device_uuid, "dev-j1");
  assert.equal(resolved.components[1]?.properties.device_uuid, "dev-r1");
  assert.equal(resolved.components[2]?.properties.device_uuid, "dev-d1");
  assert.equal(resolved.selectedDevices?.length, 3);
});

test("resolveDraftPlanDevices prefers a real 2-pin connector over unrelated multi-pin headers", async () => {
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  const resolved = await resolveDraftPlanDevices(draft, async (query) => {
    if (query.includes("header 2pin")) {
      return [
        { uuid: "wrong-j1", name: "HEADER10X2", libraryUuid: "lib-wrong", footprintName: "HEADER10X2B-2x2pin" },
        { uuid: "right-j1", name: "HEADER 1X2", libraryUuid: "lib-right", footprintName: "HDR-TH_1X2" },
      ];
    }
    return [];
  });

  assert.equal(resolved.components[0]?.properties.device_uuid, "right-j1");
});

test("resolveDraftPlanDevices prefers an exact 150R resistor over mismatched resistance values", async () => {
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  const resolved = await resolveDraftPlanDevices(draft, async (query) => {
    if (query.includes("resistor")) {
      return [
        { uuid: "wrong-r1", name: "0805W8F1511T5E", libraryUuid: "lib-wrong", footprintName: "R0805", description: "阻值:1.5kΩ" },
        { uuid: "right-r1", name: "0805W8F1500T5E", libraryUuid: "lib-right", footprintName: "R0805", description: "阻值:150Ω" },
      ];
    }
    return [];
  });

  assert.equal(resolved.components[1]?.properties.device_uuid, "right-r1");
});

test("resolveDraftPlanDevices annotates unresolved status when library search returns no results", async () => {
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  const resolved = await resolveDraftPlanDevices(draft, async (query) => {
    if (query.includes("header 2pin")) {
      return [];
    }
    return [{ uuid: "ok", name: "matched", libraryUuid: "lib-ok" }];
  });

  assert.equal(resolved.components[0]?.properties.device_resolution_status, "unresolved");
  assert.equal(resolved.components[0]?.properties.device_resolution_reason, "no_search_results");
});

test("resolveDraftPlanDevices annotates unresolved status when all connector candidates are filtered out", async () => {
  const draft = generateDraftPlanFromPrompt("帮我设计一个点亮LED的电路");
  const resolved = await resolveDraftPlanDevices(draft, async (query) => {
    if (query.includes("header 2pin")) {
      return [
        {
          uuid: "bad",
          name: "Connector_Female_10x2pin",
          libraryUuid: "lib-bad",
          footprintName: "CONN-SMD_20P-P2.00",
        },
      ];
    }
    return [{ uuid: "ok", name: "matched", libraryUuid: "lib-ok" }];
  });

  assert.equal(resolved.components[0]?.properties.device_resolution_status, "unresolved");
  assert.equal(resolved.components[0]?.properties.device_resolution_reason, "all_candidates_filtered");
});

test("resolveDraftPlanDevices rewrites semantic draft pins to real library pins when device detail is available", async () => {
  const draft = {
    title: "voice device",
    rationale: "test",
    components: [
      {
        id: "draft-u1",
        ref: "U1",
        name: "ESP32-S3-WROOM-1U",
        packageName: "WIRELM-SMD_ESP32-S3-WROOM-1U",
        value: "ESP32-S3",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          role: "mcu_module",
          preferred_search_query: "ESP32-S3-WROOM-1U",
        },
      },
      {
        id: "draft-u3",
        ref: "U3",
        name: "ES8388",
        packageName: "QFN-28_L4.0-W4.0-P0.45-BL-EP",
        value: "ES8388",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          role: "audio_codec",
          preferred_search_query: "ES8388",
        },
      },
    ],
    pins: [
      { id: "draft-u1-i2s-sck", componentId: "draft-u1", pinName: "I2S_SCK", electricalType: "bidirectional" },
      { id: "draft-u1-i2s-ws", componentId: "draft-u1", pinName: "I2S_WS", electricalType: "bidirectional" },
      { id: "draft-u3-i2s-sck", componentId: "draft-u3", pinName: "I2S_SCK", electricalType: "input" },
      { id: "draft-u3-i2s-ws", componentId: "draft-u3", pinName: "I2S_WS", electricalType: "input" },
    ],
    nets: [
      { id: "net-bclk", name: "I2S_SCK", nodeIds: ["draft-u1-i2s-sck", "draft-u3-i2s-sck"] },
      { id: "net-lrck", name: "I2S_LRCK", nodeIds: ["draft-u1-i2s-ws", "draft-u3-i2s-ws"] },
    ],
  } as any;

  const resolved = await resolveDraftPlanDevices(
    draft,
    async (query) => {
      if (query.includes("ESP32-S3")) {
        return [{ uuid: "dev-u1", name: "ESP32-S3-WROOM-1U", libraryUuid: "lib-u1", footprintName: "WIRELM-SMD_ESP32-S3-WROOM-1U" }];
      }
      if (query.includes("ES8388")) {
        return [{ uuid: "dev-u3", name: "ES8388", libraryUuid: "lib-u3", footprintName: "QFN-28_L4.0-W4.0-P0.45-BL-EP" }];
      }
      return [];
    },
    async ({ deviceUuid }) => {
      if (deviceUuid === "dev-u1") {
        return {
          uuid: "dev-u1",
          raw: {
            pins: [
              { id: "u1-bclk", pinName: "BCLK", pinNumber: "12" },
              { id: "u1-lrck", pinName: "LRCK", pinNumber: "13" },
            ],
          },
        };
      }
      if (deviceUuid === "dev-u3") {
        return {
          uuid: "dev-u3",
          raw: {
            pins: [
              { id: "u3-bclk", pinName: "SCLK", pinNumber: "5" },
              { id: "u3-lrck", pinName: "LRCK", pinNumber: "6" },
            ],
          },
        };
      }
      return null as any;
    }
  );

  const u1Bclk = resolved.pins.find((pin: any) => pin.id === "draft-u1-i2s-sck");
  const u3Bclk = resolved.pins.find((pin: any) => pin.id === "draft-u3-i2s-sck");
  const u1Lrck = resolved.pins.find((pin: any) => pin.id === "draft-u1-i2s-ws");
  const u3Lrck = resolved.pins.find((pin: any) => pin.id === "draft-u3-i2s-ws");

  assert.equal(u1Bclk?.pinName, "I2S_SCK");
  assert.equal(u1Bclk?.resolvedPinName, "BCLK");
  assert.equal(u1Bclk?.resolvedPinNumber, "12");
  assert.equal(u1Bclk?.pinResolutionStatus, "resolved");
  assert.equal(u3Bclk?.pinName, "I2S_SCK");
  assert.equal(u3Bclk?.resolvedPinName, "SCLK");
  assert.equal(u3Bclk?.resolvedPinNumber, "5");
  assert.equal(u3Bclk?.pinResolutionStatus, "resolved");
  assert.equal(u1Lrck?.pinName, "I2S_WS");
  assert.equal(u1Lrck?.resolvedPinName, "LRCK");
  assert.equal(u3Lrck?.pinName, "I2S_WS");
  assert.equal(u3Lrck?.resolvedPinName, "LRCK");
  assert.deepEqual(resolved.nets[0]?.nodeIds, ["draft-u1-i2s-sck", "draft-u3-i2s-sck"]);
});

test("resolveDraftPlanDevices preserves abstract LED pins while storing resolved runtime pin mapping", async () => {
  const draft = {
    title: "led test",
    rationale: "test",
    components: [
      {
        id: "draft-d1",
        ref: "D1",
        name: "LED",
        packageName: "LED0805",
        value: "RED",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          preferred_search_query: "RED LED LED0805",
        },
      },
    ],
    pins: [
      { id: "draft-d1-a", componentId: "draft-d1", pinName: "A", pinNumber: "1", electricalType: "passive" },
      { id: "draft-d1-c", componentId: "draft-d1", pinName: "C", pinNumber: "2", electricalType: "passive" },
    ],
    nets: [],
  } as any;

  const resolved = await resolveDraftPlanDevices(
    draft,
    async () => [{ uuid: "dev-d1", name: "LED0805", libraryUuid: "lib-d1", footprintName: "LED0805" }],
    async () => ({
      uuid: "dev-d1",
      raw: {
        pins: [
          { pinName: "A", pinNumber: "1", electricalType: "passive" },
          { pinName: "K", pinNumber: "2", electricalType: "passive" },
        ],
      },
    })
  );

  const anode = resolved.pins.find((pin: any) => pin.id === "draft-d1-a");
  const cathode = resolved.pins.find((pin: any) => pin.id === "draft-d1-c");

  assert.equal(anode?.pinName, "A");
  assert.equal(anode?.pinNumber, "1");
  assert.equal(anode?.resolvedPinName, "A");
  assert.equal(anode?.resolvedPinNumber, "1");
  assert.equal(anode?.pinResolutionStatus, "resolved");

  assert.equal(cathode?.pinName, "C");
  assert.equal(cathode?.pinNumber, "2");
  assert.equal(cathode?.resolvedPinName, "K");
  assert.equal(cathode?.resolvedPinNumber, "2");
  assert.equal(cathode?.pinResolutionStatus, "resolved");
});

test("resolveDraftPlanDevices reads library pins from nested raw symbol payloads", async () => {
  const draft = {
    title: "led nested symbol test",
    rationale: "test",
    components: [
      {
        id: "draft-d1",
        ref: "D1",
        name: "LED",
        packageName: "LED0805",
        value: "RED",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          preferred_search_query: "RED LED LED0805",
        },
      },
    ],
    pins: [
      { id: "draft-d1-a", componentId: "draft-d1", pinName: "A", pinNumber: "1", electricalType: "passive" },
      { id: "draft-d1-c", componentId: "draft-d1", pinName: "C", pinNumber: "2", electricalType: "passive" },
    ],
    nets: [],
  } as any;

  const resolved = await resolveDraftPlanDevices(
    draft,
    async () => [{ uuid: "dev-d1", name: "LED0805", libraryUuid: "lib-d1", footprintName: "LED0805" }],
    async () => ({
      uuid: "dev-d1",
      raw: {
        symbol: {
          pins: [
            { pinName: "A", pinNumber: "1", electricalType: "passive" },
            { pinName: "K", pinNumber: "2", electricalType: "passive" },
          ],
        },
      },
    })
  );

  const cathode = resolved.pins.find((pin: any) => pin.id === "draft-d1-c");
  assert.equal(cathode?.resolvedPinName, "K");
  assert.equal(cathode?.resolvedPinNumber, "2");
  assert.equal(cathode?.pinResolutionStatus, "resolved");
});

test("resolveDraftPlanDevices falls back to associated symbol detail when device detail has no pins", async () => {
  const draft = {
    title: "led symbol fallback test",
    rationale: "test",
    components: [
      {
        id: "draft-d1",
        ref: "D1",
        name: "LED",
        packageName: "LED0805",
        value: "RED",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          preferred_search_query: "RED LED LED0805",
        },
      },
    ],
    pins: [
      { id: "draft-d1-a", componentId: "draft-d1", pinName: "A", pinNumber: "1", electricalType: "passive" },
      { id: "draft-d1-k", componentId: "draft-d1", pinName: "K", pinNumber: "2", electricalType: "passive" },
    ],
    nets: [],
  } as any;

  const resolved = await resolveDraftPlanDevices(
    draft,
    async () => [
      {
        uuid: "dev-d1",
        name: "LED0805",
        libraryUuid: "lib-d1",
        symbolUuid: "sym-d1",
        footprintName: "LED0805",
      },
    ],
    async ({ deviceUuid }) => {
      if (deviceUuid !== "dev-d1") {
        return null as any;
      }
      return {
        uuid: "dev-d1",
        symbol: {
          uuid: "sym-d1",
          libraryUuid: "lib-d1",
        },
        raw: {
          association: {
            symbolUuid: "sym-d1",
          },
        },
      } as any;
    },
    async ({ symbolUuid }) => {
      if (symbolUuid !== "sym-d1") {
        return null as any;
      }
      return {
        uuid: "sym-d1",
        raw: {
          pins: [
            { pinName: "A", pinNumber: "1", electricalType: "passive" },
            { pinName: "K", pinNumber: "2", electricalType: "passive" },
          ],
        },
      } as any;
    }
  );

  const cathode = resolved.pins.find((pin: any) => pin.id === "draft-d1-k");
  assert.equal(cathode?.resolvedPinName, "K");
  assert.equal(cathode?.resolvedPinNumber, "2");
  assert.equal(cathode?.pinResolutionStatus, "resolved");
});

test("resolveDraftPlanDevices reads symbol pins from dataStr shape payload when explicit pin arrays are missing", async () => {
  const draft = {
    title: "datastr symbol fallback test",
    rationale: "test",
    components: [
      {
        id: "draft-d1",
        ref: "D1",
        name: "LED",
        packageName: "LED0805",
        value: "RED",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          preferred_search_query: "RED LED LED0805",
        },
      },
    ],
    pins: [
      { id: "draft-d1-a", componentId: "draft-d1", pinName: "A", pinNumber: "1", electricalType: "passive" },
      { id: "draft-d1-k", componentId: "draft-d1", pinName: "K", pinNumber: "2", electricalType: "passive" },
    ],
    nets: [],
  } as any;

  const resolved = await resolveDraftPlanDevices(
    draft,
    async () => [
      {
        uuid: "dev-d1",
        name: "LED0805",
        libraryUuid: "lib-d1",
        symbolUuid: "sym-d1",
        footprintName: "LED0805",
      },
    ],
    async ({ deviceUuid }) => {
      if (deviceUuid !== "dev-d1") {
        return null as any;
      }
      return {
        uuid: "dev-d1",
        symbol: {
          uuid: "sym-d1",
          libraryUuid: "lib-d1",
        },
        raw: {
          association: {
            symbolUuid: "sym-d1",
          },
        },
      } as any;
    },
    async ({ symbolUuid }) => {
      if (symbolUuid !== "sym-d1") {
        return null as any;
      }
      return {
        uuid: "sym-d1",
        raw: {
          dataStr: JSON.stringify({
            head: { docType: "symbol" },
            shape: [
              { pin: "A", num: "1", type: "passive" },
              { pin: "K", num: "2", type: "passive" },
            ],
          }),
        },
      } as any;
    }
  );

  const pinA = resolved.pins.find((pin: any) => pin.id === "draft-d1-a");
  const pinK = resolved.pins.find((pin: any) => pin.id === "draft-d1-k");
  assert.equal(pinA?.resolvedPinName, "A");
  assert.equal(pinA?.resolvedPinNumber, "1");
  assert.equal(pinA?.pinResolutionStatus, "resolved");
  assert.equal(pinK?.resolvedPinName, "K");
  assert.equal(pinK?.resolvedPinNumber, "2");
  assert.equal(pinK?.pinResolutionStatus, "resolved");
});

test("resolveDraftPlanDevices also reads symbol pins from documentSource payload variants", async () => {
  const draft = {
    title: "documentSource symbol fallback test",
    rationale: "test",
    components: [
      {
        id: "draft-d2",
        ref: "D2",
        name: "LED",
        packageName: "LED0805",
        value: "GREEN",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          preferred_search_query: "GREEN LED LED0805",
        },
      },
    ],
    pins: [
      { id: "draft-d2-a", componentId: "draft-d2", pinName: "A", pinNumber: "1", electricalType: "passive" },
      { id: "draft-d2-k", componentId: "draft-d2", pinName: "K", pinNumber: "2", electricalType: "passive" },
    ],
    nets: [],
  } as any;

  const resolved = await resolveDraftPlanDevices(
    draft,
    async () => [
      {
        uuid: "dev-d2",
        name: "LED0805",
        libraryUuid: "lib-d2",
        symbolUuid: "sym-d2",
        footprintName: "LED0805",
      },
    ],
    async () => ({
      uuid: "dev-d2",
      symbol: {
        uuid: "sym-d2",
        libraryUuid: "lib-d2",
      },
      raw: {
        association: {
          symbolUuid: "sym-d2",
        },
      },
    }) as any,
    async () => ({
      uuid: "sym-d2",
      raw: {
        documentSource: JSON.stringify({
          head: { docType: "symbol" },
          shape: [
            { pin: "A", num: "1", type: "passive" },
            { pin: "K", num: "2", type: "passive" },
          ],
        }),
      },
    }) as any
  );

  const pinA = resolved.pins.find((pin: any) => pin.id === "draft-d2-a");
  const pinK = resolved.pins.find((pin: any) => pin.id === "draft-d2-k");
  assert.equal(pinA?.resolvedPinName, "A");
  assert.equal(pinA?.resolvedPinNumber, "1");
  assert.equal(pinK?.resolvedPinName, "K");
  assert.equal(pinK?.resolvedPinNumber, "2");
});

test("resolveDraftPlanDevices reads associated nested symbol reference from host device metadata", async () => {
  const draft = {
    title: "capacitor symbol fallback test",
    rationale: "test",
    components: [
      {
        id: "draft-c1",
        ref: "C1",
        name: "Capacitor",
        packageName: "C0805",
        value: "100nF",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          preferred_search_query: "100nF capacitor C0805",
        },
      },
    ],
    pins: [
      { id: "draft-c1-1", componentId: "draft-c1", pinName: "1", electricalType: "passive" },
      { id: "draft-c1-2", componentId: "draft-c1", pinName: "2", electricalType: "passive" },
    ],
    nets: [],
  } as any;

  const resolved = await resolveDraftPlanDevices(
    draft,
    async () => [
      {
        uuid: "dev-c1",
        name: "C0805",
        libraryUuid: "lib-c1",
        footprintName: "C0805",
      },
    ],
    async ({ deviceUuid }) => {
      if (deviceUuid !== "dev-c1") {
        return null as any;
      }
      return {
        uuid: "dev-c1",
        raw: {
          association: {
            symbol: {
              uuid: "sym-c1",
              libraryUuid: "lib-sym-c1",
            },
          },
        },
      } as any;
    },
    async ({ symbolUuid, libraryUuid }) => {
      assert.equal(symbolUuid, "sym-c1");
      assert.equal(libraryUuid, "lib-sym-c1");
      return {
        uuid: "sym-c1",
        raw: {
          pins: [
            { pinName: "1", pinNumber: "1", electricalType: "passive" },
            { pinName: "2", pinNumber: "2", electricalType: "passive" },
          ],
        },
      } as any;
    }
  );

  const pin1 = resolved.pins.find((pin: any) => pin.id === "draft-c1-1");
  const pin2 = resolved.pins.find((pin: any) => pin.id === "draft-c1-2");
  assert.equal(pin1?.resolvedPinName, "1");
  assert.equal(pin1?.resolvedPinNumber, "1");
  assert.equal(pin1?.pinResolutionStatus, "resolved");
  assert.equal(pin2?.resolvedPinName, "2");
  assert.equal(pin2?.resolvedPinNumber, "2");
  assert.equal(pin2?.pinResolutionStatus, "resolved");
});

test("resolveDraftPlanDevices keeps draft pins resolved when selected passive device detail has no pins", async () => {
  const draft = {
    title: "selected passive fallback test",
    rationale: "test",
    components: [
      {
        id: "draft-c6",
        ref: "C6",
        name: "Capacitor",
        packageName: "C0603",
        value: "100nF",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          device_uuid: "cap-device",
          library_uuid: "cap-lib",
          device_resolution_status: "resolved",
          device_resolution_reason: "manual_selection",
        },
      },
    ],
    pins: [
      { id: "draft-c6-1", componentId: "draft-c6", pinName: "1", pinNumber: "1", electricalType: "passive" },
      { id: "draft-c6-2", componentId: "draft-c6", pinName: "2", pinNumber: "2", electricalType: "passive" },
    ],
    nets: [],
    selectedDevices: [
      {
        componentId: "draft-c6",
        componentRef: "C6",
        role: "input_capacitor",
        query: "100nF capacitor C0603",
        deviceUuid: "cap-device",
        libraryUuid: "cap-lib",
        name: "CC0603KRX7R9BB104",
        footprintName: "C0603",
      },
    ],
  } as any;

  const warnings: unknown[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    const resolved = await resolveDraftPlanDevices(
      draft,
      async () => [],
      async () => ({
        uuid: "cap-device",
        raw: {
          device: {
            uuid: "cap-device",
          },
        },
      })
    );

    const pin1 = resolved.pins.find((pin: any) => pin.id === "draft-c6-1");
    const pin2 = resolved.pins.find((pin: any) => pin.id === "draft-c6-2");
    assert.equal(pin1?.resolvedPinName, "1");
    assert.equal(pin1?.resolvedPinNumber, "1");
    assert.equal(pin1?.pinResolutionStatus, "resolved");
    assert.equal(pin1?.pinResolutionReason, "fallback_draft_pin_without_library_pins");
    assert.equal(pin2?.resolvedPinName, "2");
    assert.equal(pin2?.resolvedPinNumber, "2");
    assert.equal(pin2?.pinResolutionStatus, "resolved");
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 0);
});

test("buildDraftDeviceSearchQuery infers battery connector queries for BT refs", () => {
  const query = buildDraftDeviceSearchQuery({
    id: "draft-bt1",
    ref: "BT1",
    name: "Battery Connector",
    packageName: "",
    value: "",
    componentType: "part",
    addIntoBom: true,
    addIntoPcb: true,
    properties: {},
  } as any);

  assert.equal(query, "JST PH 2P battery connector");
});

test("resolveDraftPlanDevices falls back to alternative battery connector queries when the first search returns no results", async () => {
  const plan = {
    title: "battery",
    rationale: "battery connector test",
    components: [
      {
        id: "draft-bt1",
        ref: "BT1",
        name: "Battery Connector",
        packageName: "",
        value: "",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {},
      },
    ],
    pins: [],
    nets: [],
  } as any;

  const attemptedQueries: string[] = [];
  const resolved = await resolveDraftPlanDevices(plan, async (query) => {
    attemptedQueries.push(query);
    if (query === "JST PH 2P") {
      return [
        {
          uuid: "bt-dev-1",
          name: "PH2.0-2P",
          libraryUuid: "bt-lib-1",
          footprintName: "CONN-SMD_PH2.0-1X2PW",
        },
      ];
    }
    return [];
  });

  assert.deepEqual(attemptedQueries, ["JST PH 2P battery connector", "JST PH 2P"]);
  assert.equal(resolved.components[0]?.properties.device_uuid, "bt-dev-1");
  assert.equal(resolved.components[0]?.properties.preferred_search_query, "JST PH 2P");
  assert.equal(resolved.selectedDevices?.[0]?.role, "battery_connector");
});

test("summarizeLibraryDeviceDetailShape reports nested keys and string samples for debugging", () => {
  const summary = summarizeLibraryDeviceDetailShape({
    uuid: "dev-1",
    symbol: { name: "LED Symbol" },
    footprint: { name: "LED0805" },
    raw: {
      foo: 1,
      symbol: {
        pinTable: true,
      },
      dataStr: '{"head":{"docType":"symbol"},"shape":[{"pin":"A"}]}',
    },
  } as any);

  assert.equal(summary.hasDetail, true);
  assert.equal(summary.hasPinsArray, false);
  assert.deepEqual(summary.rawKeys, ["foo", "symbol", "dataStr"]);
  assert.deepEqual(summary.rawSymbolKeys, ["pinTable"]);
  assert.equal(summary.rawSymbolPinsArray, false);
  assert.match(String(summary.rawDataStrSample || ""), /docType/);
  assert.equal(summary.symbolName, "LED Symbol");
  assert.equal(summary.footprintName, "LED0805");
});

test("resolveDraftPlanDevices falls back to symbol source detail when device and symbol detail omit explicit pins", async () => {
  const draft = {
    title: "symbol source fallback",
    rationale: "test",
    components: [
      {
        id: "draft-u1",
        ref: "U1",
        name: "ip5306",
        packageName: "ESOP-8",
        value: "IP5306",
        componentType: "part",
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          device_uuid: "device-ip5306",
          library_uuid: "lib-lcsc",
        },
      },
    ],
    pins: [
      { id: "draft-u1-bat", componentId: "draft-u1", pinName: "BAT", electricalType: "power" },
      { id: "draft-u1-vin", componentId: "draft-u1", pinName: "VIN", electricalType: "power" },
    ],
    nets: [],
  } as any;

  const resolved = await resolveDraftPlanDevices(
    draft,
    async () => [],
    async () => ({
      uuid: "device-ip5306",
      libraryUuid: "lib-lcsc",
      symbol: {
        uuid: "symbol-ip5306",
        libraryUuid: "lib-lcsc",
      },
      raw: {
        symbol: {
          uuid: "symbol-ip5306",
        },
      },
    }),
    async () => ({
      uuid: "symbol-ip5306",
      libraryUuid: "lib-lcsc",
      raw: {
        result: {
          uuid: "symbol-ip5306",
        },
      },
    }),
    async () => ({
      uuid: "symbol-ip5306",
      libraryUuid: "lib-lcsc",
      raw: {
        documentSource: JSON.stringify({
          head: { docType: "symbol" },
          shape: [
            { pin: "VIN", num: "1", type: "power" },
            { pin: "BAT", num: "5", type: "power" },
          ],
        }),
      },
    })
  );

  const vinPin = resolved.pins.find((pin: any) => pin.id === "draft-u1-vin");
  const batPin = resolved.pins.find((pin: any) => pin.id === "draft-u1-bat");
  assert.equal(vinPin?.resolvedPinName, "VIN");
  assert.equal(vinPin?.resolvedPinNumber, "1");
  assert.equal(vinPin?.pinResolutionStatus, "resolved");
  assert.equal(batPin?.resolvedPinName, "BAT");
  assert.equal(batPin?.resolvedPinNumber, "5");
  assert.equal(batPin?.pinResolutionStatus, "resolved");
});
