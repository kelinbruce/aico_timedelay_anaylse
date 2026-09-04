# Capability 调用与失败处置

## 定位

本文是 Capability 调用、失败规范化、自动重试以及 Agent/Workflow 消费处置的长期白盒设计。它完整描述当前稳定实现的 owner、执行顺序、状态不变量、恢复坐标和禁止边界，是该主题的独立维护入口。

规范性行为由本文“规格导航”列出的 stable specs 定义；本文负责解释这些规格如何落到模块、公共契约、私有执行阶段和端到端控制流。若本文与 stable spec 冲突，以 stable spec 为准，并应在同一次修订中恢复一致。

## 目标与非目标

目标：

- Tool、Skill、Agent 和 Workflow Capability 经同一个 governed invocation boundary 获得严格、可消费且安全的最终结果。
- 同参自动重试只发生在 `agent-capability`，并同时受瞬态分类、`retryable`、幂等、取消、可见 delta 和调用上限约束。
- 普通 Agent 把非取消最终失败交给模型继续决策；循环只由 accepted Agent budget 收敛，不再按错误指纹、空 Tool 名称或局部失败次数提前终止。
- Workflow、定向 Skill 和隐藏 `ApiCall` 使用同一最终结果，但各自保持明确的终止、exception 或直接返回边界。
- pause、resume 和 crash recovery 保留同一 logical Agent turn，不重复普通轮次或 finalizing turn。
- 一方 Tool 对真实业务失败、授权、取消、超时、结果未知、正常空结果和复合部分成功使用一致的上位规则。

非目标：

- 不建立第二套 Capability request/result、retry policy parser、Agent loop 状态机或 finalization command。
- 不让 channel、Web、model provider、Workflow engine 或各 Tool 自行决定通用自动重试。
- 不用 `DEGRADED` 表达合法空集合、声明上限内截断、非零进程退出、Workflow waiting control 或“曾触发 fallback”。
- 不支持 named-tool choice，不增加通用 fallback dispatcher，不把 Workflow durable recovery 或 distributed scheduling纳入本设计。

## 规格导航

| 关注面 | stable spec |
|---|---|
| Capability 目录、调用、结果、失败和一方 Tool 闭包 | `capability-catalog` |
| Agent Tool loop、失败反馈、轮次与每轮 Tool 数量 | `tool-loop` |
| Agent runtime settings 编译 | `agent-package-assembly` |
| request routing 与 model-only 约束 | `routing-constraint-validation` |
| 模型调用和 `ToolChoice` | `model-invocation-contract` |
| Context、Prompt、Hook 合并 | `context-engine`、`prompt-template-assembly`、`lifecycle-hook` |
| 定向 Skill、隐藏 API、文件、命令、RAG、Memory | `targeted-skill-execution`、`skill-tool`、`file-operation-tools`、`command-script-tools`、`rag-tool`、`memory-tools` |
| Workflow 调用、Capability/LLM 节点和结果 | `workflow-contracts`、`workflow-capability-nodes`、`workflow-llm-nodes` |
| AskUserQuestion | `ask-user-question-tool` |
| checkpoint 与恢复 | `local-runtime-recovery` |

## Owner 与非 Owner

| 模块 | 拥有的事实 | 明确不拥有 |
|---|---|---|
| `agent-contracts` | 唯一公共 Capability request/result、`SafeError`、`ToolChoice`、Agent loop settings、`RequestContext.agentTurnIndex` 和 checkpoint 对应字段 | descriptor discovery、schema validator、retry predicate、模型 loop 或持久化实现 |
| `agent-capability` | descriptor resolution、公共 input validation、唯一 executor selection、result normalization、output validation、capacity guard、attempt-local delta 和同参自动 retry | session/timeline/checkpoint/terminal commit、Agent turn budget、Workflow exception routing |
| 一方 Tool producer | Tool 特有语义校验、dependency/domain/authority 事实和安全领域错误 | 通用 envelope、公共 output/capacity guard、通用 retry、Agent/Workflow 处置 |
| `agent-core` | ordinary Agent loop、Tool-call 前缀接纳、模型失败恢复、AskUserQuestion 窄化 preflight、finalizing 决策和 post-hook Tool 执行硬门禁 | request lifecycle、checkpoint store、terminal commit、Capability attempt retry |
| `agent-context-engine` | Prompt、Capability patch、trusted request 和 request-local feedback 的受治理模型输入合并 | 最终 Tool 执行授权、provider 映射、loop budget |
| `agent-model` | provider-neutral invocation 校验、`ToolChoice` 到 provider-native 字段的唯一映射和冲突拒绝 | Capability retry、Agent loop、Tool 执行 |
| `agent-runtime` | accepted run、checkpoint、pause/resume/recovery、canonical messages/timeline 和 terminal commit | 业务语义路由、Capability retry、finalizing 策略 |
| `agent-workflow` | Recipe/node 编排、节点 retry 声明向 Capability `maxRetries` 的下沉、显式 exception 分支和 waiting control 投影 | Capability 最终结果二次 retry、request lifecycle、durable workflow recovery |
| channel/Web | 安全最终结果投影和本地 view state | retry、模型恢复、runtime truth、授权和 terminal 决策 |

## 公共调用与结果契约

`CapabilityInvocationRequest` 表达一次逻辑调用。它携带可信 scope、capability identity、arguments、调用关联、每 attempt 的 `timeoutMs`、可选 `maxRetries`、稳定 `idempotencyKey` 和父 cancellation context。identity、owner scope、agent scope、execution workspace view 都来自可信 composition/runtime；模型参数、Tool arguments 或客户端 metadata 不得覆盖这些事实。

`CapabilityInvocationResult` 是唯一最终 envelope：

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

| 状态 | 必须满足 | 禁止 |
|---|---|---|
| `SUCCEEDED` | payload 通过 owning Capability output schema；合法空集合、声明上限内截断、明确非零进程退出和协议控制结果均可成功 | 携带 `safeError` |
| `DEGRADED` | 声明的复合目标中至少一个子结果成功且可独立使用，同时至少一个声明子结果缺失或失败；非空 payload 通过 output schema，并携带描述缺失面的安全错误 | 空降级、单一动作失败、仅因为 fallback 或 truncation 就降级 |
| `FAILED` | 携带合法 `safeError`；无可用业务结果时 payload 为 `{}` | 用伪业务 payload 或 `errorDiagnostics` 绕过错误契约 |
| `TIMED_OUT` | 携带 `TIMEOUT` 类安全错误；只有 owner 能确认且可安全使用的部分结果才允许非空 payload | 把取消、未知异常或结果未知一律伪装为普通 timeout |

`SafeError` 使用 `{code, category, message, retryable, safeDetails?}`。`safeDetails.reasonCode` 只表达比 `code` 更窄的原因；同值时省略。失败原因、分类、恢复建议只在 `safeError` 中表达。`fallbackTriggered` 只记录实际发生的路径事实，与最终 status 正交。

`generatedMessages` 和 `contextPatch` 只影响当前 request/run 的后续模型上下文。patch 可以收窄或指定 `allowedTools`、`modelId` 和 closed `modelOptions`，但必须经现有授权和模型治理校验；它不得永久修改 Agent assembly、session 或 provider 配置。

## Governed 调用顺序

普通 Capability 调用固定经过以下步骤：

1. 校验 request contract；`maxRetries` 缺失解析为 `1`，非法值归一化为 `0`。
2. 在父 `AbortSignal` 下解析并校验 descriptor；调用前或解析期间取消时，不创建 executor。
3. 执行公共 input schema 校验；失败时 dispatch count 必须为零。
4. 按 descriptor 选择唯一 provider executor；零个或多个匹配均安全失败。
5. 调用 executor，形成一个 attempt。
6. 严格校验 result envelope、状态组合、delta、generated messages、context patch、refs 和 metadata。
7. 对所有 status 的非空 payload 校验 output；`FAILED/TIMED_OUT` 的空对象不套业务 output schema。
8. 对 normalized result 执行统一容量、节点和深度 guard。
9. 只有自动重试门禁全部成立时，复用同一 executor 和原 request 开始下一 attempt。
10. 只把最后结果交付 Agent、Workflow 或直接调用方。

Descriptor 只解析一次，retry 不重新 discovery、不切换 provider/executor。Builtin、CLIP 和 Plugin adapter 只把 producer 原始事实适配到统一边界，不拥有最终 envelope、output validation、capacity guard 或 retry。调用边界不写 session、timeline、checkpoint、terminal commit 或 Agent loop state。

`AFTER_CAPABILITY_RESULT` 是可信 post-processing boundary，可以按 Hook contract 有意转换 payload；转换后由 Hook contract 治理，不重新套用原 Capability output schema。

AskUserQuestion 是唯一受控校验例外：assistant tool-use batch 必须先持久化，随后在创建 runtime-owned pending input 前由 `agent-core` 执行窄化 preflight。它复用相同黑盒规则和 fixtures，但不依赖 `agent-capability` 私有实现，也不创建第二套公共错误结构。

## 统一错误映射

| 已确认事实 | 最终表达 | 消费建议 |
|---|---|---|
| input schema 或本地可声明语义违规 | `FAILED / CAPABILITY_INPUT_INVALID / VALIDATION / false` | 返回完整安全 violations，修正后显式重新调用 |
| capability 不存在或当前可信 scope 不可见 | `FAILED / CAPABILITY_NOT_FOUND / NOT_FOUND / false` 或 owning Tool 稳定 code | 使用 ToolSearch/list/search 或已披露能力 |
| 已安全化业务错误 | 保留 producer 的 code/category/message/retryable/details；timeout 映射 `TIMED_OUT` | 遵循领域建议，不重写业务分类 |
| descriptor 漂移、executor 缺失/歧义、factory 异常、非法 envelope 或未知异常 | `FAILED / CAPABILITY_EXECUTION_FAILED / INTERNAL / false` | 说明调用未开始或已停止，并报告错误 |
| output、delta 或输出投影违反契约 | `FAILED / CAPABILITY_OUTPUT_INVALID / VALIDATION / false` | 不同参重试；缩小/调整请求或换能力 |
| 明确取消 | `FAILED / owning cancellation code / CANCELED / false` | 停止，不暗示仍在执行 |
| 执行事实 owner 确认副作用结果无法判断 | `CAPABILITY_RESULT_UNKNOWN / retryable=false`，status 按 owner 事实选择 | 先用独立 Read/list/search/query 核验实际状态 |
| 合法空集合、未命中或 poll 未完成 | owning Capability 正常结果 | 不生成错误 |
| 声明复合目标存在可用子结果且声明范围部分失败 | `DEGRADED` + 可用 payload + owning safe error | 使用已有结果并说明缺失范围 |
| 没有任何可用业务结果 | `FAILED`、`TIMED_OUT` 或取消 | 不使用空 `DEGRADED` 维持控制流 |

未知异常不能推断为 `UNAVAILABLE`。`NON_IDEMPOTENT`、timeout 或断连本身也不能证明结果未知。私有 failure stage 固定为 `DESCRIPTOR_RESOLUTION`、`EXECUTOR_SELECTION`、`CAPABILITY_EXECUTION`、`RESULT_VALIDATION` 和 `RESULT_SERIALIZATION`；前两者说明调用未开始，后三者说明调用已停止或结果无法安全交付。

## 同参自动重试

`maxRetries` 表示初始 attempt 之后允许的额外 attempts：缺失为 `1`，合法域为安全整数 `0..5`，非整数、负数、非安全整数或超过上限时归一化为 `0`，但仍允许一次初始 attempt。自动重试条件是完整合取：

```text
status ∈ {FAILED, TIMED_OUT}
AND safeError.category ∈ {UNAVAILABLE, TIMEOUT}
AND safeError.retryable = true
AND descriptor.replayPolicy = IDEMPOTENT
AND signal.aborted = false
AND safeError.code != CAPABILITY_RESULT_UNKNOWN
AND 当前 attempt 未调用 runtimeContext.emitResultDelta
AND 已完成 retry 数 < effective maxRetries
```

因此 `maxRetries=0/1/2` 的最多 attempt 数分别为 `1/2/3`。所有 attempts 复用原 request、arguments、invocationId、toolCallId、idempotencyKey 和同一个父 signal；每个 attempt 重新获得完整原始 `timeoutMs`，该值是 per-attempt budget，不是逻辑调用总预算。

父 signal 在 descriptor resolution、attempt 或 attempts 之间取消时，后续 attempt 不得启动。attempt-local delta wrapper 在调用 downstream emitter 前即标记“已尝试产生可见结果”，即使 emitter 校验或下游投影失败也禁止重放。attempt settle 后 delta channel 关闭并释放 delegate；late delta 被拒绝。中间失败只产生低基数 attempt 观测，不进入模型、Workflow、stream、timeline 或 `CAPABILITY_RESULT`。

`safeError.retryable` 的唯一自动行为消费者是 `GovernedCapabilityInvocationPort`。Agent、Workflow 和 Web 可用于解释，但不得据此自动再次调用。

## 参数诊断与容量

公共 input validator 使用 `allErrors=true` 收集当前 schema 阶段全部错误；schema 失败后不进入 Tool semantic validation。schema 通过后，Tool 可以收集全部“不执行副作用、不访问新外部状态且前置条件已满足”的独立语义违规。

统一 formatter 输出 `path`、`constraint` 和 `expected`：

- path 使用精确 JSON Pointer；required 指向缺失字段，数组元素保留索引。
- 只有输入 discriminator 唯一匹配组合分支时才移除其他分支错误；歧义时在父对象返回 `anyOf/oneOf` 聚合违规，不猜测分支。
- 跨字段违规指向最近共同父对象；additional property 指向最近合法父对象，并按稳定顺序列出允许字段。
- 按 `path + constraint` 去重并稳定排序。
- 不包含 actual value、非法字段原名、regex 原文、文件内容、命令、prompt、provider payload 或宿主路径。

所有状态共用单结果容量：canonical JSON 最多 `256000` 个 UTF-16 code unit、最多 `10000` 个节点、最大深度 `64`。遍历必须在每次累计后立即检查并中止，不能先构建任意大结构再检查。guard 仅在 input-invalid 的 `PRE_DISPATCH` 和每个 normalized execution result 的 `POST_DISPATCH` 使用。

容量内结果不得静默截断。超过 inline 阈值但未超过公共容量时，既有 externalizer 保存受治理内容，并提供 `PERSISTED_PREVIEW`、`contentRef` 和 Read 指引；超过公共容量、节点或深度预算时，整体替换为 `CAPABILITY_RESULT_LIMIT_EXCEEDED / VALIDATION / retryable=false`，不返回部分 violations。pre-dispatch 错误明确 execution 未开始；post-dispatch 的幂等结果可建议缩小请求，非幂等结果必须说明可能已产生效果、禁止原样重放，并只在 owner 声明独立查询能力时建议核验。

## E1–E7 失败平面

| 平面 | Owner 和验收目标 |
|---|---|
| E1 descriptor/availability | 统一边界处理 not-found、不可见、descriptor/provider 漂移和 resolver 异常 |
| E2 common schema | 统一边界返回当前阶段全部安全 violations，dispatch count 为零 |
| E3 Tool semantic validation | Tool 返回全部独立本地违规，不访问外部状态 |
| E4 dependency/context/authority | Tool 区分 dependency unavailable、可信 context 缺失和真实 authorization/policy |
| E5 downstream/domain | Tool 保真安全业务错误；未知异常不伪装业务错误 |
| E6 cancel/timeout/result unknown | cancel 优先；timeout 受 retry 门禁；result unknown 只能由执行事实 owner 声明 |
| E7 result/output/unknown | 统一边界校验 envelope、delta、output 和 extensions，并安全规范化未知异常 |

不存在的平面不为覆盖率合成错误。E1、E2、E7 由统一边界测试覆盖；E3–E6 只用真实可发生的 Tool 黑盒场景验证。

## 一方 Tool 失败闭包

生产注册闭包固定覆盖 20 个一方 Tool，其中前 19 个模型可见，`ApiCall` 只供非 Agentic Skill 编排。所有 Tool 同时遵守 E1、E2、E7；下表列出各自必须保真的 E3–E6 语义。

| Tool / replay policy | 可恢复、正常或降级事实 | 终止、结果未知或取消事实 |
|---|---|---|
| Read / `IDEMPOTENT` | missing 文件为 `FILE_UNAVAILABLE/NOT_FOUND` 并建议 Glob；正常分页和声明截断成功并给 `nextOffset`；无内容容量失败建议降低 limit、沿 offset 继续 | root/link/regular-file policy 为授权错误；未知读取失败为 internal；取消优先 |
| Write / `NON_IDEMPOTENT` | full-read 和 target-changed 冲突要求重新完整 Read 后构造 Write | path/write authority 保真；原子替换 commit 前失败明确“未提交”；取消优先 |
| Edit / `NON_IDEMPOTENT` | target missing、full-read/snapshot changed、old string 缺失/不唯一分别给出重新定位、Read 或增加上下文的动作 | path/write authority 保真；原子替换 commit 前失败明确“未提交”；取消优先 |
| Glob / `IDEMPOTENT` | path/pattern 违规完整返回；零匹配成功；声明的结果、深度或扫描预算停止成功且 `truncated=true` | root/link policy 为授权；必要遍历或未知失败为 internal，不泄漏已发现名称 |
| Grep / `IDEMPOTENT` | regex/path/filter/mode/limit 违规完整返回；零匹配和声明预算截断成功 | path authority 保真；必要遍历、decode 或未知失败为 internal，不泄漏部分 matches |
| Bash / `NON_IDEMPOTENT` | 格式违规为 `COMMAND_NOT_ALLOWED/VALIDATION/false`；zero/non-zero 正常完成均为 `SUCCEEDED`；已确认停止的 timeout 仅在有安全输出时保留部分 payload | sandbox composition/result 无效为 internal，真实 policy/auth 保真；无安全输出的 timeout 使用空 payload；取消优先 |
| Python / `NON_IDEMPOTENT` | code/args/timeout/guard 违规完整返回且不泄漏 guard 原文；已确认停止的 timeout 只保留安全输出；non-zero 保持声明结果 | sandbox/context 缺失或返回无效为 internal；真实 guard policy 保真；取消优先 |
| AskUserQuestion / `NON_IDEMPOTENT` | 全部问题、选项、modifier 和文本违规反馈模型；合法修正进入 runtime-owned pending input；无局部重复失败阈值 | 禁止用途保持安全 validation；producer/pending contract 无效为 internal；取消进入 runtime cancel |
| Agent / `NON_IDEMPOTENT` | 目标不存在、隐藏或不可用统一防枚举为 `AGENT_NOT_AVAILABLE`；相容 child SafeError 全字段保真；child timeout 映射 outer timeout | child auth/policy/internal/result unknown 上升但不泄漏 child session/run id；无效 child result 为 internal |
| Skill / `NON_IDEMPOTENT` | 未发现、隐藏或 source unavailable 防枚举为 `SKILL_NOT_AVAILABLE`；source timeout 不自动重放 | source identity/hash/scope mismatch 为授权；body/frontmatter/leakage/source contract failure 为 internal |
| Rag / `IDEMPOTENT` | 零命中和声明范围内完整/有界结果成功；仅在已有安全 chunks 且 provider 明确其余声明范围未完成时降级 | scope mismatch 为授权；无 chunks 的 dependency/failure 不降级；无效 provider/result 为 output/internal |
| ToolSearch / `IDEMPOTENT` | 零命中和声明 limit 截断成功；catalog unavailable 给出使用当前已披露能力或稍后搜索的动作 | catalog/activation/output unknown 安全失败；无可用结果的 activation failure 不静默成功 |
| TodoWrite / `IDEMPOTENT` | state conflict 要求提交包含既有未完成项的完整 replacement；dependency unavailable 可继续任务但明确状态未更新；空列表成功 | trusted context/output/unknown 为 internal；真实 auth/policy 保真 |
| Workflow / `NON_IDEMPOTENT` | recipe missing 建议已注册 recipe；合法 `WAITING` 投影为 `SUCCEEDED` 控制结果且无 safeError；nested SafeError 保真 | 无有效 pending questions/previews 的 WAITING 为 internal；nested auth/policy/internal/result unknown 上升 |
| Cron / `NON_IDEMPOTENT` | task missing 建议 `Cron list`；scope limit 建议 list/delete 或放弃创建；list 空结果成功 | gateway auth/policy/internal 保真；当前 producer 不声明 result unknown |
| `search_memory` / `IDEMPOTENT` | disabled 可继续不依赖记忆；零条目成功；storage 瞬态失败只在明确可重试时经统一门禁 retry | trusted context/output/unknown 为 internal；不使用 memory 专用失败 envelope 或容量上限 |
| `get_memory_detail` / `IDEMPOTENT` | 单项 missing 是正常 item 结果并建议重新 search；部分 missing 不覆盖成功 entries | global auth/internal/unknown 不改写成 item missing |
| `add_memory` / `NON_IDEMPOTENT` | duplicate/version conflict 建议先 search 当前 memory 或调整内容 | content guard policy 保真；trusted context/output/unknown 为 internal；不自动重放 |
| `acquire_skill` / `IDEMPOTENT` | 非 SkillHub candidate 为 validation；not-found 建议调整 query/provider；只有实际 acquired 才成功 | hidden/unauthorized candidate 为授权；install/source/output failure 为 internal；取消保真 |
| `ApiCall` / `NON_IDEMPOTENT`、隐藏 | 文档、参数、dependency、HTTP 和 timeout 按实际阶段给出安全动作；合法 response 正常返回 | auth/policy、父取消、local timeout、stream 中断、invalid response 和 unknown 分别安全映射；最终失败直接返回，不启动普通 Agent loop |

## 普通 Agent、定向 Skill、ApiCall 与 Workflow 的消费

| 消费方 | 非取消最终失败 | 自动同参重放 | 控制/终止边界 |
|---|---|---|---|
| 普通 Agent | 保存与原 `toolCallId` 配对的完整安全 `CAPABILITY_RESULT`，进入下一模型轮 | 仅统一执行边界已经完成的 retry；Agent 不按 `retryable` 重放 | 模型可改参、换能力、核验或结束；只由授权/Hook 控制、取消、模型结束或 `maxTurns` 收敛 |
| 定向 Skill | 使用同一结果直接完成定向执行 | 无第二层 retry | 不创建普通 Agent 恢复轮；失败进入调用方既有终止边界 |
| 隐藏 `ApiCall` | 直接返回安全最终失败 | `NON_IDEMPOTENT`，无自动重放 | 不启动普通模型 loop |
| Workflow | 结果进入节点显式 `exception`，按 Recipe 分支路由 | 节点 retry 只下沉为调用内 `maxRetries`；engine 不重新执行最终失败节点 | 取消直接中断；poll/batch 每项是独立逻辑调用；合法 waiting 是成功控制结果 |

普通 `AUTHORIZATION` 业务错误即使 message 建议申请权限，也仍作为 Tool result 反馈模型；只有正式 `REQUIRE_AUTHORIZATION` pending、Lifecycle `PEND/DENY/BLOCK` 等明确控制结果才能暂停或阻断 protected operation。错误文本不能升级为控制指令。

## Agent loop 收敛

### Logical turn 与 finalizing turn

`AgentRuntimeSettings.maxTurns` 是唯一循环计数边界：缺失时为 `50`，必须是正安全整数。每次新 ordinary model turn 计数一次，无论是否产生 Tool call；provider retry 或同一 turn 的 recovery replay 不增加 turn index。

`RequestContext.agentTurnIndex` 的 `0..maxTurns-1` 表示普通 turns，`maxTurns` 唯一表示 finalizing turn。普通轮次耗尽后：

1. 撤销当前 request 的后续 Tool 执行权，并保存 `TOOL_ROUND_LIMIT_EXCEEDED` degradation fact。
2. 通过 request-local `USER` generated message 要求模型只依据 transcript 中已验证事实区分已完成和未完成工作。
3. 保留原 Tool descriptors，使模型输入形态与普通轮次一致。
4. 通过受治理 context patch 设置 `toolChoice=NONE`；Hook merge 后再次硬约束为 `NONE`。
5. 最多调用一次 finalizing model turn；provider 或 terminal Hook 违规返回 Tool calls 时也不执行。
6. 根据 finalizing 文本、model safe error、取消和 terminal hook 结果走现有 terminal commit；不能产生第二个 finalizing turn。

相同失败、不同失败、空 Tool 名称和不断切换 Capability 都不创建局部 fingerprint、连续失败阈值或额外 finalization reason。它们受同一个 `maxTurns` 约束。

### 每轮 Tool-call 前缀接纳

`maxToolCallsPerTurn` 缺失时为 `30`，合法域为安全整数 `1..100`。它按模型输出顺序统计全部 Tool calls，不按 replay policy、风险或读写性质拆预算。Tool 禁用使用 `executionMode=model-only` 或 effective `toolChoice=NONE`，不能用上限 `0` 表达。

当请求数超过上限时，Agent Core 在保存 assistant message 前取有序前缀：

```ts
const admittedCalls = requestedCalls.slice(0, maxToolCallsPerTurn);
```

canonical assistant message、批量 preflight、治理、execution、event 和 result pairing 只包含 admitted prefix。omitted suffix 不保存、不执行、不生成 synthetic Tool result。前缀闭合后生成一次 request-local `USER` feedback，陈述 requested/admitted/omitted counts、明确省略调用未执行，并要求下一轮拆分剩余工作。连续超限可以逐轮产生对应事实，但没有恢复次数阈值；若发生在最后一个 ordinary turn，先闭合前缀结果和 overflow feedback，再进入同一个 finalizing turn。

空 Tool 名称属于 admitted call 的正常失败结果；它不能导致整批未执行，也不能建立局部终止策略。任何批级 preflight 失败必须保证 admitted prefix 零部分执行，并为已保存的 Tool calls 形成闭合配对结果。

## ToolChoice 合并与硬约束

公共类型固定为：

```ts
type ToolChoice = "AUTO" | "NONE" | "REQUIRED";
```

首版不支持 named-tool object。`ModelProfile` 缺失时 resolved default 为 `AUTO`。普通调用按字段逐层覆盖，省略表示不覆盖：

```text
ModelProfile
→ Prompt Template
→ governed Capability context patch
→ trusted request/render option
→ BEFORE_MODEL_INVOKE Hook
→ Agent Core hard constraint
```

`executionMode=model-only` 和 finalizing turn 的 hard constraint 始终为 `NONE`，Hook 不能扩大 Tool 执行权。`REQUIRED` 且可见 Tool 集合为空时必须在 provider 调用前安全失败。provider adapter 是 `ToolChoice` 到原生字段的唯一映射 owner；`providerOptions` 或 `modelParams` 中与原生 Tool-choice 字段冲突的 key 必须拒绝，不能用透传绕过 canonical precedence。Agent Core 还要防御 provider 违规返回 Tool calls。

## Checkpoint 与恢复

新 accepted run 从 `agentTurnIndex=0` 开始。Agent Core 在开始 logical turn 前更新 `RequestContext` copy；Runtime 通过既有 checkpoint write 原样持久化。checkpoint idempotency semantic 在既有 run/trigger/version 坐标上包含 turn index，使同一 turn replay 幂等、不同 turn 不冲突。

恢复时，Runtime 校验 checkpoint 后恢复同一 index；Tool/message state 继续从 canonical messages、lifecycle stage、`lastSequence`、tool-call state 和 active-context version 重建。`index=maxTurns` 仍只表示唯一 finalizing turn。不得新增 phase、loop store、额外 gateway port、public finalizing command或把 provider attempt 当成 Agent turn。最小内核可以继续注入既有 no-op checkpoint provider，但不能形成第二套公共恢复路径。

## Workflow 处置

Capability 节点按 `retry → retryPolicy → runtime.defaultRetry` 解析额外 retry 声明，并将其写入每个逻辑 `CapabilityInvocationRequest.maxRetries`；三者均缺失时省略，使用 Capability 默认值 `1`。兼容 RESTFUL 输入中的 `retry_times` 不进入该映射。

最终 Capability 失败不再触发 Workflow engine 节点级重放。poll ordinal、batch item 和 PromptSplicing 中每一次调用都是独立逻辑 invocation，各自应用同一个节点上限。失败按 Recipe 明确的 exception branch 次序路由；无匹配分支时 Workflow 失败。取消优先并直接中断。

合法 pending parser 产生非空 questions，或存在非空 answer previews 时，Workflow Tool 的 `WAITING` 投影为 `SUCCEEDED + WORKFLOW_NODE_WAITING`，不携带 `safeError`；无有效 questions/previews 的 WAITING 是 internal failure。控制 marker 保持 package-private，不提升为公共 Capability status。

## 安全、诊断与可观测性

- arguments、invalid values、raw exception、provider body、host path、credential、token、文件正文、命令和 stdout/stderr 不进入 `SafeError`、Web、stream、timeline 或 audit。
- 一方 producer 必须给出稳定 code/category/retryable 和领域可理解的下一步；未知 extension 使用统一安全兜底，不暴露内部阶段细节。
- ordinary Agent 只接收最终安全结果；中间 retry attempts 不产生 transcript 或用户可见事件。
- 日志/metric/trace 使用 capability kind、provider kind、最终 status、稳定 code/category、attempt count 和低基数 failure stage；不记录高基数调用参数。
- 本地 operational diagnostic 仍遵守仓库对 canonical `toolInput`、`toolOutput` 和 `rawExceptionData` 的专门边界；这些原始诊断不得反向进入产品投影。
- owner/agent scope 始终来自可信 runtime/composition；Tool input、model output 和 context patch 不得扩大 scope、授权或可见 Capability 集合。

## 禁止与延期

禁止：

- 绕过 `CapabilityInvocationPort` 直接调用 executor，或在 adapter/Tool/Workflow/Web 中复制通用 retry。
- 按错误指纹、重复次数、空 Tool 名称、单轮超限或 `retryable=false` 提前终止普通 Agent。
- 保存或执行 `maxToolCallsPerTurn` 之外的 suffix，或为 omitted calls 伪造 result。
- 用 `tools=[]`、provider raw option、Hook 或 Prompt 建立绕过 canonical `ToolChoice` 的平行控制面。
- crash recovery 重置 `agentTurnIndex`、重复 finalizing、增加公开 phase/store/command。
- 用 raw producer payload 满足失败 output schema，或对容量内诊断进行静默截断。

延期：named-tool choice、通用 fallback dispatcher、Workflow durable snapshot/resume/recovery、distributed Workflow scheduling、跨进程 attempt retry coordination，以及没有清晰业务锚点的通用结果未知推断。

## Feature / Function 追踪

| Feature | Function | 主规格 | 本设计中的主关注面 |
|---|---|---|---|
| F-5.1 | FN-5.2 调用能力 | `capability-catalog` | 唯一 governed boundary、结果不变量、E1–E7、retry、容量和一方 Tool 闭包 |
| F-3.3 | FN-3.4 工具循环失败保护 | `tool-loop` | 最终失败反馈模型、前缀接纳、`maxTurns` 与单次 finalizing |
| F-3.1 | FN-3.2 编译智能体装配 | `agent-package-assembly` | `maxTurns`/`maxToolCallsPerTurn` 的 startup compile 与不可覆盖性 |
| F-2.1 | FN-2.1 提交请求 | `routing-constraint-validation` | model-only 禁用 Tool、request 不拥有 Agent budget |
| F-4.1 | FN-4.1 调用模型 | `model-invocation-contract` | `ToolChoice` contract、provider mapping/collision 和违规 Tool-call guard |
| F-4.3 | FN-4.3 装配上下文 | `context-engine` | Prompt、patch、trusted request、feedback 与 Hook 前的 model option 合并 |
| F-10.1 | FN-10.1 注册和执行钩子 | `lifecycle-hook-execution` | Hook precedence、正式控制结果和 hard constraint |
| F-10.4 | FN-10.4 自定义工具和提示词 | `prompt-template-assembly` | 自定义 Tool 同一治理路径、Prompt `ToolChoice` authoring |
| F-2.1 | FN-2.8 指令定向请求处理 | `directive-capability-routing` | `$skill:`/`$workflow:` 到唯一受治理目标 |
| F-5.2 | FN-5.3 读写编辑文件 | `file-operation-tools` | 文件 Tool 的业务失败、冲突、授权、分页与重放策略 |
| F-5.6 | FN-5.9 调用技能 | `skill-tool` | Skill wrapper、inline/fork 结果与 context patch 治理 |
| F-11.1 | FN-11.1 恢复运行状态 | `local-runtime-recovery` | `agentTurnIndex`、checkpoint 幂等和 finalizing 恢复 |
| F-2.6 | FN-2.6 指定技能处理 | `targeted-skill-routing` | 定向 Skill 最终失败直接终止，不创建 ordinary recovery loop |
| F-9.2 | FN-9.4 执行能力节点 | `workflow-capability-nodes` | 节点 retry 下沉、最终失败 exception 和独立逻辑调用 |
| F-9.2 | FN-9.7 执行模型节点 | `workflow-llm-nodes` | LLM 节点及 DATA_ANALYSIS Python 子调用的统一处置 |
| F-9.1 | FN-9.1 执行工作流 | `workflow-contracts` | Workflow 最终失败、exception、取消和 waiting control |
| F-5.4 | FN-5.6 向用户提问 | `ask-user-question-tool` | batch-persisted preflight、pending lifecycle 和无局部纠错阈值 |
| F-5.3 | FN-5.5 执行命令和脚本 | `command-script-tools` | Bash/Python 诊断、进程事实、sandbox、timeout 和取消 |
| F-5.7 | FN-5.13 检索知识库 | `rag-tool` | 零命中、复合部分完成、无 chunks 失败和幂等 retry |
| F-8.2 | FN-8.2 检索和写入记忆 | `memory-tools` | 两个幂等读取、一个非幂等写入和统一 outer failure |

## 验证矩阵

| 层级 | 必须覆盖 |
|---|---|
| contract | 严格 result schema、状态不变量、`ToolChoice` 三值、`maxRetries` 域、`agentTurnIndex` 与 checkpoint 同形、旧 loop 字段拒绝 |
| governed boundary | E1/E2/E7、完整 violations、输出无效、非法 extension、容量/节点/深度、取消优先、无 direct executor bypass |
| retry | 默认与 0/1/2 上限、同一 request/idempotency/timeout、父 signal、delta 后不重放、中间失败不可见、非幂等和 result unknown 不重放 |
| first-party Tool | 20 个注册闭包、19 个模型可见、隐藏 ApiCall、replay policy，以及每个真实 E3–E6 黑盒场景 |
| Agent | 非取消失败反馈模型、授权文本不升级控制、AskUserQuestion pending、相同失败/空名称继续、29/30/31/100/101 前缀矩阵、零部分执行、一次 finalizing |
| model/context/hook | precedence、`REQUIRED + tools=[]` pre-provider failure、provider mapping/collision、model-only/finalizing hard guard |
| recovery | pause/resume/crash 保留 turn、同 turn checkpoint 幂等、finalizing 不重复、canonical Tool/result pairing |
| Workflow | retry 下沉、无二层节点重放、exception 顺序、batch/poll 独立调用、waiting success control、取消 |
| projection/security | live/history/Web 只显示最终安全结果，raw values、异常、路径、凭据和中间 attempts 不可见 |

完成文档修订后至少运行 `openspec validate --all --strict`、`npm run lint:architecture` 和 `git diff --check`；若仅有其他 active change 的已知验证失败，必须逐项列出并证明与本设计无关。
