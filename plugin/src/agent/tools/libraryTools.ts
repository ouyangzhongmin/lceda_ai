import type { AgentTool } from "./toolRegistry";
import type {
  HostEditorBridge,
  LibraryDeviceDetail,
  LibraryScope,
  LibrarySearchResultItem,
} from "../../editor/host/runtime";

export function createLibraryTools(bridge: HostEditorBridge | undefined): AgentTool[] {
  return [
    {
      name: "library_search_devices",
      description: "在嘉立创专业版集成元件库中搜索器件",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "器件关键词，如 STM32、10k、USB-C" },
          scope: { type: "string", description: "搜索范围，通常使用 system" },
          pageSize: { type: "integer", minimum: 1, description: "每页条数" },
          page: { type: "integer", minimum: 1, description: "页码" },
        },
        required: ["query"],
        additionalProperties: true,
      },
      riskLevel: "low",
      execute: async (input: {
        query: string;
        scope?: LibraryScope;
        libraryUuid?: string;
        classification?: string[];
        symbolType?: number;
        pageSize?: number;
        page?: number;
      }): Promise<LibrarySearchResultItem[]> => {
        if (!bridge?.searchLibraryDevices) {
          throw new Error("library search is not available in current host");
        }
        return bridge.searchLibraryDevices(input);
      },
    },
    {
      name: "library_get_device",
      description: "从嘉立创专业版集成元件库读取器件详情",
      parameters: {
        type: "object",
        properties: {
          deviceUuid: { type: "string", description: "器件 UUID" },
          libraryUuid: { type: "string", description: "可选，库 UUID" },
          scope: { type: "string", description: "可选，搜索范围" },
        },
        required: ["deviceUuid"],
        additionalProperties: false,
      },
      riskLevel: "low",
      execute: async (input: {
        deviceUuid: string;
        libraryUuid?: string;
        scope?: LibraryScope;
      }): Promise<LibraryDeviceDetail> => {
        if (!bridge?.getLibraryDevice) {
          throw new Error("library get_device is not available in current host");
        }
        return bridge.getLibraryDevice(input);
      },
    },
    {
      name: "library_get_devices_by_lcsc_ids",
      description: "按 LCSC 编号从嘉立创专业版集成元件库查找器件",
      parameters: {
        type: "object",
        properties: {
          lcscIds: {
            type: "array",
            items: { type: "string" },
            description: "LCSC 编号列表，如 C12345",
          },
          libraryUuid: { type: "string" },
          scope: { type: "string" },
          allowMultiMatch: { type: "boolean" },
        },
        required: ["lcscIds"],
        additionalProperties: false,
      },
      riskLevel: "low",
      execute: async (input: {
        lcscIds: string[];
        libraryUuid?: string;
        scope?: LibraryScope;
        allowMultiMatch?: boolean;
      }): Promise<LibraryDeviceDetail[]> => {
        if (!bridge?.getLibraryDevicesByLcscIds) {
          throw new Error("library get_devices_by_lcsc_ids is not available in current host");
        }
        return bridge.getLibraryDevicesByLcscIds(input);
      },
    },
  ];
}
