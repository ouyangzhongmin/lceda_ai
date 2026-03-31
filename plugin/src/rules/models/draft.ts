import type { SchematicComponent, SchematicNet, SchematicPin } from "../../types/schematic";

export interface DraftSchematic {
  components: SchematicComponent[];
  pins: SchematicPin[];
  nets: SchematicNet[];
}
