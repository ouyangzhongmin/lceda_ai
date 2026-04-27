import type { EditorAdapter, PatchDraftPlanResult } from "../adapters/editorAdapter";
import type { DraftPatchPlan } from "./draftPatchPlan";

export async function executeDraftPatchPlan(input: {
  adapter: Pick<EditorAdapter, "patchDraftPlan">;
  plan: DraftPatchPlan;
}): Promise<PatchDraftPlanResult> {
  const blockingConflicts = input.plan.conflicts.filter((conflict) => conflict.level === "blocking");
  if (blockingConflicts.length > 0) {
    throw new Error("blocking draft patch conflicts must be resolved before execution");
  }

  return input.adapter.patchDraftPlan(input.plan);
}
