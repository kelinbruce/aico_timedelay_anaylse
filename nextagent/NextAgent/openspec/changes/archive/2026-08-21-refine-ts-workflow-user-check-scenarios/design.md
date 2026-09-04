## 背景和现状（Context）

`user-check` 节点由 `add-ts-workflow-interaction-nodes` 归档引入，当前实现只支持 `kind: "QUESTION"` 单一场景，等待超时走 `inputs.timeout` + `timeout_result` 兜底恢复，上限 24h。`PendingInputQuestion` 结构只有 `{ prompt, options, multiple?, custom? }`，填空题不携带格式约束信息。

相关 active change：
- `refine-ts-workflow-exception-failure-contract`：重新定义 exception 变量空间为 `{code, message, category?}`，`category` 仅保留 `TIMEOUT` 单值。本 change 的超时 exception 路由依赖此 shape。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- `user-check` 支持四种 kind 场景：QUESTION（缺省）、CONFIRMATION、AUTHORIZATION、HUMAN_HANDOFF
- 等待超时复用 `node.timeout`，上限 48h，超时即失败走 exception
- 填空题通过 `PendingInputQuestion.inputFormat` 携带格式约束

**非目标：**
- 不改变 runtime pending input 的生命周期 owner（仍为 `agent-runtime`）
- 不改变 engine 的 abort signal 机制和 exception 分支机制
- 不修改 `terminalizeHumanHandoffFinalAnswer`（当前无实际 producer 使用 runtime HUMAN_HANDOFF pending input 的 final_answer 路径）
- 不修正 `PendingInputProducerRef` 枚举（spec-vs-implementation gap，可单独修正）
- 不定义前端 UI 渲染逻辑
- 不约束 inputFormat 子字段（产品按需定义）

## 设计决策（Decisions）

### D1: node.timeout 复用为等待超时（Gap1）

**选择：** handler 读取 `context.node.timeout`（秒）转换为 `timeoutAt`，废弃 `inputs.timeout`。

**理由：** `node.timeout` 已在 `WorkflowNodeDefSchema` 定义，loader 已透传。engine 的 abort signal 用同一个值创建 `nodeSignal`，但 `nodeSignal` 在 handler 返回后立即 `dispose()`（`finally` 块），WAITING 期间不计时。等待超时由 handler 转成 `timeoutAt` 交给 runtime pending input 层独立管理。两套计时器生命周期不重叠。

**同形同策例外：** `node.timeout` 对 user-check 等待型节点表达「等待超时」语义，对其他节点表达「执行超时」语义。两套机制生命周期不重叠，不会互相干扰。例外记录在 ADR。

### D2: 超时即失败，废弃兜底恢复（Gap1）

**选择：** 超时抛 `WORKFLOW_NODE_TIMEOUT`（category: TIMEOUT），走 engine exception 分支，无 exception 则 `terminalState: FAILED`。废弃 `timeout_result`/`timed_out`/`readTimeoutResult`。

**理由：** 电信场景的超时语义是「没人响应=失败」。engine 已有完整的 exception 机制，直接复用。user-check 默认 `maxRetries: 0`，超时抛错后直接进 exception 分支，不会重新创建 pending input。

### D3: 48h 上限（Gap1）

**选择：** `agent-run-state-port.ts` 的 `pendingInputMaxTimeoutMs` 从 `24 * 60 * 60 * 1000` 改为 `48 * 60 * 60 * 1000`。

**理由：** 人工接管的实际响应窗口可能跨天（如夜间告警次日处理）。校验逻辑不用改，`maxTimeoutAt` 自动跟着变。这是 runtime 实现内部常量调整，不涉及 contract 字段。

### D4: question 级 inputFormat（Gap2）

**选择：** 在 `PendingInputQuestion`（runtime）和 `PendingInputQuestionRecord`（gateway）新增 `inputFormat?: JsonObject` 字段。`inputFormat` 为 opaque JSON 对象，子字段不做约束，产品按需定义。

**理由：** 格式约束直接挂在 question 上，与 question 一一对应，不需要外部 name 映射。比节点级 metadata（之前方案，需改 6 个类型）更轻量——只改 2 个类型。askUserQuestion 不设 inputFormat，行为完全不变（向后兼容）。

**recipe DSL：** recipe 在 `inputs.fields` 中定义填空题字段列表。handler 为每个 field 创建一个 `PendingInputQuestion`（prompt 取 description，options 为空，custom=true，inputFormat 携带 field 中除 name/description 外的格式约束字段）。fields 的子字段不做约束，产品按需定义。

**resume 取值：** handler 在 resume 时通过 `context.node.inputs` 读取 recipe 的 `fields[].name` 做 key，组装结构化 `user_check_result`（多 field 为对象，单 field 为字符串）。不依赖 inputFormat.name——inputFormat 是给 task channel 的格式约束，不是 handler 的取值依据。

**runtime 透传：** `acceptPendingInput` 构造 `PendingInputRequestRecord` 时透传 `question.inputFormat`（当前只提取 prompt/options/multiple/custom，需补透传 inputFormat）。runtime 不校验不解析 inputFormat 内容。

### D5: 四种 kind 按 kind 分流（Gap3）

**选择：** handler 读 `inputs.kind`（缺省 `QUESTION`），按值分流：
- QUESTION（缺省）：保留现有 `tips`/`action_type`/`options`（choice）或 `fields`（input）逻辑。`action_type` 有效值为 `choice`/`input`/`confirm`，`confirm` 为兼容值保留现有行为。
- CONFIRMATION/AUTHORIZATION：不读 `options`/`action_type`，handler 自动构造固定二元 options
- HUMAN_HANDOFF：不创建 pending input，`emitOutputDelta` 投影 tips 后抛 `WORKFLOW_HUMAN_HANDOFF`

**kind 缺省 QUESTION：** 现有 recipe 不写 kind 时行为不变。choice recipe 走 QUESTION + action_type=choice，input recipe 走 QUESTION + action_type=input，confirm recipe 走 QUESTION + action_type=confirm。

**action_type 交互规则：** kind=QUESTION 或缺省时 action_type 必填（choice/input/confirm）；kind 非 QUESTION 时 action_type 不出现，handler 不读取。

### D6: HUMAN_HANDOFF 通知后失败退出（Gap3）

**选择：** handler 通过 `emitOutputDelta({ channel: "CONTENT", content: tips })` 投影通知内容到 stream，然后抛 `WORKFLOW_HUMAN_HANDOFF`（category: INTERNAL, retryable: false），走 exception 分支，无 exception 则 FAILED。

**不走 pending input 的理由：** 场景语义是「任务目标无法达成，通知用户后系统退出」。系统已决定无法继续，不是「等待人工输入」。人工接管发生在 run 之外（另起新请求或线下处理）。

**架构约束关系：** 架构（ts-backend-architecture）写「人工接管都进入 runtime-owned pending input」，这里的「人工接管」指 runtime `PendingInputKind.HUMAN_HANDOFF`——run 挂起等人工回答 final_answer/resume_instruction。user-check 的 `kind: HUMAN_HANDOFF` 不等于 runtime `PendingInputKind.HUMAN_HANDOFF`：前者是失败通知场景标识（通知后失败退出），后者是交互等待 pending input kind（挂起等人工）。架构约束适用于后者，不适用于前者。两者复用 kind 枚举值名称但执行路径不同。例外记录在 ADR。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | inputFormat 是 typed 透传，runtime 不解析；inputFormat MUST NOT 携带 credential/路径/高基数字段；HUMAN_HANDOFF 通知内容经 emitOutputDelta 投影，走 display-content 同一安全通道 | contract test: inputFormat shape；interaction-nodes test: HUMAN_HANDOFF 通知内容安全 |
| 性能/容量 | 48h 上限放宽 pending input 持久化时长；inputFormat 是 typed 小对象，不增加 runtime 校验开销；HUMAN_HANDOFF 不创建 pending input，减少 pending store 负载 | contract test: 48h 边界 |
| 可靠性/恢复 | 超时改失败语义后，recipe 必须通过 exception 分支显式处理；无 exception 时 FAILED 中断是确定性终态；kind 缺省 QUESTION 保证现有 recipe 不受影响 | interaction-nodes test: 超时 FAILED/exception；kind 缺省兼容 |
| 可维护性 | node.timeout 复用减少字段数量；kind 分流逻辑集中在 executeUserCheckNode；inputFormat 随 question 透传，无需额外 bridge 逻辑 | 架构检查: 无平行 timeout 字段 |
| 可测试性 | 四种 kind 各有独立 scenario；超时 exception 可通过 mock timeoutAt 验证；inputFormat 透传可通过断言 question.inputFormat 验证；kind 缺省可通过不写 kind 的 recipe 验证 | interaction-nodes test: 四种 kind + 缺省 |
| 审计/可追溯性 | HUMAN_HANDOFF 通知通过 emitOutputDelta 可追溯；超时失败产生 WORKFLOW_NODE_TIMEOUT safeError 进入 timeline；inputFormat 不进 timeline/audit（question 级元数据） | interaction-nodes test: HUMAN_HANDOFF emitOutputDelta |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| node.timeout 复用为等待超时 | T1.1 | interaction-nodes test |
| 超时抛 WORKFLOW_NODE_TIMEOUT 走 exception | T1.2 | execution-engine test |
| 废弃 inputs.timeout/timeout_result/timed_out | T1.3 | interaction-nodes test negative |
| 48h 上限 | T1.4 | contract test |
| inputFormat 全链路透传 | T2.1-T2.3, T2.5 | contract test + interaction-nodes test + runtime record test |
| inputFormat 不进 outputVariables | T2.4 | interaction-nodes test negative |
| inputFormat pattern/maxLength 可选校验 | T2.6 | runtime test |
| kind 缺省 QUESTION | T3.1 | interaction-nodes test |
| QUESTION choice/input/confirm 保留现有逻辑 | T3.2 | interaction-nodes test |
| CONFIRMATION 自动构造 approve/reject | T3.3 | interaction-nodes test |
| AUTHORIZATION 自动构造 approve/deny | T3.4 | interaction-nodes test |
| HUMAN_HANDOFF emitOutputDelta + 抛错 | T3.5 | interaction-nodes test |
| HUMAN_HANDOFF 不创建 pending input | T3.6 | interaction-nodes test negative |
| CONFIRMATION reject runtime FAILED | T3.7 | interaction-nodes test |
| fields 创建多 question + inputFormat | T3.8 | interaction-nodes test |
| 结构化 user_check_result（fields[].name 做 key） | T3.9 | interaction-nodes test |
| boundary 不可用抛错 | T3.10 | interaction-nodes test |

## 文档承载决策（Documentation Ownership）

| 事实 | 主承载文档 |
|---|---|
| User Check 行为契约 | `openspec/specs/workflow-interaction-nodes/spec.md` |
| Timeout and Retry 行为契约 | `openspec/specs/workflow-execution-engine/spec.md` |
| pending input 边界对象契约（inputFormat 字段、48h 上限） | `openspec/specs/ts-core-contracts/spec.md` |
| user-check 跨模块流程 | `openspec/designs/architecture/workflow-execution-and-routing.md` |
| executeUserCheckNode 模块设计 | `openspec/designs/modules/agent-workflow.md` |
| node.timeout 复用取舍 | `openspec/designs/adr/workflow-user-check-timeout-reuse.md` |
| HUMAN_HANDOFF 通知退出取舍 | `openspec/designs/adr/workflow-human-handoff-notify-exit.md` |
| spec 到 design 导航 | `openspec/designs/spec-to-design-map.md` |

## 风险与取舍（Risks / Trade-offs）

- [BREAKING: 废弃 inputs.timeout/timeout_result] -> 现有 recipe 需迁移到 node.timeout + exception；现有测试需改写。迁移范围限于 user-check 节点。
- [BREAKING: PendingInputQuestion 新增 inputFormat] -> 涉及 frozen core contract，需 contract refinement 确认。inputFormat 是可选字段，旧代码不设时行为不变。
- [node.timeout 双重语义] -> 同一个值在 handler 执行期是 abort signal，在 WAITING 期是等待超时。两者都是失败语义，且生命周期不重叠。ADR 记录例外。
- [HUMAN_HANDOFF 不走 pending input] -> user-check 的 kind: HUMAN_HANDOFF 与 runtime PendingInputKind.HUMAN_HANDOFF 同名但执行路径不同。前者是失败通知，后者是交互等待。ADR 记选取舍。
- [48h pending input 资源占用] -> 48h 的 pending input 持续占用 pending store。需确认 pending store 的 TTL 配置支持 48h。
- [依赖 exception-failure-contract] -> gap1 超时 exception 路由依赖该 change 先落地 error.category == "TIMEOUT" shape。

## 迁移计划（Migration Plan）

1. 废弃 `inputs.timeout` -> recipe 迁移到 `node.timeout`（节点顶层属性）
2. 废弃 `inputs.timeout_result` -> recipe 迁移到 `exception` 分支
3. 现有测试改写：timeout 测试从断言 `timed_out` + `timeout_result` 改为断言 `WORKFLOW_NODE_TIMEOUT` exception/FAILED
4. kind 缺省 QUESTION 保证现有不写 kind 的 recipe 无需迁移
5. action_type=confirm 保留兼容，现有 recipe 无需迁移
6. 回滚策略：恢复 `inputs.timeout`/`timeout_result` 逻辑和 `pendingInputMaxTimeoutMs = 24h`

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/workflow-interaction-nodes/spec.md`：修改 User Check requirement
- `openspec/specs/workflow-execution-engine/spec.md`：修改 Timeout and Retry requirement
- `openspec/specs/ts-core-contracts/spec.md`：修改 Hook And Pending Boundary Baseline requirement（inputFormat 字段、48h 上限）
- `openspec/designs/architecture/workflow-execution-and-routing.md`：补充 user-check 跨模块流程
- `openspec/designs/modules/agent-workflow.md`：补充 executeUserCheckNode 设计落点
- `openspec/designs/adr/workflow-user-check-timeout-reuse.md`：新增 ADR
- `openspec/designs/adr/workflow-human-handoff-notify-exit.md`：新增 ADR
- `openspec/designs/spec-to-design-map.md`：新增导航

## 待确认问题（Open Questions）

- pending store 的 TTL 配置和清理策略是否已支持 48h？
- `refine-ts-workflow-exception-failure-contract` 是否能先于本 change 落地？
