import type { DraftPlan, DraftPlanSelectedDevice } from "./draftPlan";

interface GenerateDraftPlanOptions {
  selectedDevices?: DraftPlanSelectedDevice[];
}

function withPlacement(
  x: number,
  y: number,
  rotation = 0
): Record<string, string> {
  return {
    placement_x: String(x),
    placement_y: String(y),
    placement_rotation: String(rotation),
  };
}

export function generateDraftPlanFromPrompt(
  userQuery: string,
  options: GenerateDraftPlanOptions = {}
): DraftPlan {
  const normalized = userQuery.toLowerCase();
  const selectedDevices = options.selectedDevices ?? [];
  const pickSelected = (role: string): DraftPlanSelectedDevice | undefined =>
    selectedDevices.find((item) => item.role === role);
  const ldoDevice = pickSelected("ldo_regulator");
  const inputCapacitorDevice = pickSelected("input_capacitor");
  const outputCapacitorDevice = pickSelected("output_capacitor") ?? inputCapacitorDevice;
  const ledDevice = pickSelected("led");
  const resistorDevice = pickSelected("resistor");
  const connectorDevice = pickSelected("power_connector");

  const looksLikeLedDraft =
    /led|发光二极管|点亮|指示灯/u.test(userQuery) &&
    !/ldo|稳压|regulator|3\.3v|3v3/u.test(userQuery);

  if (looksLikeLedDraft) {
    return {
      title: "5V LED Indicator Draft",
      rationale:
        "Generated a minimal LED indicator draft based on the user request." +
        (selectedDevices.length > 0
          ? ` Matched ${selectedDevices.length} integrated-library device candidate(s) for later placement.`
          : ""),
      components: [
        {
          id: "draft-j1",
          ref: "J1",
          name: connectorDevice?.name ?? "Power Header",
          libraryId: connectorDevice?.deviceUuid ?? "lib-power-header",
          packageName: connectorDevice?.footprintName ?? "HDR-TH_1X2",
          value: "5V Input",
          properties: {
            expected_net_1: "5V",
            expected_net_2: "GND",
            device_uuid: connectorDevice?.deviceUuid ?? "",
            library_uuid: connectorDevice?.libraryUuid ?? "",
            symbol_uuid: connectorDevice?.symbolUuid ?? "",
            footprint_uuid: connectorDevice?.footprintUuid ?? "",
            ...withPlacement(120, 220, 0),
          },
        },
        {
          id: "draft-r1",
          ref: "R1",
          name: resistorDevice?.name ?? "Resistor",
          libraryId: resistorDevice?.deviceUuid ?? "lib-resistor",
          packageName: resistorDevice?.footprintName ?? "R0805",
          value: "150Ω",
          properties: {
            expected_net_1: "5V",
            expected_net_2: "LED_ANODE",
            device_uuid: resistorDevice?.deviceUuid ?? "",
            library_uuid: resistorDevice?.libraryUuid ?? "",
            symbol_uuid: resistorDevice?.symbolUuid ?? "",
            footprint_uuid: resistorDevice?.footprintUuid ?? "",
            ...withPlacement(250, 220, 0),
          },
        },
        {
          id: "draft-d1",
          ref: "D1",
          name: ledDevice?.name ?? "LED",
          libraryId: ledDevice?.deviceUuid ?? "lib-led",
          packageName: ledDevice?.footprintName ?? "LED-TH_BD3.9-P2.54-RD_RED",
          value: "RED",
          properties: {
            expected_net_A: "LED_ANODE",
            expected_net_K: "GND",
            led_color: "red",
            device_uuid: ledDevice?.deviceUuid ?? "",
            library_uuid: ledDevice?.libraryUuid ?? "",
            symbol_uuid: ledDevice?.symbolUuid ?? "",
            footprint_uuid: ledDevice?.footprintUuid ?? "",
            ...withPlacement(390, 220, 0),
          },
        },
      ],
      pins: [
        {
          id: "draft-j1-1",
          componentId: "draft-j1",
          pinName: "5V",
          electricalType: "power_in",
        },
        {
          id: "draft-j1-2",
          componentId: "draft-j1",
          pinName: "GND",
          electricalType: "power_in",
        },
        {
          id: "draft-r1-1",
          componentId: "draft-r1",
          pinName: "1",
          electricalType: "passive",
        },
        {
          id: "draft-r1-2",
          componentId: "draft-r1",
          pinName: "2",
          electricalType: "passive",
        },
        {
          id: "draft-d1-a",
          componentId: "draft-d1",
          pinName: "A",
          electricalType: "passive",
        },
        {
          id: "draft-d1-k",
          componentId: "draft-d1",
          pinName: "K",
          electricalType: "passive",
        },
      ],
      nets: [
        {
          id: "draft-net-5v",
          name: "5V",
          nodeIds: ["draft-j1-1", "draft-r1-1"],
          isPower: true,
        },
        {
          id: "draft-net-led-anode",
          name: "LED_ANODE",
          nodeIds: ["draft-r1-2", "draft-d1-a"],
        },
        {
          id: "draft-net-gnd",
          name: "GND",
          nodeIds: ["draft-j1-2", "draft-d1-k"],
          isPower: true,
        },
      ],
      selectedDevices,
    };
  }

  if (normalized.includes("ldo") || normalized.includes("5v") || normalized.includes("3.3v")) {
    return {
      title: "5V to 3.3V LDO Draft",
      rationale:
        "Generated a minimal regulated power-path draft based on the user request." +
        (selectedDevices.length > 0
          ? ` Matched ${selectedDevices.length} integrated-library device candidate(s) for later placement.`
          : ""),
      components: [
        {
          id: "draft-u1",
          ref: "U1",
          name: ldoDevice?.name ?? "LDO",
          libraryId: ldoDevice?.deviceUuid ?? "lib-ldo",
          packageName: ldoDevice?.footprintName ?? "SOT-223",
          value: "3.3V",
          properties: {
            expected_net_VIN: "5V",
            expected_net_VOUT: "3V3",
            expected_net_GND: "GND",
            device_uuid: ldoDevice?.deviceUuid ?? "",
            library_uuid: ldoDevice?.libraryUuid ?? "",
            symbol_uuid: ldoDevice?.symbolUuid ?? "",
            footprint_uuid: ldoDevice?.footprintUuid ?? "",
            ...withPlacement(220, 220, 0),
          },
        },
        {
          id: "draft-c1",
          ref: "C1",
          name: inputCapacitorDevice?.name ?? "Capacitor",
          libraryId: inputCapacitorDevice?.deviceUuid ?? "lib-cap",
          packageName: inputCapacitorDevice?.footprintName ?? "0603",
          value: "10uF",
          properties: {
            expected_net_POS: "5V",
            expected_net_NEG: "GND",
            polarity_sensitive: "true",
            device_uuid: inputCapacitorDevice?.deviceUuid ?? "",
            library_uuid: inputCapacitorDevice?.libraryUuid ?? "",
            symbol_uuid: inputCapacitorDevice?.symbolUuid ?? "",
            footprint_uuid: inputCapacitorDevice?.footprintUuid ?? "",
            ...withPlacement(120, 220, 0),
          },
        },
        {
          id: "draft-c2",
          ref: "C2",
          name: outputCapacitorDevice?.name ?? "Capacitor",
          libraryId: outputCapacitorDevice?.deviceUuid ?? "lib-cap",
          packageName: outputCapacitorDevice?.footprintName ?? "0603",
          value: "10uF",
          properties: {
            expected_net_POS: "3V3",
            expected_net_NEG: "GND",
            polarity_sensitive: "true",
            device_uuid: outputCapacitorDevice?.deviceUuid ?? "",
            library_uuid: outputCapacitorDevice?.libraryUuid ?? "",
            symbol_uuid: outputCapacitorDevice?.symbolUuid ?? "",
            footprint_uuid: outputCapacitorDevice?.footprintUuid ?? "",
            ...withPlacement(320, 220, 0),
          },
        },
      ],
      pins: [
        {
          id: "draft-u1-vin",
          componentId: "draft-u1",
          pinName: "VIN",
          electricalType: "power_in",
        },
        {
          id: "draft-u1-vout",
          componentId: "draft-u1",
          pinName: "VOUT",
          electricalType: "power_out",
        },
        {
          id: "draft-u1-gnd",
          componentId: "draft-u1",
          pinName: "GND",
          electricalType: "power_in",
        },
        {
          id: "draft-c1-pos",
          componentId: "draft-c1",
          pinName: "POS",
          electricalType: "passive",
        },
        {
          id: "draft-c1-neg",
          componentId: "draft-c1",
          pinName: "NEG",
          electricalType: "passive",
        },
        {
          id: "draft-c2-pos",
          componentId: "draft-c2",
          pinName: "POS",
          electricalType: "passive",
        },
        {
          id: "draft-c2-neg",
          componentId: "draft-c2",
          pinName: "NEG",
          electricalType: "passive",
        },
      ],
      nets: [
        {
          id: "draft-net-5v",
          name: "5V",
          nodeIds: ["draft-u1-vin", "draft-c1-pos"],
          isPower: true,
        },
        {
          id: "draft-net-3v3",
          name: "3V3",
          nodeIds: ["draft-u1-vout", "draft-c2-pos"],
          isPower: true,
        },
        {
          id: "draft-net-gnd",
          name: "GND",
          nodeIds: ["draft-u1-gnd", "draft-c1-neg", "draft-c2-neg"],
          isPower: true,
        },
      ],
      selectedDevices,
    };
  }

  return {
    title: "Generic Draft",
    rationale:
      "Generated a placeholder draft plan from the prompt." +
      (selectedDevices.length > 0 ? ` Captured ${selectedDevices.length} selected library candidate(s).` : ""),
    components: [],
    pins: [],
    nets: [],
    selectedDevices,
  };
}
