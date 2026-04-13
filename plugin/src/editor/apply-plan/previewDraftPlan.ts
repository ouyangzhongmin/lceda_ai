import type { DraftPlan, DraftPreview } from "./draftPlan";
import { normalizeDraftPlan } from "./generateDraftPlan";

function formatGuidanceRole(role: string): string {
  const map: Record<string, string> = {
    power_connector: "电源接口",
    battery_connector: "电池接口",
    resistor: "限流电阻",
    led: "LED 器件",
    ldo_regulator: "LDO 稳压器",
    input_capacitor: "输入电容",
    output_capacitor: "输出电容",
  };
  return map[role] ?? role;
}

function formatSourceRefForDisplay(sourceRef?: string): string {
  const raw = String(sourceRef || "").trim();
  if (!raw) {
    return "未标注来源";
  }

  const kbMatch = raw.match(/^kb:\/\/(.+)$/i);
  if (kbMatch) {
    const entry = kbMatch[1]?.trim() || "unknown";
    return `知识条目 ${entry}（${raw}）`;
  }

  const docMatch = raw.match(/^doc-([a-z0-9_-]+)-v(\d+)(?:#p(\d+))?$/i);
  if (docMatch) {
    const topic = (docMatch[1] || "").replace(/[_-]+/g, " ").trim() || "unknown";
    const version = docMatch[2];
    const page = docMatch[3];
    if (page) {
      return `${topic} 文档 v${version} 第 ${page} 页（${raw}）`;
    }
    return `${topic} 文档 v${version}（${raw}）`;
  }

  if (/^https?:\/\//i.test(raw)) {
    return `网页链接 ${raw}`;
  }

  return raw;
}

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
      if (typeof item.pinCount === "number") {
        parts.push(`- pins=${item.pinCount}`);
      }
      if (item.pinSummary) {
        parts.push(`- pin_sample=${item.pinSummary}`);
      }
      return parts.join(" ");
    }),
    unresolvedDeviceDetails: normalized.components
      .filter((component) => component.properties?.device_resolution_status === "unresolved")
      .map((component) => {
        const ref = component.ref ?? component.id;
        const upperRef = ref.toUpperCase();
        const role =
          upperRef.startsWith("BT") || upperRef.startsWith("BAT") ? "battery_connector" :
          upperRef.startsWith("J") ? "power_connector" :
          upperRef.startsWith("R") ? "resistor" :
          upperRef.startsWith("D") || upperRef.startsWith("LED") ? "led" :
          upperRef.startsWith("C") ? "input_capacitor" :
          upperRef.startsWith("U") ? "ldo_regulator" :
          "generic";
        const query = component.properties?.preferred_search_query;
        return `${ref}：${formatGuidanceRole(role)}，暂未自动匹配到可直接放置的器件。${query ? `建议搜索：${query}` : ""}`;
      }),
    guidanceSummary: guidance
      ? {
          templateId: guidance.templateId,
          rationale: guidance.rationale,
          preferredSearches: guidance.preferredSearches
            ? Object.entries(guidance.preferredSearches).map(([key, value]) => `${formatGuidanceRole(key)}：${value}`)
            : undefined,
          requiredNets: guidance.requiredNets,
          requiredConnections: guidance.requiredConnections?.map(
            (item) =>
              `${item.fromComponentRef}.${item.fromPin} -> ${item.toComponentRef}.${item.toPin} @ ${item.netName}`
          ),
          evidence: guidance.evidence?.map((item) => {
            const title = item.title?.trim() || "知识片段";
            const snippet = item.snippet?.trim() || "命中相关设计建议。";
            const source = formatSourceRefForDisplay(item.sourceRef);
            return `依据：${title}。要点：${snippet}。来源：${source}`;
          }),
        }
      : undefined,
  };
}
