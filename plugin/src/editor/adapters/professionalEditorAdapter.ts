import type { LocateTarget, PluginChannel, SchematicContext, SchematicSelection } from "../../types/schematic";
import type { DraftPlan, DraftPreview } from "../apply-plan/draftPlan";
import { mockProfessionalContext } from "./mockData";
import type { ApplyPlanResult, EditorAdapter } from "./editorAdapter";

export class ProfessionalEditorAdapter implements EditorAdapter {
  readonly channel = "professional" as const;
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
      channel: "professional",
      available: true,
      missing: [],
      optionalMissing: ["previewApplyPlan", "applyPlan", "rollbackApplyPlan", "openExternal"],
    };
  }

  async getCurrentContext(): Promise<SchematicContext> {
    return mockProfessionalContext;
  }

  async getSelection(): Promise<SchematicSelection> {
    return mockProfessionalContext.selection;
  }

  async locate(target: LocateTarget): Promise<void> {
    const knownObjectIds = new Set([
      ...mockProfessionalContext.components.map((item) => item.id),
      ...mockProfessionalContext.pins.map((item) => item.id),
      ...mockProfessionalContext.nets.map((item) => item.id),
    ]);

    if (!knownObjectIds.has(target.objectId)) {
      throw new Error(`professional adapter could not locate ${target.objectId}`);
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
