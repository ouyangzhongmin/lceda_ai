import type { MainPanelState } from "../panels/mainPanel";

const FRAME_ID = "lceda-ai-assistant-main";
const FRAME_PATH = "/iframe/index.html";

export async function openAssistantFrame(_state: MainPanelState): Promise<boolean> {
  if (typeof eda === "undefined" || !eda.sys_IFrame) {
    return false;
  }

  try {
    if (await eda.sys_IFrame.isIFrameAlreadyExist(FRAME_ID)) {
      await eda.sys_IFrame.closeIFrame(FRAME_ID);
    }

    return await eda.sys_IFrame.openIFrame(FRAME_PATH, 550, 720, FRAME_ID, {
      title: "LCEDA AI Assistant",
      maximizeButton: true,
      minimizeButton: true,
      grayscaleMask: false,
    });
  } catch {
    return false;
  }
}
