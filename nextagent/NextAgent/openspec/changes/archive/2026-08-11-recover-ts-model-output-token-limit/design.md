## 设计范围

| Function | 目标变化 | delta spec | 设计章节 |
|---|---|---|---|
| `FN-4.1 调用模型` | 恢复 `finishReason="length"`，并在 direct model 可见文本超过硬上限时交付带标记的有界前缀 | legacy `ts-minimal-agent-kernel`；归档时收敛到 canonical `model-invocation-contract` | “设计决策”D1-D6 |

### 背景和现状

`agent-model` 已把 provider 原始停止原因归一化为 `ModelFinishReason`，其中 `length` 表示输出长度或 Token 预算耗尽。`DefaultAgent.executeRun()` 当前在每个 model round 中构造 `ModelInvocationRequest`，通过 `RunBoundModelInvocation.stream()` 发布模型调用生命周期和可见内容，然后只对 `safeError` 做 fallback；非错误的 `length` 会继续走无 Tool call terminal 路径，因此被截断文本可成为成功回答。

当前已有边界可以承载恢复而无需修改公共 contract：

- `ModelInvocationRequest.maxOutputTokens` 可做 provider-neutral 单次调用覆盖。
- `ModelFinalResult.finishReason`、`usage.inputTokens` 和 `ContextAssembly.modelConfiguration.contextWindowTokens` 可用于识别截断与约束恢复预算。
- `ModelMessage` 可承载 request-local assistant 段和隐藏恢复指令。
- `LLM_CONTENT_DELTA` 是累计快照，channel 标记 `metadata.accumulated=true`；同请求重试可用新候选快照替换已流出的截断候选，续写可输出已确认前缀加当前增量。
- `RunBoundModelInvocation` 已为每次实际 provider 调用发布 started/completed/failed timeline 事实并传播 `AbortSignal`。
- runtime terminal 可见内容硬上限已为 `150000` 个 UTF-16 code unit，但 direct model guard 仍为 `16384` 个 UTF-16 code unit，会使提升后的 Token 预算在到达 provider 上限前先失败。

恢复策略属于 Agent 内部 model orchestration，因此主 owner 必须保持为 `agent-core`；`agent-model` 继续只负责 SDK 映射和归一化，runtime 不参与业务恢复决策。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 把 `finishReason="length"` 从错误的成功终态改为受限、可取消、可诊断的恢复流程。
- 首先用更大输出预算重试同一请求，避免不必要的多轮续写；仍超限时最多续写 3 次。
- 保证恢复只形成一个最终 assistant 回答，不持久化中间 assistant 段或隐藏指令。
- 保持 Tool call pairing、fallback 可见输出保护、terminal commit 和硬容量上限不变量，并在硬容量保护触发时保留仍可安全交付的 provider-neutral 文本前缀。
- 不修改公共 contract、配置 schema、provider adapter 或 Web stream schema。

**非目标：**

- 不处理任何模型家族的 thinking/reasoning 标签、内容分离或 provider-specific stream 行为。
- 不修改默认 model profile、开放 request-scoped `maxOutputTokens` 配置或增加模型能力注册表字段。
- 不对 content-filter、unknown、error、timeout、context overflow 或普通 provider error 增加新的 retry 策略。
- 不跨 request、进程重启或 runtime checkpoint 恢复未完成的 output continuation。
- 不允许 `length` 结果中的 Tool call 进入 capability execution。

## 设计决策（Decisions）

### D1. 在 agent-core 内使用单一模型路由执行器

`packages/agent-core/src/model/model-output-recovery.ts` 只包含恢复常量、预算计算、request-local 消息构造和累计文本组合；私有 `model-route-execution.ts` 统一拥有单个模型路由内的实际调用、stream projection、reasoning-only correction、输出恢复和硬字符上限投影。`DefaultAgent` 只编排 model turn、cross-model fallback、terminal 和 Tool loop 分流。两个 helper 均不成为 package public export，不新增公共 interface、strategy 或 factory。

每个 model route 只创建一个恢复状态：当前请求、已确认文本前缀、是否已预算提升、续写次数以及该 route 是否已经产生可见输出。状态在切换 fallback model 或进入下一个 Tool round 前销毁，恢复调用不消耗 `maxToolIterations`。

放弃把恢复放进 `agent-model`：adapter 不应决定 Agent 是否续写、如何拼接历史或何时 terminal。放弃把恢复建成 runtime retry：runtime retry 表达整个 RequestRun 的重新执行，会重放上下文与 Tool 生命周期，语义和成本都不同。

### D2. 首次 length 只重试同一请求一次

首次 `length` 后按以下唯一顺序计算恢复预算：

1. 原请求存在 `maxOutputTokens` 时取 `原值 × 8`，否则取 `32000`。
2. 上限固定为 `32000 tokens`。
3. 输入估算优先使用该结果的 `usage.inputTokens`；同时存在 `ContextCompactionPlan.estimatedFinalInputUnits` 时取两者较大值，避免低估。两者都不存在时，把 `contextWindowTokens` 的 25% 作为最大恢复输出窗口。
4. 最终值取候选值、固定上限和 `contextWindowTokens - inputEstimate` 的最小正整数。
5. 只有最终值严格大于原显式值时，才用完全相同的 messages/tools/options/route 重试；否则直接进入续写阶段。

默认 profile 的 `2048` 因而提升为 `16384`。固定 `32000` 而不是 provider-specific 最大值，是因为当前 contract 没有模型最大输出能力字段；该值同时处于默认 `128000` 上下文窗口和 `150000` 个 UTF-16 code unit 平台输出保护范围内。未来若要使用模型能力注册表，应另建 contract refinement change。

同请求重试不会把首次截断文本加入 messages。stream 仍使用原 `stepId` 输出累计候选快照；新重试的首个快照开始替换旧候选，最终只把重试结果作为候选文本。

### D3. 预算提升仍超限时使用 request-local continuation

预算提升结果仍为纯文本 `length` 时，将该段加入 `confirmedContent`，并在下一请求的 messages 末尾追加：

1. `ASSISTANT` 文本消息：刚刚被截断的段；
2. `USER` 文本消息：固定隐藏语义“直接从截断处继续，不道歉、不复述，必要时拆小剩余内容”。

每次续写若仍为纯文本 `length`，重复以上追加，最多 3 次。续写期间继续使用已提升的输出预算；没有可提升预算时沿用原请求预算。stream 内容为 `confirmedContent + currentAttemptContent` 的累计快照，因此用户看到一个连续回答。恢复消息只存在于内存中的 `ModelInvocationRequest.messages`，不调用 `AgentRunStatePort.appendMessage()`。

第 3 次续写仍为 `length` 时，发布 `DEGRADATION_NOTICE(code=MODEL_OUTPUT_TOKEN_RECOVERY_EXHAUSTED)` 并抛出 non-retryable `AgentError(category=UNAVAILABLE)`；runtime 按现有路径形成 safe `REQUEST_FAILED`，不提交 partial terminal message。

### D4. length 与 Tool call 的组合 fail closed

`length` 表示 provider 已声明输出不完整；其中 Tool call 的参数或批次可能缺失。任何 `length` 结果携带 Tool call 时均不得执行。首次调用命中该组合时仍允许一次同请求预算提升，因为完整重试可能得到合法 Tool call；提升后或续写阶段再次出现该组合，则发布 `MODEL_OUTPUT_TOKEN_RECOVERY_UNSAFE_TOOL_CALL` 并安全失败。

续写阶段即使以非 `length` 结束但返回 Tool call，也安全失败：此前 request-local assistant 文本没有持久化，直接进入既有 Tool loop 会破坏后续 model context 的消息事实一致性。本 change 只恢复 text-only terminal output。

### D5. fallback、取消和可见输出使用聚合事实

同一 model round 的 `hasVisibleOutput` 在原调用、预算提升和续写之间累计，不在每次 provider 调用前清零。任何恢复调用返回 `safeError` 时，现有 `ModelFallbackOrchestrator` 必须看到该聚合事实；只要已流出任一候选内容，就继续禁止切换 fallback profile，避免把不同模型输出拼成一个回答。

所有调用复用当前 `AbortSignal` 和 timeout。取消会由当前 `RunBoundModelInvocation` 失败路径传播，循环不捕获为恢复条件，不再发起下一次调用。

### D6. direct model 硬字符上限对齐 runtime，并保留有界输出

`maxModelVisibleChars` 从 `16384` 调整为 `150000`，与 runtime `maxTerminalMessageChars` 对齐。每个 stream snapshot 和 `confirmedContent + currentAttemptContent` 都在投影前检查该上限。未超过时沿用普通累计快照；首次超过时，Agent Core 立即终止当前 provider stream，不再进入 Token 恢复、cross-model fallback 或模型 Tool call 分支，并发布一次 `DEGRADATION_NOTICE(code=MODEL_TEXT_LIMIT_EXCEEDED)`。

容量保护使用唯一的有界投影规则：从已经通过 provider-neutral normalization 的累计文本中保留顺序前缀且不拆分 UTF-16 surrogate pair，必要时闭合末尾未闭合的 Markdown code fence 或 table row，最后追加固定标记 `[Model output truncated at the 150000-character safety limit.]`，并保证完整 terminal content 不超过 `150000` 个 UTF-16 code unit。该标记使有界内容不会被误解为完整回答；超过容量的后缀不进入 stream、history、SafeError 或任何观测面。降级后的有界内容通过普通 terminal commit 成为唯一 assistant message，请求以 `REQUEST_COMPLETED` 结束；`DEGRADATION_NOTICE` 只携带稳定 code，不携带模型文本。

该路径不放宽硬上限，也不把截断实现为 provider retry 或第二套 terminal protocol。stream callback 只用一个内部限额信号停止继续聚合；同一 model route executor 在捕获该信号后投影有界累计快照，并把结果作为显式的内部 `OUTPUT_TRUNCATED` 分支交回 Agent loop。若超限只在 provider final result 或 governed model hook 替换后的 content 中被发现，同一投影规则直接处理该 final content。两条路径最终都进入同一个 terminal commit，不伪造 `ModelFinalResult`。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 恢复只复制已在当前可信调用中的 provider-neutral request；不读取客户端 override，不改变 Agent/Owner Scope；硬字符上限只保留有界 provider-neutral 前缀，超限后缀、未完整 Tool call 和 raw provider payload 不进入公开边界；降级事件不携带输出 | 聚焦 negative test、语义 code review、现有安全/contract 测试 |
| 性能/容量 | 最坏增加 1 次同请求重试和 3 次续写；单轮固定最多 5 次 provider 调用；恢复预算最多 `32000 tokens`，可见文本最多 `150000` 个 UTF-16 code unit，无无界数组或持久化增长 | 调用次数、预算值、字符上限单元测试；全量测试 |
| 可靠性/恢复 | 只在明确 `length` 时恢复；正常 stop 不增加调用；耗尽和 unsafe Tool call fail closed；取消立即终止；字符上限触发时只提交一个带截断标记的有界 terminal assistant message | agent-core characterization tests、取消测试、terminal outcome 断言 |
| 可维护性 | owner 保持 agent-core；纯 helper 封装预算和消息构造，私有 route executor 封装单路由状态，DefaultAgent 只编排 model turn/fallback/terminal/Tool loop；无公共 contract、配置或 provider 分支 | architecture lint、代码审查、helper unit tests |
| 可测试性 | 使用 deterministic `ModelInvocationService` 按序返回 finish reason，可精确断言请求参数、messages、调用次数、事件和 terminal 结果 | `packages/agent-core/tests/model-output-recovery.test.ts` |
| 审计/可追溯性 | 每次调用沿用 `RunBoundModelInvocation` 生命周期事件；调用事实包含 safe model option summary，降级事件只记录稳定 reason code 且不含输出 | timeline assertions 与安全审查 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `length` 不得直接 terminal success | 2.1、3.1 | 正常截断行为测试断言无 partial terminal commit |
| `2048 -> 16384` 同请求提升且只重试一次 | 1.1、2.1、3.1 | 捕获 `ModelInvocationRequest` 并断言 messages/tools 不变、预算变化 |
| 最多 3 次续写并按序拼接 | 1.2、2.2、3.2 | 续写成功与第 3 次耗尽用例 |
| 恢复消息 request-local 且不持久化 | 2.2、3.2 | model request messages 与 session message store 双向断言 |
| length Tool call 不执行 | 2.3、3.3 | capability invocation count 为 0 的 negative test |
| 取消传播且无后续调用 | 2.4、3.4 | AbortController characterization test |
| `150000` 个 UTF-16 code unit 硬上限有界交付 | 2.5、2.6、3.5 | output guard 边界、超界前缀保留、固定标记、后缀不泄漏和 terminal 一致性测试 |
| 不修改公共 contract/provider ownership | 4.1 | `npm run test:contract`、`npm run lint:architecture`、语义 code review |
| change 与基线一致 | 4.2 | `openspec validate --all --strict`、`nextagent-skill-review` |

## 文档承载决策（Documentation Ownership）

- 行为契约：当前 active delta 仍位于 legacy `ts-minimal-agent-kernel`；`refine-openai-compatible-model-adapter` 已于 2026-08-02 完成 canonical contract 迁移，本 change 归档前 MUST 把 delta 原子迁入 `FN-4.1 调用模型` 的 `model-invocation-contract`，不得在两个 stable specs 保留竞争定义。
- 架构和跨模块设计：无新增主承载；`model-provider-boundary.md` 继续说明 provider 只归一化 finish reason。
- 模块设计：`openspec/designs/modules/agent-core.md` 主承载恢复 owner、调用顺序、request-local continuation 和 fallback/Tool loop 边界。
- ADR：无；未改变长期技术栈、公共 contract 或 owner。
- 导航：`openspec/designs/spec-to-design-map.md` 在归档前更新验证入口。

## 风险与取舍（Risks / Trade-offs）

- [恢复增加延迟与模型成本] -> 严格限制为一次预算提升加最多 3 次续写，只在 provider 明确返回 `length` 时触发。
- [通用模型可能不支持 `32000` 输出] -> 实际目标受上下文剩余窗口约束；provider 拒绝时沿用现有 safe error，不猜测 provider-specific 能力。当前不扩展公共 profile contract。
- [同请求重试或字符上限投影会替换已经流出的候选文本] -> 使用既有累计快照语义，避免重复拼接；字符上限路径只提交带固定标记的有界候选。
- [续写内容可能重复少量边界文本] -> 固定指令要求从截断处直接继续；不引入启发式文本去重，避免误删电信标识、数值或配置行。
- [text-only 限制不能恢复不完整 Tool call] -> 明确 fail closed，优先保证 Tool 参数完整性和副作用安全。

## 迁移计划（Migration Plan）

本 change 无数据迁移和配置迁移。代码发布后新请求自动获得恢复行为；在途请求继续由旧进程完成。回滚只需回退本 change 的 agent-core 代码与 active OpenSpec，不涉及数据库或消息格式回滚。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/model-invocation-contract/spec.md`：纳入 Token 上限恢复、硬字符上限有界交付和恢复耗尽的安全失败语义。
- `openspec/specs/ts-minimal-agent-kernel/spec.md`：移除与 canonical contract 竞争的 legacy 输出超限定义，保留未触及的 terminal consistency 行为。
- `openspec/overview.md`：增加输出 Token 恢复能力的简短背景与导航。
- `openspec/designs/modules/agent-core.md`：提炼 D1-D6 中长期成立的 owner、恢复顺序和边界。
- `openspec/designs/functions/D4-模型与上下文/D4.1-模型调用与降级/FN-4.1-调用模型.md`：更新输出恢复、容量降级结果和量化指标导航。
- `openspec/designs/architecture/model-provider-boundary.md`：无需修改规范事实；归档审查时确认 finish reason normalization 与 core recovery owner 没有漂移。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：加入受影响测试和设计导航。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-4.1-调用模型` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**canonical model contract 迁移已完成；下一步把本 change 的 delta Requirement 迁入并合并至 `openspec/specs/model-invocation-contract/spec.md`，同时从 `openspec/specs/ts-minimal-agent-kernel/spec.md` 移除竞争的 legacy 输出超限定义。逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata，不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-08-02 更新）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**前置 canonical contract 迁移已经完成，但本 change 的 delta 仍以 legacy `ts-minimal-agent-kernel` 为临时 target；此时归档仍会把同一行为固化到两个 stable specs。
- **解除条件：**把本 change 的 delta target 原子迁移到 `model-invocation-contract`，并确认 `ts-minimal-agent-kernel` 不保留竞争定义；随后逐 Requirement 核对 Function、stable target、长期设计、正文、元数据和 Scenario 后重新执行 archive。
