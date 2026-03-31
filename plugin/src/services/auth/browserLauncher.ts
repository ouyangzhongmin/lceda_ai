import { resolveHostEditorBridge } from "../../editor/host/runtime";

export interface BrowserLauncher {
  open(url: string): Promise<void>;
}

export class HostBrowserLauncher implements BrowserLauncher {
  async open(url: string): Promise<void> {
    const hostBridge = resolveHostEditorBridge();
    if (!hostBridge?.openExternal) {
      throw new Error("host browser launcher is not available");
    }

    await hostBridge.openExternal(url);
  }
}

export class NoopBrowserLauncher implements BrowserLauncher {
  async open(url: string): Promise<void> {
    if (typeof console !== "undefined") {
      console.log("browser open skipped", url);
    }
  }
}
