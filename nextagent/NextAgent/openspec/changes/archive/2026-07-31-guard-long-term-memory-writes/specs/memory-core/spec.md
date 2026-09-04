## ADDED Requirements

### Requirement: 携带文本的长期记忆写入通过知识安全准入

当存在 REMOTE guardrail 绑定时，每个由 app 组合的 `saveLongTermMemory` 和 `manualSaveLongTermMemory` 操作 MUST 在调用所选 `LongTermMemoryStoreGateway` 之前完成一次由 `agent-memory` 拥有的知识安全准入。该准入实现 MUST 保持为 `agent-memory` 的 package-internal：`LongTermMemoryWriteCoordinator` 及其工厂 MUST NOT 从 `@nextagent/agent-memory` 公开 index 导出、被 `agent-app` 组合契约引用或传入 `agent-channel-web`。`agent-app` MAY 只向既有 `agent-memory` 公开工厂注入所选 `GuardrailGatewayPort` 和既有 memory gateway。`LongTermMemoryStoreGateway`、`LongTermMemoryManagementPort` 和 `LongTermMemoryToolPort` 的方法签名 MUST 保持不变。准入文本 MUST 是精确的 `briefIndex`，后跟一个换行字符，再后跟精确的 `content`。`labels`、`source`、tenant/subject/Agent scope、标识符、confidence、version 及其他字段 MUST NOT 进入 guard 请求。

准入边界 MUST 把完整准入文本切分为至多 2000 个 Unicode code point 的连续非空片段，不重叠、不遗漏、不重排、不替换、也不插入省略标记。它 MUST 按原始顺序通过 `GuardrailGatewayPort.checkKnowledge` 提交片段，每次调用 1 到 5 个片段，且每次调用都带 `isPrivacy=true`。它 MUST 等待每个批次完成，并 MUST 只在每个片段都 legal 后才恰好调用所选 memory store 一次。

如果任一批次被 blocked，准入边界 MUST 在持久化之前停止，并返回类别为 `POLICY_DENIED` 的不可重试 `LTM_CONTENT_GUARD_BLOCKED`。如果 guard 操作返回不可用或非法响应，它 MUST 在持久化之前停止，并返回类别为 `UNAVAILABLE` 的可重试 `LTM_CONTENT_GUARD_UNAVAILABLE`。如果准入边界产生了非法 `checkKnowledge` 请求，它 MUST 在持久化之前停止，并返回类别为 `UNAVAILABLE` 的不可重试 `LTM_CONTENT_GUARD_UNAVAILABLE`。如果在持久化之前观察到既有的调用方取消上下文，准入边界 MUST 停止并返回类别为 `CANCELED` 的不可重试 `LTM_CONTENT_GUARD_CANCELED`。准入边界 MUST 只把该取消上下文传给 `checkKnowledge`，MUST 在持久化前重新检查它，MUST NOT 把它传给 `LongTermMemoryStoreGateway`。这些错误 MUST NOT 包含被检查文本、provider `detail`、raw provider error 或 scope 标识符。

memory tool、自动提取和长期记忆管理工厂 MUST 复用同一 package-internal 准入实现和失败映射，但 MUST NOT 要求共享的 coordinator 对象身份。当不存在 guardrail 绑定时，app 组合 MUST 保持既有长期记忆写入行为，并在不调用 guard 的情况下委托给所选 store。知识安全准入 MUST NOT 被加入 `LongTermMemoryStoreGateway`、SQLite 或远程 memory 持久化 adapter。`mutateLongTermMemory`、发布、复制、读取、搜索、删除、老化 和访问统计操作 MUST 保持既有行为，MUST NOT 触发该准入。

#### Scenario: 一条完整短记忆在一次写入前被检查

- **WHEN** 一个受 guard 的写入收到 `briefIndex` 和 `content`，其合并后的准入文本至多包含 2000 个 Unicode code point
- **AND** 知识检查返回 legal
- **THEN** 恰好一次 `checkKnowledge` 调用 MUST 以 `isPrivacy=true` 包含完整准入文本作为单个片段
- **AND** 所选 memory store MUST 在该结果之后恰好被调用一次

#### Scenario: 一条完整长记忆被完整检查且无遗漏

- **WHEN** 一个受 guard 的写入收到包含 6049 个 Unicode code point 的准入文本
- **THEN** 它 MUST 产生四个有序片段，其串接等于原始准入文本
- **AND** 前三个片段 MUST 各包含 2000 个 code point，第四个 MUST 包含 49 个 code point
- **AND** 它 MUST 在一次 `checkKnowledge` 调用中发送四个片段
- **AND** 它 MUST 只在四个结果都 legal 后写入

#### Scenario: label 被排除在知识准入之外

- **WHEN** 一个受 guard 的写入包含合法的 `briefIndex` 和 `content` 以及一个或多个 label
- **THEN** 每个知识检查请求 MUST 只包含从 `briefIndex`、换行分隔符和 `content` 派生的片段
- **AND** 任何 label 值都 MUST NOT 被发送给 guardrail

#### Scenario: 较后的片段被 blocked

- **WHEN** 至少一个知识片段被 blocked
- **THEN** 操作 MUST 返回 `LTM_CONTENT_GUARD_BLOCKED`
- **AND** 所选 memory store MUST NOT 被调用
- **AND** 不得存在任何部分长期记忆 record

#### Scenario: guardrail 依赖 fail closed

- **WHEN** 存在 guardrail 绑定且一次知识检查超时、不可用或返回非法成功响应
- **THEN** 操作 MUST 返回 `LTM_CONTENT_GUARD_UNAVAILABLE`
- **AND** 所选 memory store MUST NOT 被调用

#### Scenario: guardrail 绑定缺席

- **WHEN** app 组合没有 guardrail 绑定
- **THEN** `saveLongTermMemory` 和 `manualSaveLongTermMemory` MUST 保持既有的校验与持久化结果
- **AND** MUST NOT 尝试任何 RobotRouter 请求

#### Scenario: 仅 metadata 变更不触发知识准入

- **WHEN** 一条既有记忆通过其所属 mutation 操作只改变 confidence、pin、archive 状态或访问统计
- **THEN** 该 mutation MUST 在不调用 `checkKnowledge` 的情况下保持既有结果
