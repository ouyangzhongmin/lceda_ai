import { autoInstallHostBridge } from "../editor/host/autoInstallHostBridge";
import { createEditorAdapter } from "../editor/adapters/createEditorAdapter";
import { buildSchematicContext } from "../editor/context/buildSchematicContext";
import { resolveRuntimeChannel } from "../editor/host/runtime";
import { generateDraftPlanFromPrompt } from "../editor/apply-plan/generateDraftPlan";

type ApiCall = {
  name: string;
  args: unknown[];
};

async function main(): Promise<void> {
  const calls: ApiCall[] = [];
  const channel = process.env.LCEDA_PLUGIN_CHANNEL === "professional" ? "professional" : "standard";

  (globalThis as typeof globalThis & { LCEDA_PLUGIN_CHANNEL?: "standard" | "professional" }).LCEDA_PLUGIN_CHANNEL =
    channel;

  (
    globalThis as typeof globalThis & {
      api?: (name: string, ...args: unknown[]) => Promise<unknown>;
    }
  ).api = async (name: string, ...args: unknown[]): Promise<unknown> => {
    calls.push({ name, args });
    if (name === "getSource") {
      return JSON.stringify({
        projectId: "prj_api_style",
        pageId: "page_api_style",
        components: [
          {
            id: "cmp-api-u1",
            ref: "U1",
            name: "ESP32-S3",
            value: "MCU",
            properties: {
              package: "QFN56",
            },
          },
        ],
        pins: [
          {
            id: "pin-api-u1-1",
            componentId: "cmp-api-u1",
            pinNumber: "1",
            pinName: "3V3",
            electricalType: "power_input",
          },
        ],
        nets: [
          {
            id: "net-api-3v3",
            name: "3V3",
            nodeIds: ["pin-api-u1-1"],
            isPower: true,
          },
        ],
      });
    }
    if (name === "getSelectShape") {
      return {
        shapeIds: ["cmp-api-u1"],
      };
    }
    if (name === "selectShape") {
      return { ok: true };
    }
    if (name === "applySource" || name === "setSource" || name === "updateSource") {
      return { ok: true };
    }
    if (name === "getShape") {
      return undefined;
    }
    if (name === "createShape" || name === "updateShape") {
      return { ok: true };
    }
    if (name === "openExternal" || name === "openBrowser" || name === "openUrl") {
      return { ok: true };
    }

    throw new Error(`api method not implemented in poc: ${name}`);
  };

  const detected = autoInstallHostBridge(channel);
  if (!detected) {
    throw new Error("failed to auto install host bridge from api-style runtime");
  }

  const runtimeChannel = resolveRuntimeChannel(channel);
  const adapter = createEditorAdapter(runtimeChannel);
  const context = await buildSchematicContext(adapter);
  const selection = await adapter.getSelection();
  await adapter.locate({
    objectId: "cmp-api-u1",
    objectType: "component",
  });
  const draft = generateDraftPlanFromPrompt("生成一个最小 LDO 供电草案");
  const preview = await adapter.previewApplyPlan(draft);
  const apply = await adapter.applyPlan(draft);
  const rollback =
    apply.transactionId && apply.rollbackSupported
      ? await adapter.rollbackApplyPlan(apply.transactionId)
      : undefined;

  console.log("detected channel", detected);
  console.log("adapter source", adapter.source);
  console.log("context components", context.components.length);
  console.log("context nets", context.nets.length);
  console.log("selection", selection.objectIds);
  console.log("draft preview", preview);
  console.log("draft apply", apply);
  console.log("draft rollback", rollback ?? "skipped");
  console.log("api calls", calls.map((call) => call.name));
}

void main();
