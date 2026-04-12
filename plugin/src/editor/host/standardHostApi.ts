import type { SchematicContext, SchematicSelection } from "../../types/schematic";
import type { DraftPlan, DraftPreview } from "../apply-plan/draftPlan";
import type { ApplyPlanResult } from "../adapters/editorAdapter";

export interface StandardRawHostApi {
  schematic?: {
    getCurrentDocument?: () => Promise<unknown> | unknown;
    getSelection?: () => Promise<unknown> | unknown;
    locateObject?: (target: { objectId: string; objectType: "component" | "pin" | "net" }) => Promise<void> | void;
    createEmptyPage?: (input?: { title?: string }) => Promise<unknown> | unknown;
  };
  shell?: {
    openExternal?: (url: string) => Promise<void> | void;
  };
  system?: {
    showToastMessage?: (message: string, messageType?: number, timer?: number) => Promise<void> | void;
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

export interface StandardHostCapabilities {
  getCurrentDocument?: () => Promise<unknown>;
  getSelection?: () => Promise<unknown>;
  locateObject?: (target: { objectId: string; objectType: "component" | "pin" | "net" }) => Promise<void>;
  createEmptySchematicPage?: (input?: { title?: string }) => Promise<unknown>;
  openExternal?: (url: string) => Promise<void>;
  showToastMessage?: (message: string, timeoutMs?: number) => Promise<void>;
  previewApplyPlan?: (plan: DraftPlan) => Promise<DraftPreview>;
  applyPlan?: (plan: DraftPlan) => Promise<ApplyPlanResult>;
  rollbackApplyPlan?: (
    transactionId: string
  ) => Promise<{ rolledBack: boolean; transactionId: string }>;
}

export function resolveStandardHostCapabilities(rawApi: StandardRawHostApi | undefined): StandardHostCapabilities {
  return {
    getCurrentDocument: rawApi?.schematic?.getCurrentDocument
      ? async (): Promise<unknown> => rawApi.schematic!.getCurrentDocument!()
      : undefined,
    getSelection: rawApi?.schematic?.getSelection
      ? async (): Promise<unknown> => rawApi.schematic!.getSelection!()
      : undefined,
    locateObject: rawApi?.schematic?.locateObject
      ? async (target): Promise<void> => {
          await rawApi.schematic!.locateObject!(target);
        }
      : undefined,
    createEmptySchematicPage: rawApi?.schematic?.createEmptyPage
      ? async (input): Promise<unknown> => rawApi.schematic!.createEmptyPage!(input)
      : undefined,
    openExternal: rawApi?.shell?.openExternal
      ? async (url: string): Promise<void> => {
          await rawApi.shell!.openExternal!(url);
        }
      : undefined,
    showToastMessage: rawApi?.system?.showToastMessage
      ? async (message: string, timeoutMs?: number): Promise<void> => {
          await rawApi.system!.showToastMessage!(message, 1, timeoutMs ?? 2200);
        }
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

export function isStandardSchematicContext(value: unknown): value is SchematicContext {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<SchematicContext>;
  return Array.isArray(candidate.components) && Array.isArray(candidate.nets) && Array.isArray(candidate.pins);
}

export function isStandardSelection(value: unknown): value is SchematicSelection {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { objectIds?: unknown }).objectIds)
  );
}
