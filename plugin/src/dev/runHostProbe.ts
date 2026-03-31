import { autoInstallHostBridge } from "../editor/host/autoInstallHostBridge";
import { createEditorAdapter } from "../editor/adapters/createEditorAdapter";
import { buildSchematicContext } from "../editor/context/buildSchematicContext";
import { getTypedDocumentContext, probeTypedHostRuntime } from "../editor/host/proHostProbe";
import { resolveRuntimeChannel } from "../editor/host/runtime";
import { HostBrowserLauncher } from "../services/auth/browserLauncher";

async function main(): Promise<void> {
  const envChannel = process.env.LCEDA_PLUGIN_CHANNEL === "professional" ? "professional" : "standard";
  (globalThis as typeof globalThis & { LCEDA_PLUGIN_CHANNEL?: "standard" | "professional" }).LCEDA_PLUGIN_CHANNEL =
    envChannel;

  const detected = autoInstallHostBridge(envChannel);
  if (!detected) {
    throw new Error("host bridge not detected; run inside JLCEDA host runtime");
  }

  const channel = resolveRuntimeChannel(envChannel);
  const adapter = createEditorAdapter(channel);
  const report = await adapter.getCapabilityReport();
  const available = await adapter.isAvailable();
  console.log("detected channel", detected);
  console.log("adapter source", adapter.source);
  console.log("adapter available", available);
  console.log("capability report", report);
  console.log("typed host probe", await probeTypedHostRuntime(channel));
  console.log("typed document context", await getTypedDocumentContext(channel));

  const context = await buildSchematicContext(adapter);
  console.log("context components", context.components.length);
  console.log("context nets", context.nets.length);

  const selection = await adapter.getSelection();
  console.log("selection objectIds", selection.objectIds);
  if (selection.objectIds.length > 0) {
    const targetId = selection.objectIds[0];
    try {
      await adapter.locate({ objectId: targetId, objectType: "component" });
      console.log("locate result", targetId);
    } catch (error) {
      console.log("locate error", error instanceof Error ? error.message : String(error));
    }
  } else {
    console.log("locate skipped: no selection");
  }

  if (process.env.PROBE_OPEN_EXTERNAL === "1") {
    const launcher = new HostBrowserLauncher();
    const url = process.env.PROBE_URL ?? "https://lceda.cn/";
    await launcher.open(url);
    console.log("openExternal triggered", url);
  }
}

void main();
