# 任务

## 1. 实现可配置的 raw toolInput 日志

- [x] 1.1 在 `ToolLoopDependencies` 和 `DefaultAgentDependencies` 中新增 `rawToolInputLogging?: boolean`
- [x] 1.2 将该标志贯穿 `tool-loop.ts` 中所有 `toolArgumentLogFields` 调用点
- [x] 1.3 在 `create-app.ts` 中当 `observability.logging.redaction === "debug"` 时接线 `rawToolInputLogging: true`
- [x] 1.4 恢复 `sanitizeRuntimeToolInput` 和 `sanitizeFailureToolArgumentValue`（默认脱敏路径）
- [x] 1.5 新增 debug 模式的 capability-governance 测试（断言原始 toolInput）
- [x] 1.6 验证默认模式测试仍断言脱敏值

## 2. OpenSpec 与架构验证

- [x] 2.1 `openspec validate --all --strict` 通过
- [x] 2.2 `npm run lint:architecture` 通过
- [x] 2.3 `npm run build` 通过
- [x] 2.4 `npm test` 通过
- [x] 2.5 `npm run test:contract` 通过
