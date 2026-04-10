import type { SchematicComponent } from "../../types/schematic";
import type { LibrarySearchResultItem } from "../host/runtime";
import type { DraftPlan, DraftPlanSelectedDevice } from "./draftPlan";

type SearchLibraryDevices = (query: string) => Promise<LibrarySearchResultItem[] | null>;

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
  if (role === "power_connector") return ["header 2pin", pkg].filter(Boolean).join(" ");
  if (role === "input_capacitor") return [value, "capacitor", pkg].filter(Boolean).join(" ");
  if (role === "ldo_regulator") return [value, "ldo regulator", pkg].filter(Boolean).join(" ");
  const fallback = [String(component.name || "").trim(), value, pkg].filter(Boolean).join(" ");
  return fallback || null;
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
  return results.length > 0;
}

function isSuitableTwoPinConnector(item: LibrarySearchResultItem): boolean {
  const haystack = `${item.name || ""} ${item.footprintName || ""} ${item.description || ""}`.toLowerCase();
  if (!haystack.trim()) return false;
  if (/(10x2|20p|20pin|32p|32pin|40p|40pin|16p|16pin)/i.test(haystack)) return false;
  return /(1x2|2pin|2p|hdr-th_1x2|header\s*1x2|header\s*2pin|conn.*2pin)/i.test(haystack);
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
  result: LibrarySearchResultItem
): DraftPlanSelectedDevice {
  return {
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
  };
}

export async function resolveDraftPlanDevices(
  plan: DraftPlan,
  searchLibraryDevices: SearchLibraryDevices
): Promise<DraftPlan> {
  const existingSelectedDevices = Array.isArray(plan.selectedDevices) ? plan.selectedDevices.slice() : [];
  const components = await Promise.all(
    plan.components.map(async (component) => {
      if (hasPlacementDevice(component)) {
        return withResolutionStatus(component, "resolved", "already_specified");
      }
      const query = buildDraftDeviceSearchQuery(component);
      if (!query) {
        return withResolutionStatus(component, "unresolved", "missing_search_query");
      }
      const results = await searchLibraryDevices(query);
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
      existingSelectedDevices.push(toSelectedDevice(component, query, picked));
      return {
        ...component,
        libraryId: picked.uuid,
        packageName: picked.footprintName || component.packageName,
        properties: {
          ...component.properties,
          preferred_search_query: query,
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
    ...plan,
    components,
    selectedDevices: existingSelectedDevices,
  };
}
