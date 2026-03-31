import type { MainPanelState } from "./mainPanel";

export function renderDebugPanel(state: MainPanelState): string {
  const capability = state.capabilityReport
    ? `capability_channel=${state.capabilityReport.channel}; capability_available=${state.capabilityReport.available}; capability_missing=${state.capabilityReport.missing.join(",")}; capability_optional_missing=${state.capabilityReport.optionalMissing.join(",")}`
    : "capability=unknown";

  return [
    `loggedIn=${state.loggedIn}`,
    `user=${state.userDisplayName ?? ""}`,
    `email=${state.userEmail ?? ""}`,
    `credits=${state.creditsBalance ?? 0} ${state.creditsCurrency ?? ""}`.trim(),
    `channel=${state.channel ?? "unknown"}`,
    `components=${state.componentCount ?? 0}`,
    `nets=${state.netCount ?? 0}`,
    `selection=${state.selectionCount ?? 0}`,
    `issues=${state.issueCount ?? 0}`,
    `topIssue=${state.topIssueTitle ?? ""}`,
    `locate=${state.locateStatus ?? ""}`,
    capability,
    `summary=${state.summary ?? ""}`,
  ].join("\n");
}
