import type { SchematicComponent, SchematicNet, SchematicPin } from "../../types/schematic";

export type DraftPlanningMode = "auto" | "structured_spec_required";

export interface DraftPlanSelectedDevice {
  componentId?: string;
  componentRef?: string;
  role: string;
  query: string;
  deviceUuid: string;
  libraryUuid: string;
  name: string;
  manufacturer?: string;
  symbolUuid?: string;
  symbolName?: string;
  footprintUuid?: string;
  footprintName?: string;
  pinCount?: number;
  pinSummary?: string;
}

export interface DraftPlanGuidance {
  templateId: string;
  rationale: string;
  evidence?: Array<{
    title: string;
    snippet: string;
    sourceRef: string;
  }>;
  preferredSearches?: Partial<Record<DraftPlanSelectedDevice["role"], string>>;
  requiredNets?: string[];
  requiredConnections?: Array<{
    fromComponentRef: string;
    fromPin: string;
    toComponentRef: string;
    toPin: string;
    netName: string;
  }>;
}

export interface DraftDesignSpec {
  systemType: string;
  title: string;
  rationale: string;
  components: Array<{
    id: string;
    ref?: string;
    role: string;
    name?: string;
    value?: string;
    packageName?: string;
    searchQuery?: string;
    placement?: {
      x: number;
      y: number;
      rotation?: number;
    };
    pins: Array<{
      id: string;
      pinNumber?: string;
      pinName?: string;
      electricalType?: string;
    }>;
  }>;
  nets: Array<{
    id: string;
    name?: string;
    isPower?: boolean;
  }>;
  connections: Array<{
    netName: string;
    pinIds: string[];
  }>;
}

export interface DraftPlan {
  title: string;
  rationale: string;
  components: SchematicComponent[];
  pins: SchematicPin[];
  nets: SchematicNet[];
  selectedDevices?: DraftPlanSelectedDevice[];
  guidance?: DraftPlanGuidance;
}

export interface DraftPreview {
  title: string;
  rationale: string;
  componentRefs: string[];
  netNames: string[];
  componentCount: number;
  netCount: number;
  selectedDeviceDetails?: string[];
  unresolvedDeviceDetails?: string[];
  guidanceSummary?: {
    templateId: string;
    rationale: string;
    preferredSearches?: string[];
    requiredNets?: string[];
    requiredConnections?: string[];
    evidence?: string[];
  };
}
