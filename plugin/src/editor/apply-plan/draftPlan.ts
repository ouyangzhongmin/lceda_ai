import type { SchematicComponent, SchematicNet, SchematicPin } from "../../types/schematic";

export interface DraftPlanSelectedDevice {
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

export interface DraftPlan {
  title: string;
  rationale: string;
  components: SchematicComponent[];
  pins: SchematicPin[];
  nets: SchematicNet[];
  selectedDevices?: DraftPlanSelectedDevice[];
}

export interface DraftPreview {
  title: string;
  rationale: string;
  componentRefs: string[];
  netNames: string[];
  componentCount: number;
  netCount: number;
}
