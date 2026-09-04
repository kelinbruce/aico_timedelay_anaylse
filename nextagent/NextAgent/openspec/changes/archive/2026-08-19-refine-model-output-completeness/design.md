## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-4.1 调用模型` | 将停止原因与可恢复输出不完整事实分离，并让明确超限与高可信 Tool call 截断进入唯一有界恢复流程 | `model-invocation-contract` | `FN-4.1 调用模型` |

## `FN-4.1 调用模型`

### 目标与规范依据

本设计使模型调用方同时保留 provider-neutral 停止原因和可选输出不完整原因。模型边界只基于封闭证据建立不完整事实；Agent Core 继续拥有恢复编排并确保残缺 Tool call 零执行。

#### 本 Function 的目标 Requirements

canonical spec：`model-invocation-contract`

- `MODIFIED`：`Non-streaming and streaming invocation share one terminal result contract`
- `MODIFIED`：`Failure exits are explicit and safe`
- `MODIFIED`：`输出超限不得静默截断`

### 当前实现

- `ModelFinalResult` 的 public type 与 runtime schema 只有 `finishReason`，没有独立的输出完整性事实。
- OpenAI-compatible adapter 先调用 `normalizeSdkToolCalls()`；任一 Tool call 无法归一化时立即返回 `MODEL_TOOL_ARGUMENTS_INVALID`，没有保留已归一化的 finish reason、usage、content 或 response id。
- `normalizeModelTerminalResult()` 把无完整 Tool call 的 `tool-calls` 与无 Tool call 的 `unknown` 转成 non-retryable failure；它无法区分普通结构错误和有预算证据的截断。
- `ModelRouteExecution` 直接以 `final.finishReason !== 'length'` 退出恢复分支。既有恢复状态支持一次预算提升、最多三次纯文本续写、取消传播、硬字符上限和残缺 Tool call fail closed。
- provider adapter tests 已覆盖完整 Tool call、`stop` 携带完整 Tool call和普通非法 arguments；Agent Core tests 已覆盖显式 `length` 的预算提升、续写、耗尽、Tool call 安全和取消，但没有跨 finish reason 的截断矩阵。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 公共终态分别表达停止原因和不完整原因 | `ModelFinalResult` 只有 `finishReason` | 缺少 additive provider-neutral contract、schema 和 contract tests |
| 高可信残缺 Tool call 进入恢复且保留原 finish reason | adapter 在 usage/reason normalization 前返回 validation failure | 缺少证据优先级和统一映射 |
| 所有可恢复不完整输出复用唯一恢复流程 | Core 只判断 `finishReason='length'` | 恢复入口绑定了不可靠的 provider reason |
| `truncated-tool-call` 只重生成一次且不进入文本续写 | 既有恢复只区分 `length` 与非 `length` | 缺少不完整原因对应的恢复分支和失败码选择 |
| 排除路径不误恢复 | 非法 Tool arguments 统一失败 | 新分类必须证明 usage 缺失、未饱和、content filter、error 和 safeError 仍失败 |

### 修改方案

唯一实现路径保持三层职责不变：`agent-contracts/model` 定义 provider-neutral 事实，`agent-model` 建立并校验事实，`agent-core` 消费事实执行恢复。runtime、channel、gateway、context 和 capability contracts 不修改。

1. 在 `agent-contracts/model` 增加 `ModelIncompleteOutputReason`，并向 `ModelFinalResult` 与 closed TypeBox schema 增加 optional `incompleteOutputReason`。这是 additive contract refinement；未知字段仍拒绝，现有调用方不读取该 optional 字段时保持源代码兼容。
2. 在统一终态 normalization 中为 schema-valid `finishReason='length'` 补充 `output-limit`，使所有 model provider 共享明确超限语义；已有 `safeError`、`content-filter` 和 `error` 先清除该字段并按既有安全失败收敛。
3. OpenAI-compatible adapter 在判断 Tool call 可用性前先归一化 finish reason、usage 和 response id，并把本次 request 的 effective `maxOutputTokens` 传给终态 normalization。只使用以下 decision table：

| Tool call 归一化 | finish reason | 合法 `outputTokens` 与有效上限 | adapter 结果 |
|---|---|---|---|
| 成功 | `length` | 任意 | 保留完整 Tool calls；统一终态层标记 `output-limit` |
| 成功 | 非 `length` | 任意 | 普通成功终态 |
| 失败 | `length` | 任意 | 保留 reason/content/usage，不交付 Tool calls，标记 `truncated-tool-call` |
| 失败 | `tool-calls | stop | unknown` | `outputTokens >= maxOutputTokens` | 保留 reason/content/usage，不交付 Tool calls，标记 `truncated-tool-call` |
| 失败 | `tool-calls | stop | unknown` | usage 缺失、非法或未饱和 | `MODEL_TOOL_ARGUMENTS_INVALID` |
| 失败 | `content-filter | error` 或已有 failure | 任意 | 对应安全失败，不标记不完整原因 |

   比较不使用容差，也不估算 usage。这样会保守漏掉 provider 真实上限低于请求上限的 case，但不会把普通非法参数扩大为恢复与额外模型调用。
4. `normalizeModelTerminalResult()` 先处理 content filter 和已有 safe error，再接受 schema-valid `incompleteOutputReason`，最后执行 `error`、`unknown` 和 `tool-calls` unusable terminal 检查。该顺序使高可信截断到达 Core，同时不让任意调用方伪造不完整原因绕过 schema；字段间组合由 contract schema 与 normalization tests共同约束。
5. `ModelRouteExecution` 只以 `incompleteOutputReason` 进入既有恢复状态。首次命中任一原因均尝试既有预算提升：
   - `output-limit`：提升后仍是纯文本 `output-limit` 才进入既有最多三次 continuation；恢复完成条件改为该字段缺失。
   - `truncated-tool-call`：提升后仍有任一不完整原因时立即发布 `MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL` 并失败；不得进入 continuation。
   - continuation 返回 Tool call、`truncated-tool-call` 或其他不可安全接续结果时继续 fail closed。
6. 诊断输出沿用 canonical `modelOutput` 对 `ModelFinalResult` 的投影。新增字段是 bounded enum，不包含 prompt、arguments 或 provider raw 数据；需要同步安全字段白名单与相关测试，但不新增 timeline/Web/audit 字段。

本设计不增加 provider quirk registry、模型名分支、容差配置、第二恢复 helper 或 runtime retry。完整 Tool call 继续按非空事实进入 Tool loop；只有 adapter 拥有的 raw structural evidence 用于推断 `truncated-tool-call`。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `输出超限不得静默截断` | additive 完整性事实、一次重生成、既有有界 continuation | 各 finish reason、边界 Token 值、恢复耗尽与取消 |
| 安全 | `Failure exits are explicit and safe`、`输出超限不得静默截断` | 残缺 Tool call 零执行；策略/error 优先；usage 缺失或未饱和不推断 | Capability 调用次数为零、无 raw arguments/输出泄漏 |
| 性能/容量 | `输出超限不得静默截断` | 不增加恢复次数上限；推断 Tool 截断至多增加一次同请求调用 | 最大调用次数、预算上限和硬字符上限不回归 |
| 可测试性 | `Non-streaming and streaming invocation share one terminal result contract` | 同一 public contract 和 deterministic provider 序列覆盖 complete/stream/Core | contract、adapter、Core 黑盒矩阵一致 |
| 审计/可追溯性 | `Non-streaming and streaming invocation share one terminal result contract` | 保留原 `finishReason`，新增 bounded incomplete reason | canonical diagnostic 同时可见两个事实且不含 raw payload |

#### 备选方案（Alternatives Considered）

- 把误报的 `tool-calls`、`stop` 或 `unknown` 改写成 `length`：改动较小，但会销毁原停止原因并继续把完整性绑定到 reason，拒绝采用。
- 仅新增 retryable `safeError`：会把恢复与 fallback/error orchestration 混在一起，并使成功但不完整的终态失去独立表达，拒绝采用。
- 对所有非法 Tool call 无条件重试：能覆盖 usage 缺失，但会把普通 provider/schema 错误误判成输出超限并增加成本，当前范围拒绝采用。

## 验证策略（Verification Strategy）

- contract tests 验证新增 enum、optional 字段、closed schema、显式 `null`/未知值拒绝，以及 safeError 与 incomplete reason 的非法组合。
- adapter unit tests 使用非流式与流式 provider response 覆盖 finish reason 矩阵、Token 饱和边界、usage 缺失/非法、完整与残缺 Tool calls，并断言保留 reason/content/usage 且不交付残缺 arguments。
- Agent Core characterization tests 通过 public `ModelInvocationService` 与 capability execution observation 验证一次预算提升、文本 continuation、完整 Tool call 执行、残缺 Tool call 零执行、耗尽和取消。
- minimal-kernel、architecture 和全量 backend gates 证明 public contract refinement 未破坏依赖方向、hook boundary、terminal commit 或现有模型路径。
- 人工语义审查检查 provider normalization 与 Core orchestration owner 未漂移，诊断字段不泄漏 raw payload。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/model-invocation-contract/spec.md`：合并三个 MODIFIED Requirements 与 Function 元数据。
- `openspec/designs/functions/D4-模型与上下文/D4.1-模型调用与降级/FN-4.1-调用模型.md`：刷新输出、处理过程、结果和输出不完整恢复规格。
- `openspec/designs/features/D4-模型与上下文/D4.1-模型调用与降级/F-4.1-接入多种模型.md`：更新兼容模型可依赖的恢复质量保证。
- `openspec/overview.md`：补充停止原因与输出完整性分离的不变量。
- `openspec/designs/architecture/model-provider-boundary.md`：补充 adapter 完整性证据与 Core 恢复 owner 边界。
- `openspec/designs/modules/agent-model.md`、`openspec/designs/modules/agent-core.md`：更新 normalization 与恢复入口。
- `openspec/designs/adr/`：无；未改变长期 owner 或技术栈。
- `openspec/designs/spec-to-design-map.md`：补充验证入口与设计导航。

## 风险与取舍（Risks / Trade-offs）

- provider 真实输出上限低于请求 `maxOutputTokens` 或 usage 缺失时，本设计可能保守漏判。缓解方式是保持安全失败和诊断证据，不以猜测触发额外调用；未来如有可信模型能力字段，另建 contract refinement。
- public optional 字段会影响严格 closed-schema consumer。缓解方式是同步仓内 schemas、contract guards 与直接构造 fixture，并保持字段 optional，不改变已有成功结果的必填 shape。
- 首次流式调用可能已经投影 partial content，预算提升会用新候选覆盖。该行为沿用既有累计快照恢复语义，terminal 只提交重生成结果。

## 迁移与回滚（Migration / Rollback）

无需数据或配置迁移。发布时 contract、adapter 和 Core 必须在同一版本交付；仓内 closed-schema consumer 同步更新。回滚时整体回退新增字段、adapter 分类和 Core 入口，持久化与 Web 数据不受影响。验证以 contract test、聚焦恢复测试和全量门禁为准。

## 待确认问题（Open Questions）

无。项目群已于 2026-08-19 确认 additive `agent-contracts/model` refinement，实施期 `nextagent-skill-review` 与 push 前 `nextagent-code-review` 均已完成。
