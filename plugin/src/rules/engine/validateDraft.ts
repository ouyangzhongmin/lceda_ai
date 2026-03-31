import type { DraftSchematic } from "../models/draft";
import type { SchematicCheckResult } from "../models/checkResult";
import { runSchematicChecks } from "./runSchematicChecks";

export function validateDraft(draft: DraftSchematic): SchematicCheckResult {
  return runSchematicChecks({
    project: {
      channel: "standard",
    },
    components: draft.components,
    pins: draft.pins,
    nets: draft.nets,
    selection: {
      objectIds: [],
    },
  });
}
