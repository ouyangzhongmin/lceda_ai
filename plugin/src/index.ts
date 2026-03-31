import { bootstrapApp } from "./app/bootstrap";
import { runStartupDiagnostics } from "./app/startupDiagnostics";
import { autoInstallHostBridge } from "./editor/host/autoInstallHostBridge";
import { initConfig } from "./config/env";

export function activate(): void {
  // 初始化配置
  initConfig();
  autoInstallHostBridge();
  void runStartupDiagnostics();
  void bootstrapApp();
}
