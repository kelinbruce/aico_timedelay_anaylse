# Design：Capability 来源终态回答物化与 Message-first

## 设计范围

| Function | 目标变化 | delta spec | 设计章节 |
|---|---|---|---|
| `FN-4.1 调用模型` | direct model 可见文本上限对齐 50,000 字符 Gateway Message 边界，保持带标记截断后成功 | `model-invocation-contract` | FN-4.1 |
| `FN-4.5 压缩转储工具结果` | Capability 来源结果在普通结果 Message 与直接 terminal answer 两个 consumer 前共享同一物化规则 | `large-content-references` | FN-4.5 |
| `FN-4.6 分页查看大结果` | 不改变 read 行为，把旧混合 Requirement 中的有界分页例外迁入 canonical spec | `large-content-readback` | FN-4.6 |
| `FN-9.1 执行工作流` | Direct Workflow 通过显式 Capability terminal handoff 交付结果，不伪装 LLM 输出 | `workflow-event-history` | FN-9.1 |
| `FN-5.17 技能驱动 API 调用` | 非 agentic ApiCall 使用同一 Capability terminal handoff | `skill-driven-api-call` | FN-5.17 |
| `FN-8.1 持久化运行数据` | 原子提交物化后的 terminal Message 与 body-free 有界 Event | `gateway-store-provider-ownership` | FN-8.1 |
| `FN-1.2 断线后从上次位置继续` | live/history 使用同一 committed Message projection | `ts-stream-history-consistency` | FN-1.2 |
| `FN-10.10 任务通道` | request summary 返回同一 committed projection | `agent-task-channel` | FN-10.10 |
| `FN-10.9 Cron 工具` | execution result 返回同一 committed projection | `cron-task-management-api` | FN-10.9 |
| `FN-1.22 展示会话消息正文` | terminal `PERSISTED_PREVIEW` 协议文本转换为本地化友好展示 | `agent-web-assistant-markdown-rendering` | FN-1.22 |

## 存量 Requirement 迁移方案

`Runtime Request Summary Read Model` 当前位于混合承载核心契约与 Channel reconciliation 行为的 legacy `ts-core-contracts`。本 change 必须修改其 terminal result 正文来源，因此按“触及即迁移”原子迁往 `FN-10.10` canonical spec `agent-task-channel`：

- 来源：`ts-core-contracts / Runtime Request Summary Read Model`，delta operation 为 `REMOVED`。
- 目标：`agent-task-channel / Runtime Request Summary Read Model`，delta operation 为 `ADDED`，完整保留 query、scope、pending input、safe error 与内部诊断字段禁止项，只把正文来源从 Event body 改为可信 terminal Message committed projection。
- `ts-core-contracts / Agent Core Uses Runtime-Owned Run State Port` 同时因本次 frozen public contract refinement 被完整 `MODIFIED`，在既有核心契约基线中增加必选 Capability terminal handoff、调用方穷尽和 source-conflict 规则；它不随 Task Requirement 迁移，也不建立新 Function。
- `ts-core-contracts` 除上述一个 `REMOVED` 和一个 `MODIFIED` 外的 Requirements 原位保留；该 legacy spec 不退役。
- 白盒 contract 仍由既有 `RuntimeSessionPort.getRequestSummary` 与 `RuntimeRequestSummary` 持有，不新增 Task alias 或平行 port。
- active changes 若同时修改该 Requirement，必须在本 change 归档前完成协调，不能让归档恢复 Event body owner。

`输出超限不得静默截断` 当前虽然位于 `FN-4.1` canonical spec `model-invocation-contract`，但同一 legacy Requirement 同时承载模型输出恢复、Capability 大结果外置、Runtime terminal guard 与 read 分页四个 Function 的行为。本 change 实质修改其中的模型字符上限、Capability 外置例外与 terminal guard，因此必须无损拆分：

- 来源：`model-invocation-contract / 输出超限不得静默截断`，delta operation 为 `REMOVED`；不得把原混合标题或剩余片段重新作为一个混合 Requirement 保留。
- `FN-4.1` 目标：同一 canonical spec `model-invocation-contract / 模型输出超限执行受控恢复与有界交付`，delta operation 为 `ADDED`；完整保留 `incompleteOutputReason` 判定、reasoning-only 收敛、预算提升、续写、残缺 Tool call 安全失败和取消语义，只把 direct model 字符上限从 150,000 收窄为 50,000。
- `FN-4.1` 直接引用：`model-invocation-contract / Failure exits are explicit and safe`，delta operation 为 `MODIFIED`；只把对旧标题的引用更新为新模型 Requirement，其他失败分类、安全字段和 Scenarios 无损保留。
- `FN-4.5` 目标：`large-content-references / Capability-result large content is externalized to the execution workspace as a readable file`，delta operation 为 `MODIFIED`；承载普通 Capability Result Message 与 Capability 来源 terminal answer 的统一完整外置。
- `FN-8.1` 目标：`gateway-store-provider-ownership / 终态复合提交使用唯一Message正文` 与 `终态timeline Event在复合提交前保持有界`，delta operation 为 `ADDED`；承载 terminal Message 50,000 字符 guard、body-free Event、49,000-byte Event guard 和 composite failure。
- `FN-4.6` 目标：`large-content-readback / Model can read back externalized tool results via the workspace file path with bounded pages`，delta operation 为 `MODIFIED`；原样保留 read 的有界分页、`truncated` 与 `nextOffset` 语义，不修改生产代码或 public contract。
- 原 Requirement 的模型安全约束随 `FN-4.1` 新 Requirement 保留；Capability 全文 authority 与失败安全由 `FN-4.5` Requirement 保留。四个目标共同覆盖原 Requirement 的全部黑盒行为，其他 stable Requirements 原位保留，四个 stable specs 均不退役。

## FN-4.1 调用模型

### 目标与规范依据

direct model 输出必须在进入 Runtime terminal composite 前成为 Gateway 可提交的有界正文，同时保留 stable contract 已有的“超限不丢弃全部有效内容、带明确标记后成功完成”语义。

本 Function 的目标 Requirements：

- canonical spec：`model-invocation-contract`
- `MODIFIED Failure exits are explicit and safe`
- `ADDED 模型输出超限执行受控恢复与有界交付`

### 当前实现

Agent Core 的 `maxModelVisibleChars` 仍为 150,000，并在超过该值时保留前缀、闭合 Markdown、追加固定标记、发布 `MODEL_TEXT_LIMIT_EXCEEDED` 后成功完成。Runtime terminal boundary 已按远端 Gateway 的真实限制把任一 terminal Message 正文上限设为 50,000 字符。

因此 50,001..150,000 字符的正常模型回答会越过 Agent Core 而在 Runtime 被转成请求失败；超过 150,000 字符的 Agent Core 截断结果也可能仍大于 50,000，无法满足持久化边界。stable `model-invocation-contract` 仍冻结 150,000 阈值，与本 change 的 Runtime 代码和 Gateway 事实冲突。

### GAP 分析

- 产品保护阈值大于物理持久化阈值，使 stable 的成功截断路径不可提交。
- 把所有 50,001 字符模型回答在 Runtime 转成失败会丢弃大量已生成的有效正文，并使 `MODEL_TEXT_LIMIT_EXCEEDED` 成功信号不可达。
- 让 LLM 使用 Capability workspace externalizer 会混淆两个结果生产者，新增 ref/readback 和 Message metadata 语义，不是修正阈值所必需。

### 修改方案

唯一生产路径规则如下：

1. 把 Agent Core `maxModelVisibleChars` 改为 50,000 个 UTF-16 code units；流式和 final-only 输出共享该常量。
2. 恰好 50,000 字符时原样生成 final `LLM_CONTENT_DELTA`，不发布超限信号。
3. 首次超过 50,000 字符时立即停止消费该 route 的后缀与未完整 Tool call，禁止 Token recovery 和 cross-model fallback；复用既有 surrogate-safe、Markdown fence/table closure 算法，在总预算内追加固定标记 `[Model output truncated at the 50000-character safety limit.]`。
4. 只发布一个有界 final model content 和恰好一次 `DEGRADATION_NOTICE(code=MODEL_TEXT_LIMIT_EXCEEDED)`，请求以 `REQUEST_COMPLETED` 结束。Issue #821 后续接管 completion limitation carrier 与本地化 marker presentation，不重做 50,000 字符阈值和截断算法。
5. Runtime `maxTerminalMessageChars=50_000` guard 保持不变。正常 Agent Core 生产路径不会触发它；测试或外部 adapter 直接提交 50,001 字符 terminal content 时仍在 Gateway 前形成安全失败。
6. 不调用 `LargeContentExternalizerPort`，不创建 workspace 文件、ContentRef、replacement metadata、新 Message type 或前端分支。

该方案只把既有模型保护常量收窄到真实物理边界，并保留既有成功交付算法，是满足第一性原理与 KISS 的最小改动。模型配置的 `maxOutputTokens` 仍负责常态输出预算；字符上限是独立的最终纵深保护。

### 质量属性影响

- 可靠性/恢复：超限模型回答保留可用前缀并可持久化，不因 producer/boundary 阈值错位转成整次失败。
- 性能/容量：任一正常模型 terminal Message `content.length <= 50,000`。
- 安全：超限后缀、未完整 Tool call 和模型正文不进入 notice、SafeError、audit 或日志。

## FN-4.5 压缩转储工具结果

### 目标与规范依据

Capability Executor 产生的文本结果无论进入普通 `CAPABILITY_RESULT` Message，还是被 caller 直接选为 terminal answer，都先应用同一 50,000 字符物化决策。

本 Function 的目标 Requirements：

- canonical spec：`large-content-references`
- `MODIFIED Capability-result large content is externalized to the execution workspace as a readable file`

### 当前实现

`DefaultLargeContentExternalizer.externalize()` 只在输入 draft 的 `role === 'CAPABILITY_RESULT'` 且 `content.length > 50_000` 时工作。它把完整内容写入 execution workspace 的 `tool-results/<refId>.txt`，并返回有界 preview 与 `metadata.replacement`。

`RuntimeOwnedRunMessagePort.appendMessage()` 在保存普通 Capability Result Message 前调用该 port。terminal composite path 直接接收 string，不调用 externalizer；Direct Workflow 与非 agentic ApiCall 因而绕过该保护。

### GAP 分析

- 分类条件绑定到 Message draft role，不能表达“Capability 结果直接成为 terminal answer”的合法 consumer。
- terminal Message 写入前已有 50,000 字符 fail-closed 校验，但没有先执行 Capability result materialization，因此只能把可恢复的大结果转换为请求失败。
- 若在 terminal commit 中另写一套截断/文件逻辑，会形成第二个阈值、模板、ref 和失败语义 owner。

### 修改方案

保留 `LargeContentExternalizerPort.externalize(SessionMessageDraft, context)`，不新增 large-content port。Runtime 仅在 run-local `setCapabilityTerminalAnswer` handoff 已提交结果时构造一个不持久化的 `CAPABILITY_RESULT` materialization draft，并调用现有 externalizer。该 draft 只是调用既有分类契约的内部参数，不创建 SessionMessage、不进入模型协议、不进入 timeline。

物化顺序固定为：

1. Agent Core 返回原始 Capability terminal answer。
2. Runtime 执行既有 `BEFORE_AGENT_TERMINAL` hook；hook 看到完整原始正文。
3. Runtime 分配真实 terminal MessageId，以该 MessageId 和可信 run context 调用 externalizer。
4. externalizer 在正文大于 50,000 字符时写入 owner-scoped `tool-results` 文件并返回 preview/ref/evidence；否则原样返回。
5. Runtime 把返回的 `content` 和 replacement metadata 交给唯一 terminal composite write；terminal Message 继续使用既有 `contentType='PLAIN_TEXT'`。

externalizer 缺失或返回结果仍大于 50,000 字符时，Runtime 继续使用既有 `TERMINAL_MESSAGE_LIMIT_EXCEEDED` fail-closed；不得发送超限 Message。Workspace 写入失败继续使用 large-content baseline 已定义的 replacement degradation，不在 terminal 层发明 fallback。

无新增黑盒质量目标；容量目标由本 Function 的目标 Requirement 定义。

## FN-4.6 分页查看大结果

### 目标与规范依据

read 的成功结果继续使用有界行分页；仍有后续内容时显式返回 `truncated=true` 与 `nextOffset`，超过单次预算时继续使用既有 `PAGING_REQUIRED`。本 change 只修正该既有行为的 Requirement 规范归属。

本 Function 的目标 Requirements：

- canonical spec：`large-content-readback`
- `MODIFIED Model can read back externalized tool results via the workspace file path with bounded pages`

### 当前实现

`read` 已按 `offset`/`limit` 返回有界行页，并在结果仍有后续内容时返回 `truncated` 与 `nextOffset`；`tool-results` 回读超过单次文本预算时返回带 `suggestedLimit` 的 `PAGING_REQUIRED`。相同语义已经存在于 stable `large-content-readback` 与 `file-operation-tools`，本 change 没有修改对应实现或测试。

### GAP 分析

旧混合 `model-invocation-contract / 输出超限不得静默截断` 把 read 分页列为模型输出规则的例外，使同一 read 行为同时出现在 `FN-4.1` Requirement 与 `FN-4.6` canonical spec。移除旧混合 Requirement 时，必须显式证明该行为由 `FN-4.6` 完整承接，避免语义丢失。

### 修改方案

完整重述 `large-content-readback / Model can read back externalized tool results via the workspace file path with bounded pages`，原样保留 workspace 相对路径、`offset`/`limit`、有界行页、`truncated`、`nextOffset` 和超预算显式分页语义。既有 `Read tool is exempt from externalization to prevent readback loops` 与其他 Requirements 原位保留；该迁移不修改 Runtime、read Tool、workspace port、public schema、测试期望或任何用户可观察行为。

## FN-9.1 执行工作流

### 目标与规范依据

Direct Workflow 与 Workflow-as-Tool 继续共享同一 Workflow engine。两者只在 caller 消费结果的方式上不同：Direct caller 终态化 Capability 结果，Model Loop caller 把 outer Capability result 反馈给模型。

本 Function 的目标 Requirements：

- canonical spec：`workflow-event-history`
- `ADDED Direct Workflow 通过 Capability 结果交付终态回答`

### 当前实现

Direct Workflow 路由在 `DefaultAgent.executeRecipeRoute()` 直接调用 `WorkflowExecutionService.execute()`，随后把 `projectWorkflowExecutionResult(...).terminalContent` 发为 final `LLM_CONTENT_DELTA`。Runtime 只能从该 Event accumulator 获得 terminal content。

Workflow-as-Tool 通过 `workflow-tool-port` 返回 `CapabilityInvocationResult`，由真实 outer Tool call 形成 matching Tool use/result Message，父 Model Loop 再生成最终回答。内部 node lifecycle 与 completed product 由 Workflow Event 持有。

Workflow 中间节点的原始 `outputVariables` 会先合并到 engine 内存 variables，后续节点在同一次执行中使用完整值。开启 Workflow checkpoint 时，这些 variables 会按原值进入 runtime checkpoint；当前没有为 Workflow variables 复用 Capability large-content externalizer，也没有独立的 byte/item 上限。

用户可见的节点产物是另一个有界 presentation 事实：`NODE_COMPLETED` 会投影为 Event-owned `TOOL_STRUCTURED_DELTA`，Runtime 在 timeline write 前将完整 inline payload 限制为 49,000 UTF-8 bytes，超限时保留与原 JSON 容器类型相同的有界前缀并设置 `truncated=true`。该 Event 不建立 Message 或 workspace ref，因此 timeline/history 只能恢复有界产物，不能回读中间节点的完整原文。

### GAP 分析

Direct Workflow 的结果来源是 Capability Executor，但 final `LLM_CONTENT_DELTA` 把它标记成 LLM 输出；这既混淆结果来源，也阻止 Runtime 应用 Capability 大结果保护。为 Direct 内部节点补 Tool protocol Message 会破坏 `workflow-event-history` stable 边界。

中间节点的“业务值”与“用户过程投影”当前已分离，但只有后者有 49,000-byte timeline 保护；前者及 checkpoint 仍无统一大结果物化。这不会再触发已确认的单个 `message.content > 50,000` 拒绝，因为它们不是 Session Message；但对启用 checkpoint 的恢复路径，仍存在未受治理的容量与持久化风险。该风险属于 #844 的 Workflow 内部 executor/variables 统一，不应为修复 terminal 而在 #823 内建第二套中间数据外置。

### 修改方案

对 frozen `AgentRunStatePort` 做 additive refinement：

```ts
interface AgentRunStatePort {
  readonly setCapabilityTerminalAnswer: (
    run: RequestRun,
    context: RequestContext,
    answer: { readonly content: string },
  ) => Promise<void>;
}
```

该方法的 trusted source 是当前 accepted Agent 执行；它不接收 identity、contentType、origin、MessageId、ref、metadata、idempotency 或 persistence command。当前仓库只有 `RuntimeOwnedAgentRunStatePort` 这一生产实现，不存在需要兼容的外部 production adapter，因此该方法为必选；所有 test stub 必须随 contract 同步更新，不能为了减少测试修改把编译期缺失推迟为运行期错误。

Runtime 按 `runId` 保存至多一个 run-local Capability terminal answer。首次调用成功；同一 run 第二次调用必须以 `CAPABILITY_TERMINAL_ANSWER_ALREADY_SET` fail closed，不能覆盖或拼接。run 完成、失败、取消、supersede、pending 或 discard 时清理该内存状态。只有正常 completed terminal source selection 可以消费该 answer；其他终态保持既有正文与状态语义。

生产调用点穷尽为 `executeRecipeRoute()` 的 Direct Workflow 成功路径，以及 pre-round/post-tool-call 两条非 agentic ApiCall 成功路径。普通 Model Loop、model-driven Capability、Workflow-as-Tool 和其他 Capability 不调用该方法。中间 `LLM_CONTENT_DELTA` 只表达 live/model 过程，不与 Capability answer 冲突；如果同一 run 已形成 final LLM terminal source 又提交 Capability answer，或反向发生，Runtime 必须 fail closed，不得用“Capability 优先”隐藏 producer 错误。

这里的“调用点穷尽”是受信任 Agent 实现必须遵守的 producer contract，不是新的调用方鉴权协议。该最小 handoff 刻意不接收可伪造的 `origin`：Runtime 强制校验 accepted run/context、每 run 至多一次、completed-only consumption 和 terminal source conflict；仓内 architecture negative test 则锁住只有上述三处代码路径可以调用。外部 Agent 实现仍须遵守同一 public contract，但 Runtime 不通过调用方自报字段猜测其业务路由。

Direct Workflow 完成时调用该 handoff，然后按既有 `AgentExecutionOutcome.status=COMPLETED` 返回，不再发 final `LLM_CONTENT_DELTA`。WAITING、失败、取消、checkpoint、inner lifecycle/product Event 与 `WorkflowExecutionService` 均保持不变。Workflow-as-Tool 不使用该 handoff，继续返回 outer `CapabilityInvocationResult`。

Direct Workflow 的普通结果继续作为 `PLAIN_TEXT` terminal Assistant Message 显示，与现有答案区域和正文格式一致；本 change 不新增来源标签、Capability 卡片或 content type。只有超出 Gateway inline 容量时，正文才变为既有 workspace preview/ref projection。Workflow inner `TOOL_STRUCTURED_DELTA` 继续按 `toolEventType` 使用既有展示语义：`ANSWER` 属于答案区，`TITLE`、`SUB_TITLE`、`DETAIL`、`SUB_DETAIL` 等属于执行过程区。Workflow correlation 只提供执行关联，不得把 `ANSWER` 重新分类为过程正文。若测试 fixture 同时构造语义重复的 structured `ANSWER` 与 terminal Message，必须修正 producer/fixture，而不得通过改变展示区域隐藏其中一份。

本 change 不重构 Workflow 内部节点执行器，也不新增 `context: inline | fork`、节点级 export 或其他内部过程披露配置。目标架构把 Workflow 视为由 Capability 编排形成的复合 Capability：后续 change 只把业务节点逐步收敛到统一 LLM Executor / Capability Executor 和统一大结果物化，Workflow engine 继续拥有图调度与控制节点。

内部过程默认封装。Workflow-as-Tool 的父 Model Loop 只消费 recipe 主动组装的最终 `CapabilityInvocationResult`；需要对外层模型披露的信息由 recipe 显式写入最终 result，而不是由平台按节点配置自动导出。Direct Workflow 与 Workflow-as-Tool 继续共享 engine 和内部持久化规则，caller 差异只存在于最终 result consumer。#823 只建立当前 Direct Workflow 的终态交付与容量边界，不提前冻结后续 executor 或 checkpoint contract。

若某个超长中间值最终被 recipe 选为 Direct Workflow terminal result，#823 只在该最终 consumer 边界对完整 terminal content 执行 Capability 外置；timeline 中同一节点的过程产物仍是独立的有界 Event，不与 terminal ref 合并。

### 质量属性影响

- 可靠性/恢复：Direct Workflow 大结果先物化后提交，不再因 Gateway Message 字符限制遗失终态。
- 可测试性：同一 engine 的 Direct 与 Tool caller 分别以 terminal handoff 和 Capability result 验收，禁止用 final LLM delta 代替。

## FN-5.17 技能驱动 API 调用

### 目标与规范依据

非 agentic `ApiCall` 是 Capability 结果直接终态化的第二个现存 caller，必须与 Direct Workflow 同形同策。

本 Function 的目标 Requirements：

- canonical spec：`skill-driven-api-call`
- `MODIFIED Orchestration Layer Invokes API Tool And Returns Terminal Response`

### 当前实现

两条非 agentic ApiCall 路径都通过 `capabilityInvocation.invoke()` 获得 `CapabilityInvocationResult`，保存 Capability Result Message 与 process Event，然后把 `structuredPayload` 序列化为 terminal content，并发出 final `LLM_CONTENT_DELTA`。ordinary Capability Result Message 会被 existing externalizer 保护，但 terminal Assistant Message 使用另一份原始正文。

### GAP 分析

同一 ApiCall 结果的 ordinary Capability Result Message 已 externalize，terminal copy 却仍可能超过 50,000 字符；双路径既浪费存储，又可能导致 Capability Message 成功而 terminal composite 失败。

### 修改方案

成功的非 agentic ApiCall 调用 `setCapabilityTerminalAnswer`，正文为既有 terminal selection 结果，然后按既有 completed outcome 返回。删除两条路径用于终态收集的 final `LLM_CONTENT_DELTA`；structured/non-structured streaming Event、`CAPABILITY_COMPLETED`、真实 Capability Result Message、checkpoint、hook 与失败路径保持不变。

只有已通过现有成功状态判断、且 orchestration 已预期直接终止模型循环的 ApiCall 结果可以提交 handoff。普通 model-driven ApiCall 仍把 Capability Result 反馈父 Model Loop，禁止直接终态化。

“既有 terminal selection 结果”必须保持当前显示语义：全 structured stream 继续使用现有零宽占位，混合/非结构化 stream 继续使用既有 non-structured parts 聚合，无 stream 时继续使用序列化后的最终 structured payload。handoff 不得把 raw structured payload 强行替换上述选择，否则会改变 PIU/structured answer 当前呈现；其 Event 恢复问题仍属于方案二。

ordinary Agent Loop 当前可能让相同 structured 业务内容分别出现在模型协议 `CAPABILITY_RESULT` Message 与过渡 `TOOL_STRUCTURED_DELTA` presentation Event 中。#823 只保持该路径的现有行为，不把跨 carrier 重复、PIU/DSL 对模型披露或 Event 分页恢复纳入 terminal 修复，也不得把当前过渡事实写成长期 Message-first 例外；这些由 Issue #748 统一决定 semantic/presentation owner。

两条 direct ApiCall success path 必须停止调用模型专用 `assertTerminalContentReady()`。该 guard 同时包含模型完整性判断和 50,000 字符拒绝，若在 handoff 前保留会让 Capability externalizer 永远收不到超长结果。Capability invocation 的成功 envelope/schema 仍负责结果有效性；terminal boundary 继续保留空正文与最终 Message 容量的纵深保护。

本 change 不删除普通 Capability Result Message，因为它是本轮真实 Tool protocol pair 的模型上下文事实；terminal Assistant Message 是用户最终回答事实。两者语义不同，但超长原始内容 authority 均由同一个 execution workspace ref 机制保护。若未来取消非 agentic 路径中的 model-context Message，应由该 Function 独立变更。

## FN-8.1 持久化运行数据

### 目标与规范依据

terminal composite 只持久化已物化的最终回答 projection，并保持 Message/Event/RequestRun 原子性。

本 Function 的目标 Requirements：

- canonical spec：`gateway-store-provider-ownership`
- `ADDED 终态复合提交使用唯一Message正文`
- `ADDED 终态timeline Event在复合提交前保持有界`

### 当前实现

terminal Event 已 body-free 并受 49,000 UTF-8 bytes 预算保护；Message 保存正文。Runtime 在 output accumulator 和 terminal commit 两处拒绝超过 50,000 字符的 completed content。terminal commit 失败不再发布 fallback。

### GAP 分析

现有 Message-first 只解决 Event 双存，没有区分 LLM 与 Capability 来源。Capability 大结果在 externalize 前被统一长度 guard 转为失败；terminal Message 也没有合并 replacement evidence。

### 修改方案

Runtime 在 `finishRun()` 后选择 terminal source：

- run-local Capability terminal answer 存在且没有 final LLM terminal source：只允许 completed execution 使用其正文；中间 LLM accumulator 内容不得冒充 final source 覆盖它。
- handoff 未被调用：使用既有 `output.finalContent` 与 `output.outputExceeded`，保持 LLM 路径。
- final LLM terminal source 与 Capability terminal answer 同时存在：按 producer contract violation 安全失败，不得声明任一来源优先。

terminal hook 后按 FN-4.5 物化 Capability source。terminal composite 的 Message metadata 先写 replacement evidence，再写 terminal owner 的 `eventType/status/failure/guard` 字段；同名字段冲突时 terminal owner 字段覆盖，replacement 只能保留 large-content schema 定义的 `replacement` 子树。

Event 继续只包含 `terminalMessageId`、安全失败字段和有界 hook snapshot。live terminal Event 使用已提交 Message 的物化正文，不恢复原始大正文。任一 composite write 失败时不发布 terminal presentation。

### 质量属性影响

- 性能/容量：Gateway 收到的 terminal Message `content.length <= 50_000`；Event 完整 payload 继续不超过 49,000 UTF-8 bytes。
- 可靠性/恢复：Message、Event、RequestRun 仍是单一 composite write；不引入 fallback 或第二 terminal store。
- 安全：workspace ref 使用可信 run scope 与真实 terminal MessageId 生成；客户端不能提供路径或 origin。

## FN-1.2 断线后从上次位置继续

### 目标与规范依据

live 与 cold history 呈现同一个 committed terminal Message projection；大结果全文 authority 在 ref，不在任一 presentation cache。

本 Function 的目标 Requirements：

- canonical spec：`ts-stream-history-consistency`
- `ADDED 终态回答通过唯一Message关联恢复`

### 当前实现

branch 已实现 terminal Event 通过 `terminalMessageId` 关联 Message，并对 owner/agent/session/request/run/role/visibility/metadata fail closed。旧 delta 误要求 live 与 history 都返回完整 60KB 正文。

### GAP 分析

若 live 仍返回物化前全文而 history 读取 Message preview，用户会观察到不可恢复的分叉；若 history 试图读取 workspace 文件自动展开，则会新增公开读取契约和延迟/授权语义。

### 修改方案

commit 成功后的 live terminal projection 使用 committed terminal Message 的 `content`；conversation、run history 与 resume 使用同一 Message。外置时这些 surface 均显示 preview/ref 文本和既有 replacement metadata，不在本 change 自动读回全文。关联失败继续保留状态、返回 content unavailable，禁止 Event body fallback。

## FN-10.10 任务通道

### 目标与规范依据

Task request summary 返回同一 committed terminal Message projection。

本 Function 的目标 Requirements：

- canonical spec：`agent-task-channel`
- `MODIFIED Runtime Request Summary Read Model`

### 当前实现

branch 已把 request summary 从 terminal Event body 改为可信 Message association，但旧 delta 误要求超长结果仍返回物化前“完整正文”。

### GAP 分析

“完整正文”与 Capability externalization 冲突；Task 必须消费已提交 Message projection。

### 修改方案

保留 Message association、safeError 校验和既有 public query schema，`terminalResult.content` 返回 Message 中已提交的 inline 或 preview/ref projection。

## FN-10.9 Cron 工具

### 目标与规范依据

Cron execution query 返回同一 committed terminal Message projection。

本 Function 的目标 Requirements：

- canonical spec：`cron-task-management-api`
- `MODIFIED Cron task execution record API surface`

### 当前实现

branch 已增加 terminal Message association，旧 delta 要求超长结果返回完整正文。

### GAP 分析

该要求会迫使 query 绕过 Message-first 去读取 workspace 文件，扩大 API、授权和容量范围。

### 修改方案

`resultContent` 返回 Message 中已提交的 inline 或 preview/ref projection；关联失败省略正文，Gateway read failure 继续失败。REST DTO 不新增 `contentRef` 字段；既有 Message content 已包含 presentation-safe ref 指令，后续全文 UI 由独立 change 设计。

## FN-1.22 展示会话消息正文

### 目标与规范依据

Capability 超长终态回答必须保留模型可回读的 canonical `PERSISTED_PREVIEW` 持久化形态，但普通用户不应直接看到 replacement reason、`ContentRef`、workspace 路径和 Read 工具指令。

本 Function 的目标 Requirement：

- canonical spec：`agent-web-assistant-markdown-rendering`
- `ADDED 外置终态结果以用户语言展示部分内容`

### 当前实现

terminal Message 的 canonical preview content 通过 live terminal 与 conversation history 进入既有 answer content 聚合和 Markdown renderer。当前聚合层把整段 `<persisted-content>` 协议文本当作普通答案，因而页面直接显示 reason、ref、原始字符数、workspace 路径和 Read 指令。live terminal 公共投影只带 committed Message content；cold history 另有 Message metadata，但两条路径共享同一正文形态。

### GAP 分析

- canonical preview 是为模型回读和持久化证据设计的技术协议，不是面向普通用户的答案文案。
- 只依赖 history-only replacement metadata 会使 live 与刷新后呈现分叉；为 live 新增 metadata 字段则会无必要地扩大公共契约。
- 在前端读取 workspace 全文会同时引入授权、生命周期、容量和交互边界，不是改善现有 preview 文案所必需。

### 最小投影方案

1. persistence、Channel、Task 和 Cron 仍使用既有 canonical Message content，不修改 replacement evidence 或公共字段。
2. `agent-web` 只在 terminal answer 中识别完整合法的 canonical `PERSISTED_PREVIEW` 形态；形态不完整时按普通正文显示，不根据部分标记猜测。
3. 页面以当前 locale 显示“结果内容较长，以下展示部分内容”、原始字符数、有界 preview 和“完整结果已保存，可继续提问按需查看”；不显示 `<persisted-content>`、reason、ref type/id、内部路径或 Read 指令。
4. 同一本地投影函数同时用于 live terminal content 和 cold history content，不依赖 history-only Message metadata，因而两者呈现一致。
5. 复用现有 Markdown answer renderer 和 i18n 资源，不新增组件、样式、下载/展开交互或 workspace 读取。全文 UI 与 BlobStore 权威存储仍由后续 #846 类独立变更收敛。

## 跨 Function 协作与端到端流程

### Workflow / ApiCall 兼容性门禁

#823 允许改变 producer 到 Runtime 的内部 handoff，但不允许改变 50,000 字符以内既有业务路径的公开行为。兼容性按用户可观察 projection 比较，不按内部 raw Event 序列逐字段比较；final `LLM_CONTENT_DELTA` 被删除是预期内部差异，答案正文缺失、延后到刷新、重复或产生新步骤不是允许差异。

| 路径 | 必须冻结的修改前行为 | 允许差异 |
|---|---|---|
| Direct Workflow inline success | `PLAIN_TEXT` 单一答案、答案区位置、inner process/product、状态与相对顺序 | 内部结果改经 Capability terminal handoff |
| Workflow-as-Tool | matching outer Tool use/result、父 Model Loop 后续调用、inner Event、waiting/failure/cancel/timeout | 无用户可见差异 |
| non-agentic ApiCall pre-round / post-tool-call | 既有 terminal selection、Capability Result Message、structured delta、PIU/DSL、completion Event、checkpoint、单一答案 | 内部 final LLM delta 改为 handoff |
| model-driven ApiCall | matching Tool protocol、Capability lifecycle、后续模型调用和 LLM final answer | 无行为差异 |
| Direct Capability result >50,000 chars | 现状 Gateway 拒绝、缺失 durable terminal facts | 预期修复为 completed + 既有 preview/ref |

测试先记录修改前 characterization，再修改 producer。比较对象包括 terminal Message content/contentType、public stream envelopes、settled history answer segments、ProcessPanel entries 及其状态/顺序；动态 id、sequence、timestamp 和被明确删除的内部 final delta 不作为相等条件。

前端不得新增公共字段、组件、样式或全文交互。现有 structured 投影不得因 Workflow correlation 改变 `toolEventType` 的区域语义：Workflow 与 ordinary Model Loop / Tool 的 structured `ANSWER` 都留在答案区，过程类型继续留在 ProcessPanel。terminal answer 中完整合法的 canonical `PERSISTED_PREVIEW` 使用现有 Markdown answer renderer 显示本地化友好说明和有界 preview，不把技术协议原文直接暴露给用户。

### Direct Workflow / 非 agentic ApiCall

1. caller 通过既有 Capability/Workflow executor 获得结果。
2. Agent Core 通过 `setCapabilityTerminalAnswer` 提交结果并返回既有 `COMPLETED`，不发 final LLM delta。
3. Runtime 结束 run-local Event flush，执行 terminal hook。
4. Runtime 用真实 terminal MessageId 调用 existing large-content externalizer。
5. terminal composite 原子提交 RequestRun、物化后的 Assistant Message 和 body-free Event。
6. commit 成功后 live 发布 Message projection；conversation/run history、Task、Cron 通过同一 Message association 恢复。

### Model Loop

1. LLM output 继续由 `LLM_CONTENT_DELTA` accumulator 收集；Agent Core 在累计可见文本首次超过 50,000 字符时生成不超过该边界的带标记正文。
2. `AgentExecutionOutcome.COMPLETED` 保持既有无正文控制结果；当前 `MODEL_TEXT_LIMIT_EXCEEDED` notice 与 final content 一起进入既有 Runtime 流程。
3. Runtime 接收正常 producer 的正文时不会再超过 50,000；对绕过 Agent Core 保护的原始超限 terminal content继续 fail closed，且不调用 Capability externalizer。
4. 模型专用 `assertTerminalContentReady()` 继续只用于 LLM final content，不用于 Direct Workflow 或非 agentic ApiCall terminal answer。

### Workflow-as-Tool

1. outer Model Loop 产生真实 Tool call。
2. Workflow 使用与 Direct 相同的 engine，返回 outer `CapabilityInvocationResult`。
3. ordinary Capability Result Message 使用既有 large-content externalizer；父 LLM 消费 preview/ref 后产生最终答案。
4. inner node 继续只使用 Workflow Event，不创建嵌套 Tool protocol Message。

上面的第 4 点只冻结 #823 期间的持久化边界，不表示 Workflow 业务节点长期保留平行执行器。后续统一时应复用 LLM/Capability Executor 的执行治理和大结果物化，但通过 Workflow variable/checkpoint 与 inner presentation Event 承载内部结果，不为父 Model Loop 伪造嵌套 Tool protocol Message；父模型仍只得到 recipe 组装的最终 outer result。

## 跨 Function 质量属性设计

- 容量：Gateway Message 的物理字符边界统一为 50,000；`model-invocation-contract` 拥有 LLM 有界截断，`large-content-references` 拥有 Capability 全文外置，terminal Event 的 49,000-byte JSON 上限仍由 `gateway-store-provider-ownership` 拥有，三者不得混用。
- 一致性：所有成功 surface 只呈现 committed terminal Message projection；workspace 文件是外置全文 authority，不是第二 Message body。
- 恢复：remote Gateway 明确的单个 `message.content > 50,000` 拒绝通过本地 rejecting provider characterization；整请求体没有另一个已确认上限，不在测试中虚构。

## 备选方案与取舍

- 允许 terminal Message/Event 双存：改动较小但无法解决 Message 自身 50,000 字符拒绝，也破坏 durable owner。
- terminal 层独立截断：能提交但永久丢失全文，并复制 Capability externalization policy。
- terminal 层直接用 BlobStore：BlobStore 无当前大小限制，但会建立第二个 Capability result storage/readback 机制，模型现有 `read` 工具也不能直接分页读取。
- LLM 超过 50,000 字符直接失败：代码最少但丢弃已生成的有效正文，回退 stable 的成功有界交付，并让 Issue #821 的 `MODEL_TEXT_LIMIT_EXCEEDED` 成功限制事实不可达。
- LLM 继续使用 150,000 字符上限：与不可修改的 Gateway 单 Message 50,000 字符边界矛盾，无法形成可提交的 terminal Message。
- 修改 `AgentExecutionOutcome` 返回正文：会违反 frozen “final answer 经 runtime-owned run state 发布”的 core contract，也把控制 outcome 变成业务 payload carrier。
- 继续发 final LLM delta：代码最少，但继续违反结果来源边界，Runtime 无法只对 Capability 应用物化。
- 让 LLM 也改用统一 `setTerminalAnswer(origin, ...)`：长期形态更对称，但会同时重做 model streaming、completion limitation 与 hook 链路，超出 #823 最小闭环。
- 为 Capability terminal answer 增加 content type、来源标签或专用前端卡片：扩大公共展示契约；当前两类 direct producer 的普通结果必须保持既有 `PLAIN_TEXT` 答案显示。
- 为 Direct Workflow inner node 创建 Capability Result Message：破坏 stable Workflow Event-owned process contract，并把内部编排误建模为外层模型 Tool protocol。
- 为 Workflow 增加内部过程披露配置：把业务编排应显式决定的最终 result 变成平台隐式导出策略，增加产品理解和测试矩阵，且不是 #823 容量故障所需。

选择 additive terminal handoff + existing externalizer，是同时满足结果来源、KISS、同形同策和 #823 最小生产闭环的唯一方案。

## 验证策略

- contract tests：冻结必选 `setCapabilityTerminalAnswer(run, context, {content})` 精确 shape；确认无 contentType/origin/event/role/gateway/public DTO 增量。
- unit/characterization：模型 50,000 字符原样成功且无 notice，50,001 字符按固定标记截断后成功；流式停止、surrogate/Markdown 安全、Tool call 丢弃保持。Direct Workflow 与两条非 agentic ApiCall 路径不再发 final LLM delta；Workflow-as-Tool 与普通 model loop 的非容量语义不变。
- architecture/negative：生产调用点只允许 Direct Workflow 与两条非 agentic ApiCall direct-terminal path；final LLM source 与 Capability source 冲突必须 fail closed，中间 LLM delta 不误判。
- runtime integration：正常模型 50,000/50,001 字符成功边界，以及绕过 Agent Core 的原始 50,001 字符 Runtime fail-closed；Capability ASCII/中文、workspace 写入成功/失败、hook 修改后再物化、Message/Event 原子提交、真实 commit failure 无 fallback。
- channel/read model：live、conversation/run history、Task、Cron 对同一 terminal Message 返回相同 projection；invalid association fail closed。
- architecture：Core 不拥有 persistence，Runtime 不实现第二 externalizer，Channel/browser 不读取 hidden Message 或 workspace 文件。
- scope regression：#823 不改变 ordinary structured Message/Event owner，不增加 Workflow 披露配置，不实现内部节点 executor 迁移；Issue #748、#827、#828 与后续 Workflow 架构事项保持独立。

## 长期基线刷新计划

- stable specs：更新 `model-invocation-contract`、`large-content-references`、`large-content-readback`、`workflow-event-history`、`skill-driven-api-call`、`gateway-store-provider-ownership`、`ts-stream-history-consistency`、`agent-task-channel`、`cron-task-management-api`、`agent-web-assistant-markdown-rendering`；归档时必须为 legacy `large-content-readback` stable spec 补齐 `FN-4.6` 主规格元数据，不能依赖 OpenSpec CLI 自动合并 delta 顶部元数据。
- frozen legacy core spec：把 `ts-core-contracts / Agent Core Uses Runtime-Owned Run State Port` 的 confirmed target state 合入 stable，同时按迁移方案移除 `Runtime Request Summary Read Model`。
- Functions：刷新 FN-4.1、FN-4.5、FN-4.6、FN-9.1、FN-5.17、FN-8.1、FN-1.2、FN-10.10、FN-10.9、FN-1.22；FN-4.1 把模型硬字符上限更新为 50,000，并把旧 Requirement 标题引用替换为 `模型输出超限执行受控恢复与有界交付`；FN-4.5 移除过期 64 KiB 建议值并写入 50,000 字符边界，FN-4.6 只同步既有 read 分页规范归属而不改变规格值，FN-1.22 只同步 terminal preview 的本地展示语义。
- Features：在 Function 汇总后刷新 F-4.1、F-4.4、F-9.1、F-5.6 的关键结果，并为 F-1.4 补充外置 terminal answer 的友好部分内容展示；其他 Feature 无。
- overview：补充 #823 的真实 Gateway 单 Message 字符限制和结果来源原则。
- architecture：更新 core contracts、runtime boundaries、capability SPI、conversation process history。
- modules：更新 agent-contracts、agent-core、agent-runtime、agent-context-engine、agent-workflow、agent-channel-common/web、agent-app；明确 `AgentExecutionOutcome` 不变。
- ADR：更新 `large-content-workspace-readback` 与 `process-message-body-owned-by-message`；不新增 ADR。
- spec-to-design-map：更新上述 specs 的设计与验证入口。

## 回滚边界

本 change 的 contract 与 consumer 必须原子回滚。只回滚 Agent producer 会使 Runtime 收不到 Capability terminal answer；只回滚 Runtime materialization 会恢复 Gateway 拒绝；只回滚 Message readers 会使 body-free Event 无法恢复正文。回滚不得恢复 live-only terminal fallback。
