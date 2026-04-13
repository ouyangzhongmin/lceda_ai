import type { SchematicComponent, SchematicPin } from "../../types/schematic";
import type { LibraryDeviceDetail, LibrarySearchResultItem } from "../host/runtime";
import type { DraftPlan, DraftPlanSelectedDevice } from "./draftPlan";

type SearchLibraryDevices = (query: string) => Promise<LibrarySearchResultItem[] | null>;
type GetLibraryDevice = (input: {
  deviceUuid: string;
  libraryUuid?: string;
}) => Promise<LibraryDeviceDetail | null>;

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
  const rawPins = rawRecord?.pins;
  const source = direct ?? (Array.isArray(rawPins) ? rawPins : undefined);
  if (!Array.isArray(source)) {
    return [];
  }
  return source
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
    .filter((item): item is { pinName?: string; pinNumber?: string; electricalType?: string } => Boolean(item));
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

function rewritePlanPinsWithResolvedDevicePins(
  plan: DraftPlan,
  detailsByComponentId: Map<string, LibraryDeviceDetail>
): DraftPlan {
  if (detailsByComponentId.size === 0) {
    return plan;
  }
  const usedRealPinKeys = new Set<string>();
  const pins = plan.pins.map((pin) => {
    const detail = detailsByComponentId.get(pin.componentId);
    if (!detail) {
      return pin;
    }
    const realPins = extractDetailPins(detail);
    if (realPins.length === 0) {
      return pin;
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
      return pin;
    }
    usedRealPinKeys.add(`${pin.componentId}:${bestMatch.pinNumber || ""}:${bestMatch.pinName || ""}`);
    return {
      ...pin,
      pinName: bestMatch.pinName ?? pin.pinName,
      pinNumber: bestMatch.pinNumber ?? pin.pinNumber,
      electricalType: bestMatch.electricalType ?? pin.electricalType,
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
  getLibraryDevice?: GetLibraryDevice
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
            detailsByComponentId.set(component.id, detail);
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
          detailsByComponentId.set(component.id, detail);
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
