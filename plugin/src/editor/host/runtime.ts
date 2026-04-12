import type {
  LocateTarget,
  PluginChannel,
  SchematicContext,
  SchematicSelection,
} from "../../types/schematic";
import type { DraftPlan, DraftPreview } from "../apply-plan/draftPlan";
import type { ApplyPlanResult } from "../adapters/editorAdapter";

export type LibraryScope = "system" | "project" | "personal" | "favorite";

export interface LibrarySearchResultItem {
  uuid: string;
  name: string;
  libraryUuid: string;
  symbolUuid?: string;
  symbolName?: string;
  footprintUuid?: string;
  footprintName?: string;
  manufacturer?: string;
  supplier?: string;
  supplierId?: string;
  lcscInventory?: number;
  lcscPrice?: number;
  jlcInventory?: number;
  jlcPrice?: number;
  description?: string;
}

export interface LibraryDeviceDetail {
  uuid: string;
  name?: string;
  libraryUuid?: string;
  lcscId?: string;
  manufacturer?: string;
  supplier?: string;
  supplierId?: string;
  description?: string;
  symbol?: {
    uuid?: string;
    name?: string;
    libraryUuid?: string;
  };
  footprint?: {
    uuid?: string;
    name?: string;
    libraryUuid?: string;
  };
  model3D?: {
    uuid?: string;
    name?: string;
    libraryUuid?: string;
  };
  otherProperty?: Record<string, boolean | number | string | undefined>;
  raw?: unknown;
}

export interface HostEditorBridge {
  getChannel?: () => PluginChannel;
  isAvailable?: () => boolean | Promise<boolean>;
  getCurrentContext: () => Promise<SchematicContext>;
  getSelection: () => Promise<SchematicSelection>;
  locate: (target: LocateTarget) => Promise<void>;
  createEmptySchematicPage?: (input?: { title?: string }) => Promise<SchematicContext | void>;
  previewApplyPlan?: (plan: DraftPlan) => Promise<DraftPreview>;
  applyPlan?: (plan: DraftPlan) => Promise<ApplyPlanResult>;
  rollbackApplyPlan?: (
    transactionId: string
  ) => Promise<{ rolledBack: boolean; transactionId: string }>;
  openExternal?: (url: string) => Promise<void>;
  showToastMessage?: (message: string, timeoutMs?: number) => Promise<void>;
  searchLibraryDevices?: (input: {
    query: string;
    scope?: LibraryScope;
    libraryUuid?: string;
    classification?: string[];
    symbolType?: number;
    pageSize?: number;
    page?: number;
  }) => Promise<LibrarySearchResultItem[]>;
  getLibraryDevice?: (input: { deviceUuid: string; libraryUuid?: string; scope?: LibraryScope }) => Promise<LibraryDeviceDetail>;
  getLibraryDevicesByLcscIds?: (input: {
    lcscIds: string[];
    libraryUuid?: string;
    scope?: LibraryScope;
    allowMultiMatch?: boolean;
  }) => Promise<LibraryDeviceDetail[]>;
  getCapabilityReport?: () => HostCapabilityReport;
}

export interface PluginRuntimeGlobals {
  LCEDA_PLUGIN_CHANNEL?: PluginChannel;
  LCEDA_HOST_BRIDGE?: HostEditorBridge;
  LCEDA_REQUIRE_HOST_BRIDGE?: boolean;
}

export function resolveHostEditorBridge(): HostEditorBridge | undefined {
  const runtime = globalThis as typeof globalThis & PluginRuntimeGlobals;
  return runtime.LCEDA_HOST_BRIDGE;
}

export function resolveRuntimeChannel(fallback: PluginChannel = "standard"): PluginChannel {
  const runtime = globalThis as typeof globalThis & PluginRuntimeGlobals;
  const hostChannel = runtime.LCEDA_HOST_BRIDGE?.getChannel?.();
  if (hostChannel === "professional" || hostChannel === "standard") {
    return hostChannel;
  }

  if (runtime.LCEDA_PLUGIN_CHANNEL === "professional") {
    return "professional";
  }

  return fallback;
}

export interface HostCapabilityReport {
  channel: PluginChannel;
  available: boolean;
  missing: string[];
  optionalMissing: string[];
}
