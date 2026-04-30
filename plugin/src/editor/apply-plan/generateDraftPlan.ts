import type { DraftPlan, DraftPlanGuidance, DraftPlanSelectedDevice } from "./draftPlan";
import { completeDraftPlanPeripherals } from "./draftPeripheralCompletion";
import type { DevboardRagTemplateCorpusEntry } from "./devboardRagTemplates";

interface GenerateDraftPlanOptions {
  selectedDevices?: DraftPlanSelectedDevice[];
  guidance?: DraftPlanGuidance;
  externalRagTemplateCorpus?: DevboardRagTemplateCorpusEntry[];
}

interface LegacyDraftConnection {
  from: string;
  fromPin?: string;
  to: string;
  toPin?: string;
  netName?: string;
}

function toSafeProperties(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (raw === undefined || raw === null) continue;
    result[key] = String(raw);
  }
  return result;
}

function normalizeGuidance(value: unknown): DraftPlanGuidance | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const guidance = value as DraftPlanGuidance & {
    evidence?: Array<Record<string, unknown>>;
    preferredSearches?: Record<string, unknown>;
    requiredNets?: unknown[];
    requiredConnections?: Array<Record<string, unknown>>;
  };
  const templateId = typeof guidance.templateId === "string" ? guidance.templateId : "";
  const rationale = typeof guidance.rationale === "string" ? guidance.rationale : "";
  if (!templateId || !rationale) {
    return undefined;
  }
  return {
    templateId,
    rationale,
    evidence: Array.isArray(guidance.evidence)
      ? guidance.evidence
          .map((item) => ({
            title: typeof item.title === "string" ? item.title : "",
            snippet: typeof item.snippet === "string" ? item.snippet : "",
            sourceRef: typeof item.sourceRef === "string" ? item.sourceRef : "",
          }))
          .filter((item) => item.title || item.snippet || item.sourceRef)
      : undefined,
    preferredSearches:
      guidance.preferredSearches && typeof guidance.preferredSearches === "object"
        ? Object.fromEntries(
            Object.entries(guidance.preferredSearches)
              .filter(([, raw]) => typeof raw === "string" && raw.trim())
              .map(([key, raw]) => [key, String(raw).trim()])
          )
        : undefined,
    requiredNets: Array.isArray(guidance.requiredNets)
      ? guidance.requiredNets.map((item) => String(item)).filter(Boolean)
      : undefined,
    requiredConnections: Array.isArray(guidance.requiredConnections)
      ? guidance.requiredConnections
          .map((item) => ({
            fromComponentRef: typeof item.fromComponentRef === "string" ? item.fromComponentRef : "",
            fromPin: typeof item.fromPin === "string" ? item.fromPin : "",
            toComponentRef: typeof item.toComponentRef === "string" ? item.toComponentRef : "",
            toPin: typeof item.toPin === "string" ? item.toPin : "",
            netName: typeof item.netName === "string" ? item.netName : "",
          }))
          .filter(
            (item) =>
              item.fromComponentRef && item.fromPin && item.toComponentRef && item.toPin && item.netName
          )
      : undefined,
  };
}

function buildLegacyPinId(componentId: string, pinLabel: string): string {
  const safe = String(pinLabel || "pin")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "_");
  return `${componentId}-${safe}`;
}

function inferPowerNet(netName?: string): boolean {
  const normalized = String(netName || "").trim().toUpperCase();
  return ["GND", "VCC", "VIN", "VBAT", "5V", "3V3", "3.3V"].includes(normalized);
}

export function normalizeDraftPlan(plan: DraftPlan | unknown): DraftPlan {
  const candidate = (plan && typeof plan === "object" ? plan : {}) as Partial<DraftPlan> & {
    connections?: LegacyDraftConnection[];
    components?: Array<Record<string, unknown>>;
    pins?: Array<Record<string, unknown>>;
    nets?: Array<Record<string, unknown>>;
    title?: string;
    rationale?: string;
    selectedDevices?: DraftPlanSelectedDevice[];
    guidance?: DraftPlanGuidance;
  };

  const components = Array.isArray(candidate.components)
    ? candidate.components.map((component, index) => ({
        id: String(component.id || `draft-component-${index + 1}`),
        ref: typeof component.ref === "string" ? component.ref : undefined,
        name: typeof component.name === "string" ? component.name : undefined,
        libraryId: typeof component.libraryId === "string" ? component.libraryId : undefined,
        packageName: typeof component.packageName === "string" ? component.packageName : undefined,
        value: typeof component.value === "string" ? component.value : undefined,
        componentType: typeof component.componentType === "string" ? component.componentType : undefined,
        addIntoBom: typeof component.addIntoBom === "boolean" ? component.addIntoBom : true,
        addIntoPcb: typeof component.addIntoPcb === "boolean" ? component.addIntoPcb : true,
        properties: toSafeProperties(component.properties),
      }))
    : [];

  const hasPins = Array.isArray(candidate.pins) && candidate.pins.length > 0;
  const hasNets = Array.isArray(candidate.nets);
  if (hasPins && hasNets) {
    return completeDraftPlanPeripherals({
      title: String(candidate.title || "Draft Plan"),
      rationale: String(candidate.rationale || ""),
      components,
      pins: candidate.pins!.map((pin, index) => ({
        id: String(pin.id || `draft-pin-${index + 1}`),
        componentId: String(pin.componentId || ""),
        pinNumber: typeof pin.pinNumber === "string" ? pin.pinNumber : undefined,
        pinName: typeof pin.pinName === "string" ? pin.pinName : undefined,
        electricalType: typeof pin.electricalType === "string" ? pin.electricalType : undefined,
        resolvedPinNumber: typeof pin.resolvedPinNumber === "string" ? pin.resolvedPinNumber : undefined,
        resolvedPinName: typeof pin.resolvedPinName === "string" ? pin.resolvedPinName : undefined,
        resolvedElectricalType:
          typeof pin.resolvedElectricalType === "string" ? pin.resolvedElectricalType : undefined,
        pinResolutionStatus:
          pin.pinResolutionStatus === "resolved" || pin.pinResolutionStatus === "unresolved"
            ? pin.pinResolutionStatus
            : undefined,
        pinResolutionConfidence:
          typeof pin.pinResolutionConfidence === "number" && Number.isFinite(pin.pinResolutionConfidence)
            ? pin.pinResolutionConfidence
            : undefined,
        pinResolutionReason:
          typeof pin.pinResolutionReason === "string" ? pin.pinResolutionReason : undefined,
        noConnected: typeof pin.noConnected === "boolean" ? pin.noConnected : undefined,
        netName: typeof pin.netName === "string" ? pin.netName : undefined,
      })),
      nets: candidate.nets!.map((net, index) => ({
        id: String(net.id || `draft-net-${index + 1}`),
        name: typeof net.name === "string" ? net.name : undefined,
        nodeIds: Array.isArray(net.nodeIds) ? net.nodeIds.map((item) => String(item)) : [],
        isPower: typeof net.isPower === "boolean" ? net.isPower : inferPowerNet(typeof net.name === "string" ? net.name : undefined),
      })),
      selectedDevices: Array.isArray(candidate.selectedDevices) ? candidate.selectedDevices : undefined,
      guidance: normalizeGuidance(candidate.guidance),
      externalRagTemplateCorpus: Array.isArray((candidate as { externalRagTemplateCorpus?: unknown }).externalRagTemplateCorpus)
        ? ((candidate as { externalRagTemplateCorpus?: DevboardRagTemplateCorpusEntry[] }).externalRagTemplateCorpus ?? [])
        : undefined,
    });
  }

  const pinMap = new Map<string, DraftPlan["pins"][number]>();
  const netsByName = new Map<string, DraftPlan["nets"][number]>();
  for (const connection of Array.isArray(candidate.connections) ? candidate.connections : []) {
    const netName = String(connection.netName || "").trim() || `NET_${netsByName.size + 1}`;
    const fromPin = String(connection.fromPin || "1").trim();
    const toPin = String(connection.toPin || "1").trim();
    const fromPinId = buildLegacyPinId(String(connection.from), fromPin);
    const toPinId = buildLegacyPinId(String(connection.to), toPin);
    if (!pinMap.has(fromPinId)) {
      pinMap.set(fromPinId, {
        id: fromPinId,
        componentId: String(connection.from),
        pinNumber: fromPin,
        pinName: fromPin,
        electricalType: "passive",
        netName,
      });
    }
    if (!pinMap.has(toPinId)) {
      pinMap.set(toPinId, {
        id: toPinId,
        componentId: String(connection.to),
        pinNumber: toPin,
        pinName: toPin,
        electricalType: "passive",
        netName,
      });
    }
    const existingNet = netsByName.get(netName);
    if (existingNet) {
      if (!existingNet.nodeIds.includes(fromPinId)) existingNet.nodeIds.push(fromPinId);
      if (!existingNet.nodeIds.includes(toPinId)) existingNet.nodeIds.push(toPinId);
    } else {
      netsByName.set(netName, {
        id: `draft-net-${netName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || netsByName.size + 1}`,
        name: netName,
        nodeIds: [fromPinId, toPinId],
        isPower: inferPowerNet(netName),
      });
    }
  }

  return completeDraftPlanPeripherals({
    title: String(candidate.title || "Draft Plan"),
    rationale: String(candidate.rationale || ""),
    components,
    pins: Array.from(pinMap.values()),
    nets: Array.from(netsByName.values()),
    selectedDevices: Array.isArray(candidate.selectedDevices) ? candidate.selectedDevices : undefined,
    guidance: normalizeGuidance(candidate.guidance),
    externalRagTemplateCorpus: Array.isArray((candidate as { externalRagTemplateCorpus?: unknown }).externalRagTemplateCorpus)
      ? ((candidate as { externalRagTemplateCorpus?: DevboardRagTemplateCorpusEntry[] }).externalRagTemplateCorpus ?? [])
      : undefined,
  });
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

function withGuidedSearch(
  role: DraftPlanSelectedDevice["role"],
  guidance: DraftPlanGuidance | undefined
): Record<string, string> {
  const query = guidance?.preferredSearches?.[role];
  return query ? { preferred_search_query: query } : {};
}

export function generateDraftPlanFromPrompt(
  userQuery: string,
  options: GenerateDraftPlanOptions = {}
): DraftPlan {
  const normalized = userQuery.toLowerCase();
  const selectedDevices = options.selectedDevices ?? [];
  const guidance = options.guidance;
  const externalRagTemplateCorpus = options.externalRagTemplateCorpus;
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
  const looksLikeVoiceDevice =
    /(esp32-s3|esp32 s3|esp32s3)/u.test(normalized) &&
    /(voice|语音|小智|聊天|chat|mic|microphone|inmp441|max98357|speaker|音频|audio)/u.test(normalized);

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
            ...withGuidedSearch("power_connector", guidance),
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
            ...withGuidedSearch("resistor", guidance),
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
            ...withGuidedSearch("led", guidance),
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
          pinNumber: "1",
          pinName: "5V",
          electricalType: "power_in",
        },
        {
          id: "draft-j1-2",
          componentId: "draft-j1",
          pinNumber: "2",
          pinName: "GND",
          electricalType: "power_in",
        },
        {
          id: "draft-r1-1",
          componentId: "draft-r1",
          pinNumber: "1",
          pinName: "1",
          electricalType: "passive",
        },
        {
          id: "draft-r1-2",
          componentId: "draft-r1",
          pinNumber: "2",
          pinName: "2",
          electricalType: "passive",
        },
        {
          id: "draft-d1-a",
          componentId: "draft-d1",
          pinNumber: "1",
          pinName: "A",
          electricalType: "passive",
        },
        {
          id: "draft-d1-k",
          componentId: "draft-d1",
          pinNumber: "2",
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
      guidance,
      externalRagTemplateCorpus,
    };
  }

  if (!looksLikeVoiceDevice && (normalized.includes("ldo") || normalized.includes("5v") || normalized.includes("3.3v"))) {
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
            ...withGuidedSearch("ldo_regulator", guidance),
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
            ...withGuidedSearch("input_capacitor", guidance),
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
            ...withGuidedSearch("output_capacitor", guidance),
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
      guidance,
      externalRagTemplateCorpus,
    };
  }

  if (looksLikeVoiceDevice) {
    const findSelected = (role: string): DraftPlanSelectedDevice | undefined =>
      selectedDevices.find((item) => item.role === role);
    const mcuDevice = findSelected("mcu");
    const chargerDevice = findSelected("charger_powerbank");
    const usbCDevice = findSelected("usb_c_connector");
    const batteryDevice = findSelected("battery_connector");
    const micDevice = findSelected("microphone");
    const ampDevice = findSelected("audio_amplifier");
    const speakerDevice = findSelected("speaker_connector");
    const decouplingCapDevice = findSelected("decoupling_capacitor");
    const bootResistorDevice = findSelected("boot_resistor");
    return {
      title: "ESP32-S3 Voice Device Draft",
      rationale:
        "Generated a voice-device draft with ESP32-S3 controller, lithium battery charge/boost power path, 3.3V rail, I2S microphone, and I2S audio amplifier." +
        (selectedDevices.length > 0
          ? ` Matched ${selectedDevices.length} integrated-library device candidate(s) for later placement.`
          : ""),
      components: [
        {
          id: "draft-u1",
          ref: "U1",
          name: mcuDevice?.name ?? "ESP32-S3-WROOM-1",
          libraryId: mcuDevice?.deviceUuid,
          packageName: mcuDevice?.footprintName ?? "ESP32-S3-WROOM-1",
          properties: {
            role: "mcu",
            expected_net_3V3: "3V3",
            expected_net_GND: "GND",
            expected_net_EN: "EN",
            expected_net_IO0: "IO0",
            expected_net_I2S_SCK: "I2S_SCK",
            expected_net_I2S_LRCK: "I2S_LRCK",
            expected_net_I2S_SD: "I2S_SD",
            expected_net_I2S_DOUT: "I2S_DOUT",
            ...withGuidedSearch("mcu", guidance),
            device_uuid: mcuDevice?.deviceUuid ?? "",
            library_uuid: mcuDevice?.libraryUuid ?? "",
            symbol_uuid: mcuDevice?.symbolUuid ?? "",
            footprint_uuid: mcuDevice?.footprintUuid ?? "",
            ...withPlacement(560, 260, 0),
          },
        },
        {
          id: "draft-j1",
          ref: "J1",
          name: usbCDevice?.name ?? "USB Type-C Connector",
          libraryId: usbCDevice?.deviceUuid,
          packageName: usbCDevice?.footprintName ?? "TYPE-C-SMD",
          properties: {
            role: "usb_c_connector",
            expected_net_VBUS: "VBUS",
            expected_net_GND: "GND",
            expected_net_CC1: "CC1",
            expected_net_CC2: "CC2",
            ...withGuidedSearch("usb_c_connector", guidance),
            device_uuid: usbCDevice?.deviceUuid ?? "",
            library_uuid: usbCDevice?.libraryUuid ?? "",
            symbol_uuid: usbCDevice?.symbolUuid ?? "",
            footprint_uuid: usbCDevice?.footprintUuid ?? "",
            ...withPlacement(140, 180, 0),
          },
        },
        {
          id: "draft-bt1",
          ref: "BT1",
          name: batteryDevice?.name ?? "Li-ion Battery Connector",
          libraryId: batteryDevice?.deviceUuid,
          packageName: batteryDevice?.footprintName ?? "JST-PH-2P",
          value: "3.7V Li-ion",
          properties: {
            role: "battery_connector",
            expected_net_BAT: "VBAT",
            expected_net_GND: "GND",
            ...withGuidedSearch("battery_connector", guidance),
            device_uuid: batteryDevice?.deviceUuid ?? "",
            library_uuid: batteryDevice?.libraryUuid ?? "",
            symbol_uuid: batteryDevice?.symbolUuid ?? "",
            footprint_uuid: batteryDevice?.footprintUuid ?? "",
            ...withPlacement(140, 360, 0),
          },
        },
        {
          id: "draft-u2",
          ref: "U2",
          name: chargerDevice?.name ?? "IP5306",
          libraryId: chargerDevice?.deviceUuid,
          packageName: chargerDevice?.footprintName ?? "SOP-8",
          value: "Li-ion charge/boost",
          properties: {
            role: "charger_powerbank",
            expected_net_VIN: "VBUS",
            expected_net_BAT: "VBAT",
            expected_net_VOUT: "5V",
            expected_net_GND: "GND",
            ...withGuidedSearch("charger_powerbank", guidance),
            device_uuid: chargerDevice?.deviceUuid ?? "",
            library_uuid: chargerDevice?.libraryUuid ?? "",
            symbol_uuid: chargerDevice?.symbolUuid ?? "",
            footprint_uuid: chargerDevice?.footprintUuid ?? "",
            ...withPlacement(320, 260, 0),
          },
        },
        {
          id: "draft-u3",
          ref: "U3",
          name: ldoDevice?.name ?? "3.3V LDO",
          libraryId: ldoDevice?.deviceUuid,
          packageName: ldoDevice?.footprintName ?? "SOT-223",
          value: "3.3V",
          properties: {
            role: "ldo_regulator",
            expected_net_VIN: "5V",
            expected_net_VOUT: "3V3",
            expected_net_GND: "GND",
            ...withGuidedSearch("ldo_regulator", guidance),
            device_uuid: ldoDevice?.deviceUuid ?? "",
            library_uuid: ldoDevice?.libraryUuid ?? "",
            symbol_uuid: ldoDevice?.symbolUuid ?? "",
            footprint_uuid: ldoDevice?.footprintUuid ?? "",
            ...withPlacement(420, 420, 0),
          },
        },
        {
          id: "draft-u4",
          ref: "U4",
          name: micDevice?.name ?? "INMP441",
          libraryId: micDevice?.deviceUuid,
          packageName: micDevice?.footprintName ?? "MIC-SMD",
          properties: {
            role: "microphone",
            expected_net_VDD: "3V3",
            expected_net_GND: "GND",
            expected_net_SCK: "I2S_SCK",
            expected_net_WS: "I2S_LRCK",
            expected_net_SD: "I2S_SD",
            ...withGuidedSearch("microphone", guidance),
            device_uuid: micDevice?.deviceUuid ?? "",
            library_uuid: micDevice?.libraryUuid ?? "",
            symbol_uuid: micDevice?.symbolUuid ?? "",
            footprint_uuid: micDevice?.footprintUuid ?? "",
            ...withPlacement(860, 160, 0),
          },
        },
        {
          id: "draft-u5",
          ref: "U5",
          name: ampDevice?.name ?? "MAX98357A / NS4168",
          libraryId: ampDevice?.deviceUuid,
          packageName: ampDevice?.footprintName ?? "QFN",
          properties: {
            role: "audio_amplifier",
            expected_net_VDD: "5V",
            expected_net_GND: "GND",
            expected_net_BCLK: "I2S_SCK",
            expected_net_LRCK: "I2S_LRCK",
            expected_net_DIN: "I2S_DOUT",
            expected_net_SPKP: "SPK_P",
            expected_net_SPKN: "SPK_N",
            ...withGuidedSearch("audio_amplifier", guidance),
            device_uuid: ampDevice?.deviceUuid ?? "",
            library_uuid: ampDevice?.libraryUuid ?? "",
            symbol_uuid: ampDevice?.symbolUuid ?? "",
            footprint_uuid: ampDevice?.footprintUuid ?? "",
            ...withPlacement(860, 340, 0),
          },
        },
        {
          id: "draft-j2",
          ref: "J2",
          name: speakerDevice?.name ?? "Speaker Connector",
          libraryId: speakerDevice?.deviceUuid,
          packageName: speakerDevice?.footprintName ?? "HDR-TH_1X2",
          value: "4Ω Speaker",
          properties: {
            role: "speaker_connector",
            expected_net_1: "SPK_P",
            expected_net_2: "SPK_N",
            ...withGuidedSearch("speaker_connector", guidance),
            device_uuid: speakerDevice?.deviceUuid ?? "",
            library_uuid: speakerDevice?.libraryUuid ?? "",
            symbol_uuid: speakerDevice?.symbolUuid ?? "",
            footprint_uuid: speakerDevice?.footprintUuid ?? "",
            ...withPlacement(1100, 340, 0),
          },
        },
        {
          id: "draft-c6",
          ref: "C6",
          name: decouplingCapDevice?.name ?? "Capacitor",
          libraryId: decouplingCapDevice?.deviceUuid,
          packageName: decouplingCapDevice?.footprintName ?? "0603",
          value: "0.1uF",
          properties: {
            role: "decoupling_capacitor",
            expected_net_1: "VBUS",
            expected_net_2: "GND",
            ...withGuidedSearch("decoupling_capacitor", guidance),
            device_uuid: decouplingCapDevice?.deviceUuid ?? "",
            library_uuid: decouplingCapDevice?.libraryUuid ?? "",
            symbol_uuid: decouplingCapDevice?.symbolUuid ?? "",
            footprint_uuid: decouplingCapDevice?.footprintUuid ?? "",
            ...withPlacement(240, 120, 0),
          },
        },
        {
          id: "draft-r1",
          ref: "R1",
          name: bootResistorDevice?.name ?? "Resistor",
          libraryId: bootResistorDevice?.deviceUuid,
          packageName: bootResistorDevice?.footprintName ?? "0603",
          value: "10k",
          properties: {
            role: "boot_resistor",
            expected_net_1: "IO0",
            expected_net_2: "GND",
            ...withGuidedSearch("boot_resistor", guidance),
            device_uuid: bootResistorDevice?.deviceUuid ?? "",
            library_uuid: bootResistorDevice?.libraryUuid ?? "",
            symbol_uuid: bootResistorDevice?.symbolUuid ?? "",
            footprint_uuid: bootResistorDevice?.footprintUuid ?? "",
            ...withPlacement(600, 500, 0),
          },
        },
        {
          id: "draft-r2",
          ref: "R2",
          name: bootResistorDevice?.name ?? "Resistor",
          libraryId: bootResistorDevice?.deviceUuid,
          packageName: bootResistorDevice?.footprintName ?? "0603",
          value: "10k",
          properties: {
            role: "boot_resistor",
            expected_net_1: "EN",
            expected_net_2: "3V3",
            ...withGuidedSearch("boot_resistor", guidance),
            device_uuid: bootResistorDevice?.deviceUuid ?? "",
            library_uuid: bootResistorDevice?.libraryUuid ?? "",
            symbol_uuid: bootResistorDevice?.symbolUuid ?? "",
            footprint_uuid: bootResistorDevice?.footprintUuid ?? "",
            ...withPlacement(500, 500, 0),
          },
        },
      ],
      pins: [
        { id: "draft-j1-vbus", componentId: "draft-j1", pinName: "VBUS", electricalType: "power_out", netName: "VBUS" },
        { id: "draft-j1-gnd", componentId: "draft-j1", pinName: "GND", electricalType: "power_in", netName: "GND" },
        { id: "draft-bt1-bat", componentId: "draft-bt1", pinName: "BAT", electricalType: "power_out", netName: "VBAT" },
        { id: "draft-bt1-gnd", componentId: "draft-bt1", pinName: "GND", electricalType: "power_in", netName: "GND" },
        { id: "draft-u2-vin", componentId: "draft-u2", pinName: "VIN", electricalType: "power_in", netName: "VBUS" },
        { id: "draft-u2-bat", componentId: "draft-u2", pinName: "BAT", electricalType: "power_in", netName: "VBAT" },
        { id: "draft-u2-vout", componentId: "draft-u2", pinName: "VOUT", electricalType: "power_out", netName: "5V" },
        { id: "draft-u2-gnd", componentId: "draft-u2", pinName: "GND", electricalType: "power_in", netName: "GND" },
        { id: "draft-u3-vin", componentId: "draft-u3", pinName: "VIN", electricalType: "power_in", netName: "5V" },
        { id: "draft-u3-vout", componentId: "draft-u3", pinName: "VOUT", electricalType: "power_out", netName: "3V3" },
        { id: "draft-u3-gnd", componentId: "draft-u3", pinName: "GND", electricalType: "power_in", netName: "GND" },
        { id: "draft-u1-3v3", componentId: "draft-u1", pinName: "3V3", electricalType: "power_in", netName: "3V3" },
        { id: "draft-u1-gnd", componentId: "draft-u1", pinName: "GND", electricalType: "power_in", netName: "GND" },
        { id: "draft-u1-en", componentId: "draft-u1", pinName: "EN", electricalType: "input", netName: "EN" },
        { id: "draft-u1-io0", componentId: "draft-u1", pinName: "IO0", electricalType: "input", netName: "IO0" },
        { id: "draft-u1-i2s-sck", componentId: "draft-u1", pinName: "GPIO4", electricalType: "output", netName: "I2S_SCK" },
        { id: "draft-u1-i2s-lrck", componentId: "draft-u1", pinName: "GPIO5", electricalType: "output", netName: "I2S_LRCK" },
        { id: "draft-u1-i2s-sd", componentId: "draft-u1", pinName: "GPIO6", electricalType: "input", netName: "I2S_SD" },
        { id: "draft-u1-i2s-dout", componentId: "draft-u1", pinName: "GPIO7", electricalType: "output", netName: "I2S_DOUT" },
        { id: "draft-u4-vdd", componentId: "draft-u4", pinName: "VDD", electricalType: "power_in", netName: "3V3" },
        { id: "draft-u4-gnd", componentId: "draft-u4", pinName: "GND", electricalType: "power_in", netName: "GND" },
        { id: "draft-u4-sck", componentId: "draft-u4", pinName: "SCK", electricalType: "input", netName: "I2S_SCK" },
        { id: "draft-u4-ws", componentId: "draft-u4", pinName: "WS", electricalType: "input", netName: "I2S_LRCK" },
        { id: "draft-u4-sd", componentId: "draft-u4", pinName: "SD", electricalType: "output", netName: "I2S_SD" },
        { id: "draft-u5-vdd", componentId: "draft-u5", pinName: "VDD", electricalType: "power_in", netName: "5V" },
        { id: "draft-u5-gnd", componentId: "draft-u5", pinName: "GND", electricalType: "power_in", netName: "GND" },
        { id: "draft-u5-bclk", componentId: "draft-u5", pinName: "BCLK", electricalType: "input", netName: "I2S_SCK" },
        { id: "draft-u5-lrck", componentId: "draft-u5", pinName: "LRCK", electricalType: "input", netName: "I2S_LRCK" },
        { id: "draft-u5-din", componentId: "draft-u5", pinName: "DIN", electricalType: "input", netName: "I2S_DOUT" },
        { id: "draft-u5-spkp", componentId: "draft-u5", pinName: "SPK+", electricalType: "output", netName: "SPK_P" },
        { id: "draft-u5-spkn", componentId: "draft-u5", pinName: "SPK-", electricalType: "output", netName: "SPK_N" },
        { id: "draft-j2-1", componentId: "draft-j2", pinNumber: "1", pinName: "SPK+", electricalType: "passive", netName: "SPK_P" },
        { id: "draft-j2-2", componentId: "draft-j2", pinNumber: "2", pinName: "SPK-", electricalType: "passive", netName: "SPK_N" },
        { id: "draft-c6-1", componentId: "draft-c6", pinNumber: "1", pinName: "1", electricalType: "passive", netName: "VBUS" },
        { id: "draft-c6-2", componentId: "draft-c6", pinNumber: "2", pinName: "2", electricalType: "passive", netName: "GND" },
        { id: "draft-r1-1", componentId: "draft-r1", pinNumber: "1", pinName: "1", electricalType: "passive", netName: "IO0" },
        { id: "draft-r1-2", componentId: "draft-r1", pinNumber: "2", pinName: "2", electricalType: "passive", netName: "GND" },
        { id: "draft-r2-1", componentId: "draft-r2", pinNumber: "1", pinName: "1", electricalType: "passive", netName: "EN" },
        { id: "draft-r2-2", componentId: "draft-r2", pinNumber: "2", pinName: "2", electricalType: "passive", netName: "3V3" },
      ],
      nets: [
        { id: "draft-net-vbus", name: "VBUS", nodeIds: ["draft-j1-vbus", "draft-u2-vin", "draft-c6-1"], isPower: true },
        { id: "draft-net-vbat", name: "VBAT", nodeIds: ["draft-bt1-bat", "draft-u2-bat"], isPower: true },
        { id: "draft-net-5v", name: "5V", nodeIds: ["draft-u2-vout", "draft-u3-vin", "draft-u5-vdd"], isPower: true },
        { id: "draft-net-3v3", name: "3V3", nodeIds: ["draft-u3-vout", "draft-u1-3v3", "draft-u4-vdd", "draft-r2-2"], isPower: true },
        { id: "draft-net-gnd", name: "GND", nodeIds: ["draft-j1-gnd", "draft-bt1-gnd", "draft-u2-gnd", "draft-u3-gnd", "draft-u1-gnd", "draft-u4-gnd", "draft-u5-gnd", "draft-c6-2", "draft-r1-2"], isPower: true },
        { id: "draft-net-en", name: "EN", nodeIds: ["draft-u1-en", "draft-r2-1"] },
        { id: "draft-net-io0", name: "IO0", nodeIds: ["draft-u1-io0", "draft-r1-1"] },
        { id: "draft-net-i2s-sck", name: "I2S_SCK", nodeIds: ["draft-u1-i2s-sck", "draft-u4-sck", "draft-u5-bclk"] },
        { id: "draft-net-i2s-lrck", name: "I2S_LRCK", nodeIds: ["draft-u1-i2s-lrck", "draft-u4-ws", "draft-u5-lrck"] },
        { id: "draft-net-i2s-sd", name: "I2S_SD", nodeIds: ["draft-u1-i2s-sd", "draft-u4-sd"] },
        { id: "draft-net-i2s-dout", name: "I2S_DOUT", nodeIds: ["draft-u1-i2s-dout", "draft-u5-din"] },
        { id: "draft-net-spk-p", name: "SPK_P", nodeIds: ["draft-u5-spkp", "draft-j2-1"] },
        { id: "draft-net-spk-n", name: "SPK_N", nodeIds: ["draft-u5-spkn", "draft-j2-2"] },
      ],
      selectedDevices,
      guidance,
      externalRagTemplateCorpus,
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
    guidance,
    externalRagTemplateCorpus,
  };
}
