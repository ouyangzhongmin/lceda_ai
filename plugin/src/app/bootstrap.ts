import { getAssistantRuntime } from "./assistantRuntime";
import { openAssistantFrame } from "../ui/host/openAssistantFrame";
import { showAssistantSummaryDialog } from "../ui/host/showAssistantSummaryDialog";
import { renderDebugPanel } from "../ui/panels/debugPanel";

export async function bootstrapApp(): Promise<void> {
  const placeholderState = {
    loggedIn: false,
  };

  if (!(await openAssistantFrame(placeholderState))) {
    const runtime = getAssistantRuntime();
    const state = await runtime.openPanel();
    const debugOutput = renderDebugPanel(state);
    if (typeof console !== "undefined") {
      console.log(debugOutput);
    }
    // showAssistantSummaryDialog(state); // 已禁用：不再显示调试信息弹窗
  }
}
