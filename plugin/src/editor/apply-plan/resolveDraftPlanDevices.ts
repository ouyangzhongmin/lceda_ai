import type { SchematicComponent, SchematicPin } from "../../types/schematic";
import type { LibraryDeviceDetail, LibrarySearchResultItem } from "../host/runtime";
import type { DraftPlan, DraftPlanSelectedDevice } from "./draftPlan";

type SearchLibraryDevices = (query: string) => Promise<LibrarySearchResultItem[] | null>;
type GetLibraryDevice = (input: {
  deviceUuid: string;
  libraryUuid?: string;
}) => Promise<LibraryDeviceDetail | null>;
type GetLibrarySymbol = (input: {
  symbolUuid: string;
  libraryUuid?: string;
}) => Promise<LibraryDeviceDetail | null>;
type GetLibrarySymbolSource = (input: {
  symbolUuid: string;
  libraryUuid?: string;
}) => Promise<LibraryDeviceDetail | null>;

function safeObjectKeys(value: unknown): string[] {
  return typeof value === "object" && value !== null ? Object.keys(value as Record<string, unknown>).slice(0, 20) : [];
}

function summarizeStringSample(value: unknown, maxLength = 240): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

export function summarizeLibraryDeviceDetailShape(detail: LibraryDeviceDetail | null | undefined): Record<string, unknown> {
  if (!detail) {
    return { hasDetail: false };
  }
  const rawRecord =
    typeof detail.raw === "object" && detail.raw !== null ? (detail.raw as Record<string, unknown>) : undefined;
  const symbolRecord =
    rawRecord && typeof rawRecord.symbol === "object" && rawRecord.symbol !== null
      ? (rawRecord.symbol as Record<string, unknown>)
      : undefined;
  const deviceRecord =
    rawRecord && typeof rawRecord.device === "object" && rawRecord.device !== null
      ? (rawRecord.device as Record<string, unknown>)
      : undefined;
  const dataRecord =
    rawRecord && typeof rawRecord.data === "object" && rawRecord.data !== null
      ? (rawRecord.data as Record<string, unknown>)
      : undefined;
  return {
    hasDetail: true,
    detailKeys: safeObjectKeys(detail),
    hasPinsArray: Array.isArray(detail.pins),
    rawKeys: safeObjectKeys(rawRecord),
    rawPinsArray: Array.isArray(rawRecord?.pins),
    rawSymbolKeys: safeObjectKeys(symbolRecord),
    rawSymbolPinsArray: Array.isArray(symbolRecord?.pins),
    rawDeviceKeys: safeObjectKeys(deviceRecord),
    rawDevicePinsArray: Array.isArray(deviceRecord?.pins),
    rawDataKeys: safeObjectKeys(dataRecord),
    rawDataPinsArray: Array.isArray(dataRecord?.pins),
    rawDataStrSample:
      summarizeStringSample(rawRecord?.dataStr) ??
      summarizeStringSample(rawRecord?.rawData) ??
      summarizeStringSample((detail as Record<string, unknown>).dataStr),
    symbolName: detail.symbol?.name,
    footprintName: detail.footprint?.name,
  };
}

function logLibraryPinResolutionFailure(input: {
  componentId: string;
  componentRef?: string;
  deviceUuid?: string;
  libraryUuid?: string;
  reason: "device_detail_without_pins" | "no_matching_library_pin";
  detail: LibraryDeviceDetail | null | undefined;
  planPins?: SchematicPin[];
}): void {
  if (typeof console === "undefined" || typeof console.warn !== "function") {
    return;
  }
  console.warn("[LCEDA-AI][draft-pin-resolution]", {
    componentId: input.componentId,
    componentRef: input.componentRef,
    deviceUuid: input.deviceUuid,
    libraryUuid: input.libraryUuid,
    reason: input.reason,
    planPins: (input.planPins ?? []).map((pin) => ({
      id: pin.id,
      pinName: pin.pinName,
      pinNumber: pin.pinNumber,
      resolvedPinName: pin.resolvedPinName,
      resolvedPinNumber: pin.resolvedPinNumber,
    })),
    detailShape: summarizeLibraryDeviceDetailShape(input.detail),
  });
}

function logLibrarySymbolResolutionProbe(input: {
  stage: "device_to_symbol_ref" | "symbol_detail_result";
  componentId: string;
  componentRef?: string;
  deviceUuid?: string;
  libraryUuid?: string;
  symbolUuid?: string;
  symbolLibraryUuid?: string;
  detail?: LibraryDeviceDetail | null;
  note?: string;
}): void {
  if (typeof console === "undefined" || typeof console.warn !== "function") {
    return;
  }
  console.warn("[LCEDA-AI][draft-symbol-resolution]", {
    stage: input.stage,
    componentId: input.componentId,
    componentRef: input.componentRef,
    deviceUuid: input.deviceUuid,
    libraryUuid: input.libraryUuid,
    symbolUuid: input.symbolUuid,
    symbolLibraryUuid: input.symbolLibraryUuid,
    note: input.note,
    detailShape: input.detail ? summarizeLibraryDeviceDetailShape(input.detail) : undefined,
  });
}

function hasPlacementDevice(component: SchematicComponent): boolean {
  return Boolean(component.properties?.device_uuid && component.properties?.library_uuid);
}

function withResolutionStatus(
  component: SchematicComponent,
  status: "resolved" | "unresolved",
  reason: string
): SchematicComponent {
  return {
    ...component,
    properties: {
      ...component.properties,
      device_resolution_status: status,
      device_resolution_reason: reason,
    },
  };
}

function inferComponentRole(component: SchematicComponent): string {
  const ref = String(component.ref || "").toUpperCase();
  const name = String(component.name || "").toLowerCase();
  if (
    ref.startsWith("BT") ||
    ref.startsWith("BAT") ||
    (ref.startsWith("B") && (name.includes("battery") || name.includes("cell"))) ||
    name.includes("battery connector") ||
    name.includes("battery socket") ||
    name.includes("battery holder")
  ) {
    return "battery_connector";
  }
  if (ref.startsWith("R") || name.includes("resistor")) return "resistor";
  if (ref.startsWith("D") || name.includes("led")) return "led";
  if (ref.startsWith("J") || name.includes("header") || name.includes("connector")) return "power_connector";
  if (ref.startsWith("C") || name.includes("capacitor")) return "input_capacitor";
  if (ref.startsWith("U") || name.includes("ldo") || name.includes("regulator")) return "ldo_regulator";
  return "generic";
}

export function buildDraftDeviceSearchQuery(component: SchematicComponent): string | null {
  const guidanceQuery = component.properties?.preferred_search_query;
  if (typeof guidanceQuery === "string" && guidanceQuery.trim()) {
    return guidanceQuery.trim();
  }
  const role = inferComponentRole(component);
  const value = String(component.value || "").trim();
  const pkg = String(component.packageName || "").trim();

  if (role === "resistor") return [value, "resistor", pkg].filter(Boolean).join(" ");
  if (role === "led") return [value, "LED", pkg].filter(Boolean).join(" ");
  if (role === "battery_connector") return "JST PH 2P battery connector";
  if (role === "power_connector") return ["header 2pin", pkg].filter(Boolean).join(" ");
  if (role === "input_capacitor") return [value, "capacitor", pkg].filter(Boolean).join(" ");
  if (role === "ldo_regulator") return [value, "ldo regulator", pkg].filter(Boolean).join(" ");
  const fallback = [String(component.name || "").trim(), value, pkg].filter(Boolean).join(" ");
  return fallback || null;
}

function buildDraftDeviceSearchFallbackQueries(component: SchematicComponent, primaryQuery: string): string[] {
  const role = inferComponentRole(component);
  if (role === "battery_connector") {
    return [primaryQuery, "JST PH 2P", "PH2.0-2P", "电池连接器 2P"].filter(
      (query, index, list) => Boolean(query) && list.indexOf(query) === index
    );
  }
  return [primaryQuery];
}

function pickBestSearchResult(
  component: SchematicComponent,
  results: LibrarySearchResultItem[]
): LibrarySearchResultItem | undefined {
  const role = inferComponentRole(component);
  const pkg = String(component.packageName || "").trim().toLowerCase();
  const filteredResults =
    role === "power_connector"
      ? results.filter((item) => isSuitableTwoPinConnector(item))
      : results;
  const candidates = filteredResults.length > 0 ? filteredResults : results;
  return candidates
    .map((item) => ({ item, score: scoreSearchResult(component, item) }))
    .sort((left, right) => right.score - left.score)[0]?.item;
}

function hasSuitableCandidates(component: SchematicComponent, results: LibrarySearchResultItem[]): boolean {
  const role = inferComponentRole(component);
  if (role === "power_connector") {
    return results.some((item) => isSuitableTwoPinConnector(item));
  }
  if (role === "battery_connector") {
    return results.some((item) => isSuitableBatteryConnector(item));
  }
  return results.length > 0;
}

function isSuitableTwoPinConnector(item: LibrarySearchResultItem): boolean {
  const haystack = `${item.name || ""} ${item.footprintName || ""} ${item.description || ""}`.toLowerCase();
  if (!haystack.trim()) return false;
  if (/(10x2|20p|20pin|32p|32pin|40p|40pin|16p|16pin)/i.test(haystack)) return false;
  return /(1x2|2pin|2p|hdr-th_1x2|header\s*1x2|header\s*2pin|conn.*2pin)/i.test(haystack);
}

function isSuitableBatteryConnector(item: LibrarySearchResultItem): boolean {
  const haystack = `${item.name || ""} ${item.footprintName || ""} ${item.description || ""}`.toLowerCase();
  if (!haystack.trim()) return false;
  if (/(10x2|20p|20pin|32p|32pin|40p|40pin|16p|16pin|42pin)/i.test(haystack)) return false;
  return /(ph2\.?0|jst|battery|电池|1x2|2pin|2p|conn.*2p|conn.*2pin)/i.test(haystack);
}

function scoreSearchResult(component: SchematicComponent, item: LibrarySearchResultItem): number {
  const role = inferComponentRole(component);
  const pkg = String(component.packageName || "").trim().toLowerCase();
  const value = String(component.value || "").trim().toLowerCase();
  const haystack = `${item.name || ""} ${item.footprintName || ""} ${item.description || ""}`.toLowerCase();

  let score = 0;
  if (pkg) {
    const footprint = String(item.footprintName || "").trim().toLowerCase();
    if (footprint === pkg) score += 100;
    else if (footprint.includes(pkg)) score += 60;
  }

  if (role === "power_connector") {
    if (/(hdr-th_1x2|1x2|2pin)/i.test(haystack)) score += 120;
  }
  if (role === "battery_connector") {
    if (/(ph2\.?0|jst|battery|电池)/i.test(haystack)) score += 150;
    if (/(1x2|2pin|2p)/i.test(haystack)) score += 120;
  }

  if (role === "resistor") {
    if (matchesResistanceValue(haystack, value)) score += 140;
  }

  if (role === "led") {
    if (value && haystack.includes(value)) score += 90;
    if (/infrared|fir/i.test(haystack) && !value.includes("infrared")) score -= 120;
  }

  return score;
}

function matchesResistanceValue(haystack: string, value: string): boolean {
  if (!value) return false;
  const normalizedValue = value.replace(/ω/gi, "ohm").replace(/\s+/g, "");
  const normalizedHaystack = haystack.replace(/ω/gi, "ohm").replace(/\s+/g, "");
  if (normalizedHaystack.includes(normalizedValue)) return true;
  if (normalizedValue === "150ohm" && /\b1500\b/.test(normalizedHaystack)) return false;
  if (normalizedValue === "150ohm" && (normalizedHaystack.includes("阻值:150ohm") || normalizedHaystack.includes("阻值:150"))) {
    return true;
  }
  return false;
}

function toSelectedDevice(
  component: SchematicComponent,
  query: string,
  result: LibrarySearchResultItem,
  detail?: LibraryDeviceDetail | null
): DraftPlanSelectedDevice {
  const detailPins = extractDetailPins(detail);
  return {
    componentId: component.id,
    componentRef: component.ref,
    role: inferComponentRole(component),
    query,
    deviceUuid: result.uuid,
    libraryUuid: result.libraryUuid,
    name: result.name,
    manufacturer: result.manufacturer,
    symbolUuid: result.symbolUuid,
    symbolName: result.symbolName,
    footprintUuid: result.footprintUuid,
    footprintName: result.footprintName,
    pinCount: detailPins.length,
    pinSummary:
      detailPins.length > 0
        ? detailPins
            .slice(0, 4)
            .map((pin) => [pin.pinNumber, pin.pinName].filter(Boolean).join(":"))
            .filter(Boolean)
            .join(", ")
        : detail
          ? "device_detail_without_pins"
          : "device_detail_unavailable",
  };
}

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9+_-]+/g, "");
}

function splitTokens(value: string): string[] {
  return value
    .split(/[\s/()[\]-]+/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const PIN_SEMANTIC_ALIASES: Record<string, string> = {
  i2s_sck: "i2s_bclk",
  bclk: "i2s_bclk",
  sclk: "i2s_bclk",
  i2s_bclk: "i2s_bclk",
  i2s_ws: "i2s_lrck",
  ws: "i2s_lrck",
  lrck: "i2s_lrck",
  lrc: "i2s_lrck",
  i2s_lrck: "i2s_lrck",
  i2s_sd: "i2s_data",
  sd: "i2s_data",
  sdin: "i2s_data",
  sdout: "i2s_data",
  din: "i2s_data",
  dout: "i2s_data",
  adcdat: "i2s_data",
  dacdat: "i2s_data",
  i2s_din: "i2s_data",
  i2s_dout: "i2s_data",
  gnd: "ground",
  agnd: "ground",
  pgnd: "ground",
  vss: "ground",
  vbat: "battery",
  bat: "battery",
  "bat+": "battery_pos",
  "bat-": "battery_neg",
  pos: "positive",
  neg: "negative",
};

function normalizePinSemantic(name?: string, pinNumber?: string): string[] {
  const aliases = new Set<string>();
  const addAlias = (value: string): void => {
    const normalized = normalizeToken(value);
    if (!normalized) {
      return;
    }
    aliases.add(normalized);
    const semantic = PIN_SEMANTIC_ALIASES[normalized];
    if (semantic) {
      aliases.add(semantic);
    }
  };

  if (name) {
    addAlias(name);
    for (const token of splitTokens(name)) {
      addAlias(token);
    }
  }
  if (pinNumber) {
    addAlias(pinNumber);
  }
  return [...aliases];
}

function extractDetailPins(detail: LibraryDeviceDetail | null | undefined): Array<{
  pinName?: string;
  pinNumber?: string;
  electricalType?: string;
}> {
  const direct = Array.isArray(detail?.pins) ? detail!.pins : undefined;
  const rawRecord =
    typeof detail?.raw === "object" && detail.raw !== null ? (detail.raw as Record<string, unknown>) : undefined;
  const nestedPinCandidates: unknown[] = [
    rawRecord?.pins,
    rawRecord?.symbol && typeof rawRecord.symbol === "object" ? (rawRecord.symbol as Record<string, unknown>).pins : undefined,
    rawRecord?.device && typeof rawRecord.device === "object" ? (rawRecord.device as Record<string, unknown>).pins : undefined,
    rawRecord?.data && typeof rawRecord.data === "object" ? (rawRecord.data as Record<string, unknown>).pins : undefined,
  ];
  const source =
    direct ??
    nestedPinCandidates.find((candidate) => Array.isArray(candidate));
  const directPins = Array.isArray(source)
    ? source
        .map((item) => {
          if (typeof item !== "object" || item === null) {
            return undefined;
          }
          const record = item as Record<string, unknown>;
          const pinName = typeof record.pinName === "string" ? record.pinName : typeof record.name === "string" ? record.name : undefined;
          const pinNumber =
            typeof record.pinNumber === "string" ? record.pinNumber : typeof record.number === "string" ? record.number : undefined;
          const electricalType =
            typeof record.electricalType === "string"
              ? record.electricalType
              : typeof record.type === "string"
                ? record.type
                : undefined;
          if (!pinName && !pinNumber) {
            return undefined;
          }
          return { pinName, pinNumber, electricalType };
        })
        .filter((item): item is { pinName?: string; pinNumber?: string; electricalType?: string } => Boolean(item))
    : [];
  if (directPins.length > 0) {
    return directPins;
  }

  const dataStrSources = [
    typeof rawRecord?.dataStr === "string" ? rawRecord.dataStr : undefined,
    typeof rawRecord?.rawData === "string" ? rawRecord.rawData : undefined,
    typeof rawRecord?.source === "string" ? rawRecord.source : undefined,
    typeof rawRecord?.documentSource === "string" ? rawRecord.documentSource : undefined,
    typeof (detail as Record<string, unknown>)?.dataStr === "string"
      ? ((detail as Record<string, unknown>).dataStr as string)
      : undefined,
    typeof (detail as Record<string, unknown>)?.rawData === "string"
      ? ((detail as Record<string, unknown>).rawData as string)
      : undefined,
    typeof (detail as Record<string, unknown>)?.source === "string"
      ? ((detail as Record<string, unknown>).source as string)
      : undefined,
    typeof (detail as Record<string, unknown>)?.documentSource === "string"
      ? ((detail as Record<string, unknown>).documentSource as string)
      : undefined,
  ].filter((item): item is string => Boolean(item && item.trim()));

  for (const sourceText of dataStrSources) {
    const parsedPins = extractPinsFromDataStr(sourceText);
    if (parsedPins.length > 0) {
      return parsedPins;
    }
  }

  return [];
}

function extractPinsFromDataStr(dataStr: string): Array<{
  pinName?: string;
  pinNumber?: string;
  electricalType?: string;
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataStr);
  } catch {
    return [];
  }
  if (typeof parsed !== "object" || parsed === null) {
    return [];
  }
  const shape = Array.isArray((parsed as Record<string, unknown>).shape)
    ? ((parsed as Record<string, unknown>).shape as unknown[])
    : [];
  return shape
    .map((item) => {
      if (typeof item !== "object" || item === null) {
        return undefined;
      }
      const record = item as Record<string, unknown>;
      const pinName =
        typeof record.pinName === "string"
          ? record.pinName
          : typeof record.name === "string"
            ? record.name
            : typeof record.pin === "string"
              ? record.pin
              : undefined;
      const pinNumber =
        typeof record.pinNumber === "string"
          ? record.pinNumber
          : typeof record.number === "string"
            ? record.number
            : typeof record.num === "string"
              ? record.num
              : undefined;
      const electricalType =
        typeof record.electricalType === "string"
          ? record.electricalType
          : typeof record.type === "string"
            ? record.type
            : undefined;
      if (!pinName && !pinNumber) {
        return undefined;
      }
      return { pinName, pinNumber, electricalType };
    })
    .filter((item): item is { pinName?: string; pinNumber?: string; electricalType?: string } => Boolean(item));
}

function extractAssociatedSymbolRef(detail: LibraryDeviceDetail | null | undefined): {
  symbolUuid?: string;
  libraryUuid?: string;
} {
  if (!detail) {
    return {};
  }
  const rawRecord =
    typeof detail.raw === "object" && detail.raw !== null ? (detail.raw as Record<string, unknown>) : undefined;
  const association =
    rawRecord && typeof rawRecord.association === "object" && rawRecord.association !== null
      ? (rawRecord.association as Record<string, unknown>)
      : undefined;
  const associationSymbol =
    association && typeof association.symbol === "object" && association.symbol !== null
      ? (association.symbol as Record<string, unknown>)
      : undefined;
  const symbol =
    rawRecord && typeof rawRecord.symbol === "object" && rawRecord.symbol !== null
      ? (rawRecord.symbol as Record<string, unknown>)
      : undefined;
  return {
    symbolUuid:
      detail.symbol?.uuid ||
      (typeof association?.symbolUuid === "string" ? association.symbolUuid : undefined) ||
      (typeof associationSymbol?.uuid === "string" ? associationSymbol.uuid : undefined) ||
      (typeof symbol?.uuid === "string" ? symbol.uuid : undefined),
    libraryUuid:
      detail.symbol?.libraryUuid ||
      (typeof associationSymbol?.libraryUuid === "string" ? associationSymbol.libraryUuid : undefined) ||
      (typeof symbol?.libraryUuid === "string" ? symbol.libraryUuid : undefined) ||
      detail.libraryUuid,
  };
}

function scoreRealPinMatch(planPin: SchematicPin, realPin: { pinName?: string; pinNumber?: string }): number {
  let score = 0;
  if (planPin.pinNumber && realPin.pinNumber && planPin.pinNumber === realPin.pinNumber) {
    score += 100;
  }
  if (planPin.pinName && realPin.pinName && planPin.pinName === realPin.pinName) {
    score += 90;
  }
  const planAliases = normalizePinSemantic(planPin.pinName, planPin.pinNumber);
  const realAliases = normalizePinSemantic(realPin.pinName, realPin.pinNumber);
  if (planAliases.some((alias) => realAliases.includes(alias))) {
    score += 60;
  }
  return score;
}

function canFallbackToDraftPins(component: SchematicComponent | undefined, pins: SchematicPin[]): boolean {
  if (!component || !hasPlacementDevice(component) || pins.length === 0) {
    return false;
  }
  const role = inferComponentRole(component);
  const fallbackRoles = new Set(["battery_connector", "resistor", "led", "power_connector", "input_capacitor"]);
  return fallbackRoles.has(role) && pins.every((pin) => Boolean(pin.pinName || pin.pinNumber));
}

function fallbackToDraftPin(pin: SchematicPin): SchematicPin {
  const fallbackName = pin.resolvedPinName ?? pin.pinName ?? pin.pinNumber;
  const fallbackNumber = pin.resolvedPinNumber ?? pin.pinNumber ?? pin.pinName;
  return {
    ...pin,
    resolvedPinName: fallbackName,
    resolvedPinNumber: fallbackNumber,
    resolvedElectricalType: pin.resolvedElectricalType ?? pin.electricalType,
    pinResolutionStatus: "resolved",
    pinResolutionConfidence: pin.pinResolutionConfidence ?? 0.5,
    pinResolutionReason: "fallback_draft_pin_without_library_pins",
  };
}

function rewritePlanPinsWithResolvedDevicePins(
  plan: DraftPlan,
  detailsByComponentId: Map<string, LibraryDeviceDetail>
): DraftPlan {
  if (detailsByComponentId.size === 0) {
    return plan;
  }
  const usedRealPinKeys = new Set<string>();
  const loggedFailureKeys = new Set<string>();
  const componentsById = new Map(plan.components.map((component) => [component.id, component]));
  const pins: SchematicPin[] = plan.pins.map((pin): SchematicPin => {
    const detail = detailsByComponentId.get(pin.componentId);
    const component = componentsById.get(pin.componentId);
    const componentPins = plan.pins.filter((item) => item.componentId === pin.componentId);
    if (!detail) {
      return {
        ...pin,
        pinResolutionStatus: pin.pinResolutionStatus ?? "unresolved",
        pinResolutionConfidence: pin.pinResolutionConfidence ?? 0,
        pinResolutionReason: pin.pinResolutionReason ?? "device_detail_unavailable",
      };
    }
    const realPins = extractDetailPins(detail);
    if (realPins.length === 0) {
      if (canFallbackToDraftPins(component, componentPins)) {
        return fallbackToDraftPin(pin);
      }
      const logKey = `${pin.componentId}:device_detail_without_pins`;
      if (!loggedFailureKeys.has(logKey)) {
        loggedFailureKeys.add(logKey);
        logLibraryPinResolutionFailure({
          componentId: pin.componentId,
          componentRef: component?.ref,
          deviceUuid: component?.properties?.device_uuid,
          libraryUuid: component?.properties?.library_uuid,
          reason: "device_detail_without_pins",
          detail,
          planPins: componentPins,
        });
      }
      return {
        ...pin,
        pinResolutionStatus: "unresolved",
        pinResolutionConfidence: 0,
        pinResolutionReason: "device_detail_without_pins",
      };
    }
    let bestScore = -1;
    let bestMatch: (typeof realPins)[number] | undefined;
    for (const realPin of realPins) {
      const realKey = `${pin.componentId}:${realPin.pinNumber || ""}:${realPin.pinName || ""}`;
      if (usedRealPinKeys.has(realKey)) {
        continue;
      }
      const score = scoreRealPinMatch(pin, realPin);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = realPin;
      }
    }
    if (!bestMatch || bestScore <= 0) {
      const logKey = `${pin.componentId}:no_matching_library_pin`;
      if (!loggedFailureKeys.has(logKey)) {
        loggedFailureKeys.add(logKey);
        logLibraryPinResolutionFailure({
          componentId: pin.componentId,
          componentRef: component?.ref,
          deviceUuid: component?.properties?.device_uuid,
          libraryUuid: component?.properties?.library_uuid,
          reason: "no_matching_library_pin",
          detail,
          planPins: componentPins,
        });
      }
      return {
        ...pin,
        pinResolutionStatus: "unresolved",
        pinResolutionConfidence: 0,
        pinResolutionReason: "no_matching_library_pin",
      };
    }
    usedRealPinKeys.add(`${pin.componentId}:${bestMatch.pinNumber || ""}:${bestMatch.pinName || ""}`);
    return {
      ...pin,
      resolvedPinName: bestMatch.pinName ?? pin.pinName,
      resolvedPinNumber: bestMatch.pinNumber ?? pin.pinNumber,
      resolvedElectricalType: bestMatch.electricalType ?? pin.electricalType,
      pinResolutionStatus: "resolved",
      pinResolutionConfidence: Math.min(1, bestScore / 100),
      pinResolutionReason: "matched_library_pin",
    };
  });
  return {
    ...plan,
    pins,
  };
}

export async function resolveDraftPlanDevices(
  plan: DraftPlan,
  searchLibraryDevices: SearchLibraryDevices,
  getLibraryDevice?: GetLibraryDevice,
  getLibrarySymbol?: GetLibrarySymbol,
  getLibrarySymbolSource?: GetLibrarySymbolSource
): Promise<DraftPlan> {
  const existingSelectedDevices = Array.isArray(plan.selectedDevices) ? plan.selectedDevices.slice() : [];
  const detailsByComponentId = new Map<string, LibraryDeviceDetail>();
  const components = await Promise.all(
    plan.components.map(async (component) => {
      if (hasPlacementDevice(component)) {
        if (getLibraryDevice && component.properties.device_uuid) {
          const detail = await getLibraryDevice({
            deviceUuid: component.properties.device_uuid,
            libraryUuid: component.properties.library_uuid,
          });
          if (detail) {
            let resolvedDetail = detail;
            if (extractDetailPins(resolvedDetail).length === 0 && (getLibrarySymbol || getLibrarySymbolSource)) {
              const symbolRef = extractAssociatedSymbolRef(resolvedDetail);
              logLibrarySymbolResolutionProbe({
                stage: "device_to_symbol_ref",
                componentId: component.id,
                componentRef: component.ref,
                deviceUuid: component.properties.device_uuid,
                libraryUuid: component.properties.library_uuid,
                symbolUuid: symbolRef.symbolUuid,
                symbolLibraryUuid: symbolRef.libraryUuid,
                detail: resolvedDetail,
                note: symbolRef.symbolUuid ? "resolved symbol ref from device detail" : "no symbol ref resolved from device detail",
              });
              if (symbolRef.symbolUuid) {
                const symbolDetail = getLibrarySymbol
                  ? await getLibrarySymbol({
                      symbolUuid: symbolRef.symbolUuid,
                      libraryUuid: symbolRef.libraryUuid,
                    })
                  : null;
                logLibrarySymbolResolutionProbe({
                  stage: "symbol_detail_result",
                  componentId: component.id,
                  componentRef: component.ref,
                  deviceUuid: component.properties.device_uuid,
                  libraryUuid: component.properties.library_uuid,
                  symbolUuid: symbolRef.symbolUuid,
                  symbolLibraryUuid: symbolRef.libraryUuid,
                  detail: symbolDetail,
                  note:
                    symbolDetail && extractDetailPins(symbolDetail).length > 0
                      ? "symbol detail returned usable pins"
                      : "symbol detail missing or still without pins",
                });
                if (symbolDetail && extractDetailPins(symbolDetail).length > 0) {
                  resolvedDetail = {
                    ...resolvedDetail,
                    pins: symbolDetail.pins,
                    raw: symbolDetail.raw ?? resolvedDetail.raw,
                  };
                }
                if (extractDetailPins(resolvedDetail).length === 0 && getLibrarySymbolSource) {
                  const symbolSourceDetail = await getLibrarySymbolSource({
                    symbolUuid: symbolRef.symbolUuid,
                    libraryUuid: symbolRef.libraryUuid,
                  });
                  logLibrarySymbolResolutionProbe({
                    stage: "symbol_detail_result",
                    componentId: component.id,
                    componentRef: component.ref,
                    deviceUuid: component.properties.device_uuid,
                    libraryUuid: component.properties.library_uuid,
                    symbolUuid: symbolRef.symbolUuid,
                    symbolLibraryUuid: symbolRef.libraryUuid,
                    detail: symbolSourceDetail,
                    note:
                      symbolSourceDetail && extractDetailPins(symbolSourceDetail).length > 0
                        ? "symbol source detail returned usable pins"
                        : "symbol source detail missing or still without pins",
                  });
                  if (symbolSourceDetail && extractDetailPins(symbolSourceDetail).length > 0) {
                    resolvedDetail = {
                      ...resolvedDetail,
                      pins: symbolSourceDetail.pins,
                      raw: symbolSourceDetail.raw ?? resolvedDetail.raw,
                    };
                  }
                }
              }
            }
            detailsByComponentId.set(component.id, resolvedDetail);
          }
        }
        return withResolutionStatus(component, "resolved", "already_specified");
      }
      const query = buildDraftDeviceSearchQuery(component);
      if (!query) {
        return withResolutionStatus(component, "unresolved", "missing_search_query");
      }
      const queryCandidates = buildDraftDeviceSearchFallbackQueries(component, query);
      let results: LibrarySearchResultItem[] | null = null;
      let effectiveQuery = query;
      for (const candidateQuery of queryCandidates) {
        const attemptedResults = await searchLibraryDevices(candidateQuery);
        if (attemptedResults && attemptedResults.length > 0) {
          results = attemptedResults;
          effectiveQuery = candidateQuery;
          break;
        }
      }
      if (!results || results.length === 0) {
        return {
          ...withResolutionStatus(component, "unresolved", "no_search_results"),
          properties: {
            ...component.properties,
            preferred_search_query: query,
            device_resolution_status: "unresolved",
            device_resolution_reason: "no_search_results",
          },
        };
      }
      if (!hasSuitableCandidates(component, results)) {
        return {
          ...withResolutionStatus(component, "unresolved", "all_candidates_filtered"),
          properties: {
            ...component.properties,
            preferred_search_query: query,
            device_resolution_status: "unresolved",
            device_resolution_reason: "all_candidates_filtered",
          },
        };
      }
      const picked = pickBestSearchResult(component, results);
      if (!picked?.uuid || !picked.libraryUuid) {
        return {
          ...withResolutionStatus(component, "unresolved", "no_eligible_candidate"),
          properties: {
            ...component.properties,
            preferred_search_query: query,
            device_resolution_status: "unresolved",
            device_resolution_reason: "no_eligible_candidate",
          },
        };
      }
      let detail: LibraryDeviceDetail | null | undefined;
      if (getLibraryDevice) {
        detail = await getLibraryDevice({
          deviceUuid: picked.uuid,
          libraryUuid: picked.libraryUuid,
        });
        if (detail) {
          let resolvedDetail = detail;
          if (extractDetailPins(resolvedDetail).length === 0 && getLibrarySymbol) {
            const symbolRef = extractAssociatedSymbolRef(resolvedDetail);
            const fallbackSymbolUuid = symbolRef.symbolUuid || picked.symbolUuid;
            logLibrarySymbolResolutionProbe({
              stage: "device_to_symbol_ref",
              componentId: component.id,
              componentRef: component.ref,
              deviceUuid: picked.uuid,
              libraryUuid: picked.libraryUuid,
              symbolUuid: fallbackSymbolUuid,
              symbolLibraryUuid: symbolRef.libraryUuid || picked.libraryUuid,
              detail: resolvedDetail,
              note: fallbackSymbolUuid ? "resolved symbol ref from device/search detail" : "no symbol ref resolved from device/search detail",
            });
            if (fallbackSymbolUuid) {
              const symbolDetail = await getLibrarySymbol({
                symbolUuid: fallbackSymbolUuid,
                libraryUuid: symbolRef.libraryUuid || picked.libraryUuid,
              });
              logLibrarySymbolResolutionProbe({
                stage: "symbol_detail_result",
                componentId: component.id,
                componentRef: component.ref,
                deviceUuid: picked.uuid,
                libraryUuid: picked.libraryUuid,
                symbolUuid: fallbackSymbolUuid,
                symbolLibraryUuid: symbolRef.libraryUuid || picked.libraryUuid,
                detail: symbolDetail,
                note:
                  symbolDetail && extractDetailPins(symbolDetail).length > 0
                    ? "symbol detail returned usable pins"
                    : "symbol detail missing or still without pins",
              });
              if (symbolDetail && extractDetailPins(symbolDetail).length > 0) {
                resolvedDetail = {
                  ...resolvedDetail,
                  pins: symbolDetail.pins,
                  raw: symbolDetail.raw ?? resolvedDetail.raw,
                };
              }
            }
          }
          detailsByComponentId.set(component.id, resolvedDetail);
          detail = resolvedDetail;
        }
      }
      existingSelectedDevices.push(toSelectedDevice(component, effectiveQuery, picked, detail));
      return {
        ...component,
        libraryId: picked.uuid,
        packageName: picked.footprintName || component.packageName,
        properties: {
          ...component.properties,
          preferred_search_query: effectiveQuery,
          device_uuid: picked.uuid,
          library_uuid: picked.libraryUuid,
          symbol_uuid: picked.symbolUuid || "",
          footprint_uuid: picked.footprintUuid || "",
          device_resolution_status: "resolved",
          device_resolution_reason: "matched",
        },
      };
    })
  );

  return {
    ...rewritePlanPinsWithResolvedDevicePins(plan, detailsByComponentId),
    components,
    selectedDevices: existingSelectedDevices,
  };
}
