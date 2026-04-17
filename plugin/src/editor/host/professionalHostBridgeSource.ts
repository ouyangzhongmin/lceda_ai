import type { ProfessionalRawHostApi } from "./professionalHostApi";
import { createApiApplyPlanAdapter } from "./applyPlanByApi";
import type { DraftPlan, DraftPreview } from "../apply-plan/draftPlan";
import type { ApplyPlanResult } from "../adapters/editorAdapter";
import {
  getTypedDocumentContext,
  getTypedSchematicContext,
  getTypedSelection,
  hasTypedLibraryRuntime,
  hasTypedSchematicPlacementRuntime,
  hasTypedHostRuntime,
  locateTypedHostObject,
  openTypedHostWindow,
  typedGetLibraryDevice,
  typedGetLibrarySymbol,
  typedGetLibraryDevicesByLcscIds,
  typedSearchLibraryDevices,
} from "./proHostProbe";

export function resolveProfessionalRawHostApi(): ProfessionalRawHostApi | undefined {
  const runtime = globalThis as typeof globalThis & {
    api?: (name: string, ...args: unknown[]) => Promise<unknown> | unknown;
    lcPro?: {
      editor?: {
        getActiveSchematicContext?: () => Promise<unknown> | unknown;
        getCurrentSelection?: () => Promise<unknown> | unknown;
        locateEntity?: (target: {
          objectId: string;
          objectType: "component" | "pin" | "net";
        }) => Promise<void> | void;
      };
      system?: {
        openBrowser?: (url: string) => Promise<void> | void;
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
    };
    shell?: {
      openExternal?: (url: string) => Promise<void> | void;
      openBrowser?: (url: string) => Promise<void> | void;
    };
  };

  const callApi = resolveApiInvoker(runtime);
  const applyPlanAdapter = createApiApplyPlanAdapter(callApi, {
    typedPlacementEnabled: hasTypedSchematicPlacementRuntime(),
  });
  const fromNamespace = runtime.lcPro;

  if (!fromNamespace && !callApi && !hasTypedHostRuntime()) {
    return undefined;
  }

  return {
    editor: {
      getActiveSchematicContext: fromNamespace?.editor?.getActiveSchematicContext
        ? fromNamespace.editor.getActiveSchematicContext
        : async (): Promise<unknown> => {
            const typedContext = await getTypedSchematicContext("professional");
            if (typedContext) {
              return typedContext;
            }
            const result = await callApiCandidate(callApi, [
              ["getSource"],
              ["getSchSource"],
              ["getCurrentSchematic"],
            ]);
            return tryParseJsonString(result);
          },
      getCurrentSelection: fromNamespace?.editor?.getCurrentSelection
        ? fromNamespace.editor.getCurrentSelection
        : async (): Promise<unknown> => {
            const typedSelection = await getTypedSelection();
            if (typedSelection) {
              return typedSelection;
            }
            return callApiCandidate(callApi, [
              ["getSelectShape"],
              ["getSelection"],
              ["getSelected"],
            ]);
          },
      locateEntity: fromNamespace?.editor?.locateEntity
        ? fromNamespace.editor.locateEntity
        : async (target): Promise<void> => {
            if (await locateTypedHostObject(target)) {
              return;
            }
            await callApiCandidate(callApi, [
              ["selectShape", [target.objectId]],
              ["selectShape", target.objectId],
              ["locateShape", target.objectId],
                ["focusShape", target.objectId],
              ]);
            },
      createEmptySchematicPage: fromNamespace?.editor?.createEmptySchematicPage
        ? fromNamespace.editor.createEmptySchematicPage
        : async (input): Promise<unknown> =>
            callApiCandidate(callApi, [
              ["createEmptySchematicPage", input ?? {}],
              ["createSchematicPage", input ?? {}],
              ["newSchematicPage", input ?? {}],
              ["createEmptyPage", input ?? {}],
            ]),
    },
    system: {
      openBrowser: fromNamespace?.system?.openBrowser
        ? fromNamespace.system.openBrowser
        : runtime.shell?.openBrowser
          ? runtime.shell.openBrowser
          : runtime.shell?.openExternal
            ? runtime.shell.openExternal
            : async (url: string): Promise<void> => {
                if (openTypedHostWindow(url)) {
                  return;
                }
                await callApiCandidate(callApi, [
                  ["openBrowser", url],
                  ["openExternal", url],
                  ["openUrl", url],
                ]);
              },
    },
    library: {
      searchDevices: fromNamespace?.library?.searchDevices
        ? fromNamespace.library.searchDevices
        : async (input) => {
            const typedResults = await typedSearchLibraryDevices(input);
            if (typedResults) {
              return typedResults;
            }
            if (!hasTypedLibraryRuntime()) {
              throw new Error("professional host library search is not available");
            }
            return [];
          },
      getDevice: fromNamespace?.library?.getDevice
        ? fromNamespace.library.getDevice
        : async (input) => {
            const typedResult = await typedGetLibraryDevice(input);
            if (typedResult) {
              return typedResult;
            }
            throw new Error("professional host library get is not available");
          },
      getSymbol: fromNamespace?.library?.getSymbol
        ? fromNamespace.library.getSymbol
        : async (input) => {
            const typedResult = await typedGetLibrarySymbol(input);
            if (typedResult) {
              return typedResult;
            }
            throw new Error("professional host library symbol get is not available");
          },
      getDevicesByLcscIds: fromNamespace?.library?.getDevicesByLcscIds
        ? fromNamespace.library.getDevicesByLcscIds
        : async (input) => {
            const typedResults = await typedGetLibraryDevicesByLcscIds(input);
            if (typedResults) {
              return typedResults;
            }
            throw new Error("professional host library getByLcscIds is not available");
          },
    },
    applyPlan: {
      preview: fromNamespace?.applyPlan?.preview
        ? fromNamespace.applyPlan.preview
        : applyPlanAdapter.preview,
      apply: fromNamespace?.applyPlan?.apply
        ? fromNamespace.applyPlan.apply
        : applyPlanAdapter.apply,
      rollback: fromNamespace?.applyPlan?.rollback
        ? fromNamespace.applyPlan.rollback
        : applyPlanAdapter.rollback,
    },
  };
}

function resolveApiInvoker(runtime: {
  api?: (name: string, ...args: unknown[]) => Promise<unknown> | unknown;
}): ((name: string, ...args: unknown[]) => Promise<unknown>) | undefined {
  if (!runtime.api) {
    return undefined;
  }
  return async (name: string, ...args: unknown[]): Promise<unknown> => runtime.api!(name, ...args);
}

async function callApiCandidate(
  invoker: ((name: string, ...args: unknown[]) => Promise<unknown>) | undefined,
  candidates: Array<[string] | [string, unknown] | [string, unknown[]]>
): Promise<unknown> {
  if (!invoker) {
    return undefined;
  }

  for (const candidate of candidates) {
    const [name] = candidate;
    let args: unknown[] = [];
    if (candidate.length > 1) {
      const payload = candidate[1];
      args = Array.isArray(payload) ? payload : [payload];
    }

    try {
      return await invoker(name, ...args);
    } catch {
      // Try next candidate for runtime API compatibility.
    }
  }

  return undefined;
}

function tryParseJsonString(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
