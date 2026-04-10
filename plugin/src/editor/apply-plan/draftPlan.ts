import type { SchematicComponent, SchematicNet, SchematicPin } from "../../types/schematic";

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
