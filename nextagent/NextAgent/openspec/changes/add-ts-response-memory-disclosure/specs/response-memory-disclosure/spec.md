## ADDED Requirements

### Requirement: 完成回复披露实际引用和同步新增的长期记忆

本 spec 中“可披露完成 attempt”指最终规范化终态为 `REQUEST_COMPLETED`，且执行状态未从 durable execution facts 重建的 request attempt。系统 SHALL 只在可披露完成 attempt 的回复底部按非空分组展示当前 attempt 实际引用和同步新增的长期记忆。每组标题 MUST 分别使用“引用了 N 条记忆”和“新增了 N 条记忆”，其中 N MUST 等于该组实际展示的去重条目数；展开后 MUST 能查看该组全部条目的规范化记忆内容。

披露条目 MUST 只包含稳定 `memoryId` 和规范化 `content`。`memoryId` 只用于去重和投影 identity，前端 MUST NOT 把它显示给用户。每个展开项 MUST 按 `content.category` 使用固定中文字段标签展示全部非空内容：FACTUAL 使用“主体、事实、证据、限定条件”，CONCEPTUAL 使用“概念、定义、别名、相关概念”，PROCEDURAL 使用“流程名称、流程内容”，USER_CHARACTERISTICS 使用“特征、用途”；数组字段 MUST 展示全部元素，前端 MUST NOT 把原始 JSON 序列化文本直接作为用户正文。

系统 MUST NOT 在本区域展示记忆来源、来源标题、来源链接、`memoryVersion`、独立 `memoryType`、编辑操作、“暂不可用”状态或省略计数；类别只通过 `content.category` 表达。两组均为空时 MUST 不展示记忆区域。

`REQUEST_FAILED`、`REQUEST_CANCELED` 和 `REQUEST_SUPERSEDED` 的 canonical assistant message、terminal event、live 投影和 conversation 投影 MUST 均不包含 `memoryDisclosure`，frontend MUST NOT 为这些 turn 展示记忆区域。前序 attempt 的 `referenced` 或 `created` MUST NOT 复制到 retry、edit、resubmit 或 supersede successor。

#### Scenario: 完成回复同时引用和新增记忆
- **WHEN** 一次可披露完成 attempt 最终以 `REQUEST_COMPLETED` 结束
- **AND** 该 attempt 实际引用 E1、E2 并同步新增 E3
- **THEN** 回复底部 MUST 展示“引用了 2 条记忆”和“新增了 1 条记忆”
- **AND** 展开后 MUST 分别显示 E1、E2、E3 的规范化内容

#### Scenario: 只有一个非空分组
- **WHEN** 可披露完成回复只实际引用 E1 且没有同步新增记忆
- **THEN** 回复底部 MUST 只展示“引用了 1 条记忆”
- **AND** MUST NOT 展示空的新增分组

#### Scenario: 没有记忆活动
- **WHEN** 可披露完成回复没有实际引用或同步新增长期记忆
- **THEN** 回复底部 MUST 不展示记忆区域

#### Scenario: 展开记忆条目
- **WHEN** 用户展开一条 FACTUAL 记忆，内容包含 subject、claim、evidence 和 qualifiers
- **THEN** 前端 MUST 使用“主体、事实、证据、限定条件”展示全部非空值
- **AND** MUST NOT 显示 memoryId 或原始 JSON 文本

### Requirement: 引用判定以进入后续模型循环的 L2 详情为准

一条长期记忆只有在 `get_memory_detail` 对该 `memoryId` 返回成功 L2 详情、该详情作为 capability result 进入同一 attempt 的后续模型调用，并且该 attempt 最终形成可披露完成回复时，才 MUST 计入该回复的 `referenced` 集合。`search_memory` 的 L1 候选、失败或不可披露的详情、未进入后续模型调用的详情，以及没有形成可披露完成回复的 attempt MUST NOT 进入回复 disclosure。

同一 attempt 多次成功装入同一 `memoryId` 时 MUST 只展示一条，内容 MUST 使用进入最终回复前最后一次成功装入的规范化快照。系统 MUST 展示全部已计入 `referenced` 的条目，不得在 terminal、channel 或前端阶段二次截断或省略。

#### Scenario: 搜索候选不算引用
- **WHEN** 模型通过 `search_memory` 得到 E1 但没有成功调用 `get_memory_detail(E1)`
- **AND** attempt 最终形成可披露完成回复
- **THEN** E1 MUST NOT 出现在“引用了 N 条记忆”分组

#### Scenario: 详情进入后续模型调用
- **WHEN** `get_memory_detail(E1)` 成功返回 L2 详情
- **AND** 该 capability result 进入同一 attempt 的后续模型调用
- **AND** attempt 最终形成可披露完成回复
- **THEN** E1 MUST 出现在引用分组

#### Scenario: 重复读取同一记忆
- **WHEN** 同一 attempt 两次成功装入 E1 且第二次内容快照更新
- **AND** attempt 最终形成可披露完成回复
- **THEN** 引用分组 MUST 只展示一条 E1
- **AND** 展示内容 MUST 等于第二次成功装入的规范化快照

#### Scenario: 详情成功但没有形成完成回复
- **WHEN** `get_memory_detail(E1)` 成功后 attempt 失败、取消或被替代
- **THEN** 该终态 MUST NOT 展示引用分组

### Requirement: 同步新增判定以已提交的 add_memory 写入为准

一条长期记忆只有在当前 attempt 的 `add_memory` 已成功提交 ACTIVE record 时，才 MUST 计入当前 attempt 的 request-local `created` 集合；只有该 attempt 最终形成可披露完成回复时，该集合才进入回复 disclosure。内容 MUST 来自写入 owner 返回并已经固化的规范化持久化记录；系统 MUST NOT 根据模型原始参数在 core、runtime、channel 或前端重新归一化内容，也 MUST NOT 为组装回执额外调用会修改访问计数或版本的详情读取。

每个 retry、edit、resubmit 或 supersede successor MUST 创建自己的 disclosure context，并且 MUST NOT 继承任何前序 attempt 的 `referenced`、`pendingReferenced`、`created` 或其他 disclosure flow variable。前序 attempt 已经提交到 memory Store 的记录不回滚，但 reply disclosure MUST NOT 充当跨 attempt 记忆变更账本。

后台 extraction、dreaming、aging、维护操作和其他异步学习结果 MUST NOT 进入本次 attempt 的 `created` 集合。失败的 `add_memory` MUST NOT 产生新增回执。

#### Scenario: 完成前同步写入成功
- **WHEN** `add_memory` 在 attempt 内成功提交 E3
- **AND** attempt 最终形成可披露完成回复
- **THEN** E3 MUST 出现在新增分组
- **AND** 展示内容 MUST 等于实际写入的规范化内容

#### Scenario: 写入成功后请求失败或取消
- **WHEN** `add_memory` 已成功提交 E3
- **AND** 后续执行以 `REQUEST_FAILED` 或 `REQUEST_CANCELED` 结束
- **THEN** 该 attempt 的 canonical message、terminal event、live 和 conversation MUST NOT 包含 `memoryDisclosure`
- **AND** E3 在 memory Store 中的已提交记录 MUST 不因该终态回滚

#### Scenario: 被替代 attempt 的新增不归因给 successor
- **WHEN** attempt R1 已同步新增 E1
- **AND** 同一受信 session lane 的新 attempt R2 替代 R1，使 R1 以 `REQUEST_SUPERSEDED` 提交
- **THEN** R1 的 canonical message、terminal event、live 和 conversation MUST NOT 包含 `memoryDisclosure`
- **AND** R2 的 disclosure MUST 只根据 R2 自己的引用和新增事实生成
- **AND** R2 MUST NOT 因 R1 的写入展示 E1

#### Scenario: 异步学习在终态后产生记忆
- **WHEN** extraction 或 dreaming 在 request terminal commit 之后新增 E4
- **THEN** E4 MUST NOT 被追加到已完成回复的新增分组

#### Scenario: 普通失败重试不继承前一 attempt 回执
- **WHEN** attempt R1 已同步新增 E1 后失败
- **AND** 用户重试产生 attempt R2
- **THEN** R2 的 disclosure MUST 只根据 R2 的引用和新增事实生成
- **AND** MUST NOT 把 R1 的 E1 复制到 R2 的完成回复

### Requirement: 记忆披露不改变模型上下文和 memory tool 可见结果

内部记忆写入回执 MUST 在进入 lifecycle hook、后续模型上下文、capability result message、用户可见 capability delta、日志、metric 或 trace 之前由可信 core 边界消费并移除。`add_memory` 的模型可见成功结果 MUST 保持既有字段和语义，不得因为回复底部披露而增加规范化记忆内容。

完成终态的 `memoryDisclosure` MUST 只存在于终态消息 metadata 和 terminal Web 投影，不得拼接到 assistant 正文；后续 Context Engine 组装模型消息时 MUST NOT 把该 metadata 扩展注入模型上下文。

`flowVariables.responseMemoryDisclosureDraft` MUST 是 core/runtime 保留状态。任何 lifecycle hook 的 boundary MUST NOT 包含该键；hook 返回的 `flowVariables` 也 MUST NOT 创建、覆盖或删除该保留状态。该隔离 MUST 在不新增通用 typed extension 的前提下由 core 的 hook projection/merge 边界完成。

该保留状态 MUST 由 core 作为唯一写入 owner，只维护当前 attempt 的 `referenced`、`pendingReferenced` 和 `created`；terminal assembly 时，runtime 只可读取、校验，并仅为 `REQUEST_COMPLETED` 提交。runtime MUST NOT 修改 draft，也 MUST NOT 从 memory tool、Store、模型上下文、capability delta 或前序 attempt 推导当前 attempt 的引用或新增。

#### Scenario: add_memory 后继续调用模型
- **WHEN** `add_memory` 成功写入包含内容 C1 的记忆
- **AND** Agent loop 继续执行下一次模型调用
- **THEN** 模型可见的 `add_memory` capability result MUST 仍只包含既有成功字段
- **AND** MUST NOT 包含内部写入回执或 C1 的重复副本

#### Scenario: 后续会话组装上下文
- **WHEN** 一条历史 assistant message 的 metadata 包含 `memoryDisclosure`
- **AND** Context Engine 为后续请求组装模型消息
- **THEN** 模型可见 assistant content MUST 只使用原 assistant 正文
- **AND** MUST NOT 序列化或注入 `memoryDisclosure`

#### Scenario: lifecycle hook 无法观察或篡改披露 draft
- **WHEN** 一次 `add_memory` 成功后进入下一轮 `BEFORE_PLANNING` hook
- **THEN** hook boundary 的 `flowVariables` MUST NOT 包含 `responseMemoryDisclosureDraft`
- **AND** hook 返回同名字段时 core MUST 丢弃该字段并保留可信 draft

### Requirement: disclosure 与 terminal commit 和 Web 投影一致

系统 MUST 只把当前连续执行内由 core 形成的 disclosure draft 作为 terminal handoff，不得为该 draft 新增 checkpoint 或改变既有 checkpoint/replay 契约。runtime MUST 先执行既有 terminal output guard 得到最终规范化 `terminalStatus`；仅当最终状态是 `REQUEST_COMPLETED`、执行未从 durable execution facts 重建且 draft 非空合法时，既有 terminal composite commit MUST 把同一个最终 disclosure 原子写入 terminal assistant message metadata 和 terminal timeline event。`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED` 以及从 durable facts 重建的执行 MUST 省略整个字段。

恢复执行省略 disclosure 时，runtime MUST 记录不含 memoryId、content 或 identity 的固定 `RESPONSE_MEMORY_DISCLOSURE_RECOVERY_OMITTED` 诊断，但 MUST NOT 显示“暂不可用”或改变正文、终态、capability replay 和 memory Store。系统不得扫描 live delta、按内容猜测写入结果、读取前序终态或接受前端 lineage 重建。

SSE 和 WebSocket MUST 为 `REQUEST_COMPLETED` 投影相同的 terminal disclosure；conversation history MUST 只在同一持久化 assistant message 的受信 `metadata.eventType=REQUEST_COMPLETED` 且 `metadata.status=COMPLETED` 时投影其中的相同结构，不得为此查询 timeline 或新增 `terminalMessageId` 关联。live 完成终态和刷新后的 conversation MUST 对同一 attempt 展示相同的引用与新增条目，不需要等待异步学习完成。

对于 `REQUEST_FAILED`、`REQUEST_CANCELED` 和 `REQUEST_SUPERSEDED`，live/conversation 一致性 MUST 表现为 canonical message、terminal event 和两条公开路径均不存在 `memoryDisclosure`。非完成终态的输入 metadata 即使包含该字段，channel 也 MUST 在公开投影中防御性省略。

#### Scenario: live 完成后刷新
- **WHEN** 浏览器通过 live terminal event 展示一次完成回复的 memory disclosure
- **AND** 用户刷新并重新读取 conversation history
- **THEN** 历史回复 MUST 展示相同的引用和新增条目

#### Scenario: 非完成终态在 live 和刷新后均不展示
- **WHEN** R1 已新增 E1 并以 `REQUEST_SUPERSEDED` 结束
- **THEN** R1 的 canonical message 和 terminal event MUST 不包含 `memoryDisclosure`
- **AND** R1 的 live terminal envelope 与刷新后的 conversation terminal envelope MUST 同样不包含该字段
- **AND** successor R2 MUST NOT 继承 E1 的 disclosure

#### Scenario: 重建执行统一省略披露
- **WHEN** runtime 从 durable checkpoint、message 或其他 execution facts 重建 attempt 的执行状态
- **AND** 该 attempt 最终以 `REQUEST_COMPLETED` 结束
- **THEN** terminal assistant message 和 terminal event MUST 不包含 `memoryDisclosure`
- **AND** live 与刷新后的 conversation MUST 均不展示记忆区域
- **AND** 正文、终态、capability replay 和已提交 memory Store 记录 MUST 保持正常语义

#### Scenario: output guard 将完成请求规范化为失败
- **WHEN** terminal assembly 收到候选 `COMPLETED` 状态和非空 disclosure draft
- **AND** 既有 output guard 因最终正文为空或超过终态正文上限把 `terminalStatus` 规范化为 `FAILED`
- **THEN** terminal assistant message、terminal event、live 和 conversation MUST 均不包含 `memoryDisclosure`

#### Scenario: 历史消息没有 disclosure
- **WHEN** conversation 中的历史 assistant message 不包含 `memoryDisclosure`
- **THEN** 前端 MUST 正常展示正文
- **AND** MUST 不展示记忆区域

#### Scenario: disclosure 载荷非法
- **WHEN** channel 或前端收到 schema-invalid `memoryDisclosure`
- **THEN** 正文和请求终态 MUST 继续正常展示
- **AND** 记忆区域 MUST 关闭且不得显示“暂不可用”
- **AND** 系统 MUST 记录不含记忆内容的安全 schema diagnostic

### Requirement: 累计披露大小不得改变记忆工具执行

系统 MUST NOT 为 `memoryDisclosure` 建立每 request 或跨调用累计总预算，也 MUST NOT 因当前 footer 已累计的条目数或字节数拒绝 `get_memory_detail`、`add_memory` 或其他 memory tool。每次 memory tool 调用仍 MUST 独立遵守其既有单次输入、内容和结果大小契约；`add_memory` 的完整内部 receipt 必须在 Store 写入前确认可通过该既有单次结果边界。

对于可披露完成 attempt，terminal、channel 和 frontend MUST 完整持久化、投影并展示所有已经形成的去重 `referenced` 和 `created` 条目，不得截断、分页或增加 `omittedCount`。适用于 terminal metadata 或 Web payload 的统一容量契约不得在记忆披露路径中被改写为局部总预算，也不得借此改变 Agent 的记忆使用行为。

#### Scenario: 多次记忆调用形成较大的累计披露
- **WHEN** 同一可披露完成 attempt 的多次 `get_memory_detail` 和 `add_memory` 均分别满足既有单次工具契约
- **AND** 它们形成多个去重 `referenced` 和 `created` 条目
- **THEN** 系统 MUST 正常执行每次 memory tool 调用
- **AND** terminal、live 和 conversation MUST 投影相同的全部去重条目
- **AND** 系统 MUST NOT 因累计 disclosure 大小返回披露专用 capability failure
