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

    // Prefer a taller window that stays slightly below the EDA viewport height.
    // Fallback to +150px on the previous 720px default.
    const viewportHeight =
      Math.max(
        typeof window !== "undefined" ? Number(window.innerHeight) : 0,
        typeof document !== "undefined" ? Number(document.documentElement?.clientHeight || 0) : 0
      ) || 0;
    const desiredHeight = viewportHeight > 0 ? Math.max(720, viewportHeight - 80) : 870;

    return await eda.sys_IFrame.openIFrame(FRAME_PATH, 600, desiredHeight, FRAME_ID, {
      title: "LCEDA AI Assistant",
      maximizeButton: true,
      minimizeButton: true,
      grayscaleMask: false,
    });
  } catch {
    return false;
  }
}
