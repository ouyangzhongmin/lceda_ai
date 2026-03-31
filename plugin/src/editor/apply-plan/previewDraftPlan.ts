import type { DraftPlan, DraftPreview } from "./draftPlan";

export function previewDraftPlan(plan: DraftPlan): DraftPreview {
  return {
    title: plan.title,
    rationale:
      plan.selectedDevices && plan.selectedDevices.length > 0
        ? `${plan.rationale} 已选器件: ${plan.selectedDevices
            .map((item) => `${item.role}=${item.name}`)
            .join(", ")}`
        : plan.rationale,
    componentRefs: plan.components.map((component) => component.ref ?? component.id),
    netNames: plan.nets.map((net) => net.name ?? net.id),
    componentCount: plan.components.length,
    netCount: plan.nets.length,
  };
}
