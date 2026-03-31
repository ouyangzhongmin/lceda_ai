import type { SchematicContext } from "../../types/schematic";
import { runComponentAttributesCheck } from "../checks/componentAttributesCheck";
import { runElectricalConflictCheck } from "../checks/electricalConflictCheck";
import { runFloatingPinsCheck } from "../checks/floatingPinsCheck";
import { runPowerConflictCheck } from "../checks/powerConflictCheck";
import { runShortCircuitCheck } from "../checks/shortCircuitCheck";
import { runWiringStandardsCheck } from "../checks/wiringStandardsCheck";
import type { SchematicCheckResult } from "../models/checkResult";

export function runSchematicChecks(context: SchematicContext): SchematicCheckResult {
  const issues = [
    ...runWiringStandardsCheck(context),
    ...runFloatingPinsCheck(context),
    ...runShortCircuitCheck(context),
    ...runElectricalConflictCheck(context),
    ...runComponentAttributesCheck(context),
    ...runPowerConflictCheck(context),
  ];

  return {
    issues,
    summary:
      issues.length === 0
        ? "no schematic rule issues detected"
        : `detected ${issues.length} schematic rule issue(s)`,
  };
}
