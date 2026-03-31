import { createEditorAdapter } from "../editor/adapters/createEditorAdapter";
import { getTypedDocumentContext, probeTypedHostRuntime } from "../editor/host/proHostProbe";
import { resolveRuntimeChannel } from "../editor/host/runtime";

const LOG_PREFIX = "[lceda-ai-assistant]";

function logInfo(label: string, payload: unknown): void {
  if (typeof console === "undefined") {
    return;
  }
  console.log(`${LOG_PREFIX} ${label}`, payload);
}

function logError(label: string, error: unknown): void {
  if (typeof console === "undefined") {
    return;
  }
  console.error(`${LOG_PREFIX} ${label}`, error);
}

export async function runStartupDiagnostics(): Promise<void> {
  const channel = resolveRuntimeChannel();
  const adapter = createEditorAdapter(channel);

  logInfo("activate", {
    channel,
    adapterSource: adapter.source,
  });

  try {
    logInfo("capability_report", await adapter.getCapabilityReport());
  } catch (error) {
    logError("capability_report_failed", error instanceof Error ? error.message : String(error));
  }

  try {
    logInfo("typed_host_probe", await probeTypedHostRuntime(channel));
  } catch (error) {
    logError("typed_host_probe_failed", error instanceof Error ? error.message : String(error));
  }

  try {
    logInfo("typed_document_context", await getTypedDocumentContext(channel));
  } catch (error) {
    logError("typed_document_context_failed", error instanceof Error ? error.message : String(error));
  }
}
