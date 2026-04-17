import type { DraftPlan, DraftPlanGuidance, DraftPlanSelectedDevice } from "./draftPlan";

interface GenerateDraftPlanOptions {
  selectedDevices?: DraftPlanSelectedDevice[];
  guidance?: DraftPlanGuidance;
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
    return {
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
    };
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

  return {
    title: String(candidate.title || "Draft Plan"),
    rationale: String(candidate.rationale || ""),
    components,
    pins: Array.from(pinMap.values()),
    nets: Array.from(netsByName.values()),
    selectedDevices: Array.isArray(candidate.selectedDevices) ? candidate.selectedDevices : undefined,
      guidance: normalizeGuidance(candidate.guidance),
  };
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
  };
}
