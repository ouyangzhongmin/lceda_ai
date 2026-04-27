import type {
  LocateTarget,
  PluginChannel,
  SchematicContext,
  SchematicSelection,
} from "../../types/schematic";
import type { DraftPlan, DraftPreview } from "../apply-plan/draftPlan";
import type { DraftObjectBindings, DraftPatchPlan } from "../apply-plan/draftPatchPlan";
import type { HostEditorBridge } from "../host/runtime";

export interface ApplyPlanResult {
  applied: boolean;
  componentCount: number;
  netCount: number;
  transactionId?: string;
  rollbackSupported?: boolean;
  partialWiring?: {
    connectedNetCount: number;
    skippedConnectionCount: number;
    skippedConnections?: Array<{
      fromComponentRef?: string;
      fromPin?: string;
      toComponentRef?: string;
      toPin?: string;
      netName?: string;
      reason: string;
    }>;
  };
}

export interface PatchDraftPlanResult {
  applied: boolean;
  transactionId?: string;
  bindings?: DraftObjectBindings;
}

export interface EditorAdapter {
  readonly channel: PluginChannel;
  readonly source: "host" | "mock" | "unimplemented";
  isAvailable(): Promise<boolean>;
  getCapabilityReport(): Promise<{
    channel: PluginChannel;
    available: boolean;
    missing: string[];
    optionalMissing: string[];
  } | null>;
  getCurrentContext(): Promise<SchematicContext>;
  getSelection(): Promise<SchematicSelection>;
  locate(target: LocateTarget): Promise<void>;
  previewApplyPlan(plan: DraftPlan): Promise<DraftPreview>;
  patchDraftPlan(plan: DraftPatchPlan): Promise<PatchDraftPlanResult>;
  applyPlan(plan: DraftPlan, options?: { replaceTransactionId?: string }): Promise<ApplyPlanResult>;
  rollbackApplyPlan(transactionId: string): Promise<{ rolledBack: boolean; transactionId: string }>;
}

export class HostBackedEditorAdapter implements EditorAdapter {
  readonly source = "host" as const;

  constructor(
    public readonly channel: PluginChannel,
    private readonly bridge: HostEditorBridge
  ) {}

  private async assertCapability(capability: string): Promise<void> {
    if (!this.bridge.getCapabilityReport) {
      return;
    }
    const report = await this.bridge.getCapabilityReport();
    if (!report) {
      return;
    }
    const missing = new Set([...report.missing, ...report.optionalMissing]);
    if (missing.has(capability)) {
      throw new Error(`host missing capability: ${capability}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    if (!this.bridge.isAvailable) {
      return true;
    }

    return Boolean(await this.bridge.isAvailable());
  }

  async getCurrentContext(): Promise<SchematicContext> {
    return this.bridge.getCurrentContext();
  }

  async getCapabilityReport(): Promise<{
    channel: PluginChannel;
    available: boolean;
    missing: string[];
    optionalMissing: string[];
  } | null> {
    if (!this.bridge.getCapabilityReport) {
      return null;
    }
    // 允许宿主桥接返回同步或异步报告。
    return this.bridge.getCapabilityReport();
  }

  async getSelection(): Promise<SchematicSelection> {
    return this.bridge.getSelection();
  }

  async locate(target: LocateTarget): Promise<void> {
    await this.bridge.locate(target);
  }

  async previewApplyPlan(plan: DraftPlan): Promise<DraftPreview> {
    if (!this.bridge.previewApplyPlan) {
      await this.assertCapability("previewApplyPlan");
      throw new Error("host preview_apply_plan is not available");
    }

    return this.bridge.previewApplyPlan(plan);
  }

  async patchDraftPlan(plan: DraftPatchPlan): Promise<PatchDraftPlanResult> {
    const patchDraftPlan = (this.bridge as HostEditorBridge & {
      patchDraftPlan?: (plan: DraftPatchPlan) => Promise<PatchDraftPlanResult>;
    }).patchDraftPlan;

    if (!patchDraftPlan) {
      await this.assertCapability("patchDraftPlan");
      throw new Error("host patch_draft_plan is not available");
    }

    return patchDraftPlan(plan);
  }

  async applyPlan(plan: DraftPlan, options?: { replaceTransactionId?: string }): Promise<ApplyPlanResult> {
    if (!this.bridge.applyPlan) {
      await this.assertCapability("applyPlan");
      throw new Error("host apply_plan is not available");
    }
    let context = await this.bridge.getCurrentContext();
    if (!isEmptySchematicContext(context)) {
      if (options?.replaceTransactionId && this.bridge.rollbackApplyPlan) {
        const rolledBack = await this.bridge.rollbackApplyPlan(options.replaceTransactionId);
        if (rolledBack.rolledBack) {
          context = await this.bridge.getCurrentContext();
        }
      }
      if (!isEmptySchematicContext(context) && this.bridge.createEmptySchematicPage) {
        await this.bridge.createEmptySchematicPage({ title: plan.title });
        context = await this.bridge.getCurrentContext();
      }
      if (!isEmptySchematicContext(context)) {
        const pageName = context.project.pageName?.trim();
        throw new Error(
          `draft apply requires an empty schematic page${pageName ? `: current page "${pageName}" already has content` : ""}`
        );
      }
    }

    return this.bridge.applyPlan(plan);
  }

  async rollbackApplyPlan(transactionId: string): Promise<{ rolledBack: boolean; transactionId: string }> {
    if (!this.bridge.rollbackApplyPlan) {
      await this.assertCapability("rollbackApplyPlan");
      throw new Error("host rollback_apply_plan is not available");
    }
    return this.bridge.rollbackApplyPlan(transactionId);
  }
}

export class UnimplementedEditorAdapter implements EditorAdapter {
  readonly source = "unimplemented" as const;

  constructor(public readonly channel: PluginChannel) {}

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async getCurrentContext(): Promise<SchematicContext> {
    throw new Error(`editor adapter not implemented for ${this.channel}`);
  }

  async getCapabilityReport(): Promise<{
    channel: PluginChannel;
    available: boolean;
    missing: string[];
    optionalMissing: string[];
  } | null> {
    return {
      channel: this.channel,
      available: false,
      missing: ["getCurrentContext", "getSelection", "locate"],
      optionalMissing: ["previewApplyPlan", "applyPlan", "rollbackApplyPlan", "openExternal"],
    };
  }

  async getSelection(): Promise<SchematicSelection> {
    throw new Error(`editor selection not implemented for ${this.channel}`);
  }

  async locate(_target: LocateTarget): Promise<void> {
    throw new Error(`editor locate not implemented for ${this.channel}`);
  }

  async previewApplyPlan(_plan: DraftPlan): Promise<DraftPreview> {
    return {
      title: _plan.title,
      rationale: _plan.rationale,
      componentRefs: _plan.components.map((component) => component.ref ?? component.id),
      netNames: _plan.nets.map((net) => net.name ?? net.id),
      componentCount: _plan.components.length,
      netCount: _plan.nets.length,
    };
  }

  async patchDraftPlan(_plan: DraftPatchPlan): Promise<PatchDraftPlanResult> {
    return {
      applied: false,
      bindings: {
        pageId: undefined,
        componentBindings: [],
        wireBindings: [],
      },
    };
  }

  async applyPlan(_plan: DraftPlan, _options?: { replaceTransactionId?: string }): Promise<ApplyPlanResult> {
    return {
      applied: false,
      componentCount: _plan.components.length,
      netCount: _plan.nets.length,
      rollbackSupported: false,
    };
  }

  async rollbackApplyPlan(transactionId: string): Promise<{ rolledBack: boolean; transactionId: string }> {
    return { rolledBack: false, transactionId };
  }
}

function isEmptySchematicContext(context: SchematicContext): boolean {
  const meaningfulComponents = context.components.filter((component) => {
    const componentType = String(component.componentType || "").trim().toLowerCase();
    return componentType !== "sheet";
  });
  return meaningfulComponents.length === 0 && context.pins.length === 0 && context.nets.length === 0;
}
