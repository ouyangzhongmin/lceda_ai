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
      name: "library.search_devices",
      description: "在嘉立创专业版集成元件库中搜索器件",
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
      name: "library.get_device",
      description: "从嘉立创专业版集成元件库读取器件详情",
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
      name: "library.get_devices_by_lcsc_ids",
      description: "按 LCSC 编号从嘉立创专业版集成元件库查找器件",
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
