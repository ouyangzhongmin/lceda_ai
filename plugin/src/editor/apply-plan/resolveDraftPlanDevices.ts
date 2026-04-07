import type { SchematicComponent } from "../../types/schematic";
import type { LibrarySearchResultItem } from "../host/runtime";
import type { DraftPlan, DraftPlanSelectedDevice } from "./draftPlan";

type SearchLibraryDevices = (query: string) => Promise<LibrarySearchResultItem[] | null>;

function hasPlacementDevice(component: SchematicComponent): boolean {
  return Boolean(component.properties?.device_uuid && component.properties?.library_uuid);
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
  const pkg = String(component.packageName || "").trim().toLowerCase();
  if (!pkg) return results[0];
  return (
    results.find((item) => String(item.footprintName || "").trim().toLowerCase() === pkg) ||
    results.find((item) => String(item.footprintName || "").trim().toLowerCase().includes(pkg)) ||
    results[0]
  );
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
        return component;
      }
      const query = buildDraftDeviceSearchQuery(component);
      if (!query) {
        return component;
      }
      const results = await searchLibraryDevices(query);
      if (!results || results.length === 0) {
        return component;
      }
      const picked = pickBestSearchResult(component, results);
      if (!picked?.uuid || !picked.libraryUuid) {
        return component;
      }
      existingSelectedDevices.push(toSelectedDevice(component, query, picked));
      return {
        ...component,
        libraryId: picked.uuid,
        packageName: picked.footprintName || component.packageName,
        properties: {
          ...component.properties,
          device_uuid: picked.uuid,
          library_uuid: picked.libraryUuid,
          symbol_uuid: picked.symbolUuid || "",
          footprint_uuid: picked.footprintUuid || "",
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
