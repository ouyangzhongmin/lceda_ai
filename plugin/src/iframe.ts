import { initConfig } from "./config/env";
import { autoInstallHostBridge } from "./editor/host/autoInstallHostBridge";
import { getAssistantRuntime } from "./app/assistantRuntime";

const LOG_PREFIX = "[LCEDA-AI][iframe-entry]";

declare global {
  interface Window {
    __LCEDA_AI_ASSISTANT_FRAME_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    __LCEDA_AI_ASSISTANT_FRAME_STATE__?: Awaited<ReturnType<ReturnType<typeof getAssistantRuntime>["openPanel"]>>;
    __LCEDA_AI_ASSISTANT_FRAME_SYNC_STATE__?: (
      state: Awaited<ReturnType<ReturnType<typeof getAssistantRuntime>["openPanel"]>>
    ) => void;
  }
}

async function bootstrapIframeApp(): Promise<void> {
  initConfig();
  autoInstallHostBridge();

  const runtime = getAssistantRuntime();
  const state = await runtime.openPanel();

  window.__LCEDA_AI_ASSISTANT_FRAME_RUNTIME__ = runtime;
  window.__LCEDA_AI_ASSISTANT_FRAME_STATE__ = state;

  if (typeof console !== "undefined") {
    console.log(`${LOG_PREFIX} ready`, {
      hasRuntime: true,
      messageCount: state.chatMessages?.length ?? 0,
      loggedIn: state.loggedIn,
    });
  }
}

const syncFrameState = window.__LCEDA_AI_ASSISTANT_FRAME_SYNC_STATE__;
window.__LCEDA_AI_ASSISTANT_FRAME_SYNC_STATE__ = (state) => {
  window.__LCEDA_AI_ASSISTANT_FRAME_STATE__ = state;
  syncFrameState?.(state);
};

void bootstrapIframeApp().catch((error) => {
  if (typeof console !== "undefined") {
    console.error(`${LOG_PREFIX} failed`, error instanceof Error ? error.message : String(error));
  }
});
