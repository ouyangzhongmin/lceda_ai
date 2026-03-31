import { autoInstallHostBridge } from "../editor/host/autoInstallHostBridge";
import { createEditorAdapter } from "../editor/adapters/createEditorAdapter";
import { resolveRuntimeChannel } from "../editor/host/runtime";
import { generateDraftPlanFromPrompt } from "../editor/apply-plan/generateDraftPlan";

type ApiCall = {
  name: string;
  args: unknown[];
};

async function main(): Promise<void> {
  const calls: ApiCall[] = [];

  (
    globalThis as typeof globalThis & {
      LCEDA_PLUGIN_CHANNEL?: "standard" | "professional";
      api?: (name: string, ...args: unknown[]) => Promise<unknown>;
    }
  ).LCEDA_PLUGIN_CHANNEL = "standard";

  (
    globalThis as typeof globalThis & {
      api?: (name: string, ...args: unknown[]) => Promise<unknown>;
    }
  ).api = async (name: string, ...args: unknown[]): Promise<unknown> => {
    calls.push({ name, args });
    if (name === "getSource" || name === "getSchSource" || name === "getCurrentSchematic") {
      throw new Error("source api not available in this host");
    }
    if (name === "getShape") {
      return undefined;
    }
    if (name === "createShape" || name === "updateShape" || name === "selectShape") {
      return { ok: true };
    }
    if (name === "deleteShape" || name === "removeShape") {
      return { ok: true };
    }
    if (name === "getSelectShape") {
      return {
        shapeIds: [],
      };
    }
    return undefined;
  };

  const detected = autoInstallHostBridge("standard");
  if (!detected) {
    throw new Error("failed to install host bridge");
  }

  const adapter = createEditorAdapter(resolveRuntimeChannel("standard"));
  const draft = generateDraftPlanFromPrompt("生成一个最小 LDO 供电草案");
  const result = await adapter.applyPlan(draft);
  const rollback =
    result.transactionId && result.rollbackSupported
      ? await adapter.rollbackApplyPlan(result.transactionId)
      : undefined;

  console.log("detected channel", detected);
  console.log("adapter source", adapter.source);
  console.log("apply result", result);
  console.log("rollback result", rollback ?? "skipped");
  console.log("api calls", calls.map((call) => call.name));
}

void main();
