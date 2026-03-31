# LCEDA API Mapping Reference

This file tracks the runtime mapping from LCEDA host APIs into local bridge source files.

## Sources
- Official list page:
  - `https://docs.lceda.cn/cn/API/3-API-List/`

## Current mapping placeholders
- Standard channel:
  - source file: `plugin/src/editor/host/standardHostBridgeSource.ts`
  - expected runtime object: `globalThis.lc`
  - expected groups:
    - `schematic.*`
    - `shell.*`
    - `applyPlan.*`
- Professional channel:
  - source file: `plugin/src/editor/host/professionalHostBridgeSource.ts`
  - expected runtime object: `globalThis.lcPro`
  - expected groups:
    - `editor.*`
    - `system.*`
    - `applyPlan.*`

## Next step when wiring real APIs
1. Confirm exact function names and signatures from LCEDA runtime.
2. Update only the two source files above.
3. Keep bridge factory / adapters / tools unchanged.
