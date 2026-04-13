import { test } from "node:test";
import * as assert from "node:assert/strict";

import { createDraftTools } from "../draftTools";

test("createDraftTools injects RAG guidance into draft generation when guidance is omitted", async () => {
  let buildCitationsCalled = false;
  const tools = createDraftTools({
    search: async () => ({
      results: [
        {
          chunk_id: "1",
          score: 0.9,
          title: "LED indicator",
          snippet: "推荐使用 2Pin header、150Ω 限流电阻、红色 LED。",
          source_ref: "kb://led",
          kb_type: "knowledge",
        },
      ],
    }),
    buildCitations: async () => ({
      ...(buildCitationsCalled = true, {}),
      query: "帮我设计一个点亮LED的电路 电路模板 器件选择 连接约束",
      results: [
        {
          chunk_id: "1",
          score: 0.9,
          title: "LED indicator",
          snippet: "推荐使用 2Pin header、150Ω 限流电阻、红色 LED。",
          source_ref: "kb://led-citation",
          kb_type: "knowledge",
        },
      ],
    }),
  } as any);
  const tool = tools.find((item) => item.name === "draft_generate_plan");
  if (!tool) throw new Error("draft_generate_plan missing");

  const plan = await tool.execute({ userQuery: "帮我设计一个点亮LED的电路" });

  assert.equal(plan.guidance?.templateId, "led_indicator_minimal");
  assert.equal(plan.components[0]?.properties.preferred_search_query, "header 1x2 2pin HDR-TH_1X2");
  assert.equal(buildCitationsCalled, true);
  assert.equal(plan.guidance?.evidence?.some((item) => item.sourceRef === "kb://led-citation"), true);
});

test("createDraftTools resolves concrete library devices before preview when search is available", async () => {
  const tools = createDraftTools(
    {
      search: async () => ({ results: [] }),
      buildCitations: async () => ({ query: "", results: [] }),
    } as any,
    async (input) => {
      if (input.query.includes("header")) {
        return [
          {
            uuid: "dev-j1",
            name: "CONN_1X2",
            libraryUuid: "lib-j1",
            symbolUuid: "sym-j1",
            footprintUuid: "fp-j1",
            footprintName: "HDR-TH_1X2",
          },
        ];
      }
      if (input.query.includes("150")) {
        return [
          {
            uuid: "dev-r1",
            name: "0805W8F1500T5E",
            libraryUuid: "lib-r1",
            symbolUuid: "sym-r1",
            footprintUuid: "fp-r1",
            footprintName: "R0805",
          },
        ];
      }
      return [
        {
          uuid: "dev-d1",
          name: "红色LED",
          libraryUuid: "lib-d1",
          symbolUuid: "sym-d1",
          footprintUuid: "fp-d1",
          footprintName: "LED-TH_BD3.0-P2.54-FD",
        },
      ];
    }
  );
  const tool = tools.find((item) => item.name === "draft_generate_plan");
  if (!tool) throw new Error("draft_generate_plan missing");

  const plan = await tool.execute({ userQuery: "帮我设计一个点亮LED的电路" });

  assert.equal(plan.selectedDevices?.length, 3);
  assert.equal(plan.components[0]?.properties.device_uuid, "dev-j1");
  assert.equal(plan.components[1]?.properties.device_uuid, "dev-r1");
  assert.equal(plan.components[2]?.properties.device_uuid, "dev-d1");
});

test("createDraftTools can convert llm-authored structured draft spec into a resolved plan", async () => {
  const tools = createDraftTools(
    {
      search: async () => ({ results: [] }),
      buildCitations: async () => ({ query: "", results: [] }),
    } as any,
    async (input) => {
      if (input.query.includes("ESP32-S3")) {
        return [
          {
            uuid: "dev-mcu",
            name: "ESP32-S3-WROOM-1",
            libraryUuid: "lib-mcu",
            symbolUuid: "sym-mcu",
            footprintUuid: "fp-mcu",
            footprintName: "RF-MODULE_ESP32-S3-WROOM-1",
          },
        ];
      }
      if (input.query.includes("ES8388")) {
        return [
          {
            uuid: "dev-codec",
            name: "ES8388",
            libraryUuid: "lib-codec",
            symbolUuid: "sym-codec",
            footprintUuid: "fp-codec",
            footprintName: "QFN-28_L4.0-W4.0-P0.45-BL-EP",
          },
        ];
      }
      if (input.query.includes("USB Type-C")) {
        return [
          {
            uuid: "dev-usbc",
            name: "USB3.1TYPE-C16P",
            libraryUuid: "lib-usbc",
            symbolUuid: "sym-usbc",
            footprintUuid: "fp-usbc",
            footprintName: "USB-C-SMD_TYPE-C-16PIN",
          },
        ];
      }
      return [];
    }
  );
  const tool = tools.find((item) => item.name === "draft_generate_plan");
  if (!tool) throw new Error("draft_generate_plan missing");

  const plan = await tool.execute({
    userQuery: "生成基于esp32-s3的小智语音聊天设备原理图",
    spec: {
      systemType: "esp32_s3_voice_device",
      title: "ESP32-S3 Voice Chat Device",
      rationale: "LLM authored structured voice-device spec.",
      components: [
        {
          id: "draft-u1",
          ref: "U1",
          role: "mcu_module",
          name: "ESP32-S3 Module",
          value: "ESP32-S3",
          packageName: "RF-MODULE_ESP32-S3-WROOM-1",
          searchQuery: "ESP32-S3-WROOM-1",
          placement: { x: 320, y: 220 },
          pins: [
            { id: "draft-u1-3v3", pinName: "3V3", electricalType: "power_in" },
            { id: "draft-u1-gnd", pinName: "GND", electricalType: "power_in" },
            { id: "draft-u1-io40", pinName: "IO40", electricalType: "bidirectional" },
          ],
        },
        {
          id: "draft-u2",
          ref: "U2",
          role: "audio_codec",
          name: "Audio Codec",
          value: "ES8388",
          packageName: "QFN-28_L4.0-W4.0-P0.45-BL-EP",
          searchQuery: "ES8388 audio codec",
          placement: { x: 520, y: 220 },
          pins: [
            { id: "draft-u2-dout", pinName: "DOUT", electricalType: "output" },
            { id: "draft-u2-gnd", pinName: "GND", electricalType: "power_in" },
          ],
        },
        {
          id: "draft-j1",
          ref: "J1",
          role: "usb_type_c",
          name: "USB Type-C",
          value: "USB-C",
          packageName: "USB-C-SMD_TYPE-C-16PIN",
          searchQuery: "USB Type-C 接口",
          placement: { x: 120, y: 220 },
          pins: [
            { id: "draft-j1-vbus", pinName: "VBUS", electricalType: "power_out" },
            { id: "draft-j1-gnd", pinName: "GND", electricalType: "power_in" },
          ],
        },
      ],
      nets: [
        { id: "net-3v3", name: "3V3", isPower: true },
        { id: "net-gnd", name: "GND", isPower: true },
        { id: "net-i2s-do", name: "I2S_DO" },
      ],
      connections: [
        { netName: "3V3", pinIds: ["draft-u1-3v3"] },
        { netName: "GND", pinIds: ["draft-u1-gnd", "draft-u2-gnd", "draft-j1-gnd"] },
        { netName: "I2S_DO", pinIds: ["draft-u1-io40", "draft-u2-dout"] },
      ],
    },
  });

  assert.equal(plan.title, "ESP32-S3 Voice Chat Device");
  assert.equal(plan.components.some((component) => component.ref === "U1"), true);
  assert.equal(plan.components.some((component) => component.ref === "U2"), true);
  assert.equal(plan.components.some((component) => component.ref === "J1"), true);
  assert.equal(plan.title === "5V LED Indicator Draft", false);
  assert.equal(plan.title === "5V to 3.3V LDO Draft", false);
  assert.equal(plan.nets.some((net) => net.name === "I2S_DO"), true);
});

test("createDraftTools rewrites structured spec pins against real library device pins when available", async () => {
  const tools = createDraftTools(
    {
      search: async () => ({ results: [] }),
      buildCitations: async () => ({ query: "", results: [] }),
    } as any,
    async (input) => {
      if (input.query.includes("ESP32-S3")) {
        return [
          {
            uuid: "dev-mcu",
            name: "ESP32-S3-WROOM-1U",
            libraryUuid: "lib-mcu",
            footprintName: "WIRELM-SMD_ESP32-S3-WROOM-1U",
          },
        ];
      }
      if (input.query.includes("ES8388")) {
        return [
          {
            uuid: "dev-codec",
            name: "ES8388",
            libraryUuid: "lib-codec",
            footprintName: "QFN-28_L4.0-W4.0-P0.45-BL-EP",
          },
        ];
      }
      return [];
    },
    async ({ deviceUuid }) => {
      if (deviceUuid === "dev-mcu") {
        return {
          uuid: "dev-mcu",
          pins: [
            { pinName: "BCLK", pinNumber: "12" },
            { pinName: "LRCK", pinNumber: "13" },
          ],
        } as any;
      }
      if (deviceUuid === "dev-codec") {
        return {
          uuid: "dev-codec",
          pins: [
            { pinName: "SCLK", pinNumber: "5" },
            { pinName: "LRCK", pinNumber: "6" },
          ],
        } as any;
      }
      throw new Error(`unexpected device: ${deviceUuid}`);
    }
  );
  const tool = tools.find((item) => item.name === "draft_generate_plan");
  if (!tool) throw new Error("draft_generate_plan missing");

  const plan = await tool.execute({
    userQuery: "生成基于esp32-s3的小智语音聊天设备原理图",
    planningMode: "structured_spec_required",
    spec: {
      systemType: "esp32_s3_voice_device",
      title: "ESP32-S3 Voice Chat Device",
      rationale: "LLM authored structured voice-device spec.",
      components: [
        {
          id: "draft-u1",
          ref: "U1",
          role: "mcu_module",
          name: "ESP32-S3 Module",
          packageName: "WIRELM-SMD_ESP32-S3-WROOM-1U",
          searchQuery: "ESP32-S3-WROOM-1U",
          pins: [
            { id: "draft-u1-i2s-sck", pinName: "I2S_SCK", electricalType: "bidirectional" },
            { id: "draft-u1-i2s-ws", pinName: "I2S_WS", electricalType: "bidirectional" },
          ],
        },
        {
          id: "draft-u2",
          ref: "U2",
          role: "audio_codec",
          name: "Audio Codec",
          packageName: "QFN-28_L4.0-W4.0-P0.45-BL-EP",
          searchQuery: "ES8388",
          pins: [
            { id: "draft-u2-i2s-sck", pinName: "I2S_SCK", electricalType: "input" },
            { id: "draft-u2-i2s-ws", pinName: "I2S_WS", electricalType: "input" },
          ],
        },
      ],
      nets: [
        { id: "net-bclk", name: "I2S_SCK" },
        { id: "net-lrck", name: "I2S_LRCK" },
      ],
      connections: [
        { netName: "I2S_SCK", pinIds: ["draft-u1-i2s-sck", "draft-u2-i2s-sck"] },
        { netName: "I2S_LRCK", pinIds: ["draft-u1-i2s-ws", "draft-u2-i2s-ws"] },
      ],
    },
  });

  assert.equal(plan.pins.find((pin) => pin.id === "draft-u1-i2s-sck")?.pinName, "BCLK");
  assert.equal(plan.pins.find((pin) => pin.id === "draft-u1-i2s-sck")?.pinNumber, "12");
  assert.equal(plan.pins.find((pin) => pin.id === "draft-u2-i2s-sck")?.pinName, "SCLK");
  assert.equal(plan.pins.find((pin) => pin.id === "draft-u2-i2s-sck")?.pinNumber, "5");

  const previewTool = tools.find((item) => item.name === "draft_preview_plan");
  if (!previewTool) throw new Error("draft_preview_plan missing");
  const preview = await previewTool.execute({ plan });
  assert.equal(preview.selectedDeviceDetails?.some((item: string) => item.includes("pins=2")), true);
  assert.equal(preview.selectedDeviceDetails?.some((item: string) => item.includes("pin_sample=12:BCLK, 13:LRCK")), true);
});

test("createDraftTools rejects structured_spec_required draft requests without llm-authored spec", async () => {
  const tools = createDraftTools(
    {
      search: async () => ({ results: [] }),
      buildCitations: async () => ({ query: "", results: [] }),
    } as any,
    async () => []
  );
  const tool = tools.find((item) => item.name === "draft_generate_plan");
  if (!tool) throw new Error("draft_generate_plan missing");

  await assert.rejects(
    () =>
      tool.execute({
        userQuery: "帮我设计一个基于ESP32-S3的带锂电池及充电一体的小智语音聊天设备原理图",
        planningMode: "structured_spec_required",
      }),
    /planningMode=structured_spec_required requires llm-authored spec/i
  );
});

test("createDraftTools surfaces readable spec validation error when connection pinIds is missing", async () => {
  const tools = createDraftTools(
    {
      search: async () => ({ results: [] }),
      buildCitations: async () => ({ query: "", results: [] }),
    } as any,
    async () => []
  );
  const tool = tools.find((item) => item.name === "draft_generate_plan");
  if (!tool) throw new Error("draft_generate_plan missing");

  await assert.rejects(
    () =>
      tool.execute({
        userQuery: "生成基于esp32-s3的小智语音聊天设备原理图",
        planningMode: "structured_spec_required",
        spec: {
          systemType: "esp32_s3_voice_device",
          title: "Broken Spec",
          rationale: "broken",
          components: [
            {
              id: "draft-u1",
              ref: "U1",
              role: "mcu_module",
              pins: [{ id: "draft-u1-3v3", pinName: "3V3" }],
            },
          ],
          nets: [{ id: "net-3v3", name: "3V3", isPower: true }],
          connections: [{ netName: "3V3" }],
        } as any,
      }),
    /invalid draft spec: connections\[0\]\.pinIds must be an array/i
  );
});

test("createDraftTools rejects malformed structured_spec_required spec instead of silently falling back to generic draft", async () => {
  const tools = createDraftTools(
    {
      search: async () => ({ results: [] }),
      buildCitations: async () => ({ query: "", results: [] }),
    } as any,
    async () => []
  );
  const tool = tools.find((item) => item.name === "draft_generate_plan");
  if (!tool) throw new Error("draft_generate_plan missing");

  await assert.rejects(
    () =>
      tool.execute({
        userQuery: "帮我设计一个基于esp32-s3的带锂电池及充电一体的小智语音聊天设备原理图",
        planningMode: "structured_spec_required",
        spec: {
          systemType: "智能语音聊天设备",
          title: "ESP32-S3锂电池充电语音设备",
          rationale: "bad shape",
          components: {
            main_mcu: "ESP32-S3-WROOM-1U",
          },
          powerNets: ["VCC_5V", "VCC_BAT"],
          connections: ["USB->TP4056"],
        } as any,
      }),
    /planningMode=structured_spec_required requires spec to match DraftDesignSpec/i
  );
});
