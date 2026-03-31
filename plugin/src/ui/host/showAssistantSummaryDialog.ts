import type { MainPanelState } from "../panels/mainPanel";

function buildSummaryLines(state: MainPanelState): string[] {
  const capability = state.capabilityReport
    ? [
        `capability_available=${state.capabilityReport.available}`,
        `capability_missing=${state.capabilityReport.missing.join(",") || "none"}`,
      ]
    : ["capability=unknown"];

  return [
    `logged_in=${state.loggedIn}`,
    `channel=${state.channel ?? "unknown"}`,
    `components=${state.componentCount ?? 0}`,
    `nets=${state.netCount ?? 0}`,
    `selection=${state.selectionCount ?? 0}`,
    `issues=${state.issueCount ?? 0}`,
    `top_issue=${state.topIssueTitle ?? "none"}`,
    `locate=${state.locateStatus ?? "none"}`,
    ...capability,
    `summary=${state.summary ?? ""}`,
  ];
}

export function showAssistantSummaryDialog(state: MainPanelState): boolean {
  if (typeof eda === "undefined" || typeof eda.sys_Dialog?.showInformationMessage !== "function") {
    return false;
  }

  try {
    eda.sys_Dialog.showInformationMessage(
      buildSummaryLines(state).join("\n"),
      "LCEDA AI Assistant",
      "OK"
    );
    return true;
  } catch {
    return false;
  }
}
