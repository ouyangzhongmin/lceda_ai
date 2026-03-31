import type { LocateTarget, PluginChannel, SchematicContext, SchematicSelection } from "../../types/schematic";
import type { DraftPlan, DraftPreview } from "../apply-plan/draftPlan";
import { mockStandardContext } from "./mockData";
import type { ApplyPlanResult, EditorAdapter } from "./editorAdapter";

export class StandardEditorAdapter implements EditorAdapter {
  readonly channel = "standard" as const;
  readonly source = "mock" as const;

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async getCapabilityReport(): Promise<{
    channel: PluginChannel;
    available: boolean;
    missing: string[];
    optionalMissing: string[];
  } | null> {
    return {
      channel: "standard",
      available: true,
      missing: [],
      optionalMissing: ["previewApplyPlan", "applyPlan", "rollbackApplyPlan", "openExternal"],
    };
  }

  async getCurrentContext(): Promise<SchematicContext> {
    return mockStandardContext;
  }

  async getSelection(): Promise<SchematicSelection> {
    return mockStandardContext.selection;
  }

  async locate(target: LocateTarget): Promise<void> {
    const knownObjectIds = new Set([
      ...mockStandardContext.components.map((item) => item.id),
      ...mockStandardContext.pins.map((item) => item.id),
      ...mockStandardContext.nets.map((item) => item.id),
    ]);

    if (!knownObjectIds.has(target.objectId)) {
      throw new Error(`standard adapter could not locate ${target.objectId}`);
    }
  }

  async previewApplyPlan(plan: DraftPlan): Promise<DraftPreview> {
    return {
      title: plan.title,
      rationale: plan.rationale,
      componentRefs: plan.components.map((component) => component.ref ?? component.id),
      netNames: plan.nets.map((net) => net.name ?? net.id),
      componentCount: plan.components.length,
      netCount: plan.nets.length,
    };
  }

  async applyPlan(plan: DraftPlan): Promise<ApplyPlanResult> {
    return {
      applied: true,
      componentCount: plan.components.length,
      netCount: plan.nets.length,
      rollbackSupported: false,
    };
  }

  async rollbackApplyPlan(
    transactionId: string
  ): Promise<{ rolledBack: boolean; transactionId: string }> {
    return { rolledBack: false, transactionId };
  }
}
