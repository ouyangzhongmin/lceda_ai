import type { SchematicContext, SchematicSelection } from "../../types/schematic";
import type { DraftPlan, DraftPreview } from "../apply-plan/draftPlan";
import type { ApplyPlanResult } from "../adapters/editorAdapter";
import type {
  LibraryDeviceDetail,
  LibraryScope,
  LibrarySearchResultItem,
} from "./runtime";

export interface ProfessionalRawHostApi {
  editor?: {
    getActiveSchematicContext?: () => Promise<unknown> | unknown;
    getCurrentSelection?: () => Promise<unknown> | unknown;
    locateEntity?: (target: { objectId: string; objectType: "component" | "pin" | "net" }) => Promise<void> | void;
    createEmptySchematicPage?: (input?: { title?: string }) => Promise<unknown> | unknown;
  };
  system?: {
    openBrowser?: (url: string) => Promise<void> | void;
    showToastMessage?: (message: string, messageType?: number, timer?: number) => Promise<void> | void;
  };
  library?: {
    searchDevices?: (input: {
      query: string;
      scope?: LibraryScope;
      libraryUuid?: string;
      classification?: string[];
      symbolType?: number;
      pageSize?: number;
      page?: number;
    }) => Promise<LibrarySearchResultItem[]> | LibrarySearchResultItem[];
    getDevice?: (input: {
      deviceUuid: string;
      libraryUuid?: string;
      scope?: LibraryScope;
    }) => Promise<LibraryDeviceDetail> | LibraryDeviceDetail;
    getDevicesByLcscIds?: (input: {
      lcscIds: string[];
      libraryUuid?: string;
      scope?: LibraryScope;
      allowMultiMatch?: boolean;
    }) => Promise<LibraryDeviceDetail[]> | LibraryDeviceDetail[];
  };
  applyPlan?: {
    preview?: (plan: DraftPlan) => Promise<DraftPreview> | DraftPreview;
    apply?: (plan: DraftPlan) => Promise<ApplyPlanResult> | ApplyPlanResult;
    rollback?: (
      transactionId: string
    ) =>
      | Promise<{ rolledBack: boolean; transactionId: string }>
      | { rolledBack: boolean; transactionId: string };
  };
}

export interface ProfessionalHostCapabilities {
  getCurrentDocument?: () => Promise<unknown>;
  getSelection?: () => Promise<unknown>;
  locateObject?: (target: { objectId: string; objectType: "component" | "pin" | "net" }) => Promise<void>;
  createEmptySchematicPage?: (input?: { title?: string }) => Promise<unknown>;
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
  getLibraryDevice?: (input: {
    deviceUuid: string;
    libraryUuid?: string;
    scope?: LibraryScope;
  }) => Promise<LibraryDeviceDetail>;
  getLibraryDevicesByLcscIds?: (input: {
    lcscIds: string[];
    libraryUuid?: string;
    scope?: LibraryScope;
    allowMultiMatch?: boolean;
  }) => Promise<LibraryDeviceDetail[]>;
  previewApplyPlan?: (plan: DraftPlan) => Promise<DraftPreview>;
  applyPlan?: (plan: DraftPlan) => Promise<ApplyPlanResult>;
  rollbackApplyPlan?: (
    transactionId: string
  ) => Promise<{ rolledBack: boolean; transactionId: string }>;
}

export function resolveProfessionalHostCapabilities(
  rawApi: ProfessionalRawHostApi | undefined
): ProfessionalHostCapabilities {
  return {
    getCurrentDocument: rawApi?.editor?.getActiveSchematicContext
      ? async (): Promise<unknown> => rawApi.editor!.getActiveSchematicContext!()
      : undefined,
    getSelection: rawApi?.editor?.getCurrentSelection
      ? async (): Promise<unknown> => rawApi.editor!.getCurrentSelection!()
      : undefined,
    locateObject: rawApi?.editor?.locateEntity
      ? async (target): Promise<void> => {
          await rawApi.editor!.locateEntity!(target);
        }
      : undefined,
    createEmptySchematicPage: rawApi?.editor?.createEmptySchematicPage
      ? async (input): Promise<unknown> => rawApi.editor!.createEmptySchematicPage!(input)
      : undefined,
    openExternal: rawApi?.system?.openBrowser
      ? async (url: string): Promise<void> => {
          await rawApi.system!.openBrowser!(url);
        }
      : undefined,
    showToastMessage: rawApi?.system?.showToastMessage
      ? async (message: string, timeoutMs?: number): Promise<void> => {
          await rawApi.system!.showToastMessage!(message, 1, timeoutMs ?? 2200);
        }
      : undefined,
    searchLibraryDevices: rawApi?.library?.searchDevices
      ? async (input): Promise<LibrarySearchResultItem[]> => rawApi.library!.searchDevices!(input)
      : undefined,
    getLibraryDevice: rawApi?.library?.getDevice
      ? async (input): Promise<LibraryDeviceDetail> => rawApi.library!.getDevice!(input)
      : undefined,
    getLibraryDevicesByLcscIds: rawApi?.library?.getDevicesByLcscIds
      ? async (input): Promise<LibraryDeviceDetail[]> => rawApi.library!.getDevicesByLcscIds!(input)
      : undefined,
    previewApplyPlan: rawApi?.applyPlan?.preview
      ? async (plan: DraftPlan): Promise<DraftPreview> => rawApi.applyPlan!.preview!(plan)
      : undefined,
    applyPlan: rawApi?.applyPlan?.apply
      ? async (plan: DraftPlan): Promise<ApplyPlanResult> => rawApi.applyPlan!.apply!(plan)
      : undefined,
    rollbackApplyPlan: rawApi?.applyPlan?.rollback
      ? async (
          transactionId: string
        ): Promise<{ rolledBack: boolean; transactionId: string }> =>
          rawApi.applyPlan!.rollback!(transactionId)
      : undefined,
  };
}

export function isProfessionalSchematicContext(value: unknown): value is SchematicContext {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<SchematicContext>;
  return Array.isArray(candidate.components) && Array.isArray(candidate.nets) && Array.isArray(candidate.pins);
}

export function isProfessionalSelection(value: unknown): value is SchematicSelection {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { objectIds?: unknown }).objectIds)
  );
}
