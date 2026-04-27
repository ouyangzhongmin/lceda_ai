import type { DraftPlan } from "./draftPlan";

export interface AppliedDraftSnapshot {
  draftVersionId: string;
  applyTransactionId?: string;
  title: string;
  rationale: string;
  appliedAt: string;
  pageId?: string;
  components: DraftPlan["components"];
  pins: DraftPlan["pins"];
  nets: DraftPlan["nets"];
}

export interface DraftObjectBindings {
  pageId?: string;
  authoritative: boolean;
  componentBindings: Array<{
    draftComponentId: string;
    ref?: string;
    primitiveId: string;
    deviceUuid?: string;
    libraryUuid?: string;
  }>;
  wireBindings: Array<{
    draftNetId: string;
    netName?: string;
    wireIds: string[];
  }>;
}

export interface DraftPatchConflict {
  id: string;
  type:
    | "pin_mapping_missing"
    | "binding_missing"
    | "device_class_changed"
    | "net_semantics_changed"
    | "user_edit_detected";
  level: "warning" | "blocking";
  componentRef?: string;
  netName?: string;
  message: string;
  suggestedAction?: string;
}

export type DraftPatchOperation =
  | { kind: "add_component"; componentId: string }
  | { kind: "remove_component"; componentId: string; primitiveId?: string }
  | {
      kind: "replace_component_device";
      componentId: string;
      primitiveId?: string;
      mode: "same_class" | "cross_class";
      keepRef: boolean;
      keepPlacement: boolean;
      nextDeviceUuid?: string;
      nextLibraryUuid?: string;
    }
  | {
      kind: "update_component_props";
      componentId: string;
      primitiveId?: string;
      nextProperties: Record<string, string>;
    }
  | {
      kind: "add_wire";
      netId: string;
      netName?: string;
      nodeIds: string[];
    }
  | { kind: "remove_wire"; netId: string; wireIds?: string[] }
  | {
      kind: "rewire_endpoint";
      netId: string;
      wireIds?: string[];
      fromNodeId: string;
      toNodeId: string;
    }
  | { kind: "mark_conflict"; conflictId: string };

export interface DraftPatchPlan {
  baseDraftVersionId: string;
  nextDraftVersionId: string;
  summary: {
    addComponentCount: number;
    removeComponentCount: number;
    replaceDeviceCount: number;
    updatePropCount: number;
    addWireCount: number;
    removeWireCount: number;
    conflictCount: number;
  };
  operations: DraftPatchOperation[];
  conflicts: DraftPatchConflict[];
}

export function summarizeDraftPatchPlan(plan: DraftPatchPlan): string {
  return `新增器件 ${plan.summary.addComponentCount}，替换器件 ${plan.summary.replaceDeviceCount}，删除连线 ${plan.summary.removeWireCount}，待处理冲突 ${plan.summary.conflictCount}。`;
}
