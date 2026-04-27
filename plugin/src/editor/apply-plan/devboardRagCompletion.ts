import type { DraftPlan } from "./draftPlan";
import { getDevboardRagTemplates, type DevboardRagTemplate } from "./devboardRagTemplates";

export interface RecalledDevboardTemplate {
  templateId: string;
  anchorDeviceFamily: string;
  anchorDeviceModel?: string;
  score: number;
}

interface DevboardRagCompletionOptions {
  externalTemplates?: DevboardRagTemplate[];
}

const HIGH_CONFIDENCE_THRESHOLD = 0.9;

function dedupeStrings<T extends string>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function formatTemplateSourceRef(template: DevboardRagTemplate): string {
  return `${template.source.kind}:${template.source.projectId}/${template.source.sheetRef}`;
}

function canonicalizeCompletionRole(role: string): string {
  const normalized = role.trim().toLowerCase();
  if (/^mcu_bulk_(cap|decoupling)$/.test(normalized)) {
    return "mcu_bulk_cap";
  }
  if (/^(mcu_)?en_pullup$/.test(normalized)) {
    return "mcu_en_pullup";
  }
  if (/^(mcu_local_decoupling|mcu_decoupling_small)$/.test(normalized)) {
    return "mcu_local_decoupling";
  }
  return normalized;
}

function parseNumericValue(value: string): number | undefined {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  const capMatch = normalized.match(/^(\d+(?:\.\d+)?)(p|n|u|m)?f$/);
  if (capMatch) {
    const magnitude = Number(capMatch[1]);
    const unit = capMatch[2] ?? "";
    const factor =
      unit === "m" ? 1e-3 : unit === "u" ? 1e-6 : unit === "n" ? 1e-9 : unit === "p" ? 1e-12 : 1;
    return magnitude * factor;
  }

  const resistorMatch = normalized.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (resistorMatch) {
    const magnitude = Number(resistorMatch[1]);
    const unit = resistorMatch[2] ?? "";
    const factor = unit === "m" ? 1e6 : unit === "k" ? 1e3 : 1;
    return magnitude * factor;
  }
  return undefined;
}

function areEquivalentValues(a?: string, b?: string): boolean {
  const left = String(a ?? "").trim().toLowerCase();
  const right = String(b ?? "").trim().toLowerCase();
  if (!left || !right) {
    return true;
  }
  if (left === right) {
    return true;
  }
  const leftNumeric = parseNumericValue(left);
  const rightNumeric = parseNumericValue(right);
  if (leftNumeric === undefined || rightNumeric === undefined) {
    return false;
  }
  return Math.abs(leftNumeric - rightNumeric) <= Math.max(leftNumeric, rightNumeric) * 1e-9;
}

function hasEquivalentSupportPart(
  components: DraftPlan["components"],
  role: string,
  value?: string
): boolean {
  const targetRole = canonicalizeCompletionRole(role);
  return components.some((component) => {
    const existingRole = canonicalizeCompletionRole(String(component.properties?.completion_role ?? ""));
    if (existingRole !== targetRole) {
      return false;
    }
    const generatedBy = String(component.properties?.generated_by ?? "").trim().toLowerCase();
    if (generatedBy !== "rule_completion" && generatedBy !== "rag_template") {
      return false;
    }
    return areEquivalentValues(value, component.value);
  });
}

function ensureNet(plan: DraftPlan, netName: string): DraftPlan["nets"][number] {
  const existing = plan.nets.find((net) => String(net.name || "").trim().toUpperCase() === netName.trim().toUpperCase());
  if (existing) {
    return existing;
  }
  const created = {
    id: `rag-net-${netName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: netName,
    nodeIds: [],
    isPower: /^(gnd|vbus|vbat|3v3|5v)$/iu.test(netName),
  };
  plan.nets.push(created);
  return created;
}

function detectAnchorModel(plan: DraftPlan): { family?: string; model?: string } {
  const text = plan.components
    .map((item) =>
      [
        item.ref,
        item.name,
        item.value,
        item.properties?.device_name,
        item.properties?.preferred_search_query,
      ]
        .filter(Boolean)
        .join(" ")
    )
    .join(" ")
    .toUpperCase();

  if (text.includes("ESP32-S3")) {
    return { family: "ESP32", model: "ESP32-S3" };
  }
  if (text.includes("ESP32-C3")) {
    return { family: "ESP32", model: "ESP32-C3" };
  }
  if (text.includes("RP2040")) {
    return { family: "RP2040", model: "RP2040" };
  }
  if (text.includes("STM32F103")) {
    return { family: "STM32", model: "STM32F103" };
  }
  if (text.includes("ESP32")) {
    return { family: "ESP32" };
  }
  if (text.includes("STM32")) {
    return { family: "STM32" };
  }
  return {};
}

export function recallDevboardRagTemplates(plan: DraftPlan): {
  anchorModel?: string;
  anchorFamily?: string;
  candidates: RecalledDevboardTemplate[];
};
export function recallDevboardRagTemplates(
  plan: DraftPlan,
  options?: DevboardRagCompletionOptions
): {
  anchorModel?: string;
  anchorFamily?: string;
  candidates: RecalledDevboardTemplate[];
} {
  const anchor = detectAnchorModel(plan);
  const templates = [...getDevboardRagTemplates(), ...(options?.externalTemplates ?? [])];
  const candidates = templates
    .map((item) => ({
      templateId: item.templateId,
      anchorDeviceFamily: item.anchorDeviceFamily,
      anchorDeviceModel: item.anchorDeviceModel,
      score:
        item.anchorDeviceModel && anchor.model === item.anchorDeviceModel
          ? 1
          : anchor.family === item.anchorDeviceFamily
            ? 0.7
            : 0,
      qualityScore: item.qualityScore,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.qualityScore - a.qualityScore)
    .map(({ qualityScore: _qualityScore, ...item }) => item);

  return {
    anchorModel: anchor.model,
    anchorFamily: anchor.family,
    candidates,
  };
}

export function applyDevboardRagCompletion(plan: DraftPlan): DraftPlan;
export function applyDevboardRagCompletion(plan: DraftPlan, options?: DevboardRagCompletionOptions): DraftPlan;
export function applyDevboardRagCompletion(plan: DraftPlan, options?: DevboardRagCompletionOptions): DraftPlan {
  const templates = [...getDevboardRagTemplates(), ...(options?.externalTemplates ?? [])];
  const recalled = recallDevboardRagTemplates(plan, options);
  const templateMap = new Map(templates.map((template) => [template.templateId, template]));
  const applied = recalled.candidates.filter((candidate) => candidate.score >= HIGH_CONFIDENCE_THRESHOLD);
  const suggested = recalled.candidates.filter((candidate) => candidate.score < HIGH_CONFIDENCE_THRESHOLD);
  const suggestedTemplateIds = suggested.map((candidate) => candidate.templateId);
  const suggestedTemplates = suggested
    .map((candidate) => templateMap.get(candidate.templateId))
    .filter((template): template is DevboardRagTemplate => Boolean(template));
  const suggestionReasons =
    suggestedTemplateIds.length > 0 ? suggestedTemplateIds.map(() => "low_confidence_family_fallback") : undefined;
  if (applied.length === 0) {
    if (suggestedTemplateIds.length === 0) {
      return plan;
    }
    return {
      ...plan,
      ragTemplateSummary: {
        appliedTemplateIds: [],
        suggestedTemplateIds,
        addedComponentCount: 0,
        suggestionReasons,
        appliedSourceKinds: [],
        suggestedSourceKinds: dedupeStrings(suggestedTemplates.map((template) => template.source.kind)),
        appliedSourceRefs: [],
        suggestedSourceRefs: dedupeStrings(suggestedTemplates.map((template) => formatTemplateSourceRef(template))),
      },
    };
  }

  const nextComponents = [...plan.components];
  const nextPins = [...plan.pins];
  const nextNets = [...plan.nets];
  const nextPlan: DraftPlan = {
    ...plan,
    components: nextComponents,
    pins: nextPins,
    nets: nextNets,
  };
  let addedComponentCount = 0;
  for (const candidate of applied) {
    const template = templateMap.get(candidate.templateId);
    if (!template) {
      continue;
    }
    template.components.forEach((component, index) => {
      if (hasEquivalentSupportPart(nextComponents, component.completionRole, component.value)) {
        return;
      }
      const componentId = `rag-${template.templateId}-${index + 1}`;
      nextComponents.push({
        id: componentId,
        ref: component.ref,
        name: component.name,
        value: component.value,
        addIntoBom: true,
        addIntoPcb: true,
        properties: {
          generated_by: "rag_template",
          template_id: template.templateId,
          template_type: template.templateType,
          template_confidence: String(candidate.score),
          completion_role: component.completionRole,
        },
      });
      if (component.attachToNet) {
        const pinId = `rag-pin-${template.templateId}-${index + 1}`;
        nextPins.push({
          id: pinId,
          componentId,
          pinName: component.attachToNet,
          pinNumber: "1",
          electricalType: "passive",
          pinResolutionStatus: "resolved",
          resolvedPinName: component.attachToNet,
          resolvedPinNumber: "1",
          netName: component.attachToNet,
        });
        const net = ensureNet(nextPlan, component.attachToNet);
        if (!net.nodeIds.includes(pinId)) {
          net.nodeIds.push(pinId);
        }
      }
      addedComponentCount += 1;
    });
  }

  return {
    ...plan,
    components: nextComponents,
    pins: nextPins,
    nets: nextNets,
    ragTemplateSummary: {
      appliedTemplateIds: applied.map((candidate) => candidate.templateId),
      suggestedTemplateIds,
      addedComponentCount,
      suggestionReasons,
      appliedSourceKinds: dedupeStrings(
        applied
          .map((candidate) => templateMap.get(candidate.templateId))
          .filter((template): template is DevboardRagTemplate => Boolean(template))
          .map((template) => template.source.kind)
      ),
      suggestedSourceKinds: dedupeStrings(suggestedTemplates.map((template) => template.source.kind)),
      appliedSourceRefs: dedupeStrings(
        applied
          .map((candidate) => templateMap.get(candidate.templateId))
          .filter((template): template is DevboardRagTemplate => Boolean(template))
          .map((template) => formatTemplateSourceRef(template))
      ),
      suggestedSourceRefs: dedupeStrings(suggestedTemplates.map((template) => formatTemplateSourceRef(template))),
    },
  };
}
