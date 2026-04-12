import type { StandardRawHostApi } from "./standardHostApi";
import { createApiApplyPlanAdapter } from "./applyPlanByApi";
import type { DraftPlan, DraftPreview } from "../apply-plan/draftPlan";
import type { ApplyPlanResult } from "../adapters/editorAdapter";
import {
  getTypedDocumentContext,
  getTypedSelection,
  hasTypedHostRuntime,
  locateTypedHostObject,
  openTypedHostWindow,
} from "./proHostProbe";

export function resolveStandardRawHostApi(): StandardRawHostApi | undefined {
  const runtime = globalThis as typeof globalThis & {
    api?: (name: string, ...args: unknown[]) => Promise<unknown> | unknown;
    lc?: {
      schematic?: {
        getCurrentDocument?: () => Promise<unknown> | unknown;
        getSelection?: () => Promise<unknown> | unknown;
        locateObject?: (target: {
          objectId: string;
          objectType: "component" | "pin" | "net";
        }) => Promise<void> | void;
      };
      shell?: {
        openExternal?: (url: string) => Promise<void> | void;
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
  const applyPlanAdapter = createApiApplyPlanAdapter(callApi);
  const fromNamespace = runtime.lc;

  if (!fromNamespace && !callApi && !hasTypedHostRuntime()) {
    return undefined;
  }

  return {
    schematic: {
      getCurrentDocument: fromNamespace?.schematic?.getCurrentDocument
        ? fromNamespace.schematic.getCurrentDocument
        : async (): Promise<unknown> => {
            const result = await callApiCandidate(callApi, [
              ["getSource"],
              ["getSchSource"],
              ["getCurrentSchematic"],
            ]);
            return tryParseJsonString(result);
          },
      getSelection: fromNamespace?.schematic?.getSelection
        ? fromNamespace.schematic.getSelection
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
      locateObject: fromNamespace?.schematic?.locateObject
        ? fromNamespace.schematic.locateObject
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
      createEmptyPage: fromNamespace?.schematic?.createEmptyPage
        ? fromNamespace.schematic.createEmptyPage
        : async (input): Promise<unknown> =>
            callApiCandidate(callApi, [
              ["createEmptySchematicPage", input ?? {}],
              ["createSchematicPage", input ?? {}],
              ["newSchematicPage", input ?? {}],
              ["createEmptyPage", input ?? {}],
            ]),
    },
    shell: {
      openExternal: fromNamespace?.shell?.openExternal
        ? fromNamespace.shell.openExternal
        : runtime.shell?.openExternal
          ? runtime.shell.openExternal
          : runtime.shell?.openBrowser
            ? runtime.shell.openBrowser
            : async (url: string): Promise<void> => {
                if (openTypedHostWindow(url)) {
                  return;
                }
                await callApiCandidate(callApi, [
                  ["openExternal", url],
                  ["openBrowser", url],
                  ["openUrl", url],
                ]);
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
