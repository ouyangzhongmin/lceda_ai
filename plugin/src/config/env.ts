/**
 * 环境配置管理模块
 * 负责加载和管理插件的环境变量配置
 */

export interface PluginConfig {
  /** 服务器基础 URL */
  serverBaseUrl: string;
  /** 插件渠道 */
  channel: "standard" | "professional";
  /** 环境模式 */
  nodeEnv: "development" | "production" | "test";
}

/**
 * 从环境变量加载配置
 */
function loadConfigFromEnv(): PluginConfig {
  const serverBaseUrl = process.env.SERVER_BASE_URL ?? "http://127.0.0.1:8080";
  const channel = process.env.PLUGIN_CHANNEL === "professional" ? "professional" : "standard";
  const nodeEnv = (process.env.NODE_ENV as PluginConfig["nodeEnv"]) ?? "development";

  return {
    serverBaseUrl,
    channel,
    nodeEnv,
  };
}

/**
 * 全局配置实例
 */
let config: PluginConfig | null = null;

/**
 * 初始化配置
 * 应在应用启动时调用
 */
export function initConfig(customConfig?: Partial<PluginConfig>): void {
  config = {
    ...loadConfigFromEnv(),
    ...customConfig,
  };
}

/**
 * 获取当前配置
 * 如果配置未初始化，会自动初始化
 */
export function getConfig(): PluginConfig {
  if (!config) {
    initConfig();
  }
  return config!;
}

/**
 * 更新配置
 */
export function updateConfig(updates: Partial<PluginConfig>): void {
  if (!config) {
    initConfig();
  }
  config = {
    ...config!,
    ...updates,
  };
}

/**
 * 获取服务器基础 URL
 */
export function getServerBaseUrl(): string {
  return getConfig().serverBaseUrl;
}

/**
 * 获取插件渠道
 */
export function getPluginChannel(): "standard" | "professional" {
  return getConfig().channel;
}

/**
 * 判断是否为开发环境
 */
export function isDevelopment(): boolean {
  return getConfig().nodeEnv === "development";
}
