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
      description: "Search component devices from JLCEDA professional integrated libraries",
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
      description: "Get detailed component device info from JLCEDA professional integrated libraries",
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
      description: "Find component devices by LCSC ids from JLCEDA professional integrated libraries",
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
