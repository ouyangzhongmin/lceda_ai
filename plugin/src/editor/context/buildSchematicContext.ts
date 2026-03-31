import type { EditorAdapter } from "../adapters/editorAdapter";
import type { SchematicContext } from "../../types/schematic";
import {
  formatMissingCapabilityError,
  getMissingRequiredCapabilities,
  REQUIRED_CONTEXT_CAPABILITIES,
} from "../host/capabilityGuard";

export async function buildSchematicContext(
  adapter: EditorAdapter
): Promise<SchematicContext> {
  const report = await adapter.getCapabilityReport();
  const missing = getMissingRequiredCapabilities(report, REQUIRED_CONTEXT_CAPABILITIES);
  if (missing.length > 0) {
    throw new Error(formatMissingCapabilityError(missing));
  }
  const available = await adapter.isAvailable();
  if (!available) {
    throw new Error("host editor is not available");
  }
  return adapter.getCurrentContext();
}
