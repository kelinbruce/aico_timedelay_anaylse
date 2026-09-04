## 设计范围

| Function | 目标变化 | Delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.2 调用能力` | 统一 Capability 失败结果、校验诊断、输出无效语义、自动重试和 20 个 first-party Tool 失败闭包 | `capability-catalog`；legacy source `builtin-tool-framework`、`workflow-agent-loop-tool` | §3 |
| `FN-3.4 工具循环失败保护` | 统一模型决策、控制流保真、取消、`maxTurns` 收敛、`maxToolCallsPerTurn` 前缀接纳和隐藏 ApiCall 直接路径；移除重复失败与 Tool 超限局部终止 | `tool-loop`；legacy source `ts-minimal-agent-kernel` | §4 |
| `FN-3.2 编译智能体装配` | runtime-ready assembly 只发布 `maxTurns` 与 `maxToolCallsPerTurn` 两个 canonical loop settings | `agent-package-assembly` | §4A |
| `FN-2.1 提交请求` | request routing constraints 删除 `maxToolCalls`，model-only 保持收窄语义 | `routing-constraint-validation` | §4B |
| `FN-4.1 调用模型` | `ModelInferenceOptions` 增加 canonical `toolChoice`，固定 profile/request/Hook 合并、缺省和 provider 映射 | `model-invocation-contract` | §4C |
| `FN-4.3 装配上下文` | 把 `toolChoice` 纳入 profile、Prompt、Capability patch、trusted request 的 pre-hook merge | `context-engine` | §4D |
| `FN-10.1 注册和执行钩子` | `BEFORE_MODEL_INVOKE` 支持 `toolChoice`，`BEFORE_PLANNING` 删除 loop-limit mutation | `lifecycle-hook-execution` | §4E |
| `FN-10.4 自定义工具和提示词` | Prompt Template `modelOptions` 支持 canonical `toolChoice` | `prompt-template-assembly` | §4F |
| `FN-2.8 指令定向请求处理` | Web submit 非目标约束复用无 Tool 数量预算的 closed allow-list | `directive-capability-routing` | §4G |
| `FN-5.3 读写编辑文件` | Read Tool 的路径、分页、容量和安全失败迁入 Function 主规格 | `file-operation-tools` | §4H |
| `FN-5.9 调用技能` | Skill metadata model options 支持 canonical `toolChoice` patch | `skill-tool` | §4I |
| `FN-11.1 恢复运行状态` | `RequestContext` 与 checkpoint 保持同一个 run-level logical Agent turn coordinate | `local-runtime-recovery`；legacy source `ts-core-contracts`、`ts-minimal-agent-kernel` | §4J |
| `FN-2.6 指定技能处理` | 定向 Skill 消费同一最终结果并确定终止 | `targeted-skill-routing` | §5 |
| `FN-9.4 执行能力节点` | 全部 Workflow Capability 调用点上升最终失败 | `workflow-capability-nodes` | §6 |
| `FN-9.7 执行模型节点` | `DATA_ANALYSIS` Python 子调用遵守统一失败处置 | `workflow-llm-nodes` | §7 |
| `FN-9.1 执行工作流` | Capability 最终失败跳过节点 retry 并进入显式 exception；`NODE_WAITING` timeline 投影为 `SUCCEEDED + WORKFLOW_NODE_WAITING` | `workflow-contracts`；legacy source `workflow-execution-engine` | §8 |
| `FN-5.6 向用户提问` | AskUserQuestion 使用完整诊断，全部非取消失败反馈模型并由 `maxTurns` / `maxToolCallsPerTurn` 保持有界 | `ask-user-question-tool` | §9 |
| `FN-5.5 执行命令和脚本` | Bash 可修正命令格式错误使用输入校验语义，正常完成的非零退出保持成功；Python guard 和执行失败使用统一安全语义 | `command-script-tools`；legacy source `bash-tool`、`python-tool` | §10 |
| `FN-5.13 检索知识库` | RAG 明确空结果、失败和部分降级边界 | `rag-tool` | §11 |
| `FN-8.2 检索和写入记忆` | memory Tool 统一 outer safe error、容量和重放边界 | `memory-tools` | §12 |

## 2. 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | Delta operation | 目标归属 |
|---|---|---|---|
| `tool-loop / Repeated non-terminal capability failures stop the current run` | `FN-3.4 / tool-loop` | 来源 `REMOVED`；目标 `ADDED/MODIFIED` | 删除重复失败局部终止；最终失败反馈模型，循环只由 `maxTurns` 收敛 |
| `capability-catalog / Executors Return Results Without Owning Runtime Side Effects` | `FN-5.2 / capability-catalog` 与 `FN-3.4 / tool-loop` | 来源 `REMOVED`；目标 `ADDED` | 结果契约归 `capability-catalog`，Agent 处置归 `tool-loop`，白盒 owner 归本 design |
| `builtin-tool-framework / Model-correctable Tool input failures expose safe diagnostics` | `FN-5.2 / capability-catalog` | 来源 `REMOVED`；目标 `ADDED` | 完整 violations、容量和模型投影统一归 `capability-catalog` |
| `workflow-agent-loop-tool / Workflow Tool Availability` | `FN-5.2 / capability-catalog` | 来源 `REMOVED`；目标 `ADDED` | Workflow builtin Tool 入口、可见性、输入、scope、结果安全和 visible delta 迁入统一调用闭包；recipe missing 使用统一 `NOT_FOUND` |
| `workflow-agent-loop-tool / Workflow Result To Capability Result Mapping` | `FN-5.2 / capability-catalog` | 来源 `REMOVED`；目标 `ADDED` | 四类 execution status、answer previews、outputVariables 安全和 metadata 完整迁入；合法 `WAITING` 改为 `SUCCEEDED` |
| `bash-tool / Bash Accepts Only Strict Single Commands` | `FN-5.5 / command-script-tools` | 来源 `REMOVED`；目标 `ADDED` | 单命令和 sandbox 边界保留；可修正格式错误归输入校验 |
| `bash-tool / Bash Results Are Bounded And Safe` | `FN-5.5 / command-script-tools` | 来源 `REMOVED`；目标 `ADDED` | 有界输出、安全日志和 execution-boundary failure 保留；正常完成的非零退出统一为 `SUCCEEDED` |
| `python-tool / Python tool returns structured execution result` | `FN-5.5 / command-script-tools` | 来源 `REMOVED`；目标 `ADDED` | 非零结构化结果保留；guard、internal、timeout 和安全部分输出统一归 `command-script-tools` |
| `workflow-execution-engine / Timeout and Retry` | `FN-9.1 / workflow-contracts` | 来源 `REMOVED`；目标 `ADDED` | 非 Capability retry 保留；Capability 最终失败归显式 exception |
| `ts-minimal-agent-kernel / RequestContext 使用可恢复执行坐标` | `FN-11.1 / local-runtime-recovery` | 来源 `REMOVED`；目标 `ADDED/MODIFIED` | 既有恢复坐标按 runtime owner 保留；只增加同一个 `agentTurnIndex`，不新增 phase 或平行状态机 |
| `ts-minimal-agent-kernel / 最小 Capability Tool 集合` | `FN-5.2 / capability-catalog`、`FN-5.3 / file-operation-tools`、`FN-3.4 / tool-loop`、`FN-3.2 / agent-package-assembly`、`FN-2.1 / routing-constraint-validation`、`FN-4.1 / model-invocation-contract` | 来源 `REMOVED`；目标 canonical specs `ADDED/MODIFIED` | Tool 可用性、Read 行为、fan-out、治理、配对和 loop limits 按 owner 完整迁移；删除旧日志开关与平行数量预算 |
| `ts-minimal-agent-kernel / 同轮工具调用受控并行执行` | `FN-3.4 / tool-loop` | 来源 `REMOVED`；目标 `ADDED` | 保留受控并行、取消、pending 互斥、独立配对与顺序回填；数量控制改为前缀接纳 |
| `ts-minimal-agent-kernel / Tool loop recovers empty tool-name tool calls without interrupting the run` | `FN-3.4 / tool-loop` | 来源 `REMOVED`；目标 `ADDED` | 保留空名称纠正反馈和零孤立消息；删除连续 recovery counter 与局部终止 |
| `ts-core-contracts / Runtime Command And RequestRun Baseline` | `FN-2.1 / routing-constraint-validation` 及既有 `agent-tool`、`capability-catalog`、`workflow-contracts`、scheduler 主规格 | 来源 `REMOVED`；目标 canonical specs | 多 Function legacy source 整条退出；既有行为按 owner 保留，request Tool-call 数量预算删除 |
| `ts-core-contracts / Checkpoint Recovery Contract Baseline` | `FN-11.1 / local-runtime-recovery` | 来源 `REMOVED`；目标 `ADDED/MODIFIED` | 保留全部 checkpoint anchors 与 no-op contract，只增加 `agentTurnIndex` |
| `ts-core-contracts / RoutingConstraints fields are minimal and safe` | `FN-2.1 / routing-constraint-validation` | 来源 `REMOVED`；目标 `MODIFIED` | closed allow-list 继续安全收窄，但不包含 Tool-call 数量预算 |

所有来源 spec 的未触及 Requirements 原位保留。归档后 `capability-catalog`、`command-script-tools` 和 `workflow-contracts` 是对应行为的唯一 canonical target；`bash-tool`、`python-tool` 和 `cross-platform-executable-semantics` 继续作为 `FN-5.5` 的遗留规格，直到其各自尚未触及的 Requirements 后续按规则迁移。

### 2.1 并行 change 语义协调

本 change 的设计、实现和验证以当前分支已同步的 `main` 代码与 stable OpenSpec 为基线。active change 是并行增量，不是当前实现的权威输入；其状态和是否归档均不构成本 change 的实施前置。依赖审计以 Requirement 合并键和行为不变量判定，不以“修改同一 spec 文件”判定。

以下并行 change 会在未来集成时触及相同 Requirement 或行为不变量。本 change 按当前基线采用表中的当前目标；后合入 `main` 的 change 必须在 rebase、归档或合并审查时对照届时最新 stable 与代码重新消解冲突，不得静默覆盖先合入 change 的行为：

| 行为冲突面 | 并行 change | 本 change 的当前基线目标与后续集成责任 |
|---|---|---|
| `ModelInferenceOptions.modelParams` 与 `model-invocation-contract / Target-state request fields are stable invocation inputs` | `enhance-ts-workflow-llm-model-params-passthrough` | 当前代码已包含该 active change 的 Workflow 透传实现；本 change 只增加 `toolChoice`，实施时不得删除、重命名或改变 `modelParams` 行为。任一 change 归档或后合入时必须从最新 stable 重建完整字段清单，不能把另一方字段静默删除，也不能把 `modelParams` 扩大为新的 Tool-choice authority |
| `lifecycle-hook-execution / Stage-specific boundaries and mutations are minimal runtime contracts` | `refine-model-result-hook-diagnostics` | 当前基线移除 `BEFORE_PLANNING` 的 `maxRounds/maxCalls` 并为 `BEFORE_MODEL_INVOKE` 增加 `toolChoice`；并行 change 为 `AFTER_MODEL_RESULT` 增加只读时延和 usage 诊断事实。后合入者必须从最新 stable 重建完整 stage 表和约束，同时保留两侧行为，不得恢复旧预算、遗漏 `toolChoice` 或把只读诊断字段变成 mutation authority |
| `add_memory` 自动重放资格 | `add-ts-response-memory-disclosure` | 当前基线保持 `add_memory=NON_IDEMPOTENT`；若并行 change 后合入，必须在其 delta、实现和测试中保留或显式修改届时已合入的 replay policy，不能同时留下两种假设 |
| `workflow-execution-engine / Timeout and Retry` 迁移 | `refine-ts-workflow-exception-failure-contract`、`refine-ts-workflow-user-check-scenarios` | 当前基线按本 change 的来源 `REMOVED` 与目标 `ADDED` 原子迁移；后合入者必须从最新 `workflow-contracts` 重建 timeout、retry、exception 与 waiting 的完整目标，不能恢复已移除的并行规范来源或覆盖 Capability 零节点重试 |
| Workflow 取消与 Capability 最终失败的 catch 优先级 | `refine-ts-workflow-cancel-policy` | 当前基线保持外部取消先进入 cancel/rollback、fallback 中 Capability 最终失败不进入节点 retry/普通 exception、非 Capability 回退节点保持既有 timeout/retry；后合入者必须基于该顺序合并其新增 cancel policy |
| `workflow-capability-nodes / Restful Node` | `add-ts-workflow-capability-nodes` | 当前基线在同名 Requirement 上补充 Capability 最终失败不再进入节点 retry/onError 的收敛规则；并行 change 定义请求、secret、长任务和 batch 基础语义。后合入者必须从最新 stable 重建完整 Requirement，保留安全 gateway、secret 隔离、轮询与 batch 行为，同时不得恢复 Capability 的第二层节点重试 |
| `ts-minimal-agent-kernel / 最小 Capability Tool 集合` 的 operational logging 重述 | `add-ts-runtime-operational-log-hardening` | 当前 change 整条移除该 mixed legacy Requirement；Tool diagnostic 只遵守 `runtime-logging` 与 coding standard 的 canonical `toolInput/toolOutput`，不保留 normal/debug 开关。后合入者必须迁到 canonical logging owner，不得恢复旧预算或日志分支 |
| Capability 单结果容量与隐藏 `ApiCall` 直达结果 | `add-ts-skill-driven-api-call`、`persist-ts-refresh-stable-completed-turns` | 本 change 只保留 `capabilityResultJsonCapacity=256000` 所代表的统一公共结果容量，并删除无实际 consumer 的旧 `maxCapabilityResultMessageChars` export；任何 runtime Capability 或持久化展示 change 都不得绕过该容量、恢复第二个 pre-limit，或把超限原结果直接写入 terminal/history。后合入者必须改为消费 canonical result、外置引用或安全容量失败 |
| Bash 新输入/流式路径的失败分类 | `add-bash-structured-argv`、`add-bash-streaming-structured-delta` | 本 change 要求可修改输入拒绝保持 `VALIDATION + retryable=false`，正常完成的 zero/non-zero 进程结果保持 `SUCCEEDED`。后合入者必须从最新 `command-script-tools` 重建语义，不能恢复 `retryable=true` 的输入错误或基于 exit code 的 `DEGRADED/FAILED`；流式 terminal 结果与最新非流式结果同形 |
| model output continuation 与 Agent logical turn 计数 | `recover-ts-model-output-token-limit` | provider output recovery 属于同一 logical Agent turn，不能继续引用 `maxToolIterations` 或绕过 `agentTurnIndex`；后合入者必须保持 recovery replay 不增加 normal turn，同时任一不完整 Tool call 仍零执行 |
| Workflow v2 retry policy 与 Capability 最终失败 | `refine-ts-workflow-execution-engine-v2`、`refine-ts-workflow-recipe-v2-contracts` | 当前实现已复用 `retry → retryPolicy → runtime.defaultRetry` 解析并把结果下沉为 Capability `maxRetries`；后合入者可以扩展非 Capability 节点 retry，但不得让 Capability 最终失败重新进入 engine retry，也不得建立第二个 retry policy parser |

`add-ts-workflow-event-history`、`add-ts-workflow-output-parser-contract`、`fix-python-preamble-guardrail-isolation` 和 `refine-rag-tool-output-and-display` 只涉及邻接投影、输入/输出 shape 或展示；`refine-ts-tool-default-root` 只改变 Tool 默认根目录。它们同样不是实施前置，但后合入时必须保留本 change 的最终 status、统一容量、retry 和 safe-error 边界，并运行对应 regression tests。

本 change 归档前只需对照届时最新 stable 重新校验自身 delta operation，并记录仍存活的同 Requirement 或冲突行为 active change 及后合入责任。若冲突 change 已先合入，本 change 必须从最新 stable 重建相关 `ADDED/MODIFIED/REMOVED`；若本 change 先合入，则由后合入 change 承担相同责任。并行 change 无需为本 change 先行完成、归档或关闭。

## 3. `FN-5.2 调用能力`

### 3.1 目标与规范依据

本 Function 的 canonical spec 是 `capability-catalog`。

本 Function 的目标 Requirements：

- `ADDED Runtime Capability 失败复用统一 SafeError 结果`
- `MODIFIED Capability Governance Uses The Existing Unified Contracts`
- `ADDED Capability 结果扩展保持受治理`
- `ADDED Workflow Tool 通过统一入口忠实返回执行结果`
- `ADDED 参数校验一次返回当前阶段全部违规`
- `ADDED 安全业务错误和未知异常使用确定映射`
- `ADDED 模型可调用 Tool 的失败消息具有确定语义`
- `ADDED 瞬态失败只在统一执行边界安全重试`
- `ADDED 所有一方 Tool 闭合统一失败契约`
- `ADDED Capability 结果复用统一容量和转储机制`
- `ADDED Capability 失败证据不跨安全边界`

### 3.2 当前实现

- `agent-contracts/capability` 已定义唯一 `CapabilityInvocationRequest`、`CapabilityInvocationResult` 和 `CapabilityInvocationPort`；request 已包含 optional `maxRetries`，result 使用 `safeError?: SafeError`，调用 port 接收父 `AbortSignal`。
- `GovernedCapabilityInvocationPort` 已在父 signal 下完成 descriptor resolution、完整 input violations、唯一 executor selection、result normalization/output validation、统一容量校验和同参自动 retry；非法 `maxRetries` 已归一化为 `0`，每次 attempt 复用原 request 的 `timeoutMs`。
- ordinary Agent、定向 Skill、隐藏 `ApiCall`、Workflow Capability nodes、`DATA_ANALYSIS` Python 和 memory Tool 已消费同一个最终结果；非取消 invocation rejection 和非法 result/extension 会先安全规范化，取消继续优先传播。
- Bash 正常 zero/non-zero completion 已统一为 `SUCCEEDED`；Workflow Tool 的合法 `WAITING` 已映射为无 `safeError` 的 `SUCCEEDED` 控制结果；RAG 只在存在可独立使用 chunks 且 provider 明确报告其余声明范围未完成时生产 `DEGRADED`。
- `fallbackTriggered` 已由 result contract、strict schema 和安全投影支持，但当前 first-party producer 没有实际写入该字段；本 change 不需要新增 fallback 执行机制。
- `CAPABILITY_RESULT` 仍以独立 session message content 保存，不是原样持久化的 `CapabilityInvocationResult`；安全投影把 runtime `safeError.message` 映射为 `safeError.errorMessage`，大型结果可写入由 Read 回读的外置文件。统一结果容量由 `capabilityResultJsonCapacity` 在受治理调用返回前执行；agent-core 仍残留一个无实际 consumer 的旧 `maxCapabilityResultMessageChars` export，但不再形成有效运行时限制。
- Workflow Tool result mapper 当前 metadata 仍额外写入 `durationMs`，尚未把公共 metadata 闭合到 optional `executionId` 和 optional 非负安全整数 `nodeResultCount`。
- 相关测试分散在 `packages/agent-capability/tests`、`packages/agent-core/tests`、`packages/agent-workflow/tests`、`packages/agent-memory/tests`、channel 与 frontend；根 `vitest.config.ts` 排除了其中多个目录，完整 package tests 需要 release 或专用配置。

### 3.3 GAP 分析

- 统一失败结果、完整诊断、自动 retry、容量与 first-party Tool 闭包已由本 change 的既有实现和 tests 闭合；后续 loop-control 与 `toolChoice` 实施必须复用这些边界，不得新增平行错误、retry 或容量机制。
- Workflow Tool metadata 仍允许一个未声明的 `durationMs` 字段，无法形成封闭的安全公共结果；必须在 producer 交付前只保留两个已声明字段并拒绝其他 metadata。
- 无 consumer 的旧 `maxCapabilityResultMessageChars` export 与 canonical `capabilityResultJsonCapacity` 同时存在会误导并行 change 恢复第二个限制；应直接删除旧 export，不保留 alias。
- `fallbackTriggered` 当前没有 first-party producer；只需保持 status 正交 contract 和 tests，不增加 fallback dispatcher、状态机或通用 partial-result abstraction。

### 3.4 修改方案

保留既有 app composition：`agent-app` 继续通过 `createCapabilitySubsystem(...)` 获得 `CapabilityCatalog`、`CapabilityInvocationPort`、frozen providers 和 startup validation/reporting hooks，不接收 contribution snapshots、discovery/executor instances、provider options、standalone diagnostics 或 Tool-facing dependency ports，也不重排无关 runtime/context/model/gateway/observability/attachment/memory 装配。catalog、discovery 和 execution implementation classes 继续位于 `agent-contracts` 之外；本 change 只为现有 `CapabilityInvocationRequest` 增加 `maxRetries`，不创建新 catalog、port、provider configuration contract 或 composition abstraction。

#### 3.4.1 公共结果契约

`agent-contracts/capability` 的目标对象为：

```ts
interface CapabilityInvocationResult {
  readonly status: "SUCCEEDED" | "FAILED" | "DEGRADED" | "TIMED_OUT";
  readonly structuredPayload: JsonObject;
  readonly generatedMessages: readonly CapabilityGeneratedMessage[];
  readonly contextPatch?: CapabilityContextPatch;
  readonly resultRef?: string;
  readonly artifactRefs: readonly ArtifactId[];
  readonly safeError?: SafeError;
  readonly fallbackTriggered?: boolean;
  readonly metadata?: JsonObject;
}
```

状态不变量：

- `SUCCEEDED` 禁止 `safeError`，`structuredPayload` 是 owning Capability 声明的合法最终结果并通过 output schema；合法空集合、声明上限内的 truncation、明确的非零进程退出和协议控制结果都可以是成功。
- `DEGRADED` 只在 owning Capability 声明的复合目标中至少一个子结果成功且可独立使用、同时至少一个已声明子结果缺失或失败时成立；非空 `structuredPayload` 必须通过 output schema，并按 owning Tool 契约携带可选 `safeError`。本 change 触及的 first-party Tool 降级出口携带 `safeError`。
- `FAILED` 和 `TIMED_OUT` 必须有合法 `safeError`；没有可用业务结果时 `structuredPayload` 必须为 `{}`。只有 owning Capability 显式声明的安全业务恢复事实或 stdout/stderr/chunks 等部分结果允许非空，且非空时必须通过 output schema。
- `SafeError` 使用 `{code, category, message, retryable, safeDetails?}`。
- `structuredPayload` 只承载业务结果，不承载 `errorDiagnostics`。
- `safeDetails.reasonCode` 只能表达比 `safeError.code` 更窄的原因，值相同则省略。
- `contextPatch` 保持 canonical `modelId`、closed `ModelInferenceOptions`、受治理 Skill `providerOptions` 和 request-local 模型治理契约；`toolChoice` 作为 provider-neutral field 使用 `AUTO | NONE | REQUIRED`，与其他 inference option 一样只影响当前 request/run。
- `fallbackTriggered` 只记录路径事实，不参与 status 推导；最终 status 完全由 fallback 的最终结果决定。

`CapabilityInvocationRequest` 增加可选 `maxRetries`，有效值为 `0` 到 `5` 的安全整数，表示初始 execution attempt 之后最多允许的额外同参重试次数；字段缺失时统一执行边界使用默认值 `1`，因此默认总 attempt 数最多为 `2`。统一执行边界收到非整数、负数、非安全整数或大于 `5` 的值时采用 try-best 策略，将 effective `maxRetries` 统一归一化为 `0`，继续完成 descriptor 解析、input validation 和 executor dispatch，并在成功通过这些边界后执行一次初始 attempt；不得仅因该非法值返回配置失败。严格 result runtime schema、参数 formatter、错误规范化、retry predicate 和失败处置均位于 `agent-capability` 实现边界。`agent-contracts/capability` 不增加新的平行 request、schema 或功能性 helper；`CAPABILITY_RESULT` content、外置回读文件、channel/Web 投影和 Recipe exception 变量 `error` 继续由各自既有边界拥有。runtime `safeError.message` 只在模型投影边界映射为 `safeError.errorMessage`。

#### 3.4.2 统一执行边界

`GovernedCapabilityInvocationPort` 是 Tool、Skill、Agent 同参自动重试的唯一 owner。普通 governed Capability 调用按固定顺序完成：

1. 检查 request contract，并把缺失的 `maxRetries` 解析为 `1`、把不在 `0` 到 `5` 有效域内的值归一化为 `0`。
2. 在安全异常边界内以父 `AbortSignal` 解析并校验 descriptor；调用前已取消或解析期间取消时，不创建 executor、不开始 execution attempt，并返回统一取消结果。`resolveForInvocation(...)` 的 agent-capability 私有签名接收该 signal，禁止再创建与调用无关的空 signal。
3. 完成公共 input schema 校验；失败时不创建或调用 executor。
4. 选择唯一 provider executor。
5. 发起 execution attempt。
6. 严格校验 result envelope、status/`safeError` 组合、结构化 delta、generated messages、context patch、refs 和 metadata。
7. 对所有 status 的非空 `structuredPayload` 校验 output；`FAILED/TIMED_OUT` 的空对象跳过业务 output schema。
8. 对 normalized result 执行一次公共 capacity guard。
9. 仅当 §3.4.4 全部门禁成立时，以相同调用身份再次调用同一 executor；descriptor resolution、factory 选择和 input validation 不重做。
10. 把唯一最终结果交给 Agent 或 Workflow consumer。

Builtin、CLIP 和 Plugin adapter 只适配 raw producer 事实，不拥有最终 envelope、output validation、capacity guard 或自动重试；这些职责由 E7 唯一执行。descriptor 只解析一次，retry 不重新 discovery 或切换 provider/executor。该边界只返回结果，不写 session、timeline、checkpoint、terminal commit 或 Agent loop state。

Capability `outputSchema` 的约束在 producer result 由 `GovernedCapabilityInvocationPort` 返回时结束。`AFTER_CAPABILITY_RESULT` 是可信 lifecycle post-processing，可以按其 hook contract 有意转换 `structuredPayload`；转换后的结果由 hook contract 治理，不得重新套用原 Capability `outputSchema`。本 change 不修改 hook 实现或 hook contract。

`fallbackTriggered` 保持 strict result schema 已有的可选 boolean 和既有透传投影。统一边界不依据该字段推导或改写 status；安全投影和 dev workbench 只把它显示为“fallback 已触发”的路径事实，不使用“降级”标签覆盖 result status。由于当前没有 first-party producer，本 change 不新增 fallback dispatcher、选择逻辑、状态机或通用 partial-result abstraction。

“单一 schema validator”限定为上述普通 governed Capability 调用路径。AskUserQuestion 必须在 assistant tool-use batch 已持久化之后、创建 pending input 之前完成校验，因此继续保留 agent-core 的窄化 preflight；该 preflight 复用相同黑盒规则和共享 fixtures，但 agent-core 不得依赖 agent-capability 实现包。

#### 3.4.3 唯一错误映射

| 事实 | 最终 status / safeError | message 目标 |
|---|---|---|
| 公共 schema 或本地可声明语义约束失败 | `FAILED / CAPABILITY_INPUT_INVALID / VALIDATION / false` | 说明阶段和违规总数，要求修正 violations 后重新调用 |
| 目标不存在或当前不可见 | `FAILED / CAPABILITY_NOT_FOUND / NOT_FOUND / false`，或 owning Tool 既有 code | 指向 ToolSearch、list、search 或其他安全发现动作 |
| 已安全化的业务错误 | 保持 `code/category/message/retryable/safeDetails`；`TIMEOUT` 对应 `TIMED_OUT`；`NON_IDEMPOTENT` producer 的 timeout 默认 `retryable=false`，除非 producer 明确声明重放安全 | 保留 owning producer 给出的领域事实和下一步 |
| descriptor mismatch、available descriptor 没有 executor、多个 executor、factory 任意异常、非法 result envelope 或未知 throw/rejection | `FAILED / CAPABILITY_EXECUTION_FAILED / INTERNAL / false` | 按固定阶段说明调用未开始或已经停止，以“停止该动作并报告错误”结束，不建议修改参数或重试 |
| output、结构化 delta 或输出投影不符合声明 schema | `FAILED / CAPABILITY_OUTPUT_INVALID / VALIDATION / false` | 说明输出契约无效，禁止原样重复，允许缩小或调整请求或改用其他 Capability |
| 请求或 producer 明确取消 | `FAILED / owning cancellation code / CANCELED / false` | 说明调用取消，不暗示继续执行 |
| 执行事实 owner 明确确认副作用结果无法判断 | `TIMED_OUT/TIMEOUT` 或 `FAILED/UNAVAILABLE`，`code=CAPABILITY_RESULT_UNKNOWN`、`retryable=false` | 要求先用独立 Read/list/search/query 核验实际状态 |
| 合法空集合、未命中项或 poll 尚未完成 | owning Capability 的正常结果 | 不创建 safeError |
| 单一动作的明确结果、声明上限内 truncation、非零进程退出或协议控制结果 | `SUCCEEDED` + 声明结果 | 允许调用方依据明确结果采取后续动作，不创建 safeError |
| 声明复合目标中存在可独立使用的成功子结果，且至少一个已声明子结果缺失或失败 | `DEGRADED` + 可用子结果 + owning safeError | 说明可用子结果、缺失或失败子结果和下一步 |
| 没有可用业务结果 | `FAILED`、`TIMED_OUT` 或取消结果 | 不使用空 `DEGRADED` 维持控制流 |
| fallback 被触发 | `fallbackTriggered=true`，status 仍按上述最终事实选择 | 不把路径 metadata 当作降级分类；safeError 只描述最终 fallback 结果 |

`CAPABILITY_OUTPUT_INVALID` 使用 `VALIDATION` 表示 output contract validation，不等同于 input validation，不携带 `safeDetails.violations`。它的 `retryable=false` 禁止执行边界同参重试；普通 Agent 是否允许模型选择不同动作由 §4 决定。

未知异常不推断为 `UNAVAILABLE`。`NON_IDEMPOTENT`、timeout 或断连不单独证明结果未知。公共边界使用现有稳定通用 code：`CAPABILITY_INPUT_INVALID`、`CAPABILITY_OUTPUT_INVALID`、`CAPABILITY_NOT_FOUND`、`CAPABILITY_DEPENDENCY_UNAVAILABLE`、`CAPABILITY_EXECUTION_FAILED`、`CAPABILITY_RESULT_UNKNOWN` 和既有容量 code；取消保留 owning cancellation code 并统一使用 `CANCELED` category；Tool-owned code 保持原义，不增加平行 code 层级。

私有 failure stage 固定为 `DESCRIPTOR_RESOLUTION`、`EXECUTOR_SELECTION`、`CAPABILITY_EXECUTION`、`RESULT_VALIDATION` 和 `RESULT_SERIALIZATION`。前两者 message 必须说明调用未开始，后三者说明调用已经停止或结果不能交付；全部 internal message 都以停止该动作并报告错误的建议结束。只有 Capability 未启用、未发现或对当前可信 scope 不可见时使用 `UNAVAILABLE`/not-found；descriptor mismatch、missing/ambiguous executor 和 factory error 一律使用 `EXECUTOR_SELECTION` internal。不合法的 `maxRetries` 配置不再产生 `INVOCATION_CONFIGURATION` internal 失败，改为 try-best fallback 到 `maxRetries=0`（执行一次不重试），避免配置错误阻止 capability 执行。

既有 `ToolFailedResultError`、`ToolTimedOutResultError` 和 `ToolDegradedResultError` 只增加产生安全 `message` 所需的最小可选参数；不新增 Error class。缺省消息只用于未知或扩展 Tool 兜底，20 个 first-party Tool 的已知失败出口必须产生领域可理解 message。`ToolDegradedResultError` 只能由满足上述复合部分成功条件的 producer 使用，Bash 非零退出和 Workflow `WAITING` 不再使用该 carrier。

“已安全化的业务错误保持 `code/category/message/retryable/safeDetails`”适用于 producer 已经提供完整 `SafeError` 的路径。既有 `ToolDegradedResultError` 是窄化的兼容 carrier，只携带部分可用结果、`reasonCode` 和可选安全 message，不携带 category 或 retryable；executor 将该 carrier 唯一适配为 `DEGRADED + category=UNAVAILABLE + retryable=false`，并保留其 `reasonCode` 作为 code。该路径是 §3.4.3 保真规则的显式例外，不得据此覆盖 producer 已提供的 category，也不得扩展出第二套 degraded 映射。

#### 3.4.4 自动重试

统一执行边界先把 `CapabilityInvocationRequest.maxRetries` 解析为当前逻辑调用的额外 retry 上限；字段缺失时取 `1`。解析规则：未传取默认 `1`；传入合法整数（`0` 到上界 `5`）则使用传入值；传入不合法值（非整数、负数、超过上界）时 try-best fallback 到 `0`（执行一次不重试），不拒绝整个调用。只在以下条件全部成立时启动下一 attempt：

```text
status ∈ {FAILED, TIMED_OUT}
AND safeError.category ∈ {UNAVAILABLE, TIMEOUT}
AND safeError.retryable = true
AND descriptor.replayPolicy = IDEMPOTENT
AND signal.aborted = false
AND safeError.code != CAPABILITY_RESULT_UNKNOWN
AND runtimeContext.emitResultDelta was not called by this attempt
AND 已完成的 retry 次数 < effective maxRetries
```

`maxRetries=0` 禁止自动重试；`maxRetries=1` 最多产生 `2` 个 execution attempts；`maxRetries=2` 最多产生 `3` 个 execution attempts。配置只限定上限，不得强制绕过幂等、瞬态、可见 delta、结果未知或取消门禁。

`timeoutMs` 是 execution attempt budget。全部 attempts 都接收同一个原始 request，因此获得完整且相同的 `timeoutMs`。同一个父 `AbortSignal` 贯穿全部 attempts：父请求、Workflow 节点或调用方取消时，当前 attempt 立即停止，尚未开始的后续 attempt 不得启动。一次逻辑调用最多消耗 `maxRetries + 1` 个 attempt budget；每次 attempt settle 且全部门禁成立后立即开始下一 attempt。

统一边界在每次 retry 前检查父 signal；已经取消时返回统一取消结果且不启动下一 attempt。父 signal 在 retry attempt 期间取消时，当前 attempt 立即停止并返回统一取消结果，不产生后续 attempt。Workflow 显式 `node.timeout` 会创建 node-scoped signal，并把同一时长写入 Capability request；任一 attempt 结束时该 signal 已取消的节点不会启动下一 attempt。

每次 attempt 获得一个由 `GovernedCapabilityInvocationPort` 包装的 attempt-local `runtimeContext.emitResultDelta`。wrapper 在调用下游 emitter 之前即标记该 attempt 已尝试产生调用方可见结果；无论 delta 校验、下游 emitter 或 attempt 最终结果随后成功还是失败，该 attempt 都不得自动重放。producer 必须 await emitter，executor promise settle 后该 attempt 的 delta channel 立即封闭，晚到 delta 不得投影。所有调用方可见的 Capability 中间结果必须经过这个唯一 callback，不能通过旁路 stream、timeline 或 session 写入。

Attempt delta channel 只持有可释放的 downstream delegate。`close()` 必须同时标记 closed 并清空 delegate，从而释放 request-owned downstream closure；late emit 继续被拒绝。本 change 不为此新增 `AbortSignal` listener 或 timer。

retry 复用原 request、arguments、invocationId、toolCallId 和 idempotencyKey。中间失败只允许产生低基数 attempt count 观测，不进入模型、Workflow、stream、timeline 或 `CAPABILITY_RESULT`。调用方只收到最后结果。tests 必须证明缺省与 `maxRetries=1` 的总 invocation count 上限为 `2`、`maxRetries=0` 的上限为 `1`、`maxRetries=2` 的上限为 `3`，且全部 attempts 收到相同原始 `timeoutMs`；父 signal 在调用前、descriptor 解析期间或 retry 之间取消时禁止下一 attempt；delta callback 被调用（包括下游 emitter 拒绝）后禁止下一 attempt。

`safeError.retryable` 的自动行为消费者只有 `GovernedCapabilityInvocationPort`。Agent、Workflow 和 Web 可以读取该字段用于解释，但不得据此自动调用 Capability。

#### 3.4.5 参数诊断

普通 governed 路径在 `agent-capability/src/invocation/schema-validation.ts` 提供唯一私有 schema validator。它使用 `WeakMap<JsonObject, ValidateFunction>` 按 schema identity 缓存编译后的 validator；每个首次出现的 schema 由独立 Ajv instance 编译，Ajv 仅被对应 validator 闭包持有，因此动态 schema 不会被 module-level singleton 强持有。schema 编译异常交给调用边界映射为对应阶段 internal。validator 支持两条路径：需要完整 errors 的 `collectInputViolations` 使用 `allErrors: true` 收集当前阶段全部错误；只判 `ok` 的 output validation 和 tool catalog 快速校验使用 `allErrors: false` 在首个错误后短路返回。input formatter 消费完整 errors；output normalization 只消费 `ok`/`false` 和安全的低基数日志摘要。

`validation-violations.ts` 不拥有 Ajv，只负责把 validator errors 格式化。公共 schema validator 收集当前 schema 阶段全部错误。Tool 本地语义 validator 在 schema 通过后，收集全部不执行副作用、不访问新外部状态且前置条件成立的独立违规。统一 formatter 位于 `agent-capability`，输出：

```json
{
  "violations": [
    {
      "path": "",
      "constraint": "additionalProperties",
      "expected": "only query, limit, and filters are allowed"
    },
    {
      "path": "/limit",
      "constraint": "maximum",
      "expected": "an integer from 1 to 100"
    }
  ]
}
```

formatter 对单字段违规生成精确 JSON Pointer；schema-owned `credentialRef`、`tokenCount` 等字段名是可信契约信息，不按关键词改写。`required` 指向缺失的 schema 声明字段，数组元素保留索引。只有输入中显式 `const/enum` discriminator 唯一匹配组合分支时才删除其他分支错误；没有唯一匹配时不评分、不猜测、不返回 branch-local `required/type`，而是在父对象返回 `anyOf/oneOf` 聚合 violation。对象整体或跨字段违规只在不能唯一归属单字段时指向最近共同父对象，并由 `expected` 使用 schema-owned 字段名说明关系。additional-property 违规同样指向最近合法父对象，根对象使用空 JSON Pointer，使用固定 `constraint=additionalProperties`，并在 `expected` 中按稳定排序列出已确定分支允许字段，歧义时使用全部候选分支字段并集；例如嵌套过滤对象使用父路径 `/filters/0`，并列出 `field`、`operator` 和 `value`。formatter 只按 `path + constraint` 去重并稳定排序，不包含 actual value、additional property 原名、regex 原文、文件内容、命令、prompt、provider payload 或宿主路径。schema 阶段失败后不进入语义阶段。

`tool-catalog.ts`、`clip-tool-source.ts` 和 `executor.ts` 都调用该 validator；这些路径不得自行 `new Ajv` 或 `compile`。architecture negative test 固定该 owner。CLIP 不保留按序列化 schema key 的强 `Map` validator cache。

formatter 先形成完整 violations，再构造并规范化失败结果。`agent-capability` 使用单一私有 `guardCapabilityResultCapacity(result, {phase, replayPolicy?})` 对 `JSON.stringify(normalizedResult).length` 测量 UTF-16 code unit；上限沿用当前 `256_000`，不导出新公共常量或配置。容量 guard 同时执行节点计数（`10000`，节点包含对象、数组、对象属性值、数组元素和标量值）和深度预算（`64`），且必须在遍历过程中每次增加节点计数或字节长度后立即检查预算并中止，不得在遍历完成后才检查。它只在 input invalid 完整结果的 `PRE_DISPATCH` 和每个 normalized execution result 的 `POST_DISPATCH` 使用。pre-dispatch message 要求缩小、清理或拆分输入并明确执行未开始；post-dispatch 幂等结果允许缩小请求或结果规模后重新调用；post-dispatch 非幂等结果必须说明调用可能已经产生效果，禁止原样重放，并仅在 Capability 提供独立 read/list/search/query 时建议核验，否则停止并报告结果无法安全交付。完整结果不超过容量时全部返回并由下游按既有 inline/externalize policy 处理；超过容量时整体替换为 `CAPABILITY_RESULT_LIMIT_EXCEEDED + VALIDATION + retryable=false`，不携带部分 violations。该规则以显式容量失败保持“无静默截断”，不承诺不可容纳的诊断仍能作为单个结果返回。

#### 3.4.6 完整失败平面

每个 Tool 的验收覆盖以下平面；不存在的平面不合成错误：

| 平面 | owner 与目标 |
|---|---|
| E1 descriptor / availability | 统一边界处理 not-found、不可见、descriptor/provider 漂移和 resolver 异常 |
| E2 common schema | 统一边界返回全部 schema violations，dispatch count 为 0 |
| E3 Tool semantic validation | Tool producer 返回全部独立本地 violations，不访问外部状态 |
| E4 dependency / context / authority | Tool producer区分 dependency unavailable、缺失可信 context、真实 authorization/policy |
| E5 downstream / domain | Tool producer保真安全业务 error；未知异常不伪装业务错误 |
| E6 cancel / timeout / result unknown | cancel 优先；timeout 遵守 retry 门禁；result unknown 必须来自执行事实 owner |
| E7 result / output / unknown | 统一边界在返回 producer result 前校验 envelope、delta、output 和 extensions，并安全映射未知异常 |

#### 3.4.7 20 个 first-party Tool 的目标闭包

前 19 个 Tool 模型可见；`ApiCall` 仅供非 Agentic Skill 编排调用。所有行同时适用 E1、E2 和 E7。

| Tool / replay policy | Tool-owned 可恢复、正常或降级事实 | Tool-owned 终止、结果未知或取消事实 |
|---|---|---|
| Read / `IDEMPOTENT` | schema violations 完整返回；授权范围内文件 missing 保留 `FILE_UNAVAILABLE + NOT_FOUND + false`，message 要求先用 Glob 定位；无内容的单次容量失败要求降低 `limit` 并从当前 `offset` 读取；正常 bounded/truncated page 保持 `SUCCEEDED` 并给出 `nextOffset`；明确瞬态 unavailable 可按统一门禁 retry | root、link、regular-file policy 为真实 `AUTHORIZATION`；未知读取失败为 `CAPABILITY_EXECUTION_FAILED + INTERNAL + false`；取消优先；output invalid 走公共 `CAPABILITY_OUTPUT_INVALID` |
| Write / `NON_IDEMPOTENT` | `file_path/content/size/extension` violations 完整返回；`WRITE_REQUIRES_FULL_READ` 要求完整 Read，`WRITE_TARGET_CHANGED` 要求重新完整 Read并构造新 Write；两者保持 `CONFLICT + false` | path/write authority 为 `AUTHORIZATION`；原子替换失败发生在 commit 前，返回 `WRITE_ATOMIC_REPLACE_FAILED + INTERNAL + false` 并明确未提交；取消优先 |
| Edit / `NON_IDEMPOTENT` | target missing 为 `NOT_FOUND` 并要求重新定位或使用 Write；full-read/snapshot changed 为 `CONFLICT` 并要求完整 Read；old string 缺失或不唯一为 `VALIDATION`，要求重新 Read 后更新 `old_string` 或增加上下文/使用 `replace_all` | path/write authority 为 `AUTHORIZATION`；原子替换失败发生在 commit 前，返回 `EDIT_ATOMIC_REPLACE_FAILED + INTERNAL + false` 并明确未提交；取消优先 |
| Glob / `IDEMPOTENT` | pattern/path/brace/class violations 完整返回；授权范围内 path missing/not-directory 为 `NOT_FOUND`，要求省略 path 或选择已有目录；零匹配成功；结果/深度/扫描预算停止保持 `SUCCEEDED + truncated=true` | root/link policy 为 `AUTHORIZATION`；必需 descendant 遍历或 unknown failure 为 internal，不返回已发现 filenames 或空 degraded；取消优先 |
| Grep / `IDEMPOTENT` | regex/path/glob_filter/output_mode/case/limit violations 完整返回；零匹配成功；结果/文件读取/深度/扫描预算停止保持 `SUCCEEDED + truncated=true` | path authority 为 `AUTHORIZATION`；必需 descendant 遍历、decode 或 unknown failure 为 internal，不返回已发现 matches 或空 degraded；取消优先 |
| Bash / `NON_IDEMPOTENT` | tokenization、控制字符和 unclosed quote 为 `COMMAND_NOT_ALLOWED + VALIDATION + false`，unclosed quote 保留 `BASH_COMMAND_UNCLOSED_QUOTE` reason code，message 要求修正全部 violations；正常完成的 zero/non-zero 均保持 `SUCCEEDED` 和完整声明进程 payload，不受 stdout/stderr 是否为空或安全截断影响；已确认停止的 timeout 仅在有安全 stdout/stderr 时保留部分 payload | 缺少 sandbox composition 或 invalid sandbox result 为 internal；真实 sandbox policy/auth 保真；timeout 没有安全输出时使用空 payload；取消优先 |
| Python / `NON_IDEMPOTENT` | code/args/timeout 和可修改 guard violations 完整返回，raw guard provider message 不进入 error；已确认停止的 timeout 仅在有安全 stdout/stderr 时保留部分 payload；non-zero 保持既有结构化结果 | 缺少 sandbox/context 或 invalid sandbox result 为 internal；真实 guard policy 保真；timeout 没有安全输出时使用空 payload；取消优先 |
| AskUserQuestion / `NON_IDEMPOTENT` | questions/options/modifier/text violations 完整返回；descriptor 或 pending boundary unavailable 时允许普通答复、其他 Capability、再次显式调用或结束；不设置独立重复失败阈值 | 禁止用途保持既有安全 validation outcome；producer/pending contract invalid 为 internal 且不含禁止原文或 pending state；取消进入 runtime cancel；合法输入保持 pending 生命周期 |
| Agent / `NON_IDEMPOTENT` | agentId/prompt/额外字段/self-invocation violations 完整返回；目标不存在、隐藏或不可用统一使用防枚举的 `AGENT_NOT_AVAILABLE + UNAVAILABLE + false`，message 要求选择已披露 Agent 或直接处理任务；与 child status 相容的 SafeError 全字段保真；child `FAILED + TIMEOUT` 映射为 outer `TIMED_OUT` 并保留原 SafeError | child auth/policy/internal/result unknown 上升且不投影 child session/run id；不相容或 invalid child result 为 internal 安全错误；取消优先 |
| Skill / `NON_IDEMPOTENT` | name/args violations 完整返回；path-like name 要求传 Skill capability id；未发现、隐藏或 source unavailable 统一使用防枚举的 `SKILL_NOT_AVAILABLE + UNAVAILABLE + false`，并要求选择已披露 Skill 或其他 Tool；source timeout 为 `TIMED_OUT + TIMEOUT + retryable=false`，允许其他 Skill/Tool 或结束 | source identity/hash/scope mismatch 为 auth；body/frontmatter/leakage/source contract failure 为 internal；output invalid 走公共 code；取消优先 |
| Rag / `IDEMPOTENT` | query/index/topK violations 完整返回；index missing 为 `NOT_FOUND` 并要求可用 index，not-ready 为 `CONFLICT` 并要求换 index 或稍后查询状态；零命中和声明范围内完整/有界结果成功；只有已有安全 chunks 且 provider 明确确认其余已声明检索范围未完成时才 degraded，并说明缺失范围 | scope mismatch 为 auth；invalid provider result、decode/build/cleanup/unknown 为 output/internal 安全错误；无 chunks 的 dependency/failure 不 degraded；取消优先 |
| ToolSearch / `IDEMPOTENT` | query/limit violations 完整返回；catalog unavailable/rejection 为明确 unavailable，message 允许使用当前已披露 Capability 或稍后搜索；零命中和受声明 limit 截断的结果成功；当前 producer 不增加推测性 degraded 出口 | catalog/activation/output unknown 安全失败；无可用结果的 activation failure 不静默成功；取消优先 |
| TodoWrite / `IDEMPOTENT` | schema violations 完整返回；state conflict 要求提交包含既有未完成项的完整 replacement list；明确 state dependency unavailable 时说明可继续任务但进度状态未更新；空列表成功 | trusted context/output/unknown 为 internal；真实 auth/policy 保真；取消优先 |
| Workflow / `NON_IDEMPOTENT` | recipeName/inputText/inputVariables violations 完整返回；recipe missing 为 `RECIPE_NOT_FOUND + NOT_FOUND + false` 并要求选择已注册 recipe 或不用 Workflow；canonical pending parser 接受且 questions 非空的 `pendingInput` 或非空 answer previews 使 `WAITING` 成为 `SUCCEEDED` 控制结果，不携带 safeError；pending 无效但 previews 可用时省略 pending summary；execution boundary unavailable 允许其他 Capability 或结束；nested SafeError 保真 | `WAITING` 没有有效 pending questions 和 answer previews 时返回空 payload 的 `CAPABILITY_EXECUTION_FAILED + INTERNAL + false`；缺少必需 boundary 为 internal；nested auth/policy/internal/result unknown 上升；invalid nested result 为 output/internal 安全错误；取消优先 |
| Cron / `NON_IDEMPOTENT` | action/prompt/cron/delay/recurring violations 完整返回且不回显 cron；task missing 为 `CRON_TASK_NOT_FOUND + NOT_FOUND + false` 并要求 `Cron list`；scope limit 为 `CONFLICT` 并要求 list/delete 旧任务或放弃创建；list 空结果成功 | gateway auth/policy/internal 保真；当前 producer 未声明结果未知；取消优先 |
| `search_memory` / `IDEMPOTENT` | query/category/purpose/confidence/limit/offset violations 完整返回；disabled 允许不依赖长期记忆继续；零条目成功；storage unavailable/timeout 仅在安全声明可重试时按统一门禁 retry | trusted context/output/unknown 为 internal；auth/policy 保真；不使用 memory 专用失败 payload 或容量上限；取消优先 |
| `get_memory_detail` / `IDEMPOTENT` | id list/count violations 完整返回；单项 not-found 保持正常 item 结果，item message 要求重新 `search_memory` 获取当前 id；部分 item missing 不覆盖成功 entry | global auth/internal/unknown 不改写成 item not-found；trusted context/output/unknown 为 internal；取消优先 |
| `add_memory` / `NON_IDEMPOTENT` | category/content/tags/confidence/briefIndex 和 category-specific content violations 完整返回；duplicate/version conflict 要求先 search 当前 memory 或调整内容 | content guard policy 保真；trusted context/output/unknown 为 internal；当前 producer 未声明结果未知；取消优先 |
| `acquire_skill` / `IDEMPOTENT` | invalid request/非 SkillHub candidate 为 `VALIDATION`；not-found 要求修改 query/provider 或使用已有 Tool/Skill；resolver unavailable 明确可用动作且只由统一边界按门禁 retry；没有 acquired Skill 的结果必须是 failure | unauthorized/hidden candidate 为 auth；install/source/output contract failure 为 internal；取消必须为 `CANCELED`；只有实际 acquired 才成功，不存在空 degraded |
| `ApiCall` / `NON_IDEMPOTENT`、隐藏 | API 文档 missing/invalid、参数提取失败、required parameter missing、dependency unavailable、HTTP 4xx/5xx 和已确认 timeout 按实际阶段形成安全 code/category/message；timeout 为 `TIMED_OUT + TIMEOUT + retryable=false`；可修改参数错误指出缺失字段或约束，服务失败指出改用其他路径或结束；合法 response 为正常结果 | API auth/policy 保真；父取消、local timeout、stream 中断、invalid response/output 和 unknown exception 分别安全映射；当前 producer 未声明结果未知；任何最终失败都不启动普通模型 loop 或自动重放 |

验收代码只维护生产注册闭包事实：20 个 first-party Tool、19 个模型可见 Tool、隐藏 `ApiCall` 及其 replay policy。E1、E2、E7 由统一执行边界黑盒测试与 direct-call architecture negative test 证明；Tool-owned E3–E6 只用真实可发生的业务黑盒场景验证，不为不可发生的出口生成合成 ledger。

#### 3.4.8 失败结果、容量和消费者

成功、降级和失败先在统一执行边界规范化，再以 `256_000` 个 UTF-16 code unit 的同一完整结果上限进入调用方。低于 inline 阈值时内联；超过 inline 阈值但未超过公共单结果容量时，现有 externalizer 写入受治理内容并向模型提供 `PERSISTED_PREVIEW`、`contentRef` 与 Read 指引；超过公共容量、节点或深度预算时返回显式容量错误。校验诊断容量错误在 executor dispatch 前产生，不携带部分 violations；post-dispatch 的只读结果容量错误要求缩小请求，非幂等调用的结果容量错误禁止原样重放，并指向 owning Capability 已声明的独立查询；没有查询路径时要求停止并报告无法安全交付。agent-core 删除现有 failure-specific 和 envelope pre-limit，由 runtime message externalizer 处理容量内的大结果；Workflow/direct consumer 只会收到容量内的规范化结果或显式容量错误。失败不使用独立条数、字符或字节上限。

| 字段 | 消费者 | 目标行为 |
|---|---|---|
| `safeError` | agent-capability、agent-core、agent-workflow、agent-memory、plugin SDK、fixtures/tests | 复用现有唯一 runtime 失败对象 |
| `safeError.retryable` | `GovernedCapabilityInvocationPort`；其他层只读 | 仅执行边界将其作为自动 retry 门禁之一 |
| `safeError.message` | 既有模型 `CAPABILITY_RESULT` 安全投影、Agent terminal message、Workflow exception 安全投影、Web 安全详情 | 传达领域事实和下一步；Web 固定修复动作仍由 code-owned 本地化决定 |
| `safeError.safeDetails` | 模型和受治理失败详情投影 | 参数 violations 完整可读；不进入 Recipe 未声明字段、metric、trace 或 audit |
| `structuredPayload` | Capability 业务消费者 | 只承载业务结果；不新增 `errorDiagnostics` |

行为接入覆盖 agent-capability 三类 executor 与全部 producer、agent-memory、plugin SDK、agent-core ordinary/terminal-hook loop、AskUserQuestion、定向 Skill、隐藏 ApiCall、agent-workflow 全部调用点、app composition、test kit、fixtures 和 contract/architecture tests。agent-context-engine、agent-session、channel 和 frontend 不做错误字段迁移，只验证既有安全投影仍能显示统一最终 message。

#### 3.4.9 质量属性影响

- 性能/容量：依据 `capability-catalog / Capability 结果复用统一容量和转储机制`，所有结果状态在进入任一调用方前使用同一 `256_000` UTF-16 code unit 上限、`10000` 节点计数预算和 `64` 深度预算；容量内的大结果复用既有 externalizer，容量外或预算超限时显式失败，不增加第二套存储或配置。
- 安全：依据 `capability-catalog / Capability 失败证据不跨安全边界`，公共结果和投影禁止 raw exception、stack、cause、credential、token、prompt、provider response、宿主路径和非法 output。仅既有本地 runtime diagnostic 可以记录按规则脱敏的 `rawExceptionData`。
- 可靠性/恢复：每次 attempt 获得完整 `timeoutMs`、父 `AbortSignal` 保持上层生命周期上限和调用身份不变，是功能性 retry Requirement 的实现约束；本 Function 不新增第二个可靠性黑盒目标。

## 4. `FN-3.4 工具循环失败保护`

### 4.1 目标与规范依据

canonical spec 为 `tool-loop`。本 Function 的目标 Requirements：

- `MODIFIED Tool loop preserves failure, timeout, and cancellation truth after streamed deltas`
- `ADDED Agent loop 对最终 Capability 失败执行唯一处置`
- `ADDED maxTurns 达到上限后只执行一次无工具模型收尾`
- `ADDED maxToolCallsPerTurn 只接纳有界 Tool call 前缀`
- `ADDED 空 Tool 名称只产生可修正反馈`
- `ADDED 失败结果复用正常 CAPABILITY_RESULT 路径`

### 4.2 当前实现

- ordinary tool loop、terminal-hook tool-call path 和隐藏 `ApiCall` 已分别调用 `CapabilityInvocationPort`，并使用统一失败 payload 投影。
- runtime `CapabilityInvocationResult.safeError` 使用 `message`；既有 `buildFailedCapabilityPayload(...)` 只在模型可见 `CAPABILITY_RESULT` 投影中把它映射为 `safeError.errorMessage`。
- 当前工作区已经从 ordinary tool loop、AskUserQuestion preflight 和 default-agent recovery 删除 failure fingerprint、`CAPABILITY_REPEATED_FAILURE` 与第二次相同失败终止；非取消最终失败会继续进入模型上下文。该已完成行为仍需在后续 loop-control 替换中保持。
- `throwIfPreparationControl` 已使用私有 `RiskPolicyAuthorizationControlError` 表达明确的 `REQUIRE_AUTHORIZATION` 控制，不依赖 `safeDetails.pendingInputKind`；普通 `AUTHORIZATION` safe error 已可进入一般失败路径，但缺少直接证明“授权提示不是控制指令”的回归。
- agent-runtime 已独占 terminal commit，并在真实 terminal error 存在时优先显示安全错误；当前达到 `maxToolIterations` 仍会构造 terminal error 并直接失败。
- 当前数量控制同时存在 assembly `maxToolIterations`、request `maxToolCalls`、side-effecting/read-only per-round limits 与 `toolCallLimitRecoveryLimit`，语义和 owner 重叠。
- `executeModelTurn` 在 request `maxToolCalls=0` 时通过把 `tools` 清空来阻止模型 Tool call；这改变了模型请求的 Tool schema，而不是使用模型调用契约表达“本轮禁止选择 Tool”。

### 4.3 GAP 分析

- 重复错误只能说明模型再次选择了同一动作，不能证明没有替代 Capability、普通答复、状态核验或显式结束路径；按 fingerprint 终止会替模型做业务决策。
- `retryable=false` 容易被误读为“模型不能再次调用”，但它只应禁止执行器自动原样重放；模型显式动作仍是新的 governed decision。
- failure fingerprint 已删除；后续实施不得用新的错误计数、恢复次数或等价状态重新建立与 `maxTurns` 平行的局部 termination owner。
- 授权必须由明确控制事实识别。若未来重新按 category、code 或 `safeDetails.pendingInputKind` 判断，普通 `AUTHORIZATION` 失败会被误转为 pending control。
- safety-net 合成失败必须继续给出完整安全 message；删除重复保护后不能让 invocation boundary exception 重新成为直接 throw 出口。
- 隐藏 `ApiCall` 没有模型恢复 owner，必须与普通 loop 明确分离而不能启动 tool loop。
- `maxTurns` 只应在普通 turn 耗尽后终止 Tool 执行权，不应丢失模型根据已完成 Tool 结果整理最终答复的机会；直接 `REQUEST_FAILED` 会把可用事实变成不可用终态。
- 每轮 Tool call 超限是单轮容量问题，不是模型重试或请求终止问题；“整轮零执行 + 最多三次纠正”既浪费已可安全接纳的前缀，也建立了与 `maxTurns` 冲突的局部收敛状态。
- 若模型返回的超限 Tool calls 被部分丢弃，却仍把原始 assistant tool-use message 整体写入 transcript，会产生没有配对 result 的孤立 calls；若整条 message 都不保存，又会丢失实际执行前缀。因此必须在持久化前先做有界前缀接纳。
- 清空 `tools` 同时改变 capability disclosure 和 provider request prefix；系统需要 canonical `toolChoice` 表达选择约束，同时保留同一 Tool descriptor 集合。保留 tools 只减少请求形态变化，不承诺 provider prompt cache 一定命中。

### 4.4 修改方案

Agent Core 只消费执行边界返回的最终结果，不实现 Capability 同参自动重试。

| 最终错误 | Agent Core 处置 |
|---|---|
| `CANCELED` | 不进入模型，通知 Runtime 提交取消终态 |
| `CAPABILITY_OUTPUT_INVALID` | 投影完整安全结果；message 说明原样调用不能解决问题，允许模型缩小/调整请求、改用其他 Capability、普通答复或结束 |
| 其他 `VALIDATION`、`NOT_FOUND`、`CONFLICT` | 投影完整安全结果，允许模型修正输入、再次显式调用或选择替代动作 |
| 最终 `UNAVAILABLE`、`TIMEOUT` | 统一执行边界完成允许的自动重试后投影最终结果，允许模型改用其他 Capability、稍后尝试、普通答复或结束 |
| 普通 `AUTHORIZATION`、`POLICY_DENIED`、`CAPABILITY_RESULT_UNKNOWN`、其他 `INTERNAL`、未知分类 | 投影完整安全结果，允许模型决定下一步；结果未知要求独立核验 |

所有非取消的最终失败反馈给模型时，`safeError.message` 必须包含领域事实和可操作的下一步建议，不能只表达失败本身。模型选择的每个后续调用仍重新经过既有 authority、risk policy 和 sandbox 边界；失败反馈不授予权限，也不能绕过这些边界。risk policy `DENY` 等最终调用前拒绝按同一原则形成失败证据并反馈模型。

risk policy 明确返回 `decision.outcome=REQUIRE_AUTHORIZATION` 时，它不是最终 Capability 失败，而是 runtime-owned 授权控制结果，继续进入既有 `AUTHORIZATION` pending-input 生命周期。Lifecycle hook 明确返回的 `PEND`、`DENY` 和 `BLOCK` 同样是 request lifecycle 控制结果，保持既有 pending、deny 或 block 处置，不转换成模型可恢复的 Capability 失败。取消仍优先传播。

agent-core 使用私有 error subtype 标记 risk policy `REQUIRE_AUTHORIZATION` 控制流，不通过 `SafeError.category`、code、message 或 `safeDetails.pendingInputKind` 推断控制流身份；`safeDetails` 只承载安全诊断或 pending-input 所需的数据，不授予控制权。普通 `AUTHORIZATION` SafeError 即使携带 `pendingInputKind=AUTHORIZATION` 也进入模型。取消覆盖 preparation 或 invocation failure 时，原始捕获错误只作为 `AgentError.cause` 保留到受控本地 `rawExceptionData`，不得进入公共结果或 timeline。

普通并行 Tool batch 保持执行前整批拒绝语义：任一调用在 executor dispatch 前被拒绝时，整批都不调用 executor；失败调用获得其实际安全失败结果，其余调用获得 `CAPABILITY_BATCH_REJECTED`，且 sibling result 保持实际 pre-dispatch failure 的 category，然后由模型看到完整配对 transcript。

受治理 `CapabilityInvocationPort` 按契约只返回安全最终结果；agent-core 仍保留窄化 safety net。若该边界同步 throw、异步 rejection，或者返回值在 agent-core 最终 envelope、generated message、reference、metadata 或 model patch authority 检查中失败，取消继续优先传播；其他异常记录允许进入受控本地诊断的事实后，丢弃非法原结果或未授权扩展，规范化为包含失败阶段、领域事实和可操作下一步的安全最终失败，并进入普通失败结果、timeline 和模型反馈，不建立第二套终止出口。结果扩展应用前先完成 authority 检查，失败时不得把 generated message、context patch 或非 Agentic direct-path signal 部分写入 request-local state。

模型恢复不读取 `retryable` 决定同参重试。`retryable=false` 只禁止统一执行边界自动原样重放当前逻辑调用，不阻止模型在下一轮显式选择同一 capability。ordinary tool loop、AskUserQuestion 和 default-agent recovery 删除 failure fingerprint、request-local Set、serializer budget、重复 notice 和局部错误次数状态。

循环安全只使用 canonical `maxTurns`：每个 accepted `RequestRun` 按 logical Agent turn 计数，pending-input pause、同进程 resume 和 crash recovery 继续同一计数。达到 `maxTurns` 后立即撤销当前 request 的后续 Tool 执行权，保留 `TOOL_ROUND_LIMIT_EXCEEDED` degradation fact，但不直接构造 terminal error；Agent 最多再开始一个 finalizing turn。该额外 turn 不是普通 turn，不增加 `maxTurns`，也不能执行模型或 terminal hook 返回的任何 Tool call。`maxTurns` 与错误内容和 Tool 使用无关，能同时约束相同错误、不同错误、纯模型轮次、动态参数和不断切换 Capability 的循环，因此是唯一一致的 loop-count bound。

每轮 Tool 数量只使用 canonical `maxToolCallsPerTurn`。模型返回超过 effective 上限的 Tool calls 时，Agent Core 在写 assistant message 前按模型顺序接纳前缀，canonical message 只包含接纳 calls；既有整批 preflight、治理、执行、event 和 result pairing 只作用于该前缀。超限尾部不保存、不执行、不生成 synthetic result。前缀闭合后发出一次 `TOOL_CALL_LIMIT_EXCEEDED` notice，并通过 request-local `USER` generated message 告知 requested/admitted/omitted counts，要求模型拆分剩余工作。系统继续普通 loop，不维护纠正次数或 `MAX_TOOL_CALLS` finalizing reason。

普通 loop、terminal-hook tool-call path 和 Workflow event projection 复用既有 agent-core 私有 failure payload builder。agent-runtime 继续独占 durable terminal commit。成功收尾产生普通 terminal assistant content，并保留此前 degradation notice；收尾模型调用失败、取消或没有可用安全文本时才形成真实 terminal error/cancel。runtime 的唯一 FAILED 内容规则保持为：存在真实 `terminalError` 时使用 `safeErrorContent(terminalError)` 作为最终 terminal assistant content，`output.finalContent` 只在没有 terminal error 时使用。不新增 Error class 或 terminal state。

隐藏 `ApiCall` 非 Agentic 直接路径没有模型选择环节：成功保持现有直达结果；取消提交取消；其他最终失败投影一次安全证据后终止。结果未知 message 指向独立状态查询。

runtime 继续读取 `CapabilityInvocationResult.safeError.message`；既有 payload builder 只在模型可见投影中将该值映射为 `safeError.errorMessage`，不得在 runtime `SafeError` 上新增 `errorMessage`。模型看到的输出无效结果为：

```json
{
  "status": "FAILED",
  "result": {},
  "safeError": {
    "code": "CAPABILITY_OUTPUT_INVALID",
    "category": "VALIDATION",
    "errorMessage": "Capability output did not satisfy its declared contract. Do not repeat the same call unchanged. Reduce or revise the request, or choose another capability.",
    "retryable": false
  }
}
```

该结果不包含非法 output。每次最终失败都允许模型改变编排；若模型显式再次选择完全相同的调用，系统仍重新治理、执行并反馈结果，直到模型结束，或达到 `maxTurns` 并进入一次最终收尾。

### 4.5 单次模型收尾与 `toolChoice`

#### 4.5.1 最小 Agent loop 形态

不为总结复制第二条 model invocation、context render、hook 或 terminal commit 路径。控制器把既有循环从“只有普通轮次”改为“最多 `maxTurns` 个普通 logical turns 加最多一个 finalizing turn”。canonical `AgentRuntimeSettings.maxTurns` 缺失时取 `50`；它统计每次新的普通 logical turn，无论该 turn 是否产生 Tool call。同一 logical turn 内的 model provider retry 或 recovery replay 不增加 Agent turn index。

```ts
// 修改前
for (let turn = 0; turn < maxToolIterations; turn += 1) {
  const modelResult = await executeModelTurn({ maxCalls });
  // 普通 Tool 执行与 terminal 处理
}
throw loopBudgetError("TOOL_ROUND_LIMIT_EXCEEDED");
```

```ts
// 修改后
let turn = context.agentTurnIndex;

while (turn <= maxTurns) {
  const isFinalizing = turn === maxTurns;
  context = { ...context, agentTurnIndex: turn };
  await runState.saveCheckpoint(run, context, "STEP_STARTED");

  if (isFinalizing) {
    requestLocalState.generatedMessages.push(maxTurnsFinalizingMessage);
    requestLocalState.contextPatch = {
      ...requestLocalState.contextPatch,
      modelOptions: {
        ...requestLocalState.contextPatch?.modelOptions,
        toolChoice: "NONE"
      }
    };
  }

  const modelResult = await executeModelTurn();

  if (isFinalizing) {
    return settleFinalizingResult(modelResult); // 不执行任何 Tool call
  }

  const outcome = await processNormalTurn(modelResult);
  if (outcome.kind === "TERMINAL") {
    return outcome.result;
  }

  turn += 1;
}
```

是否处于 finalizing 仍由 Agent Core controller 根据 `turn === maxTurns` 推导；`executeModelTurn` 不增加“是否总结”的业务参数，只消费 request-local state 渲染出的同一种模型输入。现有 `AgentRunStatePort.saveCheckpoint(run, context, ...)` 已从 `RequestContext` 生成 checkpoint，恢复路径也已由 checkpoint 重建 `RequestContext`；因此新接受 run 以 `RequestContext.agentTurnIndex=0` 开始，Agent Core 只在开始 logical turn 前更新 context copy，Runtime 原样持久化并在 recovery 时恢复同一 index。`index=maxTurns` 继续表示唯一 finalizing turn。`RequestContext` 与 checkpoint 只增加同一个整数坐标，不新增 phase、loop state machine、store、额外 port 或 public finalizing command。

上述伪代码只表达 logical turn controller，不替代既有 lifecycle-stage recovery。`nextLifecycleStage=BEFORE_CAPABILITY_INVOKE` 时，Runtime/Agent Core 先从 canonical messages 和 replay guard 继续当前 turn；已经完成的 model invocation 不重做。只有当前 turn 的 Tool/result/control 处理闭合后才递增 index。

Tool call over-limit 不再触发 finalization。`maxToolCallsPerTurn` 只对每个普通 turn 做前缀接纳，超限尾部不进入 canonical transcript、不执行，并向下一普通 turn 反馈拆分提示。`executionMode=model-only` 从首次模型调用起使用 `toolChoice=NONE`；如果 provider 仍返回 Tool call，controller guard 不执行。唯一 finalizing 入口是普通 turns 已达到 `maxTurns`；任何路径都不得产生第二个 finalizing turn。

#### 4.5.2 Runtime-owned request-local feedback

finalizing feedback 复用既有 request-local state 已有的 generated-message 和 context-patch 字段：

```ts
{
  generatedMessages: [{
    role: "USER",
    content: "The maximum number of normal turns has been reached. Summarize verified results, state incomplete work, and do not request or claim additional tool actions."
  }],
  contextPatch: {
    modelOptions: { toolChoice: "NONE" }
  }
}
```

这不是伪造的 `CapabilityInvocationResult`：达到 `maxTurns` 时没有新的 Capability 调用。Agent Core 作为 loop owner 生成 runtime-owned feedback，直接在既有 request-local state 上追加一条 generated message，并保留已有 patch 字段后仅把 `modelOptions.toolChoice` 覆盖为 `NONE`；Context Engine 继续按现有 render 路径消费该 state。这里不得调用只用于 Capability/Skill 授权治理的 `mergeGovernedCapabilityContextPatch`，也不得新增平行 carrier、merge helper 或权限路径。它不得把 loop policy 归因给最后一个 Tool，也不得持久化为真实用户消息或 durable Agent/profile 配置。

总结指令必须要求模型只使用当前 transcript 中已验证的成功、降级和失败事实，明确区分已完成与未完成工作，不得声称未执行的 Tool action。该 USER feedback 仅在当前 request/run 后续一次模型输入中生效。原 `tools` descriptor 集合保持不变；request-local patch 产生 pre-hook `toolChoice=NONE`，Runtime/Agent Core 在 Hook merge 后继续把 finalizing effective value 约束为 `NONE`，再通过 selected provider 的正式字段禁止本轮选择 Tool，避免使用 `tools=[]` 建立第二种请求形态。Hook 仍可转换其他合法模型字段，但不能扩大 finalizing Tool 选择权；若 provider 违规返回 Tool call，Agent Core guard 仍禁止执行。该做法不承诺 prompt cache 命中率。

#### 4.5.3 `maxToolCallsPerTurn` 前缀接纳

canonical `AgentRuntimeSettings.maxToolCallsPerTurn` 缺失时取 `30`，合法值为 `1..100` 的安全整数。它按模型输出顺序计数全部 Tool calls，不再区分 read-only 与 side-effecting calls；已有 risk policy、sandbox 和 Capability governance 仍按每个 admitted call 的真实语义执行，但不再拥有数量预算。禁用 Tool 使用 `executionMode=model-only` 或 effective `toolChoice=NONE`，不复用 `maxToolCallsPerTurn=0`。

当前非流式 turn 的处理顺序为：

```ts
const requestedCalls = modelResult.toolCalls;
const admittedCalls = requestedCalls.slice(0, maxToolCallsPerTurn);
const omittedCount = requestedCalls.length - admittedCalls.length;

const shapeIssue = validateAdmittedToolCallShapes(admittedCalls);
if (shapeIssue.hasEmptyToolName) {
  requestLocalState.generatedMessages.push(buildToolCallCorrectionFeedback({
    shapeIssue,
    requested: requestedCalls.length,
    admitted: admittedCalls.length,
    omitted: omittedCount,
  }));
  return { kind: "CONTINUE" }; // 不保存 assistant tool-use，不执行 Tool
}

persistAssistantToolUse({
  ...modelResult,
  toolCalls: admittedCalls,
});

await preflightAndExecuteBatch(admittedCalls); // 既有整批 preflight 与配对规则

if (omittedCount > 0) {
  publishToolCallLimitNotice({
    requested: requestedCalls.length,
    admitted: admittedCalls.length,
    omitted: omittedCount,
  });
  requestLocalState.generatedMessages.push(buildToolCallOverflowFeedback({
    requested: requestedCalls.length,
    admitted: admittedCalls.length,
    omitted: omittedCount,
  }));
}
```

持久化 assistant tool-use message 时只写 admitted prefix，因此每个已保存 Tool call 都能由既有路径产生恰好一个 result；omitted suffix 没有被 canonical transcript 接纳，不保存、不执行、不生成 synthetic result。若 admitted batch 的 preflight 失败，既有“前缀整批零执行 + 每个 admitted call 配对失败”继续成立，omitted calls 仍不创建任何 transcript entry。

overflow feedback 是 runtime-owned request-local USER generated message，不是 Tool result。它说明请求、接纳和省略数量，明确省略 calls 未执行并要求模型拆分后续工作；它只影响下一模型输入，不写 session history。连续 over-limit turns 逐轮产生对应事实，但没有 `toolCallLimitRecoveryLimit`、连续计数或 `MAX_TOOL_CALLS` finalizing transition。若这是最后一个 normal turn，系统先闭合 admitted results 和 overflow feedback，再由 `turn === maxTurns` 的同一 loop 进入总结。

若 admitted prefix 进入 pending-input pause，Agent Core 只把已经构造的安全 overflow feedback 字符串暂存在现有 `RequestContext.flowVariables`，由既有 checkpoint 原样保存；resume 后在下一次模型 render 前消费并删除该私有 request-local 值。该恢复路径不持久化真实 USER message，也不新增 contract 字段、phase、port、store 或第二套恢复状态。

空 Tool 名称校验发生在前缀接纳之后、assistant tool-use 持久化之前。admitted prefix 中存在空名称时，整段前缀零执行且不保存 assistant tool-use；request-local correction 同时携带 affected `toolCallId` 和可能存在的 requested/admitted/omitted counts。重复空名称不维护独立计数，只消耗普通 `maxTurns`。

未来 Tool call 流式执行会把“完整 Tool call 到达”变成 admission point，但需要独立定义并发、取消、恢复、durable transcript sealing 和超限后的 stream consumption。本 change 只固定顺序前缀语义，不增加 OPEN/SEALED Tool turn 状态，也不实现流式 Tool execution。

#### 4.5.4 `ModelInferenceOptions.toolChoice`

`agent-contracts/model` 增加：

```ts
type ToolChoice = "AUTO" | "NONE" | "REQUIRED";

interface ModelInferenceOptions {
  // existing fields
  readonly toolChoice?: ToolChoice;
}
```

当前代码已有的 `modelParams` Workflow 透传不属于本 change。实现只在既有 schema、merge 和 provider 路径上外科式增加 `toolChoice`，必须保持 `modelParams` 的现有类型、透传和测试行为；其与 stable spec 的并行归档问题按 §2.1 处理，不在本 change 顺手重构或删除。

首版不支持 named-tool object。`ModelProfile` 缺失 `toolChoice` 时 resolved default 为 `AUTO`。Prompt Template、受治理 Capability context patch、trusted render/invocation request 和 `BEFORE_MODEL_INVOKE` hook 省略该字段时均表示不覆盖；普通 invocation 的 precedence 与其他 provider-neutral inference options 相同：profile、Prompt Template、Capability patch、trusted request、governed hook，后层逐字段覆盖前层。Runtime finalizing feedback 先作为 request-local patch 进入同一路径，并在 Hook merge 后施加 `NONE` hard constraint；model-only 使用同一规则。若 provider 违反请求返回 Tool call，Agent Core guard 仍禁止执行。`REQUIRED` 与空 `tools` 组合必须在 provider access 前失败。

OpenAI-compatible adapter 把三值映射为 provider-native lowercase `auto | none | required`；Model Gateway 通过其 provider-neutral request boundary获得同一语义。`providerOptions` 与既有 `modelParams` 必须把 camelCase `toolChoice`、snake_case `tool_choice` 和规范化比较键 `toolchoice` 视为 canonical authority collision，不能建立第二个值；`modelParams` 的其他既有透传行为不变。

#### 4.5.5 收尾结果

- 收尾结果包含非空安全 content 时，系统忽略其中全部 Tool call，不启动 Capability 或 terminal-hook Tool path，保留 `maxTurns` degradation notice，并用该 content 走既有 terminal success commit。
- 收尾结果只有 Tool call 或没有非空安全 content 时，系统使用达到 `maxTurns` 的既有 safe error 结束；不再次调用模型。
- 收尾模型边界返回 `safeError` 时保持该真实模型失败；父请求取消时保持取消。模型边界内部受控 retry 仍由其原契约决定，但 Agent loop 不增加第二次收尾 invocation。
- `BEFORE_AGENT_TERMINAL` 可以继续处理安全文本；其返回的 Tool call 在 finalizing 状态下不得执行。不得为了复用 normal loop 而放松 Tool 执行硬上限。

## 4A. `FN-3.2 编译智能体装配`

### 4A.1 目标与规范依据

canonical spec 为 `agent-package-assembly`。本 Function 的目标 Requirements：

- `ADDED Agent 运行设置只定义轮次上限和单轮工具调用上限`

### 4A.2 当前实现

`AgentRuntimeSettings` 当前只有 `maxToolIterations?: number`；DefaultAgent 还可从 dependency `maxToolRounds` fallback 到 50。Tool-call 数量则来自 request `RoutingConstraints.maxToolCalls` 和 agent-core 私有 side-effecting/read-only constants。

### 4A.3 GAP 分析

相同生命周期的限制分布在 assembly、request、Hook 和实现依赖多个 owner，无法仅从 accepted assembly 解释一次 run 的有效策略。

### 4A.4 修改方案

`agent-contracts/agent-assembly` 在 frozen contract 确认后把 `maxToolIterations` 替换为 `maxTurns`，新增 `maxToolCallsPerTurn`。Agent package source、closed runtime settings schema、compiler 和 builtin Agent default 同步使用这两个字段；显式非法类型/范围在 publication 前 fail closed，字段缺失时 effective defaults 分别为 50 和 30。

旧 `maxToolIterations`、`deps.maxToolRounds` 和其他平行字段直接删除；closed source schema 拒绝旧字段，不建立 alias、双写 precedence 或迁移窗口。测试 fixture 同步改用 canonical fields，不能成为生产第三个 authority。

## 4B. `FN-2.1 提交请求`

### 4B.1 目标与规范依据

canonical spec 为 `routing-constraint-validation`。本 Function 的目标 Requirements：

- `MODIFIED Routing constraints use an allow-list schema`
- `MODIFIED Constraint validation has two stages`
- `MODIFIED Budget and execution constraints are enforced before slow boundaries`

### 4B.2 当前实现

`RoutingConstraintsSchema.maxToolCalls` 当前接受 `0..5`，Web/runtime accepted facts 可以把该值传到 Agent Core；`0` 同时触发清空 tools，正值又只限制 side-effecting calls。

### 4B.3 GAP 分析

request 数量预算与 assembly-owned loop settings、read-only calls 和 `ToolChoice` 语义不一致。数量配置属于 Agent assembly policy，不应由不可信 request 改写。

### 4B.4 修改方案

在 frozen contract 确认后，从 `RoutingConstraints` type/schema、Web projection、runtime accepted facts consumer 和 architecture allow-list 中删除 `maxToolCalls`。边界收到该未知字段时按 closed schema 拒绝，不静默忽略。需要 request-scoped 禁用 Tool 时使用 `executionMode=model-only`；Agent Core 将它映射为保留 descriptors 的 effective `toolChoice=NONE` 和零 Tool execution authority，但不改写 assembly 的 `maxTurns` / `maxToolCallsPerTurn`。

## 4C. `FN-4.1 调用模型`

### 4C.1 目标与规范依据

canonical spec 为 `model-invocation-contract`。本 Function 的目标 Requirements：

- `MODIFIED Target-state request fields are stable invocation inputs`
- `MODIFIED 全局模型目录提供安全模型配置`
- `MODIFIED Provider options remain an open selected-provider extension`

### 4C.2 当前实现

模型调用契约没有 provider-neutral Tool choice；model-only 由上游清空 `tools`，provider options 又可能形成未经治理的同名入口。

### 4C.3 GAP 分析

缺少 canonical field 会改变 Tool descriptor request shape，并让不同 provider、profile 和调用来源产生平行控制。

### 4C.4 修改方案

增加 `ToolChoice = AUTO | NONE | REQUIRED` 并纳入 `ModelInferenceOptions`、profile、resolved configuration 和 invocation request。`NONE` 保留 descriptors，`REQUIRED + tools=[]` 在 provider access 前失败；selected adapter 映射 native value，`providerOptions` 与既有 `modelParams` 的 Tool-choice 同名 collision fail closed。Skill metadata 也复用该字段，不增加带 `Model` 的类型或 named-tool object，不改变 `modelParams` 的其他行为。

## 4D. `FN-4.3 装配上下文`

### 4D.1 目标与规范依据

canonical spec 为 `context-engine`。本 Function 的目标 Requirements：

- `MODIFIED Context Engine separates assembly from rendering`

### 4D.2 当前实现

Context Engine 已合并其他 provider-neutral inference options 和 governed Capability model patch，但没有 `toolChoice`。

### 4D.3 GAP 分析

若 finalizing 另建模型调用或直接清空 tools，会复制 context/render 路径并改变缓存输入；若 patch 不经过 Context Engine，又会绕过现有治理与 precedence。

### 4D.4 修改方案

沿用 profile、selected Prompt、governed Capability patch、trusted request 的逐字段 pre-hook precedence，省略即不覆盖。finalizing feedback 通过同一 request-local `contextPatch.modelOptions.toolChoice=NONE` 进入 render；`RenderedModelInput.tools` 保持正常可见集合。

## 4E. `FN-10.1 注册和执行钩子`

### 4E.1 目标与规范依据

canonical spec 为 `lifecycle-hook-execution`。本 Function 的目标 Requirements：

- `MODIFIED Stage-specific boundaries and mutations are minimal runtime contracts`

### 4E.2 当前实现

model Hook 缺少 `toolChoice`；planning Hook 的 `maxRounds/maxCalls` 又构成 assembly 之外的 budget authority。

### 4E.3 GAP 分析

Hook 需要和其他 model options 同形扩展，但不应获得修改 `maxTurns` 或 `maxToolCallsPerTurn` 的权限。

### 4E.4 修改方案

`BEFORE_MODEL_INVOKE` closed boundary/mutation 增加 optional `toolChoice` 并复用模型契约；`BEFORE_PLANNING` closed schema 删除 `maxRounds/maxCalls`，并拒绝任何新旧 loop-limit 字段。普通 invocation 中 Hook 保持最高 merge precedence；model-only/finalizing 在 Hook merge 后把 effective value 约束为 `NONE`，Agent Core hard guard 再防御 provider 违规返回。

## 4F. `FN-10.4 自定义工具和提示词`

### 4F.1 目标与规范依据

canonical spec 为 `prompt-template-assembly`。本 Function 的目标 Requirements：

- `MODIFIED Prompt template selection is deterministic`

### 4F.2 当前实现

Template 可以 handoff 其他 inference options，但其 closed field set 不含 `toolChoice`。

### 4F.3 GAP 分析

缺少该字段会使 Prompt authoring 成为唯一无法参与既有 option precedence 的来源。

### 4F.4 修改方案

Template compiler 接受 optional `AUTO | NONE | REQUIRED` 并原样 handoff；省略不覆盖，named-tool/native alias/null/unknown field 在 Agent package publication 前失败。最终 merge 仍由 Context Engine 拥有。

## 4G. `FN-2.8 指令定向请求处理`

### 4G.1 目标与规范依据

canonical spec 为 `directive-capability-routing`。本 Function 的目标 Requirements：

- `MODIFIED Agent Web Requests Do Not Carry Target Directives`

### 4G.2 当前实现

Web request 可转发 `maxToolCalls`，directive target 则在 runtime acceptance 后由 router 从用户文本派生。

### 4G.3 GAP 分析

只改 runtime routing type 而不改 Web schema 会留下可提交但目标 contract 不再接受的字段。

### 4G.4 修改方案

保留 target Skill/Recipe 只能由 directive 派生的现有边界；Web closed schema 的非目标 allow-list 删除 Tool-call 数量预算，未知字段在调用 runtime submit 前失败。

## 4H. `FN-5.3 读写编辑文件`

### 4H.1 目标与规范依据

canonical spec 为 `file-operation-tools`。本 Function 的目标 Requirements：

- `ADDED Read Tool 只读取受控工作区内的有界文件页`

### 4H.2 当前实现

Read 的 workspace-relative path、分页 defaults/ranges、bounded result 和 safe failure 主要仍写在 `ts-minimal-agent-kernel / 最小 Capability Tool 集合`。

### 4H.3 GAP 分析

删除 mixed Requirement 时若不迁移，会丢失文件边界和分页契约；把它留在 tool-loop 又会让 orchestration 拥有 Tool 业务语义。

### 4H.4 修改方案

把 Read 输入、输出、分页、受控 `workspaceFiles` dependency 和安全失败完整迁入 `file-operation-tools`。Tool loop 只保留统一 invocation 与结果消费，不 hardcode 文件读取。

## 4I. `FN-5.9 调用技能`

### 4I.1 目标与规范依据

canonical spec 为 `skill-tool`。本 Function 的目标 Requirements：

- `MODIFIED Skill tool is the model-facing Skill execution entry`

### 4I.2 当前实现

`SkillMetadata.modelOptions` 复用 closed `ModelInferenceOptions`，但其显式字段清单尚未包含 `toolChoice`。

### 4I.3 GAP 分析

只扩展 Capability patch 而不扩展 Skill parser/typed metadata/mapper 会使主要 governed patch producer 无法产生该字段，并造成同名 contract 不同形。

### 4I.4 修改方案

完整修改 Skill 主 Requirement：parser、schema、typed metadata、mapper 和 result validation 同形增加 canonical `toolChoice`；Skill Tool 只复制 accepted metadata 明确声明的值，不清空 tools、不访问 provider、不合成默认值。

## 4J. `FN-11.1 恢复运行状态`

### 4J.1 目标与规范依据

canonical spec 为 `local-runtime-recovery`。本 Function 的目标 Requirements：

- `MODIFIED Executing recovery 必须从 checkpoint 和 messages 重建 RequestContext`
- `ADDED 检查点记录最小 Agent turn 恢复坐标`

### 4J.2 当前实现

checkpoint 已有 run/version/sequence/trigger/active-context anchors，但没有 logical Agent turn coordinate；Agent loop 的 round index 是单次 `Agent.execute` 局部变量。既有默认 checkpoint idempotency key 只使用 `runId`、`triggerReason` 和 `runVersion`，同一 run version 内重复保存 `STEP_STARTED` 会命中首次锚点。

### 4J.3 GAP 分析

恢复时从零开始会让同一 run 绕过 `maxTurns`；若不调整幂等语义，后续 turn 又无法推进 durable coordinate。把完整 loop state、transcript 或第二套状态机写入 checkpoint 会扩大复杂度和 persistence owner。

### 4J.4 修改方案

只在 `RequestContext` 与对应 checkpoint 增加同一个 `agentTurnIndex`。新 run 从 `0` 开始；Agent Core 在 logical turn 前更新 context copy，Runtime 通过既有 checkpoint write 原样持久化；turn checkpoint 的 idempotency semantic 在既有 run/trigger/version 坐标后加入 `agentTurnIndex`，使同 turn replay 幂等且不同 turn 不冲突。`0..maxTurns-1` 是普通 turns，`maxTurns` 是唯一 finalizing turn，recovery 校验 checkpoint 后用该值重建 `RequestContext`。Tool/message state 仍从 canonical messages 和 lifecycle stage 重建，provider retry/replay policy 不变，不新增 phase、port、表、store、command 或公开 finalizing 状态。无需真实 crash recovery 的最小内核继续注入既有 no-op checkpoint provider，但 Runtime 主路径仍只调用同一个 `CheckpointStoreGateway.saveCheckpoint`；no-op provider 不形成第二个 port 或公开行为分支。

## 4K. 需群内确认

本节涉及三组 frozen contract refinement，实施代码前必须按仓库治理一次性完成群内确认：

1. `agent-contracts/model` additive refinement：公共类型名 `ToolChoice`（不得带 `Model`）、字段 `ModelInferenceOptions.toolChoice?: ToolChoice`、首版值域 `AUTO | NONE | REQUIRED`、profile 缺省 `AUTO`、固定 precedence、`SkillMetadata.modelOptions`/Prompt/Capability patch/Hook 同形复用、named-tool choice 延期，以及 `providerOptions`/既有 `modelParams` 的 Tool-choice collision keys；本确认不包含删除、重命名或重新定义 `modelParams` 的其他行为。
2. `agent-contracts/agent-assembly` clean breaking replacement：删除 `AgentRuntimeSettings.maxToolIterations`，新增 `maxTurns` 与 `maxToolCallsPerTurn`；`maxTurns` 为正安全整数、缺省 `50`，`maxToolCallsPerTurn` 为 `1..100` 安全整数、缺省 `30`。本 change 不接受 deprecated alias，不定义双写 precedence，旧字段由 closed source schema 直接拒绝，runtime-ready assembly 只发布两个 canonical fields。
3. `agent-contracts/runtime` breaking refinement：从 `RoutingConstraints` 删除 `maxToolCalls`；从 `BEFORE_PLANNING` boundary/mutation 删除 `maxRounds/maxCalls`；`RequestContext` 与 checkpoint payload 只增加同一个非负安全整数 `agentTurnIndex`，`index < maxTurns` 表示 normal，`index = maxTurns` 表示 finalizing。request-scoped 禁用 Tool 只使用 `executionMode=model-only`；Web/runtime DTO、Hook schema、checkpoint Record/row mapping 和 recovery validation 必须同组确认。

用户已确认扩大后的 `toolChoice` effect 是目标、类型名不得带 `Model`，并确认新行为使用 `maxTurns` 与 `maxToolCallsPerTurn`。但用户确认不替代 frozen contract 群内治理；在上述三组 contract 的字段、默认值、范围和 clean replacement/removal 确认完成前，不得实施 public contract 或勾选相应代码任务。

## 5. `FN-2.6 指定技能处理`

### 5.1 目标与规范依据

canonical spec 为 `targeted-skill-routing`。本 Function 的目标 Requirements：

- `MODIFIED Target Skill failures degrade explicitly`

### 5.2 当前实现

`TargetedSkillRouter` 已按可信 target Skill 解析 descriptor 并调用统一执行边界；成功/降级保留定向路径，失败读取最终 `safeError` 后终止，取消保持取消语义。现有 tests 已覆盖 output invalid、resolver rejection、降级保真、无第二层 retry 和无普通模型回退。

### 5.3 GAP 分析

当前实现已闭合本 Function 的生产行为差距；剩余工作是保持 canonical spec、tests 与统一执行边界一致，后续 loop-control 修改不得把定向路径接入普通模型恢复。

### 5.4 修改方案

`TargetedSkillRouter` 通过统一执行边界调用 resolved Skill，只观察最终 `result.safeError`。成功和合法降级保持定向路径；取消结束为取消；其他最终失败构造安全终止错误。定向 Skill 不回退到普通模型选路，不拥有第二层 retry。output invalid 在该路径没有模型恢复 owner，因此直接终止。

## 6. `FN-9.4 执行能力节点`

### 6.1 目标与规范依据

canonical spec 为 `workflow-capability-nodes`。本 Function 的目标 Requirements：

- `MODIFIED Restful Node`
- `ADDED Capability 节点上升统一最终失败`

### 6.2 当前实现

- RESTFUL single/poll/batch、`PromptSplicing`、PYTHON 和 AGENT 已统一消费最终 `CapabilityInvocationResult`；最终失败通过 package-private `CapabilityNodeExecutionError` 保留 `safeError` 并上升，取消中断。
- RESTFUL single 本地 retry 已删除；统一 retry policy resolver 按 `retry → retryPolicy → runtime.defaultRetry` 选择声明值，并把它作为 `maxRetries` 下沉到每个逻辑 Capability invocation。最终 Capability 失败不会触发 engine 节点 retry。
- poll ordinal 和 batch item 使用独立逻辑身份，同一 invocation 的内部 retry 复用身份；node-scoped signal 与每-attempt `timeoutMs` 的组合已有 tests 覆盖。
- tests 已覆盖业务 code 保真、PromptSplicing 已调用失败、显式 poll/batch failure strategy、取消、独立 identity、完整 attempt timeout 和零节点 retry。

### 6.3 GAP 分析

- 当前实现已闭合本 Function 的调用分类、单一 retry owner 和最终失败 marker；剩余风险只在并行 Workflow changes 后合入时恢复第二个 retry parser 或 engine replay，按 §2.1 合并门禁处理。

### 6.4 修改方案

统一 consumer 覆盖以下调用点：

| 调用点 | 目标结果 |
|---|---|
| RESTFUL single | 成功/降级产出节点结果；最终失败上升；取消中断；删除本地 retry loop |
| RESTFUL poll | 每个 poll ordinal 是独立逻辑调用；协议“尚未完成”是正常控制结果；单项失败按 `on_poll_error` 消费或上升，不重放同一 ordinal |
| RESTFUL batch | 每个 item index 是独立逻辑调用；单项失败按 `batchFailStrategy` 消费或上升，不重放该 item |
| RESTFUL `PromptSplicing` | boundary 未装配时使用静态 prompt；已发起调用后的最终失败上升 exception，不静默 fallback；取消中断 |
| PYTHON | 最终失败保留 safeError 并上升；取消中断 |
| AGENT | child 最终错误保真上升；不泄漏 child 私有 id；取消中断 |

package-private `CapabilityNodeExecutionError` 只携带最终安全 `safeError` 和必要节点坐标，用于让 Workflow engine 区分 Capability 最终失败；它不进入 `agent-contracts` 或 package public export。每个 poll ordinal 和 batch item 使用确定且不同的 invocation/tool-call/idempotency identity；同一逻辑调用内部 retry 复用身份。

Workflow 把 node-scoped signal 传给统一调用边界，并把节点声明的 timeout 写入 Capability request。测试分别证明：父 node signal 未取消时第二次 attempt 获得与第一次相同的 `timeoutMs`；父 node signal 已取消时不会启动第二次 attempt。

Workflow 复用现有 retry policy resolution：节点显式 `retry` 优先，其次兼容字段 `retryPolicy`，再次为 Recipe `runtime.defaultRetry`。解析到声明的 retry 次数时，全部由该节点发起的逻辑 Capability invocation 都把该值写入 `CapabilityInvocationRequest.maxRetries`；三者均缺失时省略字段并使用 Capability 默认值 `1`。RESTFUL inputs 中的兼容字段 `retry_times` 不进入该映射。配置只控制统一执行边界内的额外 attempt 上限，最终 Capability 失败仍直接上升且 Workflow engine 不重新执行节点；poll ordinal、batch item 和 PromptSplicing 分别是独立逻辑 invocation，各自应用同一节点上限。

## 7. `FN-9.7 执行模型节点`

### 7.1 目标与规范依据

canonical spec 为 `workflow-llm-nodes`。本 Function 的目标 Requirements：

- `ADDED DATA_ANALYSIS Python 子调用遵守统一失败处置`

### 7.2 当前实现

`DATA_ANALYSIS` 的 optional Python boundary 已复用统一 Capability consumer 和 package-private final-failure marker；最终失败不重跑整个模型节点，取消中断。boundary 未装配时仍使用既有 model-only 路径，相关 tests 已覆盖 invocation count 与结果保真。

### 7.3 GAP 分析

当前实现已闭合本 Function 的行为差距；后续模型配置或 batch change 必须保持 optional boundary 与 model-only 两条公开结果不变，并不得把 Capability 最终失败重新送入节点 retry。

### 7.4 修改方案

`DATA_ANALYSIS` 的可选 Python boundary 使用同一 Capability consumer。成功/降级进入分析结果；最终失败用 package-private marker 上升；取消中断；engine 不因该子调用失败重跑整个模型节点。boundary 未装配时保持 model-only 路径，不合成 Capability 结果。

## 8. `FN-9.1 执行工作流`

### 8.1 目标与规范依据

canonical spec 为 `workflow-contracts`。本 Function 的目标 Requirements：

- `ADDED Workflow 节点重试不重放 Capability 最终失败`
- `ADDED 最终 Capability 失败统一求值显式 exception`
- `ADDED Capability exception 仅观察最终失败事实`
- `ADDED Workflow 节点等待状态投影为成功控制结果`

### 8.2 当前实现

- Workflow engine 已按取消、Capability final-failure marker、普通节点异常的固定顺序处理；Capability 最终失败跳过 `shouldRetry` 并求值显式 exception，非 Capability 节点继续按声明 retry。
- legacy `Timeout and Retry` 的完整目标行为已迁入 canonical `workflow-contracts`；tests 覆盖 SafeError categories、output invalid、result unknown、缺失 safe error 规范化、中间 attempt 不可见、取消和非 Capability retry 回归。
- `WorkflowRuntimeEventProjector` 已把 `NODE_WAITING` 投影为 `CAPABILITY_COMPLETED + SUCCEEDED + WORKFLOW_NODE_WAITING`，且不携带 `safeError`。

### 8.3 GAP 分析

- 当前实现已闭合本 Function 的 retry/exception/cancel 顺序和 waiting 投影；剩余风险是并行 Workflow engine、cancel 和 history changes 后合入时覆盖该顺序或恢复旧 legacy Requirement，按 §2.1 与迁移验收处理。

### 8.4 修改方案

Workflow engine 的 catch 顺序固定为：

1. 父取消或 Capability `CANCELED` 先进入中断/cancel fallback，不进入普通 exception 或 retry。
2. cancel fallback 中的 `CapabilityNodeExecutionError` 跳过 Workflow 节点 retry 和普通 exception，由 rollback failure 路径结束回退；fallback 中的非 Capability 节点继续遵守 cancel-policy 最终声明的 timeout/retry。
3. 普通执行路径的 `CapabilityNodeExecutionError` 跳过通用 `shouldRetry`，直接求值当前节点显式 exception。
4. 有匹配 exception 时只执行该分支；无匹配分支时 Workflow 失败。
5. 普通执行路径的非 Capability 节点每个 attempt 重新建立完整节点 timeout；已经消耗的 retry 次数小于声明值时启动下一 attempt。
6. 非 Capability retry 耗尽后求值显式 exception；匹配 skip 分支产生 skipped 结果，无匹配分支时 Workflow 失败。

该规则覆盖 validation、not-found、conflict、最终 transient、authorization、policy、output invalid、internal、result unknown 和规范化错误。Workflow 不推断开发者会在 exception 中执行查询、补偿、告警、转人工还是降级。Recipe `error` shape 保持既有契约，只接收其允许的最终安全字段；中间 attempt 不进入 Recipe、event 或 exception。

`WorkflowRuntimeEventProjector.buildWaitingNodeTerminal` 把 `NODE_WAITING` 投影的 `inlinePayload.status` 从 `DEGRADED` 改为 `SUCCEEDED`，保留 `reasonCode: 'WORKFLOW_NODE_WAITING'`，且不携带 `safeError`。该修改只影响 timeline event payload 的 `status` 字段，不改变 Workflow engine 的控制流、节点 retry 或 exception 求值。

#### 8.4.1 质量属性影响

- 可靠性/恢复：依据 `workflow-contracts / Capability exception 仅观察最终失败事实`，Workflow 只观察 governed boundary 的最终结果；中间 attempt 不进入 Recipe、event 或 exception，Capability 最终失败后的节点自动重试次数为 0。验证同时覆盖非 Capability retry 回归，避免统一处置误伤普通节点恢复。

## 9. `FN-5.6 向用户提问`

### 9.1 目标与规范依据

canonical spec 为 `ask-user-question-tool`。本 Function 的目标 Requirements：

- `MODIFIED AskUserQuestion tool creates runtime-owned question pending input`
- `MODIFIED AskUserQuestion 可纠正输入错误进入安全模型纠错`
- `MODIFIED AskUserQuestion 非纠正性失败保持终止和安全边界`

### 9.2 当前实现

AskUserQuestion 是 agent-core tool loop 中的 pre-invocation producer：它在普通 executor 前校验参数并调用 runtime-owned pending-input boundary。当前失败已使用统一 `safeError` payload 和配对 transcript，failure fingerprint 与第二次相同失败终止也已删除；同批 tool-use/result 配对与 pending 生命周期已有测试基线。剩余收敛仍依赖旧的全局 `maxToolIterations` 和单轮数量恢复机制。

### 9.3 GAP 分析

该旁路不能直接改成普通 executor，否则会破坏 assistant batch 持久化和 pending owner；后续 loop-control 替换还必须保持已删除的局部失败阈值不回归，并让 AskUserQuestion 与其他模型可见失败只由 canonical `maxTurns` 收敛。

### 9.4 修改方案

AskUserQuestion 保持 pre-invocation producer：先持久化 assistant tool-use batch，再执行完整 schema/semantic 校验。非法调用产生与原 `toolCallId` 配对的既有 `status/result/safeError` 投影；同批未执行 Tool 各自产生 `CAPABILITY_BATCH_REJECTED`。每次相同非取消失败都允许模型修正参数、改用其他 Capability、普通答复、再次显式调用或结束；合法修正进入现有 runtime-owned pending-input 生命周期。禁止用途保持既有安全 validation outcome，internal 保持 `INTERNAL`，两者均反馈模型；取消仍结束为取消终态。

现有 pre-invocation producer 继续留在 agent-core，并只在正常 catalog resolution 得到 `kind=TOOL`、canonical `capabilityId=AskUserQuestion`、builtin bundled provider 和 available descriptor 后命中。它使用既有 `AgentRunStatePort.requestPendingInput` 交给 Runtime 建立 pending fact，不通过普通 `CapabilityInvocationPort` 创建初始 pending request；不增加 generic pending registry、descriptor/metadata routing marker、新 public pending command、lifecycle stage、checkpoint trigger 或 capability implementation import。`4..20` questions 的兼容处理只使用 request-local descriptor validation view 放宽 top-level item count，不修改 frozen descriptor 或 provider-facing schema；其他 schema、visible-text 和 forbidden-purpose 校验保持同一条路径。

该旁路复用 §3.4.5 的黑盒规则、共享 test fixtures、§4 的最终失败处置和公共 externalizer，不调用普通 Capability executor，也不建立第二套错误结构、失败计数或 fingerprint。其窄化 preflight 留在 agent-core，避免 agent-core 依赖 agent-capability 实现包。AskUserQuestion 与普通 tool loop 共同受 canonical `maxTurns` 和每轮 `maxToolCallsPerTurn` 约束，并在达到 `maxTurns` 时进入 §4.5 的同一个单次 finalizing turn。

## 10. `FN-5.5 执行命令和脚本`

### 10.1 目标与规范依据

canonical spec 为 `command-script-tools`。本 Function 的目标 Requirements：

- `ADDED Bash 对可纠正命令格式错误返回完整诊断`
- `ADDED Bash 结果有界且忠实表达进程完成事实`
- `ADDED Python guard 和执行失败使用统一安全语义`

### 10.2 当前实现

Bash 已在 sandbox gateway 前聚合可独立判断的格式 violations，并以 `COMMAND_NOT_ALLOWED + VALIDATION + retryable=false` 返回；unclosed quote 保留 `BASH_COMMAND_UNCLOSED_QUOTE`。正常完成的 zero/non-zero、空/非空和安全截断组合均返回同形 `SUCCEEDED` 进程结果；timeout 与执行失败保持真实状态。Python guard 已使用 `/code` violation 与 `NL2PY_GUARD_BLOCKED`，missing boundary、invalid sandbox result、timeout 部分输出和取消均有统一映射。

### 10.3 GAP 分析

当前实现已闭合本 Function 的失败分类和进程结果事实；剩余工作是完成 legacy Requirement 原子迁移，并在并行 Bash/Python changes 后合入时保持最新 status、retryable、容量和 sandbox 边界。

### 10.4 修改方案

Bash 在 sandbox dispatch 前聚合 tokenization、控制字符和 quoted syntax 的全部独立违规，使用 `COMMAND_NOT_ALLOWED + VALIDATION + retryable=false`，不回显 command；unclosed quote 同时保留 `BASH_COMMAND_UNCLOSED_QUOTE` reason code。合法 shell composition 继续进入 sandbox policy；真实 policy/auth error 保真。缺少必需 sandbox composition 使用标准 `CAPABILITY_EXECUTION_FAILED + INTERNAL + retryable=false`；foreground 和 background sandbox 返回值不符合内部 contract 时，Bash 不创建 Tool-owned validation code 或 reason code，而是让统一执行边界按未知执行异常映射为同一标准内部错误。Bash timeout 仅在有安全 stdout/stderr 时保留部分 payload；正常完成时 zero/non-zero exit 均返回 `SUCCEEDED` 和完整声明的有界进程 payload，不受 stdout/stderr 是否为空或安全截断影响。Python guard 固定为 `NL2PY_GUARD_BLOCKED + VALIDATION + false`，violations 精确指向 `/code` 并使用 `codeSafetyPolicy`，不重复同名 reasonCode，provider raw guard message 不进入模型；missing sandbox/context 与 invalid sandbox response 使用标准 internal。Python timeout 有安全 stdout/stderr 时保留声明 payload，没有安全输出时使用空 payload；message 要求检查已有输出并缩小代码或输入；其 `NON_IDEMPOTENT` replay policy 不变。Python 非零退出继续遵守既有普通结构化结果契约。

## 11. `FN-5.13 检索知识库`

### 11.1 目标与规范依据

canonical spec 为 `rag-tool`。本 Function 的目标 Requirements：

- `MODIFIED Failures and degradation are explicit`

### 11.2 当前实现

RAG Tool 已区分零命中成功、声明 `topK` 范围内完成、有 chunks 的明确部分完成和无 chunks 的最终失败；descriptor 为 `IDEMPOTENT`，provider unavailable/timeout 只通过统一边界重试。invalid provider/result、取消、scope mismatch 和安全 message 已有黑盒 tests。

### 11.3 GAP 分析

当前实现已闭合本 Function 的状态分类和重试边界；并行 RAG schema/display change 可以放宽 owning output shape，但不得改变本 change 的最终 status、统一容量或 safe-error 语义。

### 11.4 修改方案

RAG 零命中和声明检索范围内的完整/有界结果是正常成功；index missing/not-ready 分别提供发现或状态恢复动作；`PROVIDER_UNAVAILABLE` 固定为 `UNAVAILABLE + retryable=true`，已确认无业务结果的 provider timeout 固定为 `TIMEOUT + retryable=true`，并只在 descriptor 的 `IDEMPOTENT` 门禁和 invocation retry 上限内重试。只有已返回安全 chunks 且 provider 明确确认至少一个其余已声明检索范围未完成时才允许 `DEGRADED`，message 必须指出可用 chunks 和缺失范围；没有 chunks 的 NOT_FOUND、CONFLICT、AUTHORIZATION、UNAVAILABLE、TIMEOUT、CANCELED 和 INTERNAL 使用空 payload SafeError，不再用 `ToolFailedResultError(payload, ...)` 携带 diagnostics。invalid provider result、decode/build/cleanup 和未知状态使用标准 internal 并丢弃 diagnostics payload。

## 12. `FN-8.2 检索和写入记忆`

### 12.1 目标与规范依据

canonical spec 为 `memory-tools`。本 Function 的目标 Requirements：

- `MODIFIED search_memory L1 retrieval`
- `MODIFIED Memory tools failure and degradation`

### 12.2 当前实现

三个 memory Tool 已直接生产统一 outer `safeError` 并使用公共容量/外置回读路径；`search_memory`、`get_memory_detail` 是 `IDEMPOTENT`，`add_memory` 是 `NON_IDEMPOTENT`。单项 detail not-found 与 global failure 已分离，owner scope、L1/L2 disclosure、ranking、写入和 access-count side effect 保持既有行为，tests 已覆盖只读 retry、取消和大结果。

### 12.3 GAP 分析

当前实现已闭合本 Function 的 outer/item failure、统一容量与 replay policy；并行 memory disclosure change 后合入时必须保持 `add_memory=NON_IDEMPOTENT`，不得恢复专用 pre-limit 或合成无 owner 事实的 result-unknown 出口。

### 12.4 修改方案

`search_memory`、`get_memory_detail` 和 `add_memory` 直接生产 outer `CapabilityInvocationResult.safeError`，不建立 memory 专用失败 payload 或 pre-limit。只读 Tool 可按统一幂等瞬态门禁 retry；`add_memory` 保持 `NON_IDEMPOTENT`，不自动重放。当前 memory producer 没有 owner-confirmed 结果未知事实，因此不新增该出口。单项 detail not-found 保持 item 结果，global auth/internal 不降级为 item missing。owner scope、L1/L2 disclosure、ranking、写入语义和 access-count side effect 保持既有边界。

## 13. 跨 Function 协作与端到端流程

本 change 对 Capability 失败处置的单一主要 owner 仍是 `agent-capability`，主要写入面是 `GovernedCapabilityInvocationPort`、result normalization、schema validation 与 first-party Tool producer；新增预算收尾由既有 loop owner `agent-core` 独占，`agent-model`、`agent-context-engine`、Prompt Template 和 lifecycle hook owner 只完成 canonical `ToolChoice` contract、合并与 provider 映射。agent-workflow、agent-memory 和 agent-runtime 只做必要的失败消费、控制流处置或终态投影；agent-session 和 channel/frontend 保持既有字段与 owner 边界。任何其他层都不取得 Capability retry、Agent budget transition 或 terminal commit ownership。

该 change 必须原子交付的理由是：唯一执行边界和所有生产 consumer 必须在同一版本采用统一失败处置；`ToolChoice` contract、authoring/merge/provider chain、Agent assembly limits、request routing migration、turn recovery coordinate 与 Agent finalizing guard 也必须同时落地。只实施其中一部分会留下调用旁路、重复 retry、失败终态不可见、`tools=[]` 平行行为、多个 budget owner、孤立 Tool message pair、recovery 重置 turn 或达到 `maxTurns` 后继续执行 Tool，不能形成独立可用中间态。二十个 Function 仍按各自 tests/implementation 独立验收，但共享契约门禁、consumer 迁移和最终端到端 gate 在 change 完成前不可部分勾选。

共享不变量为：

1. 一次逻辑 Capability 调用对调用方只产生一个最终 `CapabilityInvocationResult`。
2. `safeError.retryable` 只回答执行边界能否安全原样重放，不回答模型能否选择不同动作。
3. 同参自动重试只有 `agent-capability` 一个 owner；Agent 模型恢复和 Workflow exception 分别由其控制流 owner 决定。
4. `agent-contracts` 继续拥有公共 interface；本 change refinement `timeoutMs` 的 per-attempt 语义，为 `CapabilityInvocationRequest` 增加可选 `maxRetries`，并在群内确认后增加唯一公共 `ToolChoice` 与 `ModelInferenceOptions.toolChoice`；严格 runtime schema、处置 helper、重试逻辑、finalizing transition 和业务 message formatter留在各自实现 owner。
5. 所有 Capability 使用同一结果对象、同一 `SafeError`、同一参数诊断形态和同一大结果机制；自动重试遵守固定 truth table。
6. 通用边界只映射它拥有的执行事实；Tool producer 保留其安全业务错误和领域恢复动作。
7. `fallbackTriggered` 是与 status 正交的路径 metadata；fallback 的合法最终结果、复合部分成功、失败和超时分别保持真实最终状态。
8. `ToolChoice` 是 `agent-contracts/model` 的唯一 Tool 选择控制词汇；normal invocation 按 profile、Prompt、patch、trusted request、Hook 合并，Agent budget owner 始终保留最终 Tool 执行否决权。

```text
Capability producer
  → GovernedCapabilityInvocationPort
      → validate / invoke / normalize
      → zero or more safe same-argument retries within maxRetries (default 1)
      → one final CapabilityInvocationResult
          ├─ ordinary Agent: model decision | explicit lifecycle control | canceled
          │    └─ global loop budget exhausted → exactly one finalizing model turn, zero Tool execution
          ├─ targeted Skill / hidden ApiCall: terminal failure | canceled
          └─ Workflow: explicit exception | interrupted
```

共享集成规则：

- executor retry、Agent 模型恢复和 Workflow exception 是三个职责，不互相代替。
- Agent Core 只决定 loop 处置，agent-runtime 独占 terminal commit。
- Context Engine、Prompt Template、Capability patch、trusted request 和 lifecycle hook 只决定模型请求的 effective `ToolChoice`；它们不能扩大已耗尽的 Agent Tool 执行预算。
- Workflow 只观察最终失败；Recipe 明确消费的 poll/batch 单项失败不是自动 retry。
- failure evidence 在进入结果、模型、exception、stream 或 terminal 前完成安全化。

## 14. 跨 Function 质量属性设计

- 性能/容量：`FN-5.2` 的 `capability-catalog / Capability 结果复用统一容量和转储机制` 是统一结果容量的唯一黑盒目标。governed result guard、Agent session externalizer 和 Workflow/direct consumer 通过相同 `256_000` UTF-16 code unit 边界与 overflow fixture 组合验证；其他 Function 不增加专用容量或转储机制。
- 安全：`FN-5.2` 的 `capability-catalog / Capability 失败证据不跨安全边界` 是失败证据安全的唯一黑盒目标。私有 result schema、producer normalization、Agent/Workflow consumer 和 Web 安全投影使用同一禁止内容 fixtures；该共享验证不改变其他 Function 的错误字段或建立第二套安全契约。
- 可靠性/恢复：`FN-9.1` 的 `workflow-contracts / Capability exception 仅观察最终失败事实` 是 Workflow 只观察最终失败事实的唯一黑盒质量目标。`FN-5.2` 的 governed retry、`FN-3.4` 的 Agent 处置和 `FN-9.1` 的 exception 通过“中间 attempt 不可见、最终结果恰好一个、后续自动重放为 0”端到端组合验证。

## 15. 目标结果示例

### 15.1 完整参数诊断

```json
{
  "status": "FAILED",
  "structuredPayload": {},
  "safeError": {
    "code": "CAPABILITY_INPUT_INVALID",
    "category": "VALIDATION",
    "message": "Input validation failed for 2 constraints. Correct every listed field before calling the capability again.",
    "retryable": false,
    "safeDetails": {
      "violations": [
        { "path": "/query", "constraint": "minLength", "expected": "a non-empty string" },
        { "path": "/limit", "constraint": "maximum", "expected": "an integer no greater than 100" }
      ]
    }
  }
}
```

### 15.2 输出无效但 Agent 可以改变编排

```json
{
  "status": "FAILED",
  "structuredPayload": {},
  "safeError": {
    "code": "CAPABILITY_OUTPUT_INVALID",
    "category": "VALIDATION",
    "message": "Capability output did not satisfy its declared contract. Do not repeat the same call unchanged. Reduce or revise the request, or choose another capability.",
    "retryable": false
  }
}
```

### 15.3 执行事实 owner 明确声明的结果未知

```json
{
  "status": "TIMED_OUT",
  "structuredPayload": {},
  "safeError": {
    "code": "CAPABILITY_RESULT_UNKNOWN",
    "category": "TIMEOUT",
    "message": "The owning operation confirmed that its side-effect result is unknown. Use the independently declared query before another mutation.",
    "retryable": false
  }
}
```

## 16. 验证策略

- Contract tests 覆盖 `safeError` 唯一失败字段、严格 status/`safeError` 组合、`fallbackTriggered` 与 status 正交、完整 violations、`256_000` UTF-16 code unit 统一容量边界及 overflow、业务 safe error 保真、output invalid、unknown exception 和 retry truth table。
- Tool tests 使用生产 registry 闭包断言 20 个 first-party Tool、19 个模型可见 Tool和隐藏 `ApiCall`；统一边界测试覆盖 E1/E2/E7，真实 Tool 黑盒测试覆盖实际 E3–E6、message 语义、合法空结果、Bash 非零退出、Workflow `WAITING`、RAG 复合部分成功和 owner 明确声明的结果未知。新增未登记 Tool 必须使闭包测试失败。
- Retry tests 覆盖缺省和 `maxRetries=1` 时总 attempt 上限为 `2`、`maxRetries=0` 时不重试、显式更高上限按额外 retry 次数计数、每次 attempt 获得完整原始 `timeoutMs`、父 signal 在重试前或重试期间取消，以及中间失败不可见。
- Model contract tests 覆盖 public `ToolChoice` 命名、三值 schema、profile 缺省 `AUTO`、resolved configuration、Prompt/Capability/trusted request/Hook precedence、`REQUIRED + tools=[]` pre-provider failure、provider-native 映射，以及 `providerOptions`/`modelParams` 的 Tool-choice collision；named-tool object 必须实际触发 schema failure，其他既有 `modelParams` regression 保持通过。
- Context/Prompt/Skill/Hook tests 覆盖 `toolChoice` closed schema、字段省略、逐字段 merge、request-local 生命周期、Skill metadata patch、Hook override、planning Hook budget 字段拒绝和 `NONE` 时 `tools` descriptors 保持不变。
- Agent characterization tests 覆盖 output invalid 模型恢复、非法最终 envelope/extension safety net、未授权 model patch 零部分应用、Bash `COMMAND_NOT_ALLOWED` 后续模型选路、相同失败与空 Tool 名称多次继续、`maxTurns` 转入一次 finalizing turn、普通 `AUTHORIZATION` error 即使携带授权提示也反馈模型、明确 `REQUIRE_AUTHORIZATION` pending、lifecycle PEND/DENY/BLOCK、取消、隐藏 ApiCall、admitted batch 预检零执行和失败大结果。overflow matrix 必须覆盖 29/30/31/100/101 calls、连续超限、空名称与超限组合、最后一个 normal turn、前缀 preflight failure、canonical message pairing 和 omitted suffix 零记录；finalizing matrix 必须覆盖最后一批 Tool 结果可见、文本+Tool call、only Tool call、空文本、model safeError、cancellation、terminal hook Tool call、pause/resume/recovery 保持 turn coordinate，以及每个 run 最多 `maxTurns` 个普通 logical turns 和一个 finalizing logical turn。
- Workflow characterization tests 覆盖 RESTFUL single/poll/batch/PromptSplicing、PYTHON、AGENT、`DATA_ANALYSIS` Python、无第二层 retry、全部非取消最终失败进入 exception、无分支失败和取消中断。
- Architecture tests 覆盖 `agent-contracts` 只增加获确认的 `ToolChoice` / `ModelInferenceOptions.toolChoice` 和 `RequestContext`/checkpoint 共用的 `agentTurnIndex`，不增加 public finalization command、phase、额外 port 或第二套 loop state machine；retry owner 只在 agent-capability，budget/finalizing decision 只在 agent-core，checkpoint/recovery 和 terminal commit 只在 agent-runtime；严格结果 schema 拒绝未声明字段，Capability marker 不公开。
- Security negative tests 证明 raw exception、stack、路径、credential、provider response、非法参数值、child ids 和 Capability output 不进入模型、Web、stream、timeline、audit、metric 或 trace。

## 17. 长期基线刷新计划

- Stable specs：合并 `capability-catalog`、`tool-loop`、`agent-package-assembly`、`routing-constraint-validation`、`directive-capability-routing`、`model-invocation-contract`、`context-engine`、`prompt-template-assembly`、`lifecycle-hook-execution`、`skill-tool`、`file-operation-tools`、`local-runtime-recovery`、`ask-user-question-tool`、`targeted-skill-routing`、`workflow-capability-nodes`、`workflow-llm-nodes`、`workflow-contracts`、`command-script-tools`、`rag-tool` 和 `memory-tools`；从 `ts-core-contracts`、`ts-minimal-agent-kernel`、`builtin-tool-framework`、`workflow-agent-loop-tool`、`bash-tool`、`python-tool`、`workflow-execution-engine` 移除已迁移 Requirements。
- Functions：刷新 `FN-5.2`、`FN-3.4`、`FN-3.2`、`FN-2.1`、`FN-4.1`、`FN-4.3`、`FN-10.1`、`FN-10.4`、`FN-2.8`、`FN-5.3`、`FN-5.9`、`FN-11.1`、`FN-2.6`、`FN-9.4`、`FN-9.7`、`FN-9.1`、`FN-5.6`、`FN-5.5`、`FN-5.13`、`FN-8.2`；`FN-3.4` 移除重复失败、空名称和 Tool-call recovery termination，改为 `maxTurns` 单一收敛、`maxToolCallsPerTurn` 前缀接纳和一次最终模型收尾。凡本 change 的 Function 变更汇总刷新“规格”字段，归档时都必须重建为 `规格项 / 规格值 / 权威来源` 三列目标表：保留已有且仍有 stable Requirement 依据的黑盒规格，加入本 change 明确列出的目标规格，移除无 stable Requirement 依据的“当前实现值”“建议评审值”或候选项，不把配置字段、checkpoint payload 或其他白盒实现形态写入规格表。
- Features：刷新 proposal 列出的十八个受影响 Features；`F-3.1` 发布 canonical runtime limits，`F-2.1` 删除 request Tool budget，`F-3.3` 移除局部 failure/recovery termination 并改为单一轮次收敛、单轮前缀接纳和一次最终模型收尾，`F-11.1` 保持 run-level turn recovery coordinate。
- Overview：提炼统一 Capability 失败处置目标及 Issue #497 影响。
- Architecture：刷新核心 Capability/model contract、Agent tool loop、model provider、Context/Prompt/Hook precedence、Workflow exception、terminal commit 和安全诊断边界。
- Modules：刷新 agent-contracts、agent-capability、agent-core、agent-model、agent-context-engine、lifecycle hook owner、agent-workflow、agent-runtime、agent-channel-web/agent-web、agent-memory 和 agent-observability 模块导航。
- ADR：无。
- spec-to-design-map：更新上述 specs 到 architecture、modules、Functions 和验证入口的导航。
- Roadmap：保持 `unify-capability-failure-disposition` 的 active 状态、单一主要 owner、当前基线和后合入冲突消解责任一致。
