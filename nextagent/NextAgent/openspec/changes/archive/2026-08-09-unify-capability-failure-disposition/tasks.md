## 0. 共享 frozen contract 门禁

- [x] 0.1 完成 `CapabilityInvocationRequest.timeoutMs` 与 `maxRetries` 的 frozen contract 群内确认：`timeoutMs` 是每次 execution attempt 的完整预算；`maxRetries` 表示初始 attempt 后允许的额外重试次数，缺失时为 `1`，默认总 attempt 上限为 `2`。
  - 来源：`capability-catalog / 瞬态失败只在统一执行边界安全重试`；design §3.4.4
  - 验证：2026-08-03 确认 `timeoutMs` per-attempt 语义；2026-08-04 确认 `maxRetries` 计数、缺省值和 Workflow 下沉边界
- [x] 0.2 完成 frozen `agent-contracts/model` additive refinement 群内确认：公共 `ToolChoice = AUTO | NONE | REQUIRED`、`ModelInferenceOptions.toolChoice?: ToolChoice`、profile 缺省 `AUTO`、profile → Prompt → governed Capability patch → trusted request → governed Hook precedence、Skill metadata 同形复用、named-tool 延期，以及 `providerOptions`/`modelParams` 的 Tool-choice collision；不删除、重命名或重新定义 `modelParams` 的其他行为。
  - 来源：design §4K；`model-invocation-contract`、`skill-tool`
  - 验证：2026-08-07 用户确认群内相关 frozen model contract owners 已通过上述完整方案
- [x] 0.3 完成 frozen `agent-contracts/agent-assembly` clean replacement 群内确认：删除 `maxToolIterations`，新增 `maxTurns` 与 `maxToolCallsPerTurn`，缺省分别为 `50` 和 `30`，有效域分别为正安全整数和 `1..100` 安全整数；不保留 alias、双写 precedence 或 migration window。
  - 来源：design §4K；`agent-package-assembly`
  - 验证：2026-08-07 用户确认群内相关 frozen Agent assembly contract owners 已通过 clean replacement，无 alias 或迁移窗口
- [x] 0.4 完成 frozen `agent-contracts/runtime` refinement 群内确认：删除 `RoutingConstraints.maxToolCalls` 与 planning-hook `maxRounds/maxCalls`；`RequestContext` 与 checkpoint 只增加同一个 `agentTurnIndex`，normal/finalizing 由该 index 与 accepted `maxTurns` 推导；确认 Web/runtime schema、Hook contract、Record/row mapping 和 recovery validation。
  - 来源：design §4K；`routing-constraint-validation`、`lifecycle-hook-execution`、`local-runtime-recovery`
  - 验证：2026-08-07 用户确认群内相关 frozen runtime contract owners 已通过全部同组字段、Web/runtime schema、Hook 和 recovery mapping

## 1. `FN-5.2 调用能力`

- [x] 1.1 建立唯一 Capability 最终结果边界：严格校验 status/`safeError`/payload/extension 组合，业务错误保真，未知异常和非法 output 使用稳定安全映射；generated messages、context patch、refs 和 fallback metadata 只在完整结果通过治理后应用。
  - 来源：`capability-catalog / Capability Governance Uses The Existing Unified Contracts、Runtime Capability 失败复用统一 SafeError 结果、Capability 结果扩展保持受治理、安全业务错误和未知异常使用确定映射`
  - 验证：`packages/agent-capability/tests/result-contract.test.ts`、`execution-boundary.test.ts`、`packages/agent-core/tests/agent-failure-disposition.test.ts` 和 architecture negative tests 通过；非法 envelope 零部分应用
- [x] 1.2 统一参数诊断、结果容量和失败证据安全边界：一次返回当前阶段全部可独立判断 violations；所有状态共用 `256000` UTF-16 code unit 单结果容量；容量外显式失败且不泄漏 raw exception、路径、credential、非法原值或未经安全化 output。
  - 来源：`capability-catalog / 参数校验一次返回当前阶段全部违规、Capability 结果复用统一容量和转储机制、Capability 失败证据不跨安全边界`
  - 验证：`validation-violations.test.ts`、`execution-boundary.test.ts`、`failure-evidence-security.test.ts`、output guard 和 architecture tests 通过，覆盖边界值、零 dispatch、外置回读和禁止内容
- [x] 1.3 在唯一 governed invocation boundary 实现安全同参 retry：有效 `maxRetries` 为 `0..5`；缺失时为 `1`；非法类型、负数、非安全整数或大于 `5` 时 effective 值统一为 `0`，仍执行初始 attempt；只有 `IDEMPOTENT + UNAVAILABLE|TIMEOUT + retryable=true + 未取消 + 未调用 emitResultDelta` 才能启动下一 attempt。
  - 来源：`capability-catalog / 瞬态失败只在统一执行边界安全重试`；design §3.4.4
  - 验证：`packages/agent-capability/tests/execution-boundary.test.ts` 覆盖缺省、0、1、2、5、全部非法值、完整原始 `timeoutMs`、identity、父取消、delta 和结果未知；实现前非法值用例失败，修复后通过
- [x] 1.4 以生产 registry 闭包验证 20 个 first-party Tool、19 个模型可见 Tool 和隐藏 `ApiCall` 的真实失败出口；每个出口都有确定 status、`safeError`、安全 message、取消/超时和 replay 语义，不建立合成 failure ledger。
  - 来源：`capability-catalog / 模型可调用 Tool 的失败消息具有确定语义、所有一方 Tool 闭合统一失败契约`；design §3.4.6–§3.4.8
  - 验证：`first-party-tool-registry.test.ts` 与 Read/Write/Edit/Glob/Grep、Agent/Skill/ApiCall、ToolSearch/Todo/Workflow/Cron、Bash/Python/RAG/memory 的真实黑盒测试通过
- [x] 1.5 新增 Workflow Tool payload/metadata 黑盒 tests，并让 producer 只输出 optional 安全 `executionId` 和 optional 非负安全整数 `nodeResultCount`；两个字段都缺失时省略 metadata，其他字段在结果交付前失败。
  - 来源：`FN-5.2 + capability-catalog / Workflow Tool 通过统一入口忠实返回执行结果 / Workflow metadata 只保留声明的安全事实、Workflow metadata 拒绝未声明或非法字段`
  - 验证：先运行 `npx vitest run --config vitest.config.release.ts packages/agent-workflow/tests/workflow-tool-port.test.ts packages/agent-capability/tests/result-contract.test.ts` 并确认新增非法 metadata 用例失败；实现后同命令通过
- [x] 1.6 删除无 consumer 的 `maxCapabilityResultMessageChars` export，只保留 `capabilityResultJsonCapacity` 作为公共单结果容量实现，不保留 alias 或 Agent-side pre-limit。
  - 来源：design §3.4.8；`FN-5.2 + capability-catalog / Capability 结果复用统一容量和转储机制 / 所有状态使用同一公共容量`
  - 验证：`rg -n "maxCapabilityResultMessageChars" packages` 无结果；相关 result/projection/output-guard tests、typecheck 和 architecture gate 通过

## 2. `FN-3.4 工具循环失败保护`

- [x] 2.1 让普通 Agent 把全部非取消最终 Capability 失败作为完整配对结果反馈模型；相同失败、`DEGRADED`、空 Tool 名称和 ordinary preflight rejection 均不建立 fingerprint、局部次数阈值或 repeated-failure notice。取消、显式 `REQUIRE_AUTHORIZATION` 和 lifecycle `PEND/DENY/BLOCK` 保持控制流，普通 `AUTHORIZATION` SafeError 只作为失败信息。
  - 来源：`tool-loop / Agent loop 对最终 Capability 失败执行唯一处置、Tool loop preserves failure, timeout, and cancellation truth after streamed deltas`；`ask-user-question-tool / AskUserQuestion 可纠正输入错误进入安全模型纠错`
  - 验证：`packages/agent-core/tests` 368 tests 通过；覆盖 ordinary/Ask/preflight/invocation rejection 多次反馈、无 repeated notice、显式控制、普通授权、取消、batch 零执行和非法结果零部分应用；production source 无 fingerprint state/helper
- [x] 2.2 失败结果复用普通 `CAPABILITY_RESULT`、公共 externalizer 和 runtime terminal commit；已有可见 assistant 内容不能遮蔽真实 terminal error，隐藏 `ApiCall` 直接路径不启动普通模型恢复。
  - 来源：`tool-loop / 失败结果复用正常 CAPABILITY_RESULT 路径、Agent loop 对最终 Capability 失败执行唯一处置`
  - 验证：`capability-result-projection.test.ts`、`output-guard.test.ts`、`targeted-skill-routing-failure.test.ts` 和 history/channel regression 通过
- [x] 2.3 先新增 Agent loop characterization，再把控制器实现为最多 `maxTurns` 个普通 logical turns 加一个 finalizing turn；turn coordinate 只读取 trusted `RequestContext.agentTurnIndex`，`executeModelTurn` 不增加 summary 参数，同一 provider retry 或 recovery replay 不增加 Agent turn。
  - 来源：design §4.5.1；`FN-3.4 + tool-loop / maxTurns 达到上限后只执行一次无工具模型收尾 / maxTurns 达到上限后总结最后一批 Tool 结果、暂停和恢复保持同一 RequestRun 的轮次计数`
  - 验证：先运行 `npx vitest run --config vitest.config.release.ts packages/agent-core/tests/budget-degradation-notice.test.ts packages/agent-core/tests/agent-failure-disposition.test.ts tests/agent-kernel/tool-loop.test.ts` 并确认新增目标用例失败；实现后覆盖提前结束、无 Tool turn、pause/recovery 和最多一个 finalizing turn
- [x] 2.4 在已有 request-local state 上直接构造 finalizing feedback：追加一条 runtime-owned `USER` 指令，保留已有 patch 字段并只把 `toolChoice` 覆盖为 `NONE`；不调用 Capability/Skill source-authorization helper，不新增 carrier、merge helper、phase、port、store 或独立 summary flow。
  - 来源：design §4.5.2；`FN-3.4 + tool-loop / maxTurns 达到上限后只执行一次无工具模型收尾 / maxTurns 达到上限后总结最后一批 Tool 结果、model-only 保留 Tool descriptors`
  - 验证：运行 2.3 命令及 Context/Hook tests；收尾输入可见最后结果，history/config 不持久化 feedback，Hook/provider 返回 Tool calls 时 executor count 仍为 0
- [x] 2.5 先新增 29/30/31/100/101 边界 tests，再实现 `maxToolCallsPerTurn` 顺序前缀接纳：canonical assistant message 只保存 admitted prefix；前缀按统一 preflight/治理/执行/配对规则处理；omitted suffix 零保存、零执行、零 synthetic result；前缀闭合后反馈 requested/admitted/omitted counts 并继续普通 loop。
  - 来源：design §4.5.3；`FN-3.4 + tool-loop / maxToolCallsPerTurn 只接纳有界 Tool call 前缀 / 非流式 Tool calls 超限时只接纳有界前缀、超限反馈要求模型拆分剩余工作、接纳前缀并行执行后按模型顺序配对、最后一个普通 turn 超限后仍保持总结上下文完整`
  - 验证：先运行 `parallel-tool-loop.test.ts`、`budget-degradation-notice.test.ts` 和 `tests/agent-kernel/tool-loop.test.ts` 并确认新增边界用例失败；实现后覆盖 pairing、preflight 零执行、并行顺序回填、最后一个 normal turn 和连续超限
- [x] 2.6 删除 over-limit/empty-name recovery counter、`MAX_TOOL_CALLS` finalizing reason 和仅服务旧数量预算的 read-only/side-effecting 分类；空 Tool 名称在 prefix admission 后、assistant message 保存前产生 correction feedback。
  - 来源：`FN-3.4 + tool-loop / 空 Tool 名称只产生可修正反馈 / 空 Tool 名称不破坏消息配对、重复空 Tool 名称不建立局部终止阈值`；design §4.5.3
  - 验证：重复空名称与连续 overflow 不提前终止，空名称+超限同时反馈且无孤立 messages；`rg -n "toolCallLimitRecoveryLimit|MAX_TOOL_CALLS" packages/agent-core/src` 无结果
- [x] 2.7 完成 finalizing 结果矩阵：非空安全文本正常完成；文本与 Tool calls 同时返回时丢弃 calls；only Tool、空文本或非法结果安全失败；模型 `safeError` 保真；取消优先；terminal Hook 产生的 Tool calls 零执行；任何分支不得开始第二个 finalizing turn。
  - 来源：design §4.5.5；`FN-3.4 + tool-loop / maxTurns 达到上限后只执行一次无工具模型收尾 / 收尾轮返回文本和 Tool call、收尾轮无法提供安全文本`
  - 验证：运行 2.3/2.5 的 Agent tests，断言 terminal status/content、degradation notice、model/Capability counts、events、message pairing 和取消保真

## 3. `FN-3.2 编译智能体装配`

- [x] 3.1 先新增 contract/config 黑盒 tests，再让 Agent package source、compiler、builtin defaults 和 runtime-ready assembly 只使用 `maxTurns/maxToolCallsPerTurn`；非法显式值 fail closed，旧字段按 closed schema 拒绝。
  - 来源：`FN-3.2 + agent-package-assembly / Agent 运行设置只定义轮次上限和单轮工具调用上限 / 运行设置使用规范循环上限、运行设置省略循环上限、运行设置包含非法循环上限`
  - 验证：运行 `config-assembly.test.ts` 和 `core-contracts.test.ts`；覆盖缺省 50/30、范围边界、旧字段拒绝和 assembly 只发布两个 canonical fields

## 4. `FN-2.1 提交请求`

- [x] 4.1 先新增 request/runtime contract tests，再从 `RoutingConstraints` type、schema、accepted facts consumer 和 architecture allow-list 删除 `maxToolCalls`；`executionMode=model-only` 保持唯一 request-scoped Tool 禁用约束。
  - 来源：`FN-2.1 + routing-constraint-validation / Routing constraints use an allow-list schema / Forbidden routing override is submitted`；`Constraint validation has two stages / Constraint passes schema validation`；`Budget and execution constraints are enforced before slow boundaries / 请求 model-only 执行`；design §4B
  - 验证：运行 routing-constraint validation/carry/contract tests；unknown 数量字段 fail closed，request 不能修改 assembly limits，model-only 保留 descriptors 且 Tool executor count 为 0

## 5. `FN-2.8 指令定向请求处理`

- [x] 5.1 更新 agent-web submit schema 与 tests：保留 directive-derived targets，非目标约束复用无 Tool 数量预算的 closed allow-list。
  - 来源：`FN-2.8 + directive-capability-routing / Agent Web Requests Do Not Carry Target Directives / Web request carries non-target constraints、Web request attempts direct targetRecipe、Web request attempts direct targetSkill`
  - 验证：在 `frontend/agent-web` 运行 `npm test -- tests/contracts.test.ts tests/requestService.test.ts` 与 `npm run build`

## 6. `FN-4.1 调用模型`

- [x] 6.1 先新增 model contract/config/provider tests，再实现 canonical `ToolChoice`、profile default、resolved/invocation fields、`REQUIRED + tools=[]` pre-provider failure、selected-provider native mapping，以及 `providerOptions`/`modelParams` 的 Tool-choice collision rejection。
  - 来源：`FN-4.1 + model-invocation-contract / Target-state request fields are stable invocation inputs / NONE 保留 Tool descriptor 但禁止 Tool 选择、REQUIRED 没有可选 Tool、未声明 named-tool choice、modelParams 不能覆盖 canonical tool choice`；`全局模型目录提供安全模型配置 / Compatible 模型进入目录`；`Provider options remain an open selected-provider extension / Provider options 不能覆盖 canonical tool choice`；design §4C
  - 验证：运行 model invocation/config、OpenAI-compatible、model request builder 和 remote Model Gateway tests；public export 只名为 `ToolChoice`，named-tool/null/unknown/collision 失败，complete/stream 保留 canonical field，其他 `modelParams` regression 通过

## 7. `FN-4.3 装配上下文`

- [x] 7.1 先新增 merge/render tests，再把 `toolChoice` 纳入 profile、Prompt、Capability patch、trusted request 的逐字段 pre-hook merge 和 `RenderedModelInput`；字段省略表示不覆盖，request-local patch 不持久化，`NONE` 不清空 Tool descriptors。
  - 来源：`FN-4.3 + context-engine / Context Engine separates assembly from rendering / Finalizing patch 保留 Tool descriptors、Tool choice 按 canonical 层次逐字段覆盖`；design §4D
  - 验证：运行 Context assembly、Prompt、Capability patch resolver 和 context contract tests，覆盖完整 precedence、非法 patch 零部分应用和 request 结束清理

## 8. `FN-10.1 注册和执行钩子`

- [x] 8.1 先新增 Hook schema tests，再为 `BEFORE_MODEL_INVOKE` 增加 canonical `toolChoice`，从 `BEFORE_PLANNING` 删除 `maxRounds/maxCalls` 并拒绝所有 loop-limit mutation。
  - 来源：`FN-10.1 + lifecycle-hook-execution / Stage-specific boundaries and mutations are minimal runtime contracts / Planning hook 不能覆盖 Agent loop limits、BEFORE_MODEL_INVOKE Hook 覆盖 ToolChoice、Hook 不能扩大 runtime-owned ToolChoice 硬约束`；design §4E
  - 验证：运行 lifecycle hook wrapper/core/owner integration tests，覆盖合法覆盖、字段省略、unknown/native alias、planning budget rejection、mutation isolation 和 finalizing hard guard

## 9. `FN-10.4 自定义工具和提示词`

- [x] 9.1 更新 Prompt Template parser/schema/compiler 与 tests，使 closed `modelOptions` 支持 optional canonical `toolChoice` 并只做原样 handoff。
  - 来源：`FN-10.4 + prompt-template-assembly / Prompt template selection is deterministic / Prompt template 省略 model option、Prompt template 拒绝非治理 model option、Template 声明 ToolChoice`；design §4F
  - 验证：运行 `packages/agent-context-engine/tests/prompt-template-assembly.test.ts`，覆盖三值、字段省略、named-tool/native alias/null/unknown negative cases

## 10. `FN-5.9 调用技能`

- [x] 10.1 更新 Skill manifest parser、typed metadata、schema、Skill Tool mapper 和 result validation，使 accepted metadata 的 `toolChoice` 只通过已有 `CapabilityContextPatch.modelOptions` 生效。
  - 来源：`FN-5.9 + skill-tool / Skill tool is the model-facing Skill execution entry / Skill metadata 只产生 requested context patch、Skill metadata 提供 ToolChoice patch、Skill metadata 拒绝开放 model options`；design §4I
  - 验证：运行 Skill Tool、Capability patch resolver 和 Skill disclosure tests；覆盖原样投影、省略、非法值、descriptor 保持和 provider authority

## 11. `FN-5.3 读写编辑文件`

- [x] 11.1 用 Read Tool 黑盒 tests 证明 legacy kernel Requirement 迁入 `file-operation-tools` 后，workspace path、offset/limit、bounded page、continuation 和 safe failure 行为无回归；仅在测试暴露缺口时做最小实现修正。
  - 来源：`FN-5.3 + file-operation-tools / Read Tool 只读取受控工作区内的有界文件页 / Read 返回有界文件页、Read 使用缺省分页参数、Read 拒绝非法路径或分页参数、Read 保持取消与超时事实、Read 明确缺失文件和普通 I/O 失败`；design §4H
  - 验证：运行 `packages/agent-capability/tests/read-capability.test.ts`，覆盖合法默认值、0/2000 边界、路径逃逸、目录/glob、timeout/abort 和敏感信息禁止

## 12. `FN-11.1 恢复运行状态`

- [x] 12.1 先新增 checkpoint/recovery tests，再把同一个 `agentTurnIndex` 写入 `RequestContext` 与 checkpoint contract/Record/row；turn checkpoint 幂等语义包含 index，pending/resume/recovery 恢复同一 index，由 `index=maxTurns` 推导 finalizing，不新增 phase、port、store 或 state machine。
  - 来源：`FN-11.1 + local-runtime-recovery / Executing recovery 必须从 checkpoint 和 messages 重建 RequestContext / RequestContext 携带最小 Agent turn 恢复坐标、Recovery 保持 logical Agent turn 坐标`；`检查点记录最小 Agent turn 恢复坐标 / 模型调用前保存 Agent turn 坐标、Turn checkpoint 幂等键不阻止坐标推进`；design §4J
  - 验证：运行 local recovery、durable pending resume 和 recovery guard tests，覆盖连续同 run-version turns、同 turn replay、finalizing、pause/resume、crash replay、coordinate mismatch 和 `BEFORE_CAPABILITY_INVOKE` 不重复 model invocation

## 13. `FN-2.6 指定技能处理`

- [x] 13.1 定向 Skill 复用统一最终结果；成功/合法降级正常返回，取消提交取消终态，其他最终失败安全终止，不启动普通 Agent 模型恢复或第二层 retry。
  - 来源：`targeted-skill-routing / Target Skill failures degrade explicitly`
  - 验证：`packages/agent-core/tests/targeted-skill-routing-failure.test.ts` 覆盖 success/degraded/output-invalid/failure/cancel/resolver rejection 和 invocation count

## 14. `FN-9.4 执行能力节点`

- [x] 14.1 RESTFUL single/poll/batch/PromptSplicing、PYTHON 和 AGENT 节点通过统一 Capability boundary 调用；节点 retry 配置只下沉为 `maxRetries`，最终 Capability 失败不进入第二层节点 retry，取消立即传播，Recipe 显式单项失败策略保持生效。
  - 来源：`workflow-capability-nodes / Restful Node、Capability 节点上升统一最终失败`
  - 验证：Workflow Capability node/engine tests 覆盖独立 invocation identity、零节点 retry、poll/batch strategy、PromptSplicing failure、timeout 和取消

## 15. `FN-9.7 执行模型节点`

- [x] 15.1 `DATA_ANALYSIS` Python 子调用复用统一 Capability failure marker；最终失败使当前节点失败且不重试整个节点，取消传播，未装配 boundary 时保持 model-only 行为。
  - 来源：`workflow-llm-nodes / DATA_ANALYSIS Python 子调用遵守统一失败处置`
  - 验证：`packages/agent-workflow/tests/workflow-llm-nodes.test.ts` 覆盖 success/output-invalid/failure/cancel/invocation count/model-only

## 16. `FN-9.1 执行工作流`

- [x] 16.1 原子迁移 `workflow-execution-engine / Timeout and Retry` 到 `workflow-contracts`，保留非 Capability timeout/retry/exception 行为；Capability 最终失败跳过节点 retry，取消优先，其他最终失败求值显式 exception，无匹配分支时 Workflow 失败。
  - 来源：`workflow-contracts / Workflow 节点重试不重放 Capability 最终失败、最终 Capability 失败统一求值显式 exception、Capability exception 仅观察最终失败事实`
  - 验证：`workflow-execution-engine.test.ts` 覆盖全部 SafeError categories、中间 attempt 不可见、取消/cancel fallback、显式 exception、非 Capability retry 和耗尽结果
- [x] 16.2 将合法 `NODE_WAITING` timeline terminal payload 投影为 `SUCCEEDED + WORKFLOW_NODE_WAITING` 且不携带 `safeError`，不改变节点控制流。
  - 来源：`workflow-contracts / Workflow 节点等待状态投影为成功控制结果`
  - 验证：`workflow-runtime-event-projector.test.ts` 的目标断言先失败后通过，其他节点投影 regression 通过

## 17. `FN-5.6 向用户提问`

- [x] 17.1 AskUserQuestion pre-invocation producer 返回完整、安全且稳定排序的 violations，并保持 tool-use/result 配对、batch 零执行、availability、显式授权/lifecycle/cancellation 和合法 pending-input 生命周期。
  - 来源：`ask-user-question-tool / AskUserQuestion tool creates runtime-owned question pending input、AskUserQuestion 可纠正输入错误进入安全模型纠错、AskUserQuestion 非纠正性失败保持终止和安全边界`
  - 验证：`parallel-tool-loop.test.ts`、`capability-governance.test.ts` 和 AskUserQuestion tests 覆盖完整诊断、配对、控制流与 pending input
- [x] 17.2 更新 AskUserQuestion 黑盒 characterization：保留测试文件名以避免无价值重命名；重复可纠正和非纠正性非取消失败每次反馈模型且无局部 threshold，合法修正创建一个 pending input，取消仍终止。
  - 来源：`FN-5.6 + ask-user-question-tool / AskUserQuestion tool creates runtime-owned question pending input / 合法修正创建 pending input、重复问题数量超限不建立局部阈值`；`AskUserQuestion 可纠正输入错误进入安全模型纠错 / 相同可纠正失败继续进入模型`；`AskUserQuestion 非纠正性失败保持终止和安全边界 / AskUserQuestion 取消与内部错误采用不同处置`；design §9.4
  - 验证：运行 `ask-user-question-fingerprint.test.ts`、`parallel-tool-loop.test.ts`、`capability-governance.test.ts`；production source 中 correction counter/fingerprint 搜索无结果

## 18. `FN-5.5 执行命令和脚本`

- [x] 18.1 Bash 可修正格式错误返回完整 `VALIDATION + retryable=false` 诊断且不 dispatch；正常完成的任意非零退出返回有界结构化 `SUCCEEDED` 结果；Python guard、internal、timeout 和安全部分结果使用统一映射。
  - 来源：`command-script-tools / Bash 对可纠正命令格式错误返回完整诊断、Bash 结果有界且忠实表达进程完成事实、Python guard 和执行失败使用统一安全语义`
  - 验证：Bash/Python capability tests 覆盖 violations、sandbox policy、非零空/非空输出、timeout、guard、internal 和禁止内容

## 19. `FN-5.13 检索知识库`

- [x] 19.1 RAG 合法零命中返回成功；无可用 chunks 的依赖失败返回失败；只有存在可独立使用 chunks 且声明目标部分未完成时返回 `DEGRADED`，并保留安全 message、重试和取消语义。
  - 来源：`rag-tool / Failures and degradation are explicit`
  - 验证：`packages/agent-capability/tests/rag-capability.test.ts` 覆盖 zero-hit、dependency failure、partial success、output invalid、timeout、cancel 和 message

## 20. `FN-8.2 检索和写入记忆`

- [x] 20.1 memory Tool 使用统一 outer `safeError`、公共容量/externalizer 和安全消息；`get_memory_detail` 的 per-entry error 只表示批量业务结果；只读 Tool 可按 replay policy 重试，`add_memory` 保持 `NON_IDEMPOTENT` 且不自动重放。
  - 来源：`memory-tools / search_memory L1 retrieval、Memory tools failure and degradation`
  - 验证：`packages/agent-memory/tests/memory-tools-provider.test.ts` 覆盖 disabled/storage unavailable/item/global error、只读 retry、写入零重放、取消和大结果

## 21. 跨 Function 共享迁移与验证

- [x] 21.1 按 design §2 逐行完成不可部分交付的 Requirement 迁移：来源精确 `REMOVED`，目标精确 `ADDED/MODIFIED` 并承载全部被触及黑盒行为；来源中未触及 Requirements 原位保留，直接引用转向 canonical specs。
  - 来源：design §2；全部 legacy source 与目标 Function groups
  - 验证：运行 OpenSpec strict validation、Requirement operation checker、target behavior tests 和直接引用搜索；mixed legacy Requirement 的全部 Function 切片必须一起通过
- [x] 21.2 清理 production consumer、fixture 和 architecture assertions 中的旧字段、alias、双 per-round budgets、planning budgets、零预算 `tools=[]`、局部 recovery termination 和 local-only turn 假设；实施阶段不修改长期基线文档。
  - 来源：design §2、§13、§17
  - 验证：production source 搜索旧字段和终止 reason 无结果，tests 只保留明确 negative assertions；`npm run lint:architecture` 通过
- [x] 21.3 执行完整门禁并闭合 review findings：OpenSpec strict validate、受影响 backend/frontend 定向 tests、typecheck/build、workspace tests、contract tests、architecture gate 和 diff check；push 前运行 `$nextagent-code-review`。
  - 来源：design §16；0–21 全部任务
  - 验证：运行 `openspec validate unify-capability-failure-disposition --strict`、`openspec validate --all --strict`、`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture` 和 `git diff --check`；前端改动时追加 `frontend/agent-web` build/tests，未运行项说明不适用原因
