## Why

电信网络运维任务中的模型可能在生成 Tool call 参数时耗尽输出 Token，却把停止原因报告为 `tool-calls`、`stop` 或无法识别的值。当前系统只把 `finishReason="length"` 视为不完整输出，因此会把这类被截断的 Tool call 当作普通参数错误，跳过已有的输出恢复并直接向用户报告执行失败。Agent 开发者也无法同时观察“provider-neutral 停止原因”和“该结果是否完整”，导致兼容模型的停止原因偏差直接改变恢复行为。

现在需要把停止原因与输出完整性拆成两个独立的公共事实，使系统基于可信完整性证据恢复被截断输出，同时保留原停止原因用于兼容、诊断和 Tool 分支判断，并确保任何残缺 Tool call 都不会执行。

本 change 定义“输出不完整原因”为：一次模型终态无法安全作为完整结果消费、且系统具有明确证据可将其纳入既有有界恢复流程的 provider-neutral 原因。它不等同于 provider 原始停止字符串，也不把普通 provider 错误、策略拦截或任意参数校验失败解释为输出截断。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 模型调用方能够分别观察 provider-neutral `finishReason` 与可选的输出不完整原因。
- provider 明确报告输出 Token 超限，或在预算饱和时返回结构残缺的 Tool call，即使停止原因为 `tool-calls`、`stop` 或 `unknown`，系统都进入同一个有界输出恢复流程。
- 预算未饱和、usage 缺失或结构错误不满足截断证据时，系统保持普通安全校验失败，不猜测输出超限。
- 完整 Tool call 继续以非空 Tool call 事实进入 Tool loop；残缺 Tool call 在原调用、预算提升和续写阶段均不得执行。
- 流式与非流式模型调用形成相同的终态完整性语义，并保留取消、恢复次数、容量上限和安全失败保证。

**非目标：**

- 不根据普通文本是否以完整句子结束推断截断，不对仅有 `finishReason="stop"` 且没有结构异常的文本自动续写。
- 不估算或补零 usage，不引入 provider/model 名称硬编码、可配置容差或真实模型最大输出能力目录。
- 不改变 `content-filter`、`error`、timeout、取消、context overflow 或普通 provider failure 的既有失败和重试语义。
- 不修改 Web stream、runtime command、session message、terminal commit、Agent Scope 或 Owner Scope 契约。
- 不执行或修补残缺 Tool arguments，也不把中间恢复消息持久化。

## What Changes

- **修改**公共模型终态契约：在 `finishReason` 之外增加可选的 provider-neutral 输出不完整原因；字段缺失表示系统没有可恢复的不完整输出证据。
- **修改**输出超限行为：`finishReason="length"` 映射为明确的输出 Token 超限；非 `length` 终态只有在 Tool call 结构残缺且已报告输出 Token 数不小于本次有效 `maxOutputTokens` 时，才映射为推断的 Tool call 截断。
- **修改**恢复触发：Agent 依据输出不完整原因进入既有一次预算提升和最多三次续写的唯一恢复流程，不再直接依据 `finishReason` 决定恢复。
- **修改**安全失败边界：没有高可信截断证据的非法 Tool arguments 保持 non-retryable validation failure；策略拦截、provider error 和 unknown unusable terminal 不得进入输出恢复。
- **修改**公共契约校验：流式、非流式、hook 前终态与直接 contract consumer 必须接受并校验新增字段及字段间约束。

## Feature 影响（Features）

### 修改的 Feature

- `F-4.1 接入多种模型`：兼容模型即使错误报告停止原因，也不会在高可信 Tool call 截断场景绕过既有输出恢复；完整 Tool call、普通文本终态和安全失败边界保持一致。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-4.1 调用模型` → `specs/model-invocation-contract/spec.md`
  - 功能边界：模型终态分别暴露停止原因与输出不完整原因，并由后者统一触发有界恢复；残缺 Tool call 不执行，没有截断证据时安全失败。
  - 系统质量属性：可靠性/恢复、安全、可测试性、审计/可追溯性。
  - 映射说明：`model-invocation-contract` 是 canonical spec；本 change 不触及 legacy spec。

## 影响范围（Impact）

- Agent 开发者和内部模型调用方可观察新增的 optional 终态事实；现有未读取该字段的调用方保持兼容。
- 模型终态公共 schema、OpenAI-compatible adapter、Agent 输出恢复和相关诊断投影需要同步适配。
- contract、provider adapter、Agent Core 和最小内核测试需要覆盖显式超限、推断 Tool call 截断、非截断参数错误及全部排除路径。
- 配置、持久化数据、Web API、stream schema 和部署方式不变。
