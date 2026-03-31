import { initConfig } from "./config/env";
import { autoInstallHostBridge } from "./editor/host/autoInstallHostBridge";
import { getAssistantRuntime } from "./app/assistantRuntime";

const LOG_PREFIX = "[LCEDA-AI][iframe-entry]";

declare global {
  interface Window {
    __LCEDA_AI_ASSISTANT_FRAME_RUNTIME__?: ReturnType<typeof getAssistantRuntime>;
    __LCEDA_AI_ASSISTANT_FRAME_STATE__?: Awaited<ReturnType<ReturnType<typeof getAssistantRuntime>["openPanel"]>>;
  }
}

const FRAME_STATE_EVENT = "lceda-ai-assistant:state";

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

window.addEventListener(FRAME_STATE_EVENT, (event) => {
  const customEvent = event as CustomEvent<Awaited<ReturnType<ReturnType<typeof getAssistantRuntime>["openPanel"]>>>;
  window.__LCEDA_AI_ASSISTANT_FRAME_STATE__ = customEvent.detail;
});

void bootstrapIframeApp().catch((error) => {
  if (typeof console !== "undefined") {
    console.error(`${LOG_PREFIX} failed`, error instanceof Error ? error.message : String(error));
  }
});
