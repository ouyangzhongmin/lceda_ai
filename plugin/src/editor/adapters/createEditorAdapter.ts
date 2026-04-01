import type { PluginChannel } from "../../types/schematic";
import { resolveHostEditorBridge } from "../host/runtime";
import { HostBackedEditorAdapter, type EditorAdapter, UnimplementedEditorAdapter } from "./editorAdapter";

export function createEditorAdapter(channel: PluginChannel): EditorAdapter {
  const hostBridge = resolveHostEditorBridge();
  if (hostBridge) {
    return new HostBackedEditorAdapter(channel, hostBridge);
  }
  return new UnimplementedEditorAdapter(channel);
}
