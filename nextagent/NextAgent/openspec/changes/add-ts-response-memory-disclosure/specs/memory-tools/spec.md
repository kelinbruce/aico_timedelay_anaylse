## ADDED Requirements

### Requirement: add_memory 提供可前置剥离的内部写入回执

`add_memory` 成功创建 ACTIVE 长期记忆后，其受 output schema 校验的 structured result MUST 同时包含内部 `memoryWriteReceipt`。回执 MUST 只包含实际写入记录的 canonical `memoryId` 和由 `agent-memory` 解析后的规范化 `content`，不得包含来源、版本、访问计数、置信度、owner scope 或其他 retained record 字段；回执 MUST NOT 通过模型参数在下游重新构造，也不得通过额外详情读取取得。

Store 调用前，`agent-memory` MUST 校验模型输入、规范化后的可持久化 content 和预计 receipt 大小；任一项非法或预计超过单条 24000-byte 上限时 MUST 安全失败且不得调用 Store。Store 成功返回后，系统 MUST 从实际 ACTIVE record 只抽取 `memoryId + content` 构造 receipt，并由 `addMemoryOutputSchema` 执行 exact-field 校验；该返回后校验不得错误承诺 Store 尚未产生副作用。

canonical `add_memory` capability MUST 声明 `replayPolicy=IDEMPOTENT`，并 MUST 使用原始 `runId + toolCallId` 派生的稳定 idempotency key 调用 `LongTermMemoryStoreGateway`。该策略只允许 runtime 对调用结果不确定的同一 invocation 使用原 key 重放；Store MUST 返回首次锚点记录且不得重复写入。不同 `toolCallId` MUST 使用不同 key，不得按规范化 content 合并不同 invocation。`memoryWriteReceipt` 和 reply disclosure MUST NOT 参与 replay 判断，也不得改变 checkpoint contract。

`memoryWriteReceipt` 只用于可信 `providerKind=BUNDLED`、`providerId=memory-tools`、`capabilityId=add_memory` 的 request-local result effect。Agent Core MUST 在任何 lifecycle hook、模型可见 capability result、capability result message、live delta、日志、metric 或 trace 消费 structured result 前校验并移除该字段。移除后的模型可见成功结果 MUST 继续只包含既有 `longTermMemoryId`、`state`、`briefIndexTruncated`、`createdAt`、`outcome` 和 `nextAction`。其他 provider 或 capability 返回同名字段 MUST 作为非法结果安全失败，不得形成记忆回执。

本 requirement 只修改 canonical `add_memory` 的 replay descriptor 和同 invocation 恢复语义，MUST NOT 改变 `search_memory`、`get_memory_detail` 的 replay policy 或读取副作用，也不得借此局部重构通用 runtime replay guard、checkpoint、候选筛选或 risk-policy 执行职责。从 durable execution facts 重建的 attempt 即使重新形成 receipt，reply disclosure 也按 response disclosure contract 整段省略。

#### Scenario: 成功写入产生规范化回执
- **WHEN** `add_memory` 把模型输入规范化为 C1 并成功写入 E1
- **THEN** 受信任的 structured result MUST 包含 `memoryWriteReceipt={memoryId:E1,content:C1}`
- **AND** core 消费后发送给模型的成功结果 MUST 不包含 `memoryWriteReceipt` 或 C1

#### Scenario: 回执来自写入结果
- **WHEN** 模型使用 alias 或 string content 调用 `add_memory`
- **THEN** 回执内容 MUST 等于 Store 返回记录经 `agent-memory` 解析得到的规范化内容
- **AND** MUST NOT 等于未经归一化的原始参数副本

#### Scenario: 非可信 capability 伪造回执
- **WHEN** 非 canonical `BUNDLED memory-tools/add_memory` capability 返回名为 `memoryWriteReceipt` 的字段
- **THEN** Agent Core MUST 以安全 validation failure 拒绝该结果
- **AND** MUST NOT 收集、持久化或展示该字段

#### Scenario: 写入失败不产生回执
- **WHEN** `add_memory` 在创建长期记忆前失败或超时
- **THEN** structured result MUST 不包含 `memoryWriteReceipt`
- **AND** 终态新增分组 MUST 不包含该调用

#### Scenario: 前置内容或单次结果边界校验失败不写入
- **WHEN** `add_memory` 的输入无法规范化为合法可持久化 content，或预计 receipt 超过 24000 bytes
- **THEN** 系统 MUST 在 Store 调用前安全失败
- **AND** MUST NOT 创建长期记忆

#### Scenario: Store 返回记录只投影允许的回执字段
- **WHEN** Store 成功返回包含版本、访问次数、来源、Owner Scope 和其他 retained record 字段的 ACTIVE record
- **THEN** `memoryWriteReceipt` MUST 只包含该记录的 canonical `memoryId` 和规范化 `content`
- **AND** `addMemoryOutputSchema` MUST 拒绝包含未知字段的 receipt

#### Scenario: 写入已提交但 invocation 结果不确定
- **WHEN** 同一 `add_memory` invocation 已使用 K1 成功写入 E1
- **AND** runtime 从调用结果不确定状态恢复
- **THEN** runtime MUST 使用原始 `runId + toolCallId` 派生的同一 K1 重放该 invocation
- **AND** Store MUST 返回首次锚点 E1，不得创建第二条记忆或推进 E1 的版本和访问计数
- **AND** 恢复结果 MUST 重新形成 E1 的同一规范化回执
- **AND** 该重建执行的完成回复 MUST 不包含 `memoryDisclosure`

#### Scenario: 不同调用不做内容级去重
- **WHEN** 两个不同 `toolCallId` 的 `add_memory` invocation 提交相同规范化 content
- **THEN** 两次调用 MUST 使用不同 idempotency key
- **AND** 第二次调用 MUST NOT 因第一次调用的 invocation key 被折叠
