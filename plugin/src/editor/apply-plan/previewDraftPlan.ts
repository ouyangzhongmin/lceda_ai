import type { DraftPlan, DraftPreview } from "./draftPlan";
import { normalizeDraftPlan } from "./generateDraftPlan";

export function previewDraftPlan(plan: DraftPlan): DraftPreview {
  const normalized = normalizeDraftPlan(plan);
  const guidance = normalized.guidance;
  const rationaleWithGuidance = normalized.guidance?.rationale
    ? `${normalized.rationale} ${normalized.guidance.rationale}`
    : normalized.rationale;
  return {
    title: normalized.title,
    rationale:
      normalized.selectedDevices && normalized.selectedDevices.length > 0
        ? `${rationaleWithGuidance} 已选器件: ${normalized.selectedDevices
            .map((item) => `${item.role}=${item.name}`)
            .join(", ")}`
        : rationaleWithGuidance,
    componentRefs: normalized.components.map((component) => component.ref ?? component.id),
    netNames: normalized.nets.map((net) => net.name ?? net.id),
    componentCount: normalized.components.length,
    netCount: normalized.nets.length,
    selectedDeviceDetails: normalized.selectedDevices?.map((item) => {
      const parts = [`${item.role}: ${item.name}`];
      if (item.footprintName) {
        parts.push(`[${item.footprintName}]`);
      }
      if (item.manufacturer) {
        parts.push(`- ${item.manufacturer}`);
      }
      return parts.join(" ");
    }),
    unresolvedDeviceDetails: normalized.components
      .filter((component) => component.properties?.device_resolution_status === "unresolved")
      .map((component) => {
        const ref = component.ref ?? component.id;
        const role =
          ref.startsWith("J") ? "power_connector" :
          ref.startsWith("R") ? "resistor" :
          ref.startsWith("D") ? "led" :
          ref.startsWith("C") ? "input_capacitor" :
          ref.startsWith("U") ? "ldo_regulator" :
          "generic";
        const reason = component.properties?.device_resolution_reason || "unknown";
        const query = component.properties?.preferred_search_query;
        return `${ref} / ${role}: unresolved (${reason})${query ? ` query=${query}` : ""}`;
      }),
    guidanceSummary: guidance
      ? {
          templateId: guidance.templateId,
          rationale: guidance.rationale,
          preferredSearches: guidance.preferredSearches
            ? Object.entries(guidance.preferredSearches).map(([key, value]) => `${key}: ${value}`)
            : undefined,
          requiredNets: guidance.requiredNets,
          requiredConnections: guidance.requiredConnections?.map(
            (item) =>
              `${item.fromComponentRef}.${item.fromPin} -> ${item.toComponentRef}.${item.toPin} @ ${item.netName}`
          ),
          evidence: guidance.evidence?.map((item) =>
            `${item.title}：${item.snippet}${item.sourceRef ? ` (${item.sourceRef})` : ""}`
          ),
        }
      : undefined,
  };
}
