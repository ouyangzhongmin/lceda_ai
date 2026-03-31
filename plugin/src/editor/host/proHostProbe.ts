import type { PluginChannel } from "../../types/schematic";
import type { LocateTarget } from "../../types/schematic";
import type { SchematicSelection } from "../../types/schematic";
import type { SchematicContext } from "../../types/schematic";
import type {
  LibraryDeviceDetail,
  LibraryScope,
  LibrarySearchResultItem,
} from "./runtime";

export interface TypedHostProbeResult {
  channel: PluginChannel;
  currentDocumentType?: string;
  currentDocumentUuid?: string;
  selectedPrimitiveIds: string[];
  typedApiAvailable: boolean;
}

export function hasTypedHostRuntime(): boolean {
  return (
    typeof eda !== "undefined" &&
    typeof eda.sch_SelectControl?.getAllSelectedPrimitives_PrimitiveId === "function" &&
    typeof eda.dmt_SelectControl?.getCurrentDocumentInfo === "function"
  );
}

export async function getTypedSelectedPrimitiveIds(): Promise<string[]> {
  if (!hasTypedHostRuntime()) {
    return [];
  }
  try {
    return await eda.sch_SelectControl.getAllSelectedPrimitives_PrimitiveId();
  } catch {
    return [];
  }
}

export async function getTypedSelection(): Promise<SchematicSelection | null> {
  const objectIds = await getTypedSelectedPrimitiveIds();
  if (objectIds.length === 0) {
    return null;
  }
  return { objectIds };
}

export function openTypedHostWindow(url: string): boolean {
  if (typeof eda === "undefined") {
    return false;
  }
  try {
    eda.sys_Window.open(url);
    return true;
  } catch {
    return false;
  }
}

export function hasTypedWindowOpenCapability(): boolean {
  return typeof eda !== "undefined" && typeof eda.sys_Window?.open === "function";
}

export function hasTypedToastCapability(): boolean {
  return typeof eda !== "undefined" && typeof eda.sys_Message?.showToastMessage === "function";
}

export function showTypedToast(message: string, timeoutMs = 2200): boolean {
  if (!hasTypedToastCapability()) {
    return false;
  }
  try {
    eda.sys_Message.showToastMessage(message, 1, timeoutMs);
    return true;
  } catch {
    return false;
  }
}

export async function locateTypedHostObject(target: LocateTarget): Promise<boolean> {
  if (
    typeof eda === "undefined" ||
    typeof eda.sch_SelectControl?.doSelectPrimitives !== "function" ||
    typeof eda.sch_Primitive?.getPrimitivesBBox !== "function" ||
    typeof eda.sch_Document?.navigateToRegion !== "function"
  ) {
    return false;
  }

  try {
    const selected = await eda.sch_SelectControl.doSelectPrimitives(target.objectId);
    if (!selected) {
      return false;
    }

    const bbox = await eda.sch_Primitive.getPrimitivesBBox([target.objectId]);
    if (bbox) {
      await eda.sch_Document.navigateToRegion(bbox.minX, bbox.maxX, bbox.maxY, bbox.minY);
    }

    return true;
  } catch {
    return false;
  }
}

export async function getTypedDocumentContext(
  channel: PluginChannel
): Promise<Pick<SchematicContext, "project" | "selection"> | null> {
  if (!hasTypedHostRuntime()) {
    return null;
  }

  try {
    const [currentDocument, currentSchematic, currentPage, selection] = await Promise.all([
      eda.dmt_SelectControl.getCurrentDocumentInfo(),
      eda.dmt_Schematic.getCurrentSchematicInfo().catch(() => undefined),
      eda.dmt_Schematic.getCurrentSchematicPageInfo().catch(() => undefined),
      getTypedSelection(),
    ]);

    return {
      project: {
        channel,
        projectId: currentSchematic?.parentProjectUuid ?? currentDocument?.parentProjectUuid,
        pageId: currentPage?.uuid ?? currentDocument?.uuid,
      },
      selection: selection ?? { objectIds: [] },
    };
  } catch {
    return null;
  }
}

export async function probeTypedHostRuntime(
  channel: PluginChannel
): Promise<TypedHostProbeResult | null> {
  if (!hasTypedHostRuntime()) {
    return null;
  }

  const currentDocument = await eda.dmt_SelectControl.getCurrentDocumentInfo();
  const selectedPrimitiveIds =
    channel === "professional" || channel === "standard" ? await getTypedSelectedPrimitiveIds() : [];

  return {
    channel,
    currentDocumentType:
      currentDocument?.documentType !== undefined ? String(currentDocument.documentType) : undefined,
    currentDocumentUuid: currentDocument?.uuid,
    selectedPrimitiveIds,
    typedApiAvailable: true,
  };
}

function resolveScopeLibraryUuid(scope: LibraryScope): Promise<string | undefined> {
  if (typeof eda === "undefined" || typeof eda.lib_LibrariesList === "undefined") {
    return Promise.resolve(undefined);
  }

  try {
    switch (scope) {
      case "project":
        return eda.lib_LibrariesList.getProjectLibraryUuid();
      case "personal":
        return eda.lib_LibrariesList.getPersonalLibraryUuid();
      case "favorite":
        return eda.lib_LibrariesList.getFavoriteLibraryUuid();
      case "system":
      default:
        return eda.lib_LibrariesList.getSystemLibraryUuid();
    }
  } catch {
    return Promise.resolve(undefined);
  }
}

export function hasTypedLibraryRuntime(): boolean {
  return (
    typeof eda !== "undefined" &&
    typeof eda.lib_Device?.search === "function" &&
    typeof eda.lib_LibrariesList?.getSystemLibraryUuid === "function"
  );
}

export function hasTypedSchematicPlacementRuntime(): boolean {
  return (
    typeof eda !== "undefined" &&
    typeof eda.sch_PrimitiveComponent?.create === "function" &&
    typeof eda.sch_PrimitiveWire?.create === "function"
  );
}

export async function typedSearchLibraryDevices(input: {
  query: string;
  scope?: LibraryScope;
  libraryUuid?: string;
  classification?: string[];
  symbolType?: number;
  pageSize?: number;
  page?: number;
}): Promise<LibrarySearchResultItem[] | null> {
  if (!hasTypedLibraryRuntime()) {
    return null;
  }

  const query = input.query.trim();
  if (!query) {
    return [];
  }

  try {
    const libraryUuid = input.libraryUuid ?? (await resolveScopeLibraryUuid(input.scope ?? "system"));
    const results = await eda.lib_Device.search(
      query,
      libraryUuid,
      input.classification && input.classification.length > 0 ? input.classification : undefined,
      input.symbolType as never,
      input.pageSize,
      input.page
    );
    return Array.isArray(results) ? results.map(normalizeLibrarySearchResult) : [];
  } catch {
    return null;
  }
}

export async function typedGetLibraryDevice(input: {
  deviceUuid: string;
  libraryUuid?: string;
  scope?: LibraryScope;
}): Promise<LibraryDeviceDetail | null> {
  if (
    typeof eda === "undefined" ||
    typeof eda.lib_Device?.get !== "function" ||
    typeof eda.lib_LibrariesList?.getSystemLibraryUuid !== "function"
  ) {
    return null;
  }

  try {
    const libraryUuid = input.libraryUuid ?? (await resolveScopeLibraryUuid(input.scope ?? "system"));
    const result = await eda.lib_Device.get(input.deviceUuid, libraryUuid);
    return normalizeLibraryDeviceDetail(result);
  } catch {
    return null;
  }
}

export async function typedGetLibraryDevicesByLcscIds(input: {
  lcscIds: string[];
  libraryUuid?: string;
  scope?: LibraryScope;
  allowMultiMatch?: boolean;
}): Promise<LibraryDeviceDetail[] | null> {
  if (
    typeof eda === "undefined" ||
    typeof eda.lib_Device?.getByLcscIds !== "function" ||
    typeof eda.lib_LibrariesList?.getSystemLibraryUuid !== "function"
  ) {
    return null;
  }

  const lcscIds = input.lcscIds.map((item) => item.trim()).filter(Boolean);
  if (lcscIds.length === 0) {
    return [];
  }

  try {
    const libraryUuid = input.libraryUuid ?? (await resolveScopeLibraryUuid(input.scope ?? "system"));
    const results = await eda.lib_Device.getByLcscIds(lcscIds, libraryUuid, input.allowMultiMatch);
    return Array.isArray(results) ? results.map(normalizeLibraryDeviceDetail) : [];
  } catch {
    return null;
  }
}

function normalizeLibrarySearchResult(value: unknown): LibrarySearchResultItem {
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    uuid: readStringRecord(record, ["uuid"]) ?? "",
    name: readStringRecord(record, ["name"]) ?? "",
    libraryUuid: readStringRecord(record, ["libraryUuid"]) ?? "",
    symbolUuid: readStringRecord(record, ["symbolUuid"]),
    symbolName: readStringRecord(record, ["symbolName"]),
    footprintUuid: readStringRecord(record, ["footprintUuid"]),
    footprintName: readStringRecord(record, ["footprintName"]),
    manufacturer: readStringRecord(record, ["manufacturer"]),
    supplier: readStringRecord(record, ["supplier"]),
    supplierId: readStringRecord(record, ["supplierId"]),
    lcscInventory: readNumberRecord(record, ["lcscInventory"]),
    lcscPrice: readNumberRecord(record, ["lcscPrice"]),
    jlcInventory: readNumberRecord(record, ["jlcInventory", "jlcInventory"]),
    jlcPrice: readNumberRecord(record, ["jlcPrice"]),
    description: readStringRecord(record, ["description"]),
  };
}

function normalizeLibraryDeviceDetail(value: unknown): LibraryDeviceDetail {
  const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return {
    uuid: readStringRecord(record, ["uuid"]) ?? "",
    name: readStringRecord(record, ["name"]),
    libraryUuid: readStringRecord(record, ["libraryUuid"]),
    lcscId: readStringRecord(record, ["supplierId", "lcscId"]),
    manufacturer: readStringRecord(record, ["manufacturer"]),
    supplier: readStringRecord(record, ["supplier"]),
    supplierId: readStringRecord(record, ["supplierId"]),
    description: readStringRecord(record, ["description"]),
    symbol: normalizeLinkedLibraryItem(record.symbol),
    footprint: normalizeLinkedLibraryItem(record.footprint),
    model3D: normalizeLinkedLibraryItem(record.model3D),
    otherProperty:
      typeof record.otherProperty === "object" && record.otherProperty !== null
        ? (record.otherProperty as Record<string, boolean | number | string | undefined>)
        : undefined,
    raw: value,
  };
}

function normalizeLinkedLibraryItem(value: unknown):
  | {
      uuid?: string;
      name?: string;
      libraryUuid?: string;
    }
  | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  return {
    uuid: readStringRecord(record, ["uuid"]),
    name: readStringRecord(record, ["name"]),
    libraryUuid: readStringRecord(record, ["libraryUuid"]),
  };
}

function readStringRecord(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function readNumberRecord(record: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}
