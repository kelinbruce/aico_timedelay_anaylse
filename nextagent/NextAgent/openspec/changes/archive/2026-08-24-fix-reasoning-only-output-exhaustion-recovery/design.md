## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-4.1 调用模型` | reasoning-only 输出耗尽先收敛、重复耗尽再 fallback 或安全失败，普通不完整输出路径不变 | `model-invocation-contract` | `FN-4.1 调用模型` |
| `FN-10.13 HarnessBench 评测` | 报告独立标记 reasoning-only 输出耗尽，并提供 `021`、`037` 固定非计分回归 | `harnessbench-evaluation` | `FN-10.13 HarnessBench 评测` |

## `FN-4.1 调用模型`

### 目标与规范依据

本 Function 需要以最小额外调用打断已经耗尽输出预算的纯 reasoning 发散，同时保持普通文本超限、残缺 Tool call、fallback、取消和字符硬上限的既有黑盒行为。

#### 本 Function 的目标 Requirements

canonical spec：`model-invocation-contract`

- `MODIFIED`：`输出超限不得静默截断`

实施前置顺序固定为：先归档 `refine-model-output-completeness`；再把 `fix-model-empty-output-recovery` 的同名 MODIFIED Requirement 重基到刷新后的 stable 全文，确认同时保留 incomplete-output decision table 与“先预算提升、后 correction”后归档；最后实施本 change。任一前置步骤未完成时，本 change 不得归档或与其并行修改同一 Requirement。

### 当前实现

- `packages/agent-core/src/model/model-route-execution.ts` 的 `ModelRouteExecution` 拥有同一 route 的预算提升、reasoning-only correction、continuation 和终态校验状态；`DefaultAgent` 仍拥有跨模型 fallback 编排。
- `isReasoningOnlyStop()` 已使用 normalized final result 判定：无 `safeError`、`finishReason` 为 `stop | length`、无 Tool call、content 为空且 reasoning 非空。产品路径不依赖 provider usage detail。
- `shouldCorrectReasoningOnly()` 对 `finishReason="length"` 额外要求 `escalationAttempted=true`；`continueAfterIncompleteOutput()` 会在该判断之前对首次 `output-limit` 执行预算提升。因此 `16384` reasoning-only 终态先重试到最高 `32000`，收敛指令只能在预算提升返回后发生。
- correction 已由 request-local message 注入，当前 model round 至多一次；stop 类重复 reasoning-only 已映射为 retryable `MODEL_EMPTY_OUTPUT`，并可进入既有 cross-model fallback。
- characterization test 当前锁定“budget escalation 后才 correction”的顺序，尚无“首次 reasoning-only 不 escalation”与“correction 后重复 reasoning-only 禁止 escalation/continuation”覆盖。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| reasoning-only `output-limit` 在原预算下先收敛 | 首次 `output-limit` 无条件先进入预算提升 | 缺少 reasoning-only 优先级分支 |
| 收敛后重复耗尽直接 fallback 或安全失败 | correction 后的 `length` 可再次进入既有预算提升/continuation 判断 | 缺少重复耗尽的封闭出口 |
| 普通 `output-limit` 与 `truncated-tool-call` 不回归 | 两者共享 `continueAfterIncompleteOutput()` | 调整优先级时需要保留原 decision branches 和恢复计数 |
| provider-neutral 产品行为 | 现有 Core 只消费 normalized content/reasoning/toolCalls/incomplete reason | 不得把 HarnessBench usage detail 或 provider-specific token 字段引入产品 contract |

### 修改方案

唯一实现路径只调整 `ModelRouteExecution` 的私有决策顺序和既有状态，不新增公共 contract、配置项、provider adapter 或恢复 helper 层。

1. 在 incomplete-output 分支进入 budget escalation 之前，使用现有 `isReasoningOnlyStop()` 识别 `incompleteOutputReason="output-limit"` 的 reasoning-only 终态。若当前 round 尚未 correction，立即复用现有 correction message 和调用入口，并保持当前 effective `maxOutputTokens`。
2. 继续使用现有 request-local boolean correction 状态作为当前 model round 的单次门禁；不新增持久化状态、runtime event 或跨 round counter。Tool round 开始后由新的 `ModelRouteExecution` 实例自然复位。
3. correction 结果按下表进入唯一后继分支。先判断 cancellation/字符硬上限和 `safeError`，再应用该表；不得以分支顺序绕过现有高优先级安全边界。

| correction 结果 | 当前 route 后继处理 | 是否允许预算提升/continuation |
|---|---|---|
| 无 `incompleteOutputReason`、无 `safeError`，且为非空 content 或完整 Tool call | 返回现有正常终态消费路径 | 否 |
| 非空 content、无 Tool call、`incompleteOutputReason="output-limit"` | 进入现有 `continueAfterIncompleteOutput()`，从一次预算提升开始 | 是，沿用既有上限 |
| 无 content、无 Tool call、reasoning 非空、`incompleteOutputReason="output-limit"` | 构造既有 retryable `MODEL_EMPTY_OUTPUT` route failure，交给 `DefaultAgent` fallback | 否 |
| `incompleteOutputReason="truncated-tool-call"`、Tool call、`safeError` 或其他非法终态 | 进入各自既有 fail-closed/Tool 安全路径 | 仅 `truncated-tool-call` 依既有规则；其他否 |

4. `calculateEscalatedMaxOutputTokens`、最大 `32000 tokens`、最多 3 次 continuation、`150000` UTF-16 code unit 上限、同一 `AbortSignal` 与 cross-model visible-output guard 均不修改。reasoning 不计入 visible-output guard；correction 产生可见 content 后继续遵守“已流出候选内容不切换模型”的现有安全边界。
5. 删除或改写锁定旧恢复顺序的 characterization test，并补齐普通 contentful `output-limit`、首次 reasoning-only、收敛成功、收敛后 contentful length、重复 reasoning-only、fallback exhaust、Tool call、取消的调用序列与可观察结果。断言请求的 effective token budget 和最终结果，不锁定新私有函数名。

选择这一方案是因为 reasoning-only 识别和 correction 已由 Core 拥有；只改变决策优先级即可闭合问题。把预算继续调大不能建立收敛上界，把 token detail 加入公共模型契约会把 provider/evaluator 事实泄漏到产品恢复语义。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `输出超限不得静默截断` | correction 单次门禁、重复耗尽的 retryable route failure、既有 fallback | 正常恢复、重复耗尽、fallback 成功/耗尽、无空终态提交 |
| 性能/容量 | `输出超限不得静默截断` | 首次 reasoning-only 不做 8 倍预算提升；普通超限上限不变 | 首次与 correction 请求预算相同，重复耗尽无 `32000` 调用 |
| 安全 | `输出超限不得静默截断` | 复用 Tool fail-closed、cancellation 与字符硬上限 | 残缺 Tool 零执行、取消后无 late call、无 reasoning 进入安全输出 |

## `FN-10.13 HarnessBench 评测`

### 目标与规范依据

本 Function 需要把“reasoning-only 输出耗尽曾发生”作为独立、fail-closed、安全的运行证据输出，并用固定真实任务验证产品恢复，而不把证据误当成终态原因或评分输入。

#### 本 Function 的目标 Requirements

canonical spec：`harnessbench-evaluation`

- `ADDED`：`reasoning-only 输出耗尽形成独立报告事实`
- `ADDED`：`reasoning-only 输出耗尽具有固定非计分回归入口`

实施前置顺序固定为：先归档 `harden-harnessbench-failure-diagnostics`，再归档 `harden-harnessbench-report-truth`，使 schema version 4 成为 stable 基线。新字段只在 schema version 5 中存在，不维护 v4/v5 双写或兼容读取。

### 当前实现

- `tests/harnessbench/harness-runner.mjs` 同步分类上游 task result；`model-evidence.mjs` 目前只把 usage summary 收敛为 request count 与 total tokens。
- `modelOutputLimitObserved` 来自 adapter stdout 的每轮 normalized usage，只能证明某轮 `output_tokens` 达到候选配置上限，不能证明 completion 全部为 reasoning、可见 content 为零或 `finishReason="length"`。
- usage-proxy 为每个 task 生成 `requests.jsonl`，每条完成记录提供 `raw_response_file`，对应 response JSON 中包含 provider 结束原因、聚合 visible content/tool calls 与 completion token detail。该目录是当前 run 的私有原始证据面，现有报告不会复制其正文。
- `tests/harnessbench/report.mjs` 当前生成 schema version 4 JSON/Markdown，并已将 `modelOutputLimitObserved` 作为不覆盖 terminal/failure/score 的独立字段和聚合计数。
- `timeout-budget-p0-regression` 已固定其他 timeout regression tasks，不适合追加会改变其精确 manifest 断言的 `037`。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 准确识别 all-reasoning、zero-visible 的 length completion | adapter stdout 只有 normalized output token count | 需要从 run-local usage-proxy 完成记录提取最小结构化事实 |
| 证据缺失时 fail closed | 当前没有读取 raw response ref 的安全边界 | 需要限定 trusted root、路径、记录状态和字段校验 |
| 报告 schema v5 JSON/Markdown 一致 | v4 只有普通 output-limit observation | 需要 task boolean、聚合 count、schema/test 更新 |
| 021/037 固定真实回归 | 无专用 profile | 需要新 profile，不能改变既有 timeout profile 或全量计分 |

### 修改方案

`tests/harnessbench/**` 继续是唯一 owner。实现复用现有目录，不新增目录层；在 `model-evidence.mjs` 增加异步的私有 usage-proxy evidence summarizer，并在 task result 分类前完成读取，最终只把 boolean 安全摘要交给同步报告模型。

1. `run.mjs` 在 live task 完成和 resume prefix 重建两条路径中，都把启动期创建并冻结的 `runRoot` 与 `usage_summary.log_file` 交给 evidence summarizer。summarizer 先验证 log file 的最终 `realpath()` 位于 `runRoot` 的最终 `realpath()` 内且文件名为 `requests.jsonl`，再以该文件父目录作为 trusted usage-proxy root；不接受报告、profile、task 输入或 usage 记录覆盖 `runRoot`。
2. summarizer 解析 UTF-8 JSONL 完成记录，只接受 `raw_response_file` 经 `realpath()` 后仍位于 trusted usage-proxy root 最终 `realpath()` 内的普通文件。绝对/相对 ref 均必须通过同一 containment 校验；单个 `requests.jsonl` 最大读取 `4 MiB`，单个 response JSON 最大读取 `16 MiB`。越界、缺失、symlink 最终目标越界、非文件、非法 JSON、超过上述上限或字段非法均返回 `false`，不抛出会改写 task 终态的诊断失败。
3. 对每个已完成 HTTP 200 模型请求，只读取 response JSON 的结构字段并立即投影为私有 boolean，不保留或返回 reasoning/content/raw body。判定条件唯一为 spec 定义的五项合取；`reasoning_tokens === completion_tokens > 0` 使用整数精确相等，不使用字符数、SSE chunk 数或阈值近似。任一合法请求命中则 task 为 `true`；单条非法记录忽略，log file 整体缺失、越界或不可解析时 task 为 `false`。

| 私有判定事实 | usage-proxy response JSON 唯一映射 | 合法条件 |
|---|---|---|
| length terminal | `response_json.choices[0].finish_reason` | 精确为 `length` |
| visible content empty | `response_json.choices[0].message.content` 与 `.delta.content` | 两者均为缺失、`null` 或 trim 后空字符串 |
| Tool call empty | `response_json.choices[0].message.tool_calls` 与 `.delta.tool_calls` | 两者均缺失或为空数组 |
| completion tokens | `response_json.usage.completion_tokens` | 正整数 |
| reasoning tokens | `response_json.usage.completion_tokens_details.reasoning_tokens` | 正整数且与 completion tokens 精确相等 |
4. `classifyUpstreamTaskResult()` 接收已经净化的 boolean evidence；`report.mjs` 将 task 字段默认闭合为 `false`，聚合 count 从最终 execute task 数组计算。Markdown 增加对应列与 diagnostics 行；敏感字段扫描器继续作用于最终 JSON/Markdown。不得写 raw evidence ref，因为报告已有 task 级上游结果引用足以追溯到私有 run 目录。
5. 报告 schema 直接从 4 升到 5，并同步 type declarations、README、fixtures、partial/interrupted report defaults 与 JSON/Markdown tests；不增加兼容分支。
6. 在既有 profiles 目录增加 `reasoning-only-output-exhaustion-regression.json`，只选 `021`、`037` 且 `nonScoring=true`。profile 复用现有 validation、candidate、usage-proxy、grader、report path，不复制 runner 或配置模板。

该 evidence summarizer 是 evaluator 私有的安全投影，不是 `agent-observability`、产品日志或公共 model contract。产品恢复仍只使用 normalized final result；评测 token detail 只用于事后归因。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 审计/可追溯性 | `reasoning-only 输出耗尽形成独立报告事实` | run-local evidence 的 fail-closed 安全投影、schema v5 一致输出 | true/false 边界、聚合一致、终态/计分不干扰、敏感字段扫描 |
| 可靠性/恢复 | `reasoning-only 输出耗尽具有固定非计分回归入口`（功能性 Requirement，无新增黑盒质量目标） | 固定真实 task profile 复用全量路径 | 精确 task 清单、nonScoring、不改变 full suite |

## 跨 Function 协作与端到端流程

`FN-4.1` 的产品路径先按其修改方案执行模型恢复；`FN-10.13` 不调用或控制该状态机，只在同一次 HarnessBench task 的 usage-proxy 私有证据中独立观察实际模型调用。固定 profile 将两者组合为端到端验收：`021`、`037` 的已知发散调用先出现同预算 correction，随后由当前 route 或既有 fallback 产出有效 content/完整 Tool call，且 task 不再以 `MODEL_TIMEOUT` 或 `TASK_TIMED_OUT` 结束；报告同时保留真实 terminal reason，并按证据设置独立 boolean。重复耗尽的有界安全失败由 characterization/integration negative tests 验收，不作为两个固定 task 的 live 成功标准。评测 observation 不反向影响候选执行、重试或评分。

## 跨 Function 质量属性设计（Cross-Function Quality Attributes）

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| 可靠性/恢复 | `FN-4.1` / `输出超限不得静默截断`；`FN-10.13` / `reasoning-only 输出耗尽具有固定非计分回归入口` | 真实候选恢复由产品 owner 执行，评测 owner 只观察并验证，不形成生产依赖 | 两个固定 task 的调用预算序列、有效产出/有界失败和 nonScoring report |
| 审计/可追溯性 | `FN-10.13` / `reasoning-only 输出耗尽形成独立报告事实` | 同一 run 的私有原始证据经安全投影形成独立报告事实 | JSON/Markdown、聚合数、terminal reason 与敏感字段扫描一致 |

## 验证策略（Verification Strategy）

- characterization/unit 层覆盖 `FN-4.1` 的决策矩阵，使用可观察的模型调用次数、每次 effective token budget、最终 content/Tool call/safe error 和 capability invocation count 断言恢复顺序，不断言私有 helper 名称。
- integration 层覆盖 cross-model fallback、取消、Tool call 安全、direct model 字符硬上限和 minimal kernel 非回归，确保优先级调整未绕过既有 owner 边界。
- HarnessBench unit/contract 层用不含真实正文的最小 fixture 覆盖 usage JSONL/ref containment、token 精确相等、普通 length、缺失/非法/越界/symlink evidence、schema v5、JSON/Markdown 一致及 score noninterference。
- profile contract 层断言新 profile 精确包含两个 task、`nonScoring=true`，且既有 timeout profile 和 full suite catalog 不变。
- live e2e 层执行固定 profile，对比基线请求序列；验收 correction 在原预算发生、无先行 `32000` reasoning burn，且两个固定 task 最终产生有效 content/完整 Tool call 并不再 timeout。
- architecture 与人工语义检视确认没有新增公共 contract、provider-specific 产品分支、新目录层、产品日志字段或 raw evidence 泄漏。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/model-invocation-contract/spec.md`：合并 `输出超限不得静默截断` 的新恢复顺序与场景。
- `openspec/specs/harnessbench-evaluation/spec.md`：新增两条 Requirements，并把报告格式基线提升到 schema version 5。
- `openspec/designs/functions/D4-模型与上下文/D4.1-模型调用与降级/FN-4.1-调用模型.md`：刷新处理过程、结果和输出 Token 恢复规格。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.3-测试与扩展/FN-10.13-HarnessBench评测.md`：刷新输出、处理过程、报告格式与回归 profile 规格。
- Feature：无；Function 组成、用户价值和可依赖 Feature 质量保证不变。
- `openspec/overview.md`：更新模型输出恢复与 HarnessBench 安全诊断的当前目标态摘要。
- `openspec/designs/architecture/model-provider-boundary.md`：更新 Agent Core reasoning-only 恢复顺序，保持 agent-model normalization owner 不变。
- `openspec/designs/architecture/e2e-quality-gates.md`：更新 HarnessBench schema version 5、安全证据投影和固定 profile。
- `openspec/designs/modules/agent-core.md`：刷新私有模型输出恢复状态机与验证关注点。
- `openspec/designs/modules/agent-test-kit.md`：刷新 HarnessBench evidence/report/profile owner 边界与验证入口。
- ADR：无；本 change 是既有输出恢复状态机的局部优先级修正，不建立新的跨模块长期取舍。
- `openspec/designs/spec-to-design-map.md`：刷新 `model-invocation-contract` 与 `harnessbench-evaluation` 的设计摘要和验证入口，不新增 spec 映射。

## 风险与取舍（Risks / Trade-offs）

- 某些模型可能在原预算的 correction 中再次耗尽；设计选择立即 fallback 或安全失败，牺牲同 route 的更多尝试，以换取有界耗时和避免 32K reasoning 放大。固定 task live regression 验证该取舍。
- usage-proxy token detail 可能因 provider 不支持而缺失；报告按 `false` fail closed，可能漏报但不会误报或改变 task 结论。既有 `modelOutputLimitObserved` 仍提供较宽的上限观测。
- schema version 5 与旧报告消费者不兼容；HarnessBench 报告是仓内私有测试 artifact，本 change 选择单一目标态并同步全部仓内 consumer，不维护双版本。

## 待确认问题（Open Questions）

无。
