export type AssistantCardSection = "header" | "thinking" | "steps" | "report";

export interface AssistantCardLayoutInput {
  contextCompaction?: boolean;
  streaming: boolean;
  hasThinking: boolean;
  hasSteps: boolean;
  hasReport: boolean;
  stepsOpen: boolean;
}

export interface AssistantCardLayoutState {
  showThinking: boolean;
  showSteps: boolean;
  showReport: boolean;
  useSplitLayout: boolean;
  reportFillsRemainingHeight: boolean;
  sectionOrder: AssistantCardSection[];
}

export function getAssistantCardLayout(input: AssistantCardLayoutInput): AssistantCardLayoutState {
  if (input.contextCompaction) {
    return {
      showThinking: false,
      showSteps: false,
      showReport: input.hasReport,
      useSplitLayout: false,
      reportFillsRemainingHeight: true,
      sectionOrder: input.hasReport ? ["header", "report"] : ["header"],
    };
  }

  if (input.streaming) {
    const showThinking = input.hasThinking;
    const showSteps = input.hasSteps;
    const showReport = false;
    return {
      showThinking,
      showSteps,
      showReport,
      useSplitLayout: showThinking || showSteps,
      reportFillsRemainingHeight: false,
      sectionOrder: [
        "header",
        ...(showSteps ? ["steps" as const] : []),
        ...(showThinking ? ["thinking" as const] : []),
        ...(showReport ? ["report" as const] : []),
      ],
    };
  }

  const showSteps = input.hasSteps && input.stepsOpen;
  const showReport = input.hasReport;
  return {
    showThinking: false,
    showSteps,
    showReport,
    useSplitLayout: false,
    reportFillsRemainingHeight: showReport && !showSteps,
    sectionOrder: [
      "header",
      ...(showSteps ? ["steps" as const] : []),
      ...(showReport ? ["report" as const] : []),
    ],
  };
}
