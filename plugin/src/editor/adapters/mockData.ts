import type { PluginChannel, SchematicContext } from "../../types/schematic";

function buildMockContext(channel: PluginChannel): SchematicContext {
  return {
    project: {
      projectId: `${channel}-demo-project`,
      pageId: `${channel}-page-1`,
      channel,
    },
    components: [
      {
        id: "cmp-u1",
        ref: "U1",
        name: "ESP32-S3",
        libraryId: "lib-esp32-s3",
        packageName: "QFN-56",
        value: "ESP32-S3",
        properties: {
          footprint: "QFN-56",
          expected_net_3V3: "3V3",
        },
      },
      {
        id: "cmp-u2",
        ref: "U2",
        name: "LDO",
        libraryId: "lib-ldo",
        packageName: "SOT-223",
        value: "3.3V",
        properties: {
          output: "3.3V",
          expected_net_VIN: "3V3",
        },
      },
      {
        id: "cmp-d1",
        ref: "D1",
        name: "Schottky Diode",
        libraryId: "lib-diode-schottky",
        packageName: "SOD-123",
        value: "SS14",
        properties: {
          expected_net_ANODE: "5V",
          expected_net_CATHODE: "3V3",
          polarity_sensitive: "true",
        },
      },
      {
        id: "cmp-u3",
        ref: "U3",
        name: "Sensor",
        libraryId: "lib-sensor-demo",
        value: "Hall Sensor",
        properties: {
          expected_net_GND: "GND",
        },
      },
      {
        id: "cmp-u4",
        ref: "U4",
        name: "Power Monitor",
        libraryId: "lib-power-monitor",
        packageName: "SOT-23-5",
        value: "INA-demo",
        properties: {
          expected_net_VOUT: "5V",
        },
      },
      {
        id: "cmp-u5",
        ref: "U5",
        name: "MCU GPIO Source",
        libraryId: "lib-gpio-demo",
        packageName: "QFN-16",
        value: "GPIO",
        properties: {},
      },
    ],
    pins: [
      {
        id: "pin-u1-1",
        componentId: "cmp-u1",
        pinNumber: "1",
        pinName: "3V3",
        electricalType: "power_in",
      },
      {
        id: "pin-u2-1",
        componentId: "cmp-u2",
        pinNumber: "1",
        pinName: "VIN",
        electricalType: "power_in",
      },
      {
        id: "pin-d1-1",
        componentId: "cmp-d1",
        pinNumber: "1",
        pinName: "ANODE",
        electricalType: "passive",
      },
      {
        id: "pin-d1-2",
        componentId: "cmp-d1",
        pinNumber: "2",
        pinName: "CATHODE",
        electricalType: "passive",
      },
      {
        id: "pin-u3-1",
        componentId: "cmp-u3",
        pinNumber: "1",
        pinName: "GND",
        electricalType: "power_in",
      },
      {
        id: "pin-u3-2",
        componentId: "cmp-u3",
        pinNumber: "2",
        pinName: "SDA",
        electricalType: "input",
      },
      {
        id: "pin-u4-1",
        componentId: "cmp-u4",
        pinNumber: "1",
        pinName: "VOUT",
        electricalType: "power_out",
      },
      {
        id: "pin-u5-1",
        componentId: "cmp-u5",
        pinNumber: "1",
        pinName: "GPIO_OUT",
        electricalType: "output",
      },
      {
        id: "pin-u5-2",
        componentId: "cmp-u5",
        pinNumber: "2",
        pinName: "GPIO_FB",
        electricalType: "bidirectional",
      },
    ],
    nets: [
      {
        id: "net-3v3",
        name: "3V3",
        nodeIds: ["pin-u1-1"],
        isPower: true,
      },
      {
        id: "net-5v",
        name: "5V",
        nodeIds: ["pin-u2-1", "pin-d1-2", "pin-u3-1", "pin-u4-1"],
        isPower: true,
      },
      {
        id: "net-vbus",
        name: "VBUS",
        nodeIds: ["pin-d1-1"],
        isPower: true,
      },
      {
        id: "net-gpio-bus",
        name: "GPIO_BUS",
        nodeIds: ["pin-u5-1", "pin-u5-2"],
      },
    ],
    selection: {
      objectIds: ["cmp-u1"],
    },
  };
}

export const mockStandardContext = buildMockContext("standard");
export const mockProfessionalContext = buildMockContext("professional");
