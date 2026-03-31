import type { HostCapabilityReport } from "./runtime";

// 约束：默认必须具备的宿主能力清单。
export const REQUIRED_CONTEXT_CAPABILITIES = ["getCurrentContext", "getSelection", "locate"] as const;

export function getMissingRequiredCapabilities(
  report: HostCapabilityReport | null | undefined,
  required: readonly string[]
): string[] {
  if (!report) {
    return [];
  }
  return required.filter((capability) => report.missing.includes(capability));
}

export function formatMissingCapabilityError(missing: string[]): string {
  return `host missing required capabilities: ${missing.join(",")}`;
}
