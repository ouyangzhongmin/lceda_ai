import { createEditorAdapter } from "../editor/adapters/createEditorAdapter";
import { buildSchematicContext } from "../editor/context/buildSchematicContext";
import { resolveRuntimeChannel } from "../editor/host/runtime";

async function main(): Promise<void> {
  (globalThis as typeof globalThis & { LCEDA_PLUGIN_CHANNEL?: "standard" | "professional" }).LCEDA_PLUGIN_CHANNEL =
    "standard";
  (globalThis as typeof globalThis & { LCEDA_REQUIRE_HOST_BRIDGE?: boolean }).LCEDA_REQUIRE_HOST_BRIDGE = true;

  const channel = resolveRuntimeChannel("standard");
  const adapter = createEditorAdapter(channel);
  const report = await adapter.getCapabilityReport();
  console.log("adapter source", adapter.source);
  console.log("capability report", report);

  try {
    await buildSchematicContext(adapter);
    console.log("unexpected: context resolved with missing host bridge");
  } catch (error) {
    console.log("expected error", error instanceof Error ? error.message : String(error));
  }
}

void main();
