import type { PluginChannel } from "../../types/schematic";
import { installHostBridge } from "./installHostBridge";
import { resolveProfessionalRawHostApi } from "./professionalHostBridgeSource";
import { resolveStandardRawHostApi } from "./standardHostBridgeSource";

export function autoInstallHostBridge(preferredChannel?: PluginChannel): PluginChannel | undefined {
  if (preferredChannel === "professional") {
    const professionalApi = resolveProfessionalRawHostApi();
    if (professionalApi) {
      installHostBridge({
        channel: "professional",
        rawApi: professionalApi,
      });
      return "professional";
    }
  }

  if (preferredChannel === "standard") {
    const standardApi = resolveStandardRawHostApi();
    if (standardApi) {
      installHostBridge({
        channel: "standard",
        rawApi: standardApi,
      });
      return "standard";
    }
  }

  const professionalApi = resolveProfessionalRawHostApi();
  if (professionalApi) {
    installHostBridge({
      channel: "professional",
      rawApi: professionalApi,
    });
    return "professional";
  }

  const standardApi = resolveStandardRawHostApi();
  if (standardApi) {
    installHostBridge({
      channel: "standard",
      rawApi: standardApi,
    });
    return "standard";
  }

  return undefined;
}
