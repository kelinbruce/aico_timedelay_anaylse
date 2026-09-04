## 提案：新增 debug-raw toolInput 日志

## 动机（Motivation）

tool-loop 调试需要看到传给 capability 调用的原始 tool 参数。当前 observability.logging.redaction spec 禁止 debug 模式输出原始敏感字段，tool-loop 始终通过 sanitizeRuntimeToolInput 脱敏 toolInput。这使诊断 tool 调用失败变得困难——脱敏后的 preview/summary 会掩盖根因（例如畸形参数、意外的路径形态、编码问题）。

## 变更范围（What Changes）

- 修订 app-config-schema spec：debug 模式 MAY 在 tool-loop runtime 日志中输出原始 toolInput，范围仅限 toolInput 字段。toolInputPreview 和 toolSafeSummary 在所有模式下保持脱敏。
- 修订 ts-minimal-agent-kernel spec：tool-loop 日志包含 rawToolInputLogging 依赖标志，控制 toolInput 携带脱敏还是原始的 tool 参数。默认为 false（脱敏）。
- agent-core 的 ToolLoopDependencies 和 DefaultAgentDependencies 新增可选 boolean 的 rawToolInputLogging。
- agent-app composition root 在 observability.logging.redaction 等于 debug 时接线 rawToolInputLogging 为 true。

## 范围（Scope）

- 在范围内：tool-loop runtime 日志 toolInput 字段行为、配置接线。
- 范围外：audit 事件、metric、trace、safe error、stream projection——它们在所有模式下保持脱敏。
