import type { PluginChannel } from "../../types/schematic";
import type { ProfessionalRawHostApi } from "./professionalHostApi";
import type { StandardRawHostApi } from "./standardHostApi";
import { createHostBridge } from "./bridgeFactory";

interface InstallHostBridgeOptions {
  channel: PluginChannel;
  rawApi?: StandardRawHostApi | ProfessionalRawHostApi;
}

export function installHostBridge(options: InstallHostBridgeOptions): void {
  (
    globalThis as typeof globalThis & {
      LCEDA_HOST_BRIDGE?: ReturnType<typeof createHostBridge>;
      LCEDA_PLUGIN_CHANNEL?: PluginChannel;
    }
  ).LCEDA_PLUGIN_CHANNEL = options.channel;

  (
    globalThis as typeof globalThis & {
      LCEDA_HOST_BRIDGE?: ReturnType<typeof createHostBridge>;
    }
  ).LCEDA_HOST_BRIDGE = createHostBridge(options);
}
