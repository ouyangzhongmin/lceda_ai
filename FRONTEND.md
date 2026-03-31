# FRONTEND.md

## 作用
- 记录插件端 UI、交互与前端实现约束。

## 当前入口
- 插件交互与产品要求主要见：
  - [需求文档.md](/Users/oyzm/workspace5/agents/lceda_ai/docs/product-specs/需求文档.md)
- 智能体驱动交互主要见：
  - [Agent设计文档.md](/Users/oyzm/workspace5/agents/lceda_ai/docs/design-docs/Agent设计文档.md)

## 当前约束
- 插件前端需同时兼容嘉立创标准版与专业版运行环境。
- 高风险操作必须显式展示预览与确认。
- 草案生成结果应优先展示结构化信息，而不是直接修改原理图。
- 交互上优先支持问题定位、证据展示、工具结果可视化。
- 涉及 UI 细节、交互表现、视觉层设计时，优先使用 `ui-ux-pro-max` 这类 Skill 进行处理。

## 后续扩展
- 如后续需要拆分更细的前端设计文档，可继续补充到 `docs/design-docs/`。
