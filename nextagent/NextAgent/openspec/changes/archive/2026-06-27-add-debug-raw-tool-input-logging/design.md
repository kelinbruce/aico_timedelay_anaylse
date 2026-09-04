## 背景和现状（Context）

observability.logging.redaction 配置字段已存在，有两种模式：normal（默认）和 debug。当前 spec 禁止 debug 模式输出原始敏感字段。tool-loop runtime 日志始终通过 sanitizeRuntimeToolInput 脱敏 toolInput，这会掩盖诊断所需的路径/凭据/prompt 细节。

## 设计决策（Decisions）

1. 复用既有 redaction 配置字段，不引入新的配置开关。当 redaction 为 debug 时，tool-loop 依赖中的 rawToolInputLogging 设为 true；normal 时保持 false（脱敏）。
2. 只影响 toolInput 字段。toolInputPreview 和 toolSafeSummary 在所有模式下继续使用既有脱敏器。这使脱敏面保持最小且可审计。
3. audit 事件、metric、trace、safe error 和 stream projection 不受影响。无论 redaction 设置如何，它们在所有模式下都保持脱敏。
4. rawToolInputLogging 标志在 ToolLoopDependencies 和 DefaultAgentDependencies 上是可选的。缺省即 false（脱敏）。这使默认行为符合 AGENTS.md 第 47 条。

## 质量属性设计（Quality Attributes）

| 属性 | 结论 | 验证 |
|---|---|---|
| 安全 | 默认模式保持完整脱敏。debug 模式只能通过配置显式开启。audit/metric/trace 不受影响。 | capability-governance 测试断言默认模式下为脱敏值 |
| 可靠性 | 除日志字段内容外无运行时行为变化。 | npm test, npm run test:contract |
| 可维护性 | 单一标志、单一接线点、不新增配置面。 | npm run lint:architecture |

## 验证映射（Verification Map）

| 约束 | 任务 | 验证 |
|---|---|---|
| 默认 toolInput 被脱敏 | 1.1 | capability-governance 测试 |
| debug toolInput 为原始值 | 1.2 | capability-governance 测试（新增 debug 模式测试） |
| 配置接线 | 1.3 | npm run build, npm test |
| OpenSpec 与架构校验通过 | 2.1 | openspec validate --all --strict, npm run lint:architecture |
