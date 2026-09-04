## Why

Issue #497 是本 change 的直接触发点，它暴露了 Capability 失败后反馈不足、恢复行为不一致或请求不能确定结束的具体问题，但该 Issue 只是系统性缺口的一种表现，不是本 change 的范围边界。

对 Agent 而言，Tool、Skill 或 Agent 的失败不是单纯需要展示的一条错误信息，而是决定下一步行为的输入。系统必须能够一致区分：当前输入是否可修正、同一次调用是否可安全重试、是否应改用其他 Capability、是否因结果未知而必须先核验实际状态，以及当前请求是否已取消。若这些判断由每个 Capability 和每种调用路径各自解释，即使修复某一个 Tool，其他调用仍会产生同类问题，新增 Capability 也会继续复制不一致的失败语义。

因此，本 change 不以修补单个错误出口为目标，而是建立覆盖全部 runtime Capability 调用及其结果处置的统一不变量：相同失败事实得到相同分类、重试边界和安全反馈；普通 Agent 将取消之外的最终失败作为下一轮模型输入，由模型选择安全替代动作、修改参数、核验状态、再次调用或结束。系统不再根据重复错误或 Tool call 超限次数替模型结束推理；canonical `maxTurns` 是唯一 loop-count 收敛上限，达到上限后停止 Tool 执行并追加且仅追加一次无工具模型收尾轮。canonical `maxToolCallsPerTurn` 只限制单轮 Tool call 接纳前缀，超限尾部不保存、不执行，并把未执行事实反馈模型拆分后续工作。Issue #497 的具体问题将由这套统一规则闭合，当前 first-party Tool 和后续扩展 Capability 也必须遵守同一原则，从而解决一类问题而不是一个案例。

### 问题

Agent 调用 Tool、Skill 或 Agent 后，调用方目前不能稳定依赖失败结果完成下一步判断：

1. 参数和业务约束错误可能只返回单项或泛化信息，模型无法一次修正全部可判断问题。
2. 同类失败在不同 Capability 中使用不同的 code、category、retryable 和 message，模型无法判断应改参数、改用其他 Capability、先核验状态还是停止。
3. 自动同参重试、模型编排恢复和请求终止缺少清晰边界，不安全或无意义的重复调用会降低效率并可能重复副作用。
4. Agent、定向 Skill 和 Workflow 对同一最终失败采用不同原则，失败结果和后续行为不可预测。
5. 达到 Agent loop 上限时直接失败，模型没有最后一次机会把已获得的 Tool 结果、失败证据和未完成项整理成对用户有用的答复；同时存在多套 Tool 数量预算和局部纠正计数，单轮超限要么整批丢弃，要么破坏 tool-use/result 配对；model-only 还通过清空 `tools` 改变请求前缀。

### 目标

Capability 最终失败必须落入以下唯一处置：

| 最终事实 | 自动同参重试 | 普通 Agent | Workflow |
|---|---:|---|---|
| `UNAVAILABLE` 或 `TIMEOUT`，且 `safeError.retryable=true`、`replayPolicy=IDEMPOTENT` | 在当前逻辑调用声明的重试上限内；未声明时至多一次 | 只消费最终结果；耗尽后允许模型选择其他动作 | 节点 retry 只约束调用边界内的重试次数；只消费最终结果并进入显式 `exception` |
| 输入校验、业务 `NOT_FOUND` 或 `CONFLICT` | 否 | 向模型反馈完整、可操作的错误，由模型决定下一步 | 进入显式 `exception` |
| `CAPABILITY_OUTPUT_INVALID` | 否 | 向模型反馈完整错误，明确说明原样调用不能解决问题，并允许缩小或调整请求、改用其他 Capability 或结束 | 进入显式 `exception` |
| 普通 `AUTHORIZATION`、`POLICY_DENIED`、未知 `INTERNAL` 或结果未知 | 否 | 向模型反馈安全失败结果，由模型决定下一步 | 进入显式 `exception`；结果未知不得自动重放 |
| `safeError.category=CANCELED` | 否 | 取消当前请求 | 立即中断，不进入 `exception` |
| 达到 `maxTurns` | 不适用；禁止继续执行 Tool | 追加且仅追加一次 `toolChoice=NONE` 的模型收尾轮；成功总结后正常完成，收尾调用失败或没有可用文本时安全失败 | 不适用 |
| 单轮 Tool calls 超过 `maxToolCallsPerTurn` | 不适用 | 只接纳有界前缀并按统一 preflight、治理、执行和配对规则处理；超限尾部不保存、不执行，反馈数量和拆分建议后继续普通 loop | 不适用 |

自动同参重试和模型恢复是两个独立概念：`safeError.retryable` 只表达执行边界能否安全重放当前调用；`CAPABILITY_OUTPUT_INVALID` 的 `retryable=false` 不阻止 Agent 让模型选择不同参数或不同 Capability。

所有非取消的最终失败反馈给模型时，`safeError.message` 必须包含领域事实和可操作的下一步建议，不能只表达失败本身。模型选择的每个后续调用仍重新经过既有 authority、risk policy 和 sandbox 边界；失败反馈不授予权限，也不能绕过这些边界。

授权必须按控制事实而不是错误外形区分：只有 risk policy 明确返回 `REQUIRE_AUTHORIZATION` 时才进入 runtime-owned `AUTHORIZATION` pending-input 生命周期；普通 `AUTHORIZATION` SafeError，以及 error code、message 或 `safeDetails` 中携带的授权提示，都只是最终失败信息，必须按一般错误反馈模型。Lifecycle hook 的 `PEND`、`DENY` 和 `BLOCK` 同样只按显式控制结果保留既有生命周期。

相同最终失败可以在同一请求内多次反馈模型。Agent loop 不建立重复错误 fingerprint、独立错误次数阈值或 `CAPABILITY_REPEATED_FAILURE` 终止；模型选择再次调用仍需重新通过全部治理边界，并受 canonical `maxTurns` 与每轮 `maxToolCallsPerTurn` 约束。`safeError.retryable=false` 只禁止执行器自动原样重放，不禁止模型在读取失败后显式选择同一 Capability。达到 `maxTurns` 只终止 Tool 执行权，不跳过模型收尾：系统保留原 `tools` descriptor 集合，以 effective `toolChoice=NONE` 最多再调用模型一次。该轮返回的 Tool call、terminal hook 新增的 Tool call 或其他 Tool 执行请求都不得执行。

Capability 失败结果必须通过 `CapabilityInvocationResult.safeError?: SafeError` 统一表达。本 change 收紧 status/`safeError` 组合、执行边界校验和消费行为，使所有调用方只依赖同一个最终失败对象。

## What Changes

### 变更范围

- 覆盖全部 runtime Capability 类型：Tool、Skill、Agent。
- 覆盖生产装配可注册的全部 20 个 first-party Tool：19 个模型可见 Tool 和隐藏的编排专用 `ApiCall`；CLIP、Plugin 等扩展 Tool 遵守相同公共失败边界。
- 逐个闭合全部 first-party Tool 的 descriptor/availability、公共 schema、本地语义、依赖/context/authority、下游业务结果、取消/超时/结果未知、结果/output 和未知异常出口。
- 参数校验在当前阶段收集全部可独立判断的违规；完整安全诊断不超过统一的 `256000` UTF-16 code unit 单结果容量时全部返回，超过容量时明确返回容量错误而不截断；`safeError.message` 说明失败阶段和下一步，`safeError.safeDetails.violations` 说明字段、约束和期望形态，不回显非法原值。
- 仅因修改参数即可满足约束的拒绝使用 `VALIDATION + retryable=false`，不得伪装成权限或策略拒绝。
- 已安全化的业务错误保持原 code、category、message、retryable 和 safeDetails；未知异常使用稳定安全错误，非法输出使用 `CAPABILITY_OUTPUT_INVALID + VALIDATION + retryable=false`，不得暴露非法输出。
- `DEGRADED` 保留为公共兼容状态，但仅表示 owning Capability 声明的复合目标中至少一个可独立使用的子结果已经成功、同时至少一个已声明子结果缺失或失败；单一动作已经产生明确结果、合法空结果、受声明上限截断的结果和协议控制结果均不得仅因“不完整”返回 `DEGRADED`。没有可用结果时使用 `FAILED`、`TIMED_OUT` 或取消结果。
- 最终结果的业务 payload 具有固定语义：`SUCCEEDED` 必须是通过 output schema 的合法最终结果，可以是合法空结果、受声明上限截断的结果、非零进程退出结果或协议控制结果；`DEGRADED` 必须包含通过 output schema 的可独立使用子结果，并明确缺失子结果；`FAILED`/`TIMED_OUT` 在没有安全可用业务结果时必须使用空对象，仅显式声明的安全部分结果或恢复事实允许非空，且非空时同样必须通过 output schema。失败原因、分类和恢复建议只位于 `safeError`，不得为满足 output schema 构造伪业务 payload。
- `fallbackTriggered` 只表达执行路径确实触发 fallback，与最终 status 正交：fallback 产生 owning Capability 声明的合法最终结果时为 `SUCCEEDED`，只得到可独立使用的复合子结果时才为 `DEGRADED`，fallback 失败或超时时分别为 `FAILED` 或 `TIMED_OUT`。系统不得仅因触发 fallback 改变结果状态。
- 同一次逻辑 Capability 调用可以声明 `0` 到 `5` 次额外自动重试；未声明时默认重试一次，因此默认总调用次数最多为两次。统一执行边界收到非整数、负数、非安全整数或大于 `5` 的值时采用 try-best 策略，将 effective `maxRetries` 统一归一化为 `0`，仍执行初始 attempt，但不自动同参重试，也不单独返回配置失败。`CapabilityInvocationRequest.timeoutMs` 是每次 execution attempt 的完整超时预算，每次 retry 使用相同的原始值；父 `AbortSignal` 控制整次调用所属请求或 Workflow 的取消，已取消时不得启动或继续重试。
- 普通 Agent 只消费最终结果：所有非取消的最终失败（含普通 `AUTHORIZATION`、`POLICY_DENIED`、`INTERNAL`、`CAPABILITY_RESULT_UNKNOWN`）都以完整安全结果进入下一模型轮次；相同 capability + 相同参数可以再次失败并继续由模型决策，直到模型结束、显式控制/取消发生或达到 canonical `maxTurns`。只有 risk policy 明确返回 `REQUIRE_AUTHORIZATION` 才进入授权 pending control。
- Agent runtime settings 使用 `maxTurns`（缺省 `50`）作为一个 accepted `RequestRun` 的唯一 logical loop-count 上限。pause、resume 和 crash recovery 保持同一 turn coordinate；普通 turns 达到上限时系统不直接抛出 `TOOL_ROUND_LIMIT_EXCEEDED` 结束 request，而是保留对应 degradation fact，向模型提供安全总结指令，以 effective `toolChoice=NONE` 执行且仅执行一次最终收尾轮。
- Agent runtime settings 使用 `maxToolCallsPerTurn`（缺省 `30`、有效域 `1..100`）作为唯一单轮 Tool-call admission limit。该名称计数的是模型返回的 Tool call，而不是不同 Tool 名称；它表示最多有多少调用可进入受治理调用流程，不保证每个调用最终执行成功。非流式模型返回超限 calls 时只保存顺序前缀并按统一 preflight、治理、执行和配对规则处理；尾部不保存、不执行、不生成 synthetic result。前缀结果闭合后向模型反馈 requested/admitted/omitted counts 并继续普通 loop，不使用局部 recovery counter 或 `MAX_TOOL_CALLS` finalization。
- `executionMode=model-only` 从首次模型调用起使用 `toolChoice=NONE` 并保留 Tool descriptors；request `maxToolCalls`、assembly `maxToolIterations`、planning-hook `maxRounds/maxCalls`、read-only/side-effecting per-round limits 和 `toolCallLimitRecoveryLimit` 从目标 contract 删除。
- 模型推理公共选项增加 provider-neutral `ToolChoice = 'AUTO' | 'NONE' | 'REQUIRED'` 和 `ModelInferenceOptions.toolChoice?: ToolChoice`；类型名不得带 `Model`。profile、Prompt Template、受治理 Skill patch、可信 request 和 governed Hook 使用同一个选项及固定覆盖顺序；model-only/finalizing 的 effective value 必须为 `NONE`，同时保留 Tool descriptors，且任何违规返回的 Tool call 都不得执行。首版不支持指定单个 Tool 的 choice object。
- 失败与成功使用同一种 `CAPABILITY_RESULT`、同一个 `256000` UTF-16 code unit 单结果容量和大结果转储能力；容量内的完整诊断不得截断或省略，超过容量时返回显式容量错误。
- 普通 governed 调用只交付一个通过公共输入、输出、结果形状和容量约束的最终结果；不引入总 deadline，每次符合安全门禁的 retry 继续获得原始完整 `timeoutMs`。
- 定向 Skill 和隐藏 `ApiCall` 直接路径消费相同最终错误契约，但没有普通 Agent 的模型恢复轮次。
- Workflow Capability 调用不执行第二层自动重试；除取消和 Recipe 已显式消费的 poll/batch 单项失败外，全部最终失败进入当前节点显式 `exception`，无匹配分支则 Workflow 失败。

### 非目标

- 不修改 Recipe 可见 `error` 变量的字段结构。
- 不扩展公共错误词汇、Workflow retry 配置形态、认证获取流程或持久化 schema；只让既有 Workflow retry 次数约束进入统一 Capability 调用边界。
- 不修改 Model Provider retry/fallback、Gateway 通用重试或 Capability replay eligibility；durable recovery 只在 `RequestContext` 与对应 checkpoint 增加同一个 `agentTurnIndex`。
- 不删除、重命名或重新定义 `modelParams` 的 Workflow 透传语义；`toolChoice` 只作为 additive canonical 字段加入，`modelParams` 中与它规范化同名的 key 必须拒绝，其他字段保持其 owning contract 定义的行为。
- 不在本 change 实现 Tool call 流式到达即执行；未来 change 必须另行定义 stream admission、并发、取消、恢复和 durable transcript sealing。本 change 只固定可复用的顺序前缀接纳语义。
- 不删除或重命名公共 `DEGRADED`、`fallbackTriggered` 字段，也不删除调用方的兼容消费分支；本 change 只收窄 first-party producer 的状态判定。
- 不改变合法空结果和 pending-input 生命周期本身；只纠正它们的 Capability-level 状态表达。
- 不新增 fallback 编排、选择器或 producer；只治理既有 `fallbackTriggered` 字段被使用时的结果语义。
- 不仅根据 `NON_IDEMPOTENT`、timeout 或断连推断结果未知；结果未知必须由执行事实 owner 明确声明。

## Capabilities

### Feature 影响

#### 修改的 Features

- `F-2.6 指定技能处理`：定向 Skill 使用统一最终错误并确定终止。
- `F-2.1 提交请求`：request routing constraints 删除 `maxToolCalls`，model-only 继续作为 request-scoped 收窄约束。
- `F-3.1 装配智能体`：runtime settings 使用 `maxTurns` 和 `maxToolCallsPerTurn` 两个 canonical limits，并在启动期校验。
- `F-3.3 工具循环失败保护`：Agent 区分执行器重试、模型恢复、`maxTurns` 收敛、`maxToolCallsPerTurn` 前缀接纳、显式生命周期控制和取消，不再因重复错误或 Tool-call 超限替模型终止。
- `F-4.1 接入多种模型`：统一模型选项增加 provider-neutral `toolChoice`，由 profile、调用覆盖和 Hook 按固定优先级生效并映射到 selected provider。
- `F-4.3 自动管理上下文窗口`：Context Engine 在不清空 Tool descriptor 的前提下合并 request-local `toolChoice` patch。
- `F-5.1 统一能力治理`：Tool、Skill、Agent 使用统一失败结果、完整诊断和单一自动重试规则。
- `F-5.2 文件操作工具`：Read Tool 的受控路径、分页、容量和安全失败从 legacy kernel 迁入 Function 主规格。
- `F-5.6 Skill 系统`：Skill metadata 的 canonical model options 增加 `toolChoice` patch。
- `F-5.4 向用户提问`：AskUserQuestion 使用完整参数诊断；全部非取消失败进入模型，合法调用继续创建 pending input。
- `F-5.3 命令执行工具`：Bash 可修改的命令格式错误使用输入校验语义；正常完成的非零进程退出始终保持 `SUCCEEDED` 结构化结果，不因 stdout/stderr 是否为空改变 Capability status；Python guard 返回 `/code` violation，缺失 sandbox/context 或 sandbox result 无效时使用标准 internal，timeout 保留安全部分输出且不自动重试。
- `F-5.7 知识检索`：RAG 区分合法零命中、无结果失败和部分降级。
- `F-8.2 长期记忆`：memory Tool 使用统一 outer safe error、大结果转储和写入结果核验。
- `F-9.1 执行工作流`：Workflow 对 Capability 最终失败只执行显式 exception，不执行第二层重试；合法 `WAITING` pending control result 使用 `SUCCEEDED`，无可用 pending context 时失败。
- `F-9.2 工作流节点`：全部 Capability 调用节点保留并上升统一最终错误。
- `F-10.1 扩展生命周期钩子`：`BEFORE_MODEL_INVOKE` mutation 可以按 canonical schema 覆盖 `toolChoice`；`BEFORE_PLANNING` 不再提供 loop-limit mutation。
- `F-10.4 自定义工具与提示词`：Prompt Template `modelOptions` 可以声明 `toolChoice`。
- `F-11.1 重启恢复运行`：`RequestContext` 与 checkpoint 保持 `RequestRun` 的同一个 logical Agent turn coordinate，恢复不能重置 `maxTurns` 或重复 finalizing。

### Function 影响（OpenSpec Capabilities）

#### 新增 Functions

无。

#### 修改的 Functions

- `FN-5.2 调用能力` → canonical spec `capability-catalog`
  - 修改公共失败结果、完整参数诊断、安全错误保真、输出无效语义、`DEGRADED` 窄化语义、fallback metadata 正交语义、统一自动重试和全部 first-party Tool 失败闭包；`workflow-agent-loop-tool` 是本次迁移 Workflow Tool 入口与结果映射的 legacy source spec。
  - 系统质量属性：性能/容量、安全。
- `FN-3.4 工具循环失败保护` → canonical spec `tool-loop`
  - 修改模型恢复、输出无效恢复、`maxTurns` 单次无工具模型收尾、`maxToolCallsPerTurn` 顺序前缀接纳、显式授权/生命周期控制和取消边界；移除重复失败终止、Tool-call recovery 终止与达到 turn 上限直接失败。`ts-minimal-agent-kernel / 最小 Capability Tool 集合` 整条退出，仍有效行为迁入对应主规格。
- `FN-3.2 编译智能体装配` → canonical spec `agent-package-assembly`
  - 把 runtime settings 的 loop limits 收敛为 `maxTurns`（缺省 50）和 `maxToolCallsPerTurn`（缺省 30、有效域 1..100），启动期拒绝非法显式值。
- `FN-2.1 提交请求` → canonical spec `routing-constraint-validation`
  - 从 request-carried `RoutingConstraints` 删除 `maxToolCalls`，保留 `executionMode=model-only` 作为禁用 Tool 的 request-scoped 收窄约束。
- `FN-4.1 调用模型` → canonical spec `model-invocation-contract`
  - 为 `ModelInferenceOptions`、profile、resolved configuration 和 invocation request 增加 canonical `toolChoice`，固定缺省、覆盖顺序、校验和 selected-provider 映射。
- `FN-4.3 装配上下文` → canonical spec `context-engine`
  - 把 `toolChoice` 纳入 provider-neutral model option merge，并允许受治理 request-local patch 影响同一 request/run 的后续模型调用。
- `FN-5.6 向用户提问` → canonical spec `ask-user-question-tool`
  - 修改 AskUserQuestion 参数诊断和最终失败反馈；移除独立纠错次数与相同失败终止阈值。
- `FN-2.6 指定技能处理` → canonical spec `targeted-skill-routing`
  - 修改定向 Skill 对统一最终失败的消费和终止行为。
- `FN-2.8 指令定向请求处理` → canonical spec `directive-capability-routing`
  - Web submit 的非目标 routing constraints 复用同一 closed allow-list，不再接收 Tool-call 数量预算。
- `FN-9.4 执行能力节点` → canonical spec `workflow-capability-nodes`
  - 修改全部 Workflow Capability 调用点的最终失败上升行为。
- `FN-9.7 执行模型节点` → canonical spec `workflow-llm-nodes`
  - 修改 `DATA_ANALYSIS` Python Capability 子调用的最终失败行为。
- `FN-9.1 执行工作流` → canonical spec `workflow-contracts`
  - 修改 Capability 失败与节点 retry、显式 exception 的关系；`NODE_WAITING` timeline 投影为 `SUCCEEDED + WORKFLOW_NODE_WAITING` 控制结果；`workflow-execution-engine` 是本 change 触及的 legacy source spec。
  - 系统质量属性：可靠性/恢复。
- `FN-5.5 执行命令和脚本` → canonical spec `command-script-tools`
  - 修改 Bash 可纠正命令格式错误的分类、完整 violations 和安全 message，并把所有正常完成的非零进程退出统一映射为 `SUCCEEDED`；Python guard 返回 `/code` violation，缺失 sandbox/context 或 sandbox result 无效时使用标准 internal，timeout 保留安全部分输出且不自动重试；`bash-tool` 与 `python-tool` 是本次迁移的 legacy source specs。
- `FN-5.3 读写编辑文件` → canonical spec `file-operation-tools`
  - 承接 legacy kernel 中 Read Tool 的 workspace-relative path、分页、容量和 safe failure 黑盒行为。
- `FN-5.9 调用技能` → canonical spec `skill-tool`
  - `SkillMetadata.modelOptions` 与 Capability context patch 同形增加 canonical `toolChoice`。
- `FN-5.13 检索知识库` → canonical spec `rag-tool`
  - 修改 RAG 的合法空结果、无结果失败和部分降级边界。
- `FN-8.2 检索和写入记忆` → canonical spec `memory-tools`
  - 修改 memory Tool 的 outer safe error、大结果转储和只读重试；`add_memory` 保持 `NON_IDEMPOTENT` 且不增加未经 owner 事实支持的结果未知出口。
- `FN-10.1 注册和执行钩子` → canonical spec `lifecycle-hook-execution`
  - 把 `toolChoice` 纳入 `BEFORE_MODEL_INVOKE` 的封闭 mutation contract，并从 `BEFORE_PLANNING` closed schema 删除 `maxRounds/maxCalls`。
- `FN-10.4 自定义工具和提示词` → canonical spec `prompt-template-assembly`
  - 把 `toolChoice` 纳入 Prompt Template 的封闭 `modelOptions` handoff。
- `FN-11.1 恢复运行状态` → canonical spec `local-runtime-recovery`
  - `RequestContext` 与 checkpoint 只增加同一个 `agentTurnIndex`，turn checkpoint 的幂等语义区分该 index；pause/resume/recovery 复用同一 `RequestRun` 计数，finalizing 由 `index=maxTurns` 推导。

## Impact

- Capability 开发者继续生产 `CapabilityInvocationResult.safeError`，但所有生产方必须满足同一严格状态组合、完整安全消息和统一执行边界。
- 可信 Capability 调用方可以在 `0` 到 `5` 的有效域内限制同一次逻辑调用的额外自动重试次数；未声明时使用一次重试的统一默认值，非法值统一按 `0` 次重试执行初始 attempt。
- Agent loop、定向 Skill、隐藏 ApiCall 和 Workflow 消费同一最终 `code/category/message/retryable/safeDetails`，并分别执行模型恢复、终止、取消或显式 exception。
- 模型一次获得当前校验阶段的全部安全违规；大型诊断通过既有结果转储和回读协议提供。
- 20 个 first-party Tool 的每个实际失败出口都有确定 status、safeError 和 message 语义；新增 Tool 或新增失败出口必须进入同一闭包验收。
- public `DEGRADED` 枚举保持兼容，但 first-party producer 只在声明的复合目标发生可用部分成功时生产；Bash 非零退出、Workflow `WAITING` 和 fallback 触发本身不再伪装为降级。
- 所有非取消的最终失败都反馈给模型并附带可操作的 `safeError.message`；普通授权错误与显式 `REQUIRE_AUTHORIZATION` 控制严格分离；相同失败不触发局部终止，loop 仅由 `maxTurns`、显式控制、取消或模型结束收敛。
- 达到 `maxTurns` 后不再直接失败：系统最多追加一次无 Tool 执行权的模型收尾并保留原 Tool descriptor；成功文本成为最终答复，取消、收尾模型失败或无可用文本仍保持真实失败/取消终态。
- 单轮超过 `maxToolCallsPerTurn` 时只保存顺序前缀并按统一 preflight、治理、执行和配对规则处理，超限尾部不进入 canonical transcript，模型获得明确的 requested/admitted/omitted feedback 后继续 loop；不存在 Tool-call recovery counter 或 Tool-call terminal reason。
- 本 change 涉及模型推理选项、Agent runtime settings、request routing constraints、planning Hook 和运行恢复坐标三组 frozen public contract refinement。实施前必须完成群内确认；`ToolChoice` 首版只支持 `AUTO | NONE | REQUIRED`，不增加 named-tool choice。
