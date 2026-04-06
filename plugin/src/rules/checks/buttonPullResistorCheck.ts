import type { SchematicContext, SchematicComponent } from "../../types/schematic";
import type { RuleIssue } from "../models/issue";

// Heuristic: detect "button/switch" nets that look like they rely on internal pull-ups only.
// We only flag when the net has a button/switch AND connects to a GPIO-like pin,
// but has no obvious pull resistor on the same net.

const BUTTON_PATTERNS = [/btn/i, /button/i, /key/i, /switch/i, /sw\d+/i];
const PULL_RESISTOR_VALUE_PATTERNS = [/^\s*(?:4\.7k|10k|47k|100k)\s*$/i, /\b(?:4\.7k|10k|47k|100k)\b/i];

export function runButtonPullResistorCheck(context: SchematicContext): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const componentById = new Map(context.components.map((c) => [c.id, c]));

  // Prefer grouping by pin.netName (works even when host does not map net.nodeIds->pin.id).
  const pinsByNetName = new Map<string, Array<{ pinId: string; componentId: string; pinName?: string; pinNumber?: string }>>();
  for (const pin of context.pins) {
    const netName = String(pin.netName || "").trim();
    if (!netName) continue;
    const bucket = pinsByNetName.get(netName) ?? [];
    bucket.push({ pinId: pin.id, componentId: pin.componentId, pinName: pin.pinName, pinNumber: pin.pinNumber });
    pinsByNetName.set(netName, bucket);
  }

  for (const [netName, pins] of pinsByNetName.entries()) {
    if (!looksLikeButtonNet(netName)) continue;
    if (pins.length === 0) continue;

    const compsOnNet = new Set(pins.map((p) => p.componentId));
    const components = Array.from(compsOnNet).map((id) => componentById.get(id)).filter(Boolean) as SchematicComponent[];

    const hasButtonLike = components.some((c) => classifyLikeButton(c));
    if (!hasButtonLike) continue;

    const hasGpioLike = pins.some((p) => {
      const comp = componentById.get(p.componentId);
      if (!comp) return false;
      // If the component is MCU-like, treat pins named IOx/GPIOx as gpio nets.
      const pinText = [p.pinName, p.pinNumber].filter(Boolean).join(" ").toUpperCase();
      return /\bIO\d+\b/.test(pinText) || /\bGPIO\d+\b/.test(pinText) || /\bEN\b/.test(pinText) || /\bRST\b/.test(pinText);
    });
    if (!hasGpioLike) continue;

    const hasPullResistor = components.some((c) => isResistor(c) && looksLikePullResistor(c.value));
    if (hasPullResistor) continue;

    const netId = context.nets.find((n) => String(n.name || "").trim() === netName || String(n.id || "").trim() === netName)?.id ?? netName;
    issues.push({
      id: `issue-net-${netId}-button-missing-pull`,
      ruleId: "design.button-missing-pull",
      severity: "low",
      title: "按键网络可能缺少外部上拉/下拉",
      message: `网络 ${netName} 疑似按键输入网络，但未在同网内发现明显的上拉/下拉电阻（如 10K）。如果仅依赖主控内部上拉/下拉，抗干扰与一致性可能较弱。`,
      objectId: netId,
      objectType: "net",
      objectLabel: `网络 ${netName}`,
      suggestion: "若该按键用于启动/复位/模式选择等关键功能，建议增加 4.7K-100K 外部上拉/下拉，并确认去抖与默认电平。",
    });
  }

  return issues;
}

function looksLikeButtonNet(netName: string): boolean {
  const n = netName.trim();
  if (!n) return false;
  return BUTTON_PATTERNS.some((re) => re.test(n));
}

function classifyLikeButton(component: SchematicComponent): boolean {
  const text = [component.ref, component.name, component.value, component.packageName].filter(Boolean).join(" ");
  return /switch|button|key|btn/i.test(text);
}

function isResistor(component: SchematicComponent): boolean {
  const text = [component.ref, component.name].filter(Boolean).join(" ");
  return /\bR\d+\b/i.test(text) || /resistor/i.test(text);
}

function looksLikePullResistor(value?: string): boolean {
  const v = String(value || "").trim();
  if (!v) return false;
  return PULL_RESISTOR_VALUE_PATTERNS.some((re) => re.test(v));
}
