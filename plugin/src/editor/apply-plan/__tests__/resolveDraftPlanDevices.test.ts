import { test } from "node:test";
import * as assert from "node:assert/strict";

import { generateDraftPlanFromPrompt } from "../generateDraftPlan";
import { buildDraftDeviceSearchQuery, resolveDraftPlanDevices } from "../resolveDraftPlanDevices";

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

  assert.equal(u1Bclk?.pinName, "BCLK");
  assert.equal(u1Bclk?.pinNumber, "12");
  assert.equal(u3Bclk?.pinName, "SCLK");
  assert.equal(u3Bclk?.pinNumber, "5");
  assert.equal(u1Lrck?.pinName, "LRCK");
  assert.equal(u3Lrck?.pinName, "LRCK");
  assert.deepEqual(resolved.nets[0]?.nodeIds, ["draft-u1-i2s-sck", "draft-u3-i2s-sck"]);
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
