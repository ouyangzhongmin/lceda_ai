import type {
  LocateTarget,
  PluginChannel,
  SchematicContext,
  SchematicSelection,
} from "../../types/schematic";
import {
  isProfessionalSchematicContext,
  isProfessionalSelection,
  resolveProfessionalHostCapabilities,
  type ProfessionalRawHostApi,
} from "./professionalHostApi";
import { getTypedDocumentContext, hasTypedToastCapability, hasTypedWindowOpenCapability, showTypedToast } from "./proHostProbe";
import {
  isStandardSchematicContext,
  isStandardSelection,
  resolveStandardHostCapabilities,
  type StandardRawHostApi,
} from "./standardHostApi";
import type { HostCapabilityReport, HostEditorBridge } from "./runtime";

type RawHostApi = StandardRawHostApi | ProfessionalRawHostApi;

export interface HostBridgeFactoryOptions {
  channel: PluginChannel;
  rawApi?: RawHostApi;
}

export function createHostBridge(options: HostBridgeFactoryOptions): HostEditorBridge {
  const { channel, rawApi } = options;
  if (channel === "professional") {
    return createProfessionalHostBridge(rawApi);
  }

  return createStandardHostBridge(rawApi);
}

export function createStandardHostBridge(rawApi?: RawHostApi): HostEditorBridge {
  const capabilities = resolveStandardHostCapabilities(rawApi as StandardRawHostApi | undefined);
  const typedWindowAvailable = hasTypedWindowOpenCapability();
  const typedToastAvailable = hasTypedToastCapability();
  const capabilityReport = buildCapabilityReport(
    "standard",
    Boolean(capabilities.getCurrentDocument || capabilities.getSelection),
    {
      getCurrentContext: Boolean(capabilities.getCurrentDocument),
      getSelection: Boolean(capabilities.getSelection),
      locate: Boolean(capabilities.locateObject),
    },
    {
      createEmptySchematicPage: Boolean(capabilities.createEmptySchematicPage),
      previewApplyPlan: Boolean(capabilities.previewApplyPlan),
      applyPlan: Boolean(capabilities.applyPlan),
      rollbackApplyPlan: Boolean(capabilities.rollbackApplyPlan),
      openExternal: Boolean(capabilities.openExternal || typedWindowAvailable),
      showToastMessage: Boolean(capabilities.showToastMessage || typedToastAvailable),
      searchLibraryDevices: false,
      getLibraryDevice: false,
      getLibraryDevicesByLcscIds: false,
    }
  );
  return {
    getChannel: () => "standard",
    isAvailable: () => Boolean(capabilities.getCurrentDocument || capabilities.getSelection),
    getCurrentContext: async () =>
      mapRawDocumentToContext("standard", capabilities.getCurrentDocument),
    getSelection: async () => mapRawSelection(capabilities.getSelection),
    locate: async (target) => {
      if (capabilities.locateObject) {
        await capabilities.locateObject(target);
        return;
      }
      throw new Error("standard host bridge locate is not available");
    },
    createEmptySchematicPage: async (input) => {
      if (!capabilities.createEmptySchematicPage) {
        throw new Error("standard host bridge createEmptySchematicPage is not available");
      }
      await capabilities.createEmptySchematicPage(input);
    },
    previewApplyPlan: capabilities.previewApplyPlan,
    applyPlan: capabilities.applyPlan,
    rollbackApplyPlan: capabilities.rollbackApplyPlan,
    openExternal: capabilities.openExternal,
    showToastMessage: async (message, timeoutMs) => {
      if (capabilities.showToastMessage) {
        await capabilities.showToastMessage(message, timeoutMs);
        return;
      }
      if (!showTypedToast(message, timeoutMs)) {
        throw new Error("host toast not available");
      }
    },
    searchLibraryDevices: undefined,
    getLibraryDevice: undefined,
    getLibraryDevicesByLcscIds: undefined,
    getCapabilityReport: () => capabilityReport,
  };
}

export function createProfessionalHostBridge(rawApi?: RawHostApi): HostEditorBridge {
  const capabilities = resolveProfessionalHostCapabilities(rawApi as ProfessionalRawHostApi | undefined);
  const typedWindowAvailable = hasTypedWindowOpenCapability();
  const typedToastAvailable = hasTypedToastCapability();
  const capabilityReport = buildCapabilityReport(
    "professional",
    Boolean(capabilities.getCurrentDocument || capabilities.getSelection),
    {
      getCurrentContext: Boolean(capabilities.getCurrentDocument),
      getSelection: Boolean(capabilities.getSelection),
      locate: Boolean(capabilities.locateObject),
    },
    {
      createEmptySchematicPage: Boolean(capabilities.createEmptySchematicPage),
      previewApplyPlan: Boolean(capabilities.previewApplyPlan),
      applyPlan: Boolean(capabilities.applyPlan),
      rollbackApplyPlan: Boolean(capabilities.rollbackApplyPlan),
      openExternal: Boolean(capabilities.openExternal || typedWindowAvailable),
      showToastMessage: Boolean(capabilities.showToastMessage || typedToastAvailable),
      searchLibraryDevices: Boolean(capabilities.searchLibraryDevices),
      getLibraryDevice: Boolean(capabilities.getLibraryDevice),
      getLibrarySymbol: Boolean(capabilities.getLibrarySymbol),
      getLibraryDevicesByLcscIds: Boolean(capabilities.getLibraryDevicesByLcscIds),
    }
  );
  return {
    getChannel: () => "professional",
    isAvailable: () => Boolean(capabilities.getCurrentDocument || capabilities.getSelection),
    getCurrentContext: async () =>
      mapRawDocumentToContext("professional", capabilities.getCurrentDocument),
    getSelection: async () =>
      mapRawSelection(capabilities.getSelection),
    locate: async (target) => {
      if (capabilities.locateObject) {
        await capabilities.locateObject(target);
        return;
      }
      throw new Error("professional host bridge locate is not available");
    },
    createEmptySchematicPage: async (input) => {
      if (!capabilities.createEmptySchematicPage) {
        throw new Error("professional host bridge createEmptySchematicPage is not available");
      }
      await capabilities.createEmptySchematicPage(input);
    },
    previewApplyPlan: capabilities.previewApplyPlan,
    applyPlan: capabilities.applyPlan,
    rollbackApplyPlan: capabilities.rollbackApplyPlan,
    openExternal: capabilities.openExternal,
    showToastMessage: async (message, timeoutMs) => {
      if (capabilities.showToastMessage) {
        await capabilities.showToastMessage(message, timeoutMs);
        return;
      }
      if (!showTypedToast(message, timeoutMs)) {
        throw new Error("host toast not available");
      }
    },
    searchLibraryDevices: capabilities.searchLibraryDevices,
    getLibraryDevice: capabilities.getLibraryDevice,
    getLibrarySymbol: capabilities.getLibrarySymbol,
    getLibraryDevicesByLcscIds: capabilities.getLibraryDevicesByLcscIds,
    getCapabilityReport: () => capabilityReport,
  };
}

async function mapRawDocumentToContext(
  channel: PluginChannel,
  getCurrentDocument: (() => Promise<unknown>) | undefined
): Promise<SchematicContext> {
  const typedDocumentContext = await getTypedDocumentContext(channel);
  if (!getCurrentDocument) {
    if (typedDocumentContext) {
      throw new Error(`${channel} host bridge returned metadata only; schematic primitives are unavailable`);
    }
    throw new Error(`${channel} host bridge missing getCurrentDocument`);
  }

  const rawDocument = await getCurrentDocument();

  if (channel === "standard" && isStandardSchematicContext(rawDocument)) {
    return rawDocument;
  }

  if (channel === "professional" && isProfessionalSchematicContext(rawDocument)) {
    return rawDocument;
  }

  const normalized = normalizeSchematicContext(rawDocument, channel);
  if (normalized) {
    if (typedDocumentContext) {
      return {
        ...normalized,
        project: {
          ...normalized.project,
          projectId: typedDocumentContext.project.projectId ?? normalized.project.projectId,
          pageId: typedDocumentContext.project.pageId ?? normalized.project.pageId,
          pageName: typedDocumentContext.project.pageName ?? normalized.project.pageName,
          channel,
        },
        selection: typedDocumentContext.selection.objectIds.length > 0
          ? typedDocumentContext.selection
          : normalized.selection,
      };
    }
    return normalized;
  }

  if (typedDocumentContext) {
    throw new Error(`${channel} host bridge returned metadata only; schematic primitives are unavailable`);
  }

  throw new Error(`${channel} host bridge could not map raw current document to schematic context`);
}

async function mapRawSelection(
  getSelection: (() => Promise<unknown>) | undefined
): Promise<SchematicSelection> {
  if (!getSelection) {
    return { objectIds: [] };
  }

  const rawSelection = await getSelection();
  if (isStandardSelection(rawSelection) || isProfessionalSelection(rawSelection)) {
    return rawSelection as SchematicSelection;
  }

  const normalized = normalizeSelection(rawSelection);
  if (normalized) {
    return normalized;
  }

  return { objectIds: [] };
}

function normalizeSelection(raw: unknown): SchematicSelection | undefined {
  if (Array.isArray(raw)) {
    const objectIds = raw.filter((item): item is string => typeof item === "string");
    if (objectIds.length > 0) {
      return { objectIds };
    }
  }

  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  const fromKnownKey = ["ids", "selectedIds", "shapeIds"]
    .map((key) => candidate[key])
    .find((value) => Array.isArray(value));
  if (Array.isArray(fromKnownKey)) {
    return {
      objectIds: fromKnownKey.filter((item): item is string => typeof item === "string"),
    };
  }

  return undefined;
}

function normalizeSchematicContext(raw: unknown, channel: PluginChannel): SchematicContext | undefined {
  if (typeof raw !== "object" || raw === null) {
    return undefined;
  }

  const candidate = raw as Record<string, unknown>;
  const components = pickArray(candidate, ["components", "compList", "symbols"]);
  const nets = pickArray(candidate, ["nets", "netList"]);
  const pins = pickArray(candidate, ["pins", "pinList"]);
  const selection = normalizeSelection(
    candidate.selection ?? candidate.selected ?? candidate.currentSelection ?? []
  ) ?? { objectIds: [] };

  const normalizedComponents = components
    .map((item, index) => normalizeComponent(item, index))
    .filter((item): item is SchematicContext["components"][number] => Boolean(item));
  const normalizedPins = pins
    .map((item, index) => normalizePin(item, index))
    .filter((item): item is SchematicContext["pins"][number] => Boolean(item));
  const normalizedNets = nets
    .map((item, index) => normalizeNet(item, index))
    .filter((item): item is SchematicContext["nets"][number] => Boolean(item));

  if (normalizedComponents.length === 0 && normalizedPins.length === 0 && normalizedNets.length === 0) {
    return undefined;
  }

  // Some hosts provide net names on pins but omit/obfuscate net.nodeIds. Rehydrate nodeIds from pin.netName.
  rehydrateNetNodeIds(normalizedNets, normalizedPins);

  return {
    project: {
      channel,
      projectId: readString(candidate, ["projectId", "project_id"]),
      pageId: readString(candidate, ["pageId", "page_id", "sheetId"]),
      pageName: readString(candidate, ["pageName", "page_name", "sheetName", "name", "title"]),
    },
    components: normalizedComponents,
    pins: normalizedPins,
    nets: normalizedNets,
    selection,
  };
}

function rehydrateNetNodeIds(
  nets: SchematicContext["nets"],
  pins: SchematicContext["pins"]
): void {
  if (!nets.length || !pins.length) return;

  const pinById = new Map(pins.map((pin) => [pin.id, pin]));
  const pinIdsByNetName = new Map<string, Set<string>>();
  for (const pin of pins) {
    const name = String(pin.netName || "").trim();
    if (!name) continue;
    const bucket = pinIdsByNetName.get(name) ?? new Set<string>();
    bucket.add(pin.id);
    pinIdsByNetName.set(name, bucket);
  }
  if (pinIdsByNetName.size === 0) return;

  let totalNodeIds = 0;
  let matchedNodeIds = 0;
  for (const net of nets) {
    totalNodeIds += net.nodeIds.length;
    for (const id of net.nodeIds) {
      if (pinById.has(id)) matchedNodeIds += 1;
    }
  }
  const mappingWeak = totalNodeIds === 0 || matchedNodeIds / Math.max(1, totalNodeIds) < 0.3;
  if (!mappingWeak) return;

  for (const net of nets) {
    const nameFromNet = String(net.name || "").trim();
    const nameFromId = String(net.id || "").trim();
    const candidateNames = [nameFromNet, nameFromId].filter(Boolean);
    if (candidateNames.length === 0) continue;

    // Pick the name that matches the most pins.
    let best: string | undefined;
    let bestCount = 0;
    for (const candidate of candidateNames) {
      const count = (pinIdsByNetName.get(candidate)?.size ?? 0);
      if (count > bestCount) {
        best = candidate;
        bestCount = count;
      }
    }
    if (!best || bestCount === 0) continue;
    const nodeIds = Array.from(pinIdsByNetName.get(best) ?? []);
    if (nodeIds.length === 0) continue;

    const shouldReplace =
      net.nodeIds.length === 0 || net.nodeIds.every((id) => !pinById.has(id));
    if (shouldReplace) {
      net.nodeIds = nodeIds;
    }
  }
}

function buildCapabilityReport(
  channel: PluginChannel,
  available: boolean,
  required: Record<string, boolean>,
  optional: Record<string, boolean>
): HostCapabilityReport {
  return {
    channel,
    available,
    missing: Object.entries(required)
      .filter(([, value]) => !value)
      .map(([key]) => key),
    optionalMissing: Object.entries(optional)
      .filter(([, value]) => !value)
      .map(([key]) => key),
  };
}

function normalizeComponent(item: unknown, index: number): SchematicContext["components"][number] | undefined {
  if (typeof item !== "object" || item === null) {
    return undefined;
  }
  const value = item as Record<string, unknown>;
  const id = readString(value, ["id", "uuid", "uid", "gId", "gid"]) ?? `cmp_auto_${index}`;
  return {
    id,
    ref: readString(value, ["ref", "designator", "name"]),
    name: readString(value, ["name", "title", "symbol"]),
    libraryId: readString(value, ["libraryId", "lib", "libId"]),
    packageName: readString(value, ["package", "footprint", "packageName"]),
    value: readString(value, ["value", "val"]),
    properties: normalizeProperties(value.properties),
  };
}

function normalizePin(item: unknown, index: number): SchematicContext["pins"][number] | undefined {
  if (typeof item !== "object" || item === null) {
    return undefined;
  }
  const value = item as Record<string, unknown>;
  const id = readString(value, ["id", "uuid", "uid", "gId", "gid"]) ?? `pin_auto_${index}`;
  const componentId =
    readString(value, ["componentId", "component_id", "ownerId", "symbolId"]) ?? "cmp_unknown";
  const properties = normalizeProperties(value.properties);
  return {
    id,
    componentId,
    pinNumber: readString(value, ["pinNumber", "num", "number"]),
    pinName: readString(value, ["pinName", "name", "label"]),
    electricalType: readString(value, ["electricalType", "type"]),
    noConnected: readBoolean(value, ["noConnected", "no_connect", "nc"]) ?? false,
    netName:
      readString(value, ["netName", "net", "Net", "NET", "网络"]) ??
      readString(properties as unknown as Record<string, unknown>, ["Net", "NET", "net", "网络"]),
  };
}

function normalizeNet(item: unknown, index: number): SchematicContext["nets"][number] | undefined {
  if (typeof item !== "object" || item === null) {
    return undefined;
  }
  const value = item as Record<string, unknown>;
  const id = readString(value, ["id", "uuid", "uid", "gId", "gid"]) ?? `net_auto_${index}`;
  const nodeIds = pickArray(value, ["nodeIds", "nodes", "pins", "pinIds"]).filter(
    (node): node is string => typeof node === "string"
  );
  return {
    id,
    name: readString(value, ["name", "netName", "label"]),
    nodeIds,
    isPower: readBoolean(value, ["isPower", "power"]),
  };
}

function normalizeProperties(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      output[key] = value;
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      output[key] = String(value);
    }
  }

  return output;
}

function pickArray(target: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = target[key];
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
}

function readString(target: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = target[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function readBoolean(target: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = target[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}
