import type { PluginChannel } from "../../types/schematic";
import { resolveHostEditorBridge } from "../host/runtime";
import { HostBackedEditorAdapter, type EditorAdapter, UnimplementedEditorAdapter } from "./editorAdapter";
import { ProfessionalEditorAdapter } from "./professionalEditorAdapter";
import { StandardEditorAdapter } from "./standardEditorAdapter";

export function createEditorAdapter(channel: PluginChannel): EditorAdapter {
  const runtime = globalThis as typeof globalThis & { LCEDA_REQUIRE_HOST_BRIDGE?: boolean };
  const hostBridge = resolveHostEditorBridge();
  if (hostBridge) {
    return new HostBackedEditorAdapter(channel, hostBridge);
  }
  if (runtime.LCEDA_REQUIRE_HOST_BRIDGE) {
    // 强制要求宿主桥接时，未检测到宿主能力则直接进入不可用适配器。
    return new UnimplementedEditorAdapter(channel);
  }

  if (channel === "professional") {
    return new ProfessionalEditorAdapter();
  }

  return new StandardEditorAdapter();
}
