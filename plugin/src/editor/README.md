# Editor 模块

- `adapters/`：嘉立创 API 适配
- `host/`：宿主桥接接口、运行时能力检测与注入
- `context/`：原理图上下文构建
- `apply-plan/`：草案应用与落图计划

补充说明：
- 当前 `host/` 已拆分为：
  - 桥接工厂
  - 标准版宿主 source
  - 专业版宿主 source
  - 自动安装入口
