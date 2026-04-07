import type { DraftPlan, DraftPreview } from "./draftPlan";
import { normalizeDraftPlan } from "./generateDraftPlan";

export function previewDraftPlan(plan: DraftPlan): DraftPreview {
  const normalized = normalizeDraftPlan(plan);
  return {
    title: normalized.title,
    rationale:
      normalized.selectedDevices && normalized.selectedDevices.length > 0
        ? `${normalized.rationale} 已选器件: ${normalized.selectedDevices
            .map((item) => `${item.role}=${item.name}`)
            .join(", ")}`
        : normalized.rationale,
    componentRefs: normalized.components.map((component) => component.ref ?? component.id),
    netNames: normalized.nets.map((net) => net.name ?? net.id),
    componentCount: normalized.components.length,
    netCount: normalized.nets.length,
  };
}
