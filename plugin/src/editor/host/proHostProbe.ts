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
          pageName:
            currentPage?.name ??
            currentPage?.title ??
            currentSchematic?.name ??
            currentSchematic?.title ??
            currentDocument?.name ??
            currentDocument?.title,
        },
        selection: selection ?? { objectIds: [] },
      };
  } catch {
    return null;
  }
}

export async function getTypedSchematicContext(
  channel: PluginChannel
): Promise<SchematicContext | null> {
  const documentContext = await getTypedDocumentContext(channel);
  if (!documentContext) {
    return null;
  }

  if (
    typeof eda === "undefined" ||
    typeof eda.sch_PrimitiveComponent?.getAllPrimitiveId !== "function" ||
    typeof eda.sch_PrimitiveComponent?.get !== "function" ||
    typeof eda.sch_PrimitiveComponent?.getAllPinsByPrimitiveId !== "function" ||
    typeof eda.sch_PrimitiveWire?.getAll !== "function"
  ) {
    return null;
  }

  try {
    const [componentIdsRaw, rawWires] = await Promise.all([
      eda.sch_PrimitiveComponent.getAllPrimitiveId(undefined, false),
      eda.sch_PrimitiveWire.getAll(),
    ]);

    const componentIds = Array.isArray(componentIdsRaw)
      ? componentIdsRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
    const rawComponents =
      componentIds.length > 0 ? await eda.sch_PrimitiveComponent.get(componentIds) : [];
    const components = Array.isArray(rawComponents) ? rawComponents : [];
    const wires = Array.isArray(rawWires) ? rawWires : [];
    const pinsPerComponent = await Promise.all(
      componentIds.map(async (componentId) => {
        if (!componentId) {
          return [];
        }
        try {
          const pins = await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(componentId);
          return Array.isArray(pins) ? pins : [];
        } catch {
          return [];
        }
      })
    );

    const normalizedComponents = (
      await Promise.all(components.map((component) => normalizeTypedComponent(component)))
    ).filter((component): component is SchematicContext["components"][number] => Boolean(component));
    const normalizedPins = pinsPerComponent.flatMap((pins, index) =>
      pins
        .map((pin) => normalizeTypedPin(pin, normalizedComponents[index]?.id))
        .filter((pin): pin is SchematicContext["pins"][number] => Boolean(pin))
    );
    const normalizedNets = normalizeTypedNets(wires, normalizedPins);

    return {
      project: documentContext.project,
      selection: documentContext.selection,
      components: normalizedComponents,
      pins: normalizedPins,
      nets: normalizedNets,
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
    pins: normalizeLibraryDevicePins(record),
    raw: value,
  };
}

function normalizeLibraryDevicePins(record: Record<string, unknown>): LibraryDeviceDetail["pins"] | undefined {
  const candidates = [
    record.pins,
    record.pinList,
    record.symbolPins,
    typeof record.symbol === "object" && record.symbol !== null ? (record.symbol as Record<string, unknown>).pins : undefined,
    typeof record.raw === "object" && record.raw !== null ? (record.raw as Record<string, unknown>).pins : undefined,
  ];
  const source = candidates.find(Array.isArray);
  if (!Array.isArray(source)) {
    return undefined;
  }
  const pins = source
    .map((item) => normalizeLibraryDevicePin(item))
    .filter((item): item is NonNullable<LibraryDeviceDetail["pins"]>[number] => Boolean(item));
  return pins.length > 0 ? pins : undefined;
}

function normalizeLibraryDevicePin(
  value: unknown
): NonNullable<LibraryDeviceDetail["pins"]>[number] | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const pinName = readStringRecord(record, ["pinName", "name", "PinName", "Name"]);
  const pinNumber = readStringRecord(record, ["pinNumber", "number", "PinNumber", "Number"]);
  const id = readStringRecord(record, ["id", "uuid", "primitiveId", "PrimitiveId"]);
  if (!pinName && !pinNumber && !id) {
    return undefined;
  }
  return {
    id,
    pinName,
    name: pinName,
    pinNumber,
    number: pinNumber,
    electricalType: readStringRecord(record, ["electricalType", "ElectricalType", "type", "Type"]),
  };
}

async function normalizeTypedComponent(
  value: unknown
): Promise<SchematicContext["components"][number] | undefined> {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const id =
    (await callStateString(record, ["getState_PrimitiveId"])) ??
    readStringRecord(record, ["primitiveId", "PrimitiveId"]);
  if (!id) {
    return undefined;
  }

  const properties =
    normalizeStringMap(await callStateValue(record, ["getState_OtherProperty"])) ||
    normalizeStringMap(record.otherProperty);
  const componentType =
    (await callStateString(record, ["getState_ComponentType"])) ??
    readStringRecord(record, ["componentType", "ComponentType", "type", "Type"]);
  const ref =
    (await callStateString(record, ["getState_Designator"])) ??
    readStringRecord(record, ["designator", "Designator"]) ??
    readStringRecord(properties, ["Designator", "Ref", "REF", "位号"]);
  const name =
    (await callStateString(record, ["getState_Name"])) ??
    readStringRecord(record, ["name", "Name"]) ??
    readStringRecord(properties, ["Name", "Comment", "名称"]);
  const packageName =
    normalizeFootprintName(await callStateValue(record, ["getState_Footprint"])) ??
    normalizeFootprintName(record.footprint) ??
    readStringRecord(record, ["footprint", "Footprint", "footprintName", "FootprintName"]) ??
    readStringRecord(properties, [
      "Footprint",
      "footprint",
      "FootprintName",
      "footprintName",
      "Supplier Footprint",
      "SupplierFootprint",
      "Package",
      "封装",
    ]);
  const componentLink = normalizeLinkedEntity(await callStateValue(record, ["getState_Component"])) ?? normalizeLinkedEntity(record.component);
  const footprintLink =
    normalizeLinkedEntity(await callStateValue(record, ["getState_Footprint"])) ?? normalizeLinkedEntity(record.footprint);
  const libraryId =
    (await callStateString(record, ["getState_UniqueId"])) ??
    readStringRecord(record, ["uniqueId", "UniqueId", "componentUuid"]) ??
    componentLink?.uuid;
  const addIntoBom = normalizeBoolean(await callStateValue(record, ["getState_AddIntoBom"]));
  const addIntoPcb = normalizeBoolean(await callStateValue(record, ["getState_AddIntoPcb"]));
  const componentValue =
    readStringRecord(properties, ["Value", "value", "Comment", "COMMENT", "型号", "Model", "MPN"]) ??
    name;

  return {
    id,
    ref: shouldKeepComponentDesignator(componentType) ? ref : undefined,
    name,
    libraryId,
    packageName: packageName ?? footprintLink?.name,
    value: componentValue,
    componentType,
    addIntoBom,
    addIntoPcb,
    properties,
  };
}

function normalizeTypedPin(
  value: unknown,
  fallbackComponentId?: string
): SchematicContext["pins"][number] | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const properties =
    normalizeStringMap(callMaybeSync(record, ["getState_OtherProperty"])) ||
    normalizeStringMap(record.otherProperty);
  const id =
    callMaybeSyncString(record, ["getState_PrimitiveId"]) ??
    readStringRecord(record, ["primitiveId", "PrimitiveId", "id", "Id"]);
  const componentId =
    readStringRecord(record, ["parentPrimitiveId", "ParentPrimitiveId", "componentId"]) ?? fallbackComponentId;
  if (!id || !componentId) {
    return undefined;
  }

  return {
    id,
    componentId,
    pinNumber:
      callMaybeSyncString(record, ["getState_PinNumber"]) ??
      readStringRecord(record, ["pinNumber", "number", "Number"]),
    pinName:
      callMaybeSyncString(record, ["getState_PinName"]) ??
      readStringRecord(record, ["pinName", "name", "Name"]),
    electricalType:
      normalizePinType(callMaybeSync(record, ["getState_pinType"])) ??
      readStringRecord(record, ["electricalType", "type", "Type"]),
    noConnected:
      normalizeBoolean(callMaybeSync(record, ["getState_NoConnected"])) ??
      normalizeBoolean(record.noConnected) ??
      false,
    netName: readStringRecord(properties, ["Net", "NET", "net", "网络"]),
  };
}

function normalizeTypedNets(
  wires: unknown[],
  pins: SchematicContext["pins"]
): SchematicContext["nets"] {
  const pinIdsByNet = new Map<string, Set<string>>();
  const netsById = new Map<string, SchematicContext["nets"][number]>();

  for (const pin of pins) {
    const pinNetName = pin.netName?.trim();
    if (!pinNetName) continue;
    const bucket = pinIdsByNet.get(pinNetName) ?? new Set<string>();
    bucket.add(pin.id);
    pinIdsByNet.set(pinNetName, bucket);
  }

  for (const wire of wires) {
    if (typeof wire !== "object" || wire === null) {
      continue;
    }
    const record = wire as Record<string, unknown>;
    const id =
      callMaybeSyncString(record, ["getState_PrimitiveId"]) ??
      readStringRecord(record, ["primitiveId", "PrimitiveId"]);
    if (!id) {
      continue;
    }
    const name =
      callMaybeSyncString(record, ["getState_Net"]) ??
      readStringRecord(record, ["net", "Net"]);
    const nodeIds = name ? Array.from(pinIdsByNet.get(name) ?? []) : [];
    netsById.set(id, {
      id,
      name,
      nodeIds,
      isPower: Boolean(name && /^(vcc|vdd|gnd|3v3|5v|12v|power)/i.test(name)),
    });
  }

  if (netsById.size === 0 && pinIdsByNet.size > 0) {
    let syntheticIndex = 0;
    for (const [name, nodeSet] of pinIdsByNet.entries()) {
      syntheticIndex += 1;
      netsById.set(`net:${name || syntheticIndex}`, {
        id: `net:${name || syntheticIndex}`,
        name,
        nodeIds: Array.from(nodeSet),
        isPower: Boolean(name && /^(vcc|vdd|gnd|3v3|5v|12v|power)/i.test(name)),
      });
    }
  }

  return Array.from(netsById.values());
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record)
    .map(([key, entryValue]) => [key, stringifyRecordValue(entryValue)] as const)
    .filter((entry): entry is readonly [string, string] => Boolean(entry[1]));
  return Object.fromEntries(entries);
}

async function callStateString(
  record: Record<string, unknown>,
  methodNames: string[]
): Promise<string | undefined> {
  const value = await callStateValue(record, methodNames);
  return typeof value === "string" && value.trim() ? value : undefined;
}

async function callStateValue(
  record: Record<string, unknown>,
  methodNames: string[]
): Promise<unknown> {
  for (const methodName of methodNames) {
    const candidate = record[methodName];
    if (typeof candidate !== "function") {
      continue;
    }
    try {
      return await candidate.call(record);
    } catch {
      // Ignore typed getter failures and continue with other candidates.
    }
  }
  return undefined;
}

function callMaybeSync(record: Record<string, unknown>, methodNames: string[]): unknown {
  for (const methodName of methodNames) {
    const candidate = record[methodName];
    if (typeof candidate !== "function") {
      continue;
    }
    try {
      return candidate.call(record);
    } catch {
      // Ignore sync typed getter failures and continue with other candidates.
    }
  }
  return undefined;
}

function callMaybeSyncString(record: Record<string, unknown>, methodNames: string[]): string | undefined {
  const value = callMaybeSync(record, methodNames);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringifyRecordValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
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

function normalizeLinkedEntity(value: unknown):
  | {
      uuid?: string;
      name?: string;
      libraryUuid?: string;
    }
  | undefined {
  return normalizeLinkedLibraryItem(value);
}

function normalizeFootprintName(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  const entity = normalizeLinkedEntity(value);
  return entity?.name;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

function normalizePinType(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.toLowerCase();
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function shouldKeepComponentDesignator(componentType?: string): boolean {
  const normalized = componentType?.trim().toLowerCase();
  return normalized === undefined || normalized === "" || normalized === "part" || normalized === "component";
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
