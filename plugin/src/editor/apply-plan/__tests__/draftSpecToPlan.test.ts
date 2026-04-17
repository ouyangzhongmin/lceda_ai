import { test } from "node:test";
import * as assert from "node:assert/strict";

import { draftSpecToPlan } from "../draftSpecToPlan";
import type { DraftDesignSpec } from "../draftPlan";

function createVoiceDeviceSpec(): DraftDesignSpec {
  return {
    systemType: "voice_device",
    title: "ESP32-S3 Voice Device",
    rationale: "test",
    components: [
      {
        id: "usb",
        ref: "J1",
        role: "usb_port",
        name: "USB Type-C",
        pins: [
          { id: "usb-vbus", pinName: "VBUS", electricalType: "power_out" },
          { id: "usb-gnd", pinName: "GND", electricalType: "power_out" },
        ],
      },
      {
        id: "charger",
        ref: "U2",
        role: "battery_charger",
        name: "TP4056X",
        pins: [
          { id: "chg-vin", pinName: "VIN", electricalType: "power_in" },
          { id: "chg-bat", pinName: "BAT", electricalType: "power_out" },
          { id: "chg-gnd", pinName: "GND", electricalType: "power_in" },
        ],
      },
      {
        id: "mcu",
        ref: "U1",
        role: "main_mcu",
        name: "ESP32-S3-WROOM-1U",
        pins: [
          { id: "mcu-3v3", pinName: "3V3", electricalType: "power_in" },
          { id: "mcu-gnd", pinName: "GND", electricalType: "power_in" },
          { id: "mcu-scl", pinName: "GPIO1", electricalType: "bidirectional" },
          { id: "mcu-sda", pinName: "GPIO2", electricalType: "bidirectional" },
          { id: "mcu-bclk", pinName: "GPIO3", electricalType: "output" },
          { id: "mcu-ws", pinName: "GPIO4", electricalType: "output" },
          { id: "mcu-sdout", pinName: "GPIO5", electricalType: "output" },
          { id: "mcu-sdin", pinName: "GPIO6", electricalType: "input" },
        ],
      },
      {
        id: "codec",
        ref: "U3",
        role: "audio_codec",
        name: "ES8311-S",
        pins: [
          { id: "codec-3v3", pinName: "VDD", electricalType: "power_in" },
          { id: "codec-gnd", pinName: "GND", electricalType: "power_in" },
          { id: "codec-scl", pinName: "SCL", electricalType: "input" },
          { id: "codec-sda", pinName: "SDA", electricalType: "bidirectional" },
          { id: "codec-bclk", pinName: "BCLK", electricalType: "input" },
          { id: "codec-lrck", pinName: "LRCK", electricalType: "input" },
          { id: "codec-dac", pinName: "DACDAT", electricalType: "input" },
          { id: "codec-adc", pinName: "ADCDAT", electricalType: "output" },
        ],
      },
      {
        id: "mic",
        ref: "MK1",
        role: "microphone",
        name: "MEMS Mic",
        pins: [
          { id: "mic-3v3", pinName: "VDD", electricalType: "power_in" },
          { id: "mic-gnd", pinName: "GND", electricalType: "power_in" },
          { id: "mic-out", pinName: "OUT", electricalType: "output" },
        ],
      },
      {
        id: "spk",
        ref: "SPK1",
        role: "speaker",
        name: "Speaker",
        pins: [
          { id: "spk-p", pinName: "SPK+", electricalType: "input" },
          { id: "spk-n", pinName: "SPK-", electricalType: "input" },
        ],
      },
      {
        id: "btn",
        ref: "SW1",
        role: "button",
        name: "Button",
        pins: [
          { id: "btn-1", pinName: "1", electricalType: "passive" },
          { id: "btn-2", pinName: "2", electricalType: "passive" },
        ],
      },
    ],
    nets: [
      { id: "net-usb-5v", name: "VCC_5V", isPower: true },
      { id: "net-bat", name: "VBAT_SYS", isPower: true },
      { id: "net-3v3", name: "VCC_3V3", isPower: true },
      { id: "net-gnd", name: "GND", isPower: true },
      { id: "net-scl", name: "I2C_SCL" },
      { id: "net-sda", name: "I2C_SDA" },
      { id: "net-bclk", name: "I2S_BCLK" },
      { id: "net-lrck", name: "I2S_WS" },
      { id: "net-dout", name: "I2S_DOUT" },
      { id: "net-din", name: "I2S_DIN" },
      { id: "net-mic", name: "MIC_OUT" },
      { id: "net-spk-p", name: "SPK_OUT_P" },
      { id: "net-spk-n", name: "SPK_OUT_N" },
      { id: "net-key", name: "KEY_USER" },
    ],
    connections: [
      { netName: "VCC_5V", pinIds: ["usb-vbus", "chg-vin"] },
      { netName: "VBAT_SYS", pinIds: ["chg-bat"] },
      { netName: "VCC_3V3", pinIds: ["mcu-3v3", "codec-3v3", "mic-3v3"] },
      { netName: "GND", pinIds: ["usb-gnd", "chg-gnd", "mcu-gnd", "codec-gnd", "mic-gnd"] },
      { netName: "I2C_SCL", pinIds: ["mcu-scl", "codec-scl"] },
      { netName: "I2C_SDA", pinIds: ["mcu-sda", "codec-sda"] },
      { netName: "I2S_BCLK", pinIds: ["mcu-bclk", "codec-bclk"] },
      { netName: "I2S_WS", pinIds: ["mcu-ws", "codec-lrck"] },
      { netName: "I2S_DOUT", pinIds: ["mcu-sdout", "codec-dac"] },
      { netName: "I2S_DIN", pinIds: ["mcu-sdin", "codec-adc"] },
      { netName: "MIC_OUT", pinIds: ["mic-out"] },
      { netName: "SPK_OUT_P", pinIds: ["spk-p"] },
      { netName: "SPK_OUT_N", pinIds: ["spk-n"] },
      { netName: "KEY_USER", pinIds: ["btn-1"] },
    ],
  };
}

test("draftSpecToPlan normalizes schematic net names for readability", () => {
  const plan = draftSpecToPlan({ spec: createVoiceDeviceSpec() });

  assert.deepEqual(
    plan.nets.map((net) => net.name),
    [
      "5V",
      "VBAT",
      "3V3",
      "GND",
      "I2C_SCL",
      "I2C_SDA",
      "I2S_BCLK",
      "I2S_LRCK",
      "I2S_DOUT",
      "I2S_DIN",
      "MIC_OUT",
      "SPK_OUT_P",
      "SPK_OUT_N",
      "KEY_USER",
    ]
  );
});

test("draftSpecToPlan assigns grouped default placement for major functional blocks", () => {
  const plan = draftSpecToPlan({ spec: createVoiceDeviceSpec() });
  const byRef = new Map(plan.components.map((component) => [component.ref, component]));

  assert.deepEqual(
    [
      byRef.get("J1")?.properties.placement_x,
      byRef.get("J1")?.properties.placement_y,
      byRef.get("U2")?.properties.placement_x,
      byRef.get("U2")?.properties.placement_y,
    ],
    ["180", "180", "180", "320"]
  );
  assert.deepEqual(
    [byRef.get("U1")?.properties.placement_x, byRef.get("U1")?.properties.placement_y],
    ["520", "260"]
  );
  assert.deepEqual(
    [
      byRef.get("U3")?.properties.placement_x,
      byRef.get("U3")?.properties.placement_y,
      byRef.get("MK1")?.properties.placement_x,
      byRef.get("MK1")?.properties.placement_y,
      byRef.get("SPK1")?.properties.placement_x,
      byRef.get("SPK1")?.properties.placement_y,
    ],
    ["860", "220", "1180", "160", "1180", "300"]
  );
  assert.deepEqual(
    [byRef.get("SW1")?.properties.placement_x, byRef.get("SW1")?.properties.placement_y],
    ["520", "540"]
  );
});

test("draftSpecToPlan merges pinIds from repeated connections targeting the same normalized net", () => {
  const spec = createVoiceDeviceSpec();
  spec.connections = [
    { netName: "VCC_5V", pinIds: ["usb-vbus"] },
    { netName: "USB_5V", pinIds: ["chg-vin"] },
    { netName: "5V", pinIds: ["mcu-3v3"] },
  ];
  spec.nets = [{ id: "net-usb-5v", name: "VCC_5V", isPower: true }];

  const plan = draftSpecToPlan({ spec });
  const powerNet = plan.nets.find((net) => net.name === "5V");

  assert.deepEqual(powerNet?.nodeIds, ["usb-vbus", "chg-vin", "mcu-3v3"]);
});

test("draftSpecToPlan injects a power connector when a simple LED spec leaves a power net orphaned", () => {
  const spec: DraftDesignSpec = {
    systemType: "simple_led_circuit",
    title: "Simple LED",
    rationale: "minimal",
    components: [
      {
        id: "draft-r1",
        ref: "R1",
        role: "resistor",
        name: "220R",
        pins: [
          { id: "draft-r1-1", pinNumber: "1", pinName: "1", electricalType: "passive" },
          { id: "draft-r1-2", pinNumber: "2", pinName: "2", electricalType: "passive" },
        ],
      },
      {
        id: "draft-d1",
        ref: "D1",
        role: "led",
        name: "LED",
        pins: [
          { id: "draft-d1-a", pinNumber: "1", pinName: "A", electricalType: "passive" },
          { id: "draft-d1-k", pinNumber: "2", pinName: "K", electricalType: "passive" },
        ],
      },
    ],
    nets: [
      { id: "net-3v3", name: "3V3", isPower: true },
      { id: "net-led", name: "LED_ANODE" },
      { id: "net-gnd", name: "GND", isPower: true },
    ],
    connections: [
      { netName: "3V3", pinIds: ["draft-r1-1"] },
      { netName: "LED_ANODE", pinIds: ["draft-r1-2", "draft-d1-a"] },
      { netName: "GND", pinIds: ["draft-d1-k"] },
    ],
  };

  const plan = draftSpecToPlan({ spec });
  const byRef = new Map(plan.components.map((component) => [component.ref, component]));
  const powerNet = plan.nets.find((net) => net.name === "3V3");
  const groundNet = plan.nets.find((net) => net.name === "GND");

  assert.equal(byRef.has("J1"), true);
  assert.equal(byRef.get("J1")?.properties.role, "power_connector");
  assert.deepEqual(powerNet?.nodeIds, ["draft-r1-1", "draft-j1-pos"]);
  assert.deepEqual(groundNet?.nodeIds, ["draft-d1-k", "draft-j1-gnd"]);
});
