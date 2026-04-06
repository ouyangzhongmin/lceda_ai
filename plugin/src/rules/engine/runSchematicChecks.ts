import type { SchematicContext } from "../../types/schematic";
import { runButtonPullResistorCheck } from "../checks/buttonPullResistorCheck";
import { runComponentAttributesCheck } from "../checks/componentAttributesCheck";
import { runElectricalConflictCheck } from "../checks/electricalConflictCheck";
import { runFloatingPinsCheck } from "../checks/floatingPinsCheck";
import { runMcuUnusedPinsCheck } from "../checks/mcuUnusedPinsCheck";
import { runPowerConflictCheck } from "../checks/powerConflictCheck";
import { runShortCircuitCheck } from "../checks/shortCircuitCheck";
import { runWiringStandardsCheck } from "../checks/wiringStandardsCheck";
import type { SchematicCheckResult } from "../models/checkResult";
import type { RuleIssue } from "../models/issue";

export function runSchematicChecks(context: SchematicContext): SchematicCheckResult {
  const issues: RuleIssue[] = [
    ...runMcuUnusedPinsCheck(context),
    ...runButtonPullResistorCheck(context),
    ...runWiringStandardsCheck(context),
    ...runFloatingPinsCheck(context),
    ...runShortCircuitCheck(context),
    ...runElectricalConflictCheck(context),
    ...runComponentAttributesCheck(context),
    ...runPowerConflictCheck(context),
  ];
  attachIssueLabels(issues, context);

  return {
    issues,
    summary:
      issues.length === 0
        ? "no schematic rule issues detected"
        : `detected ${issues.length} schematic rule issue(s)`,
  };
}

function attachIssueLabels(issues: RuleIssue[], context: SchematicContext): void {
  if (!issues || issues.length === 0) return;
  const compById = new Map(context.components.map((c) => [c.id, c]));
  const pinById = new Map(context.pins.map((p) => [p.id, p]));
  const netById = new Map(context.nets.map((n) => [n.id, n]));

  const cleanText = (value: string | undefined): string | undefined => {
    const text = String(value || "").trim();
    if (!text) return undefined;
    if (text.includes("={Manufacturer Part}")) return undefined;
    if (/^[0-9a-f]{12,}$/i.test(text)) return undefined;
    return text;
  };

  for (const issue of issues) {
    if (!issue || issue.objectLabel) continue;
    const type = issue.objectType;
    const id = issue.objectId;
    if (!type || !id) continue;

    if (type === "component") {
      const c = compById.get(id);
      if (!c) continue;
      const label = [cleanText(c.ref), cleanText(c.name), cleanText(c.value), cleanText(c.packageName)].filter(Boolean).join(" / ");
      issue.objectLabel = label || undefined;
      continue;
    }

    if (type === "pin") {
      const p = pinById.get(id);
      if (!p) continue;
      const c = compById.get(p.componentId);
      const pinName = p.pinName || p.pinNumber;
      const pinLabel = [pinName, p.pinNumber && p.pinName ? `(${p.pinNumber})` : ""].filter(Boolean).join("");
      const netHint = p.netName ? `网络 ${p.netName}` : "";
      issue.objectLabel = [cleanText(c?.ref) || cleanText(c?.name), cleanText(pinLabel), cleanText(netHint)].filter(Boolean).join(" / ") || undefined;
      continue;
    }

    if (type === "net") {
      const n = netById.get(id);
      const name = n?.name || id;
      issue.objectLabel = cleanText(name) ? `网络 ${cleanText(name)}` : undefined;
    }
  }
}
