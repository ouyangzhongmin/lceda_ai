# 宿主桥接说明

## 作用
- 定义插件运行时与嘉立创宿主环境之间的最小桥接接口。
- 让插件主流程优先走真实宿主能力，不可用时再回退到 mock 适配器。

## 当前约定
- 宿主环境可通过 `globalThis.LCEDA_HOST_BRIDGE` 注入桥接对象。
- 可选约束：`globalThis.LCEDA_REQUIRE_HOST_BRIDGE=true` 时，未检测到宿主桥接会直接进入不可用适配器。
- 桥接对象当前最小能力包括：
  - `getChannel()`
  - `isAvailable()`
  - `getCurrentContext()`
  - `getSelection()`
  - `locate()`
  - `previewApplyPlan()`
  - `applyPlan()`
  - `openExternal()` (browser login)

## 当前目标
- 先稳定主流程接线点，不假设嘉立创标准版与专业版 API 已完全一致。
- 后续根据真实 SDK/API 能力，把标准版与专业版分别适配到这层桥接接口。

## 当前结构
- `standardHostBridgeSource.ts`
  - 负责从标准版宿主全局对象解析原始 API。
- `professionalHostBridgeSource.ts`
  - 负责从专业版宿主全局对象解析原始 API。
- `autoInstallHostBridge.ts`
  - 启动时自动探测标准版/专业版宿主并安装桥接。
- `bridgeFactory.ts`
  - 提供宿主能力报告（`capability_report`）用于联调验证。

## 实现补充（当前已支持）
- 桥接层支持两类运行时入口：
  - 命名空间对象风格（`globalThis.lc` / `globalThis.lcPro`）
  - 函数调用风格（`api('methodName', ...)`）
- 已内置首批方法候选映射（按优先顺序尝试）：
  - 读取原理图：`getSource` / `getSchSource` / `getCurrentSchematic`
  - 读取选区：`getSelectShape` / `getSelection` / `getSelected`
  - 定位对象：`selectShape` / `locateShape` / `focusShape`
  - 打开浏览器：`openExternal` / `openBrowser` / `openUrl`
- 已补充草案落图的 API 风格通道：
  - 优先走 source 级更新：`getSource` + `applySource`
  - source 不可用时回退 shape 级更新：`getShape` / `updateShape` / `createShape`
- 若宿主返回的是 JSON 字符串 source，会尝试自动解析为对象。
- 当前 PoC 验证脚本：
  - `npm run poc:api-host`：验证 source 风格宿主桥接
  - `npm run poc:shape-host`：验证 shape-only 风格宿主桥接
  - `npm run poc:missing-host`：验证强制宿主桥接缺失时报错路径
  - `npm run poc:host-probe`：在真实宿主中探测能力、读取上下文与浏览器打开
