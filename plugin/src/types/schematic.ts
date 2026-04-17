export type PluginChannel = "standard" | "professional";

export interface SchematicProjectRef {
  projectId?: string;
  pageId?: string;
  pageName?: string;
  channel: PluginChannel;
}

export interface SchematicComponent {
  id: string;
  ref?: string;
  name?: string;
  libraryId?: string;
  packageName?: string;
  value?: string;
  componentType?: string;
  addIntoBom?: boolean;
  addIntoPcb?: boolean;
  properties: Record<string, string>;
}

export interface SchematicPin {
  id: string;
  componentId: string;
  pinNumber?: string;
  pinName?: string;
  electricalType?: string;
  resolvedPinNumber?: string;
  resolvedPinName?: string;
  resolvedElectricalType?: string;
  pinResolutionStatus?: "resolved" | "unresolved";
  pinResolutionConfidence?: number;
  pinResolutionReason?: string;
  noConnected?: boolean;
  netName?: string;
}

export interface SchematicNet {
  id: string;
  name?: string;
  nodeIds: string[];
  isPower?: boolean;
}

export interface SchematicSelection {
  objectIds: string[];
}

export interface SchematicContext {
  project: SchematicProjectRef;
  components: SchematicComponent[];
  pins: SchematicPin[];
  nets: SchematicNet[];
  selection: SchematicSelection;
}

export interface LocateTarget {
  objectId: string;
  objectType: "component" | "pin" | "net";
}
