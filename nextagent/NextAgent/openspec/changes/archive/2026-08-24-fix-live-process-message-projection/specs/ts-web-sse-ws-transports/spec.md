## Function

- **所属 Function**：`FN-1.1 查看会话消息流`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Web stream 在服务端解析过程消息引用

SSE 与 WebSocket 的共享过程投影 MUST 在服务端决定引用事件的安全正文来源。对于当前订阅已经向 consumer 交付的非空安全累计过程快照，后续完成引用事件仅在全部可信 occurrence 坐标一致时 MUST 使用该快照生成完成投影；除此之外，共享过程投影 MUST 在服务端解析过程事件的 `messageId`，并且 MUST 仅从通过关联校验的消息生成用户可见正文。两种 transport MUST 对同一事件、同一订阅前序和同一消息可见性产生相同的 `StreamEnvelope` 内容、顺序、完成状态和安全降级结果。

可复用的 occurrence 只有以下两类，且列表是穷尽的：具有相同 `sessionId`、`requestId`、`runId`、`rootMessageId` 和非空 `stepId` 的累计 `LLM_CONTENT_DELTA` 与 completed `LLM_CONTENT_DELTA`；具有相同 `sessionId`、`requestId`、`runId`、`rootMessageId`、`capabilityId` 和非空 `toolCallId` 的 `CAPABILITY_RESULT_DELTA` 与 `CAPABILITY_COMPLETED`。前序快照 MUST 已经通过当前 transport 的安全投影并向同一订阅 consumer 交付。不同 occurrence、空正文、未交付快照、`CAPABILITY_STARTED` 和未列出的其他事件类型 MUST NOT 使用该路径。

命中可复用 occurrence 时，共享过程投影 MUST 使用该 occurrence 最新交付的安全累计正文生成完成投影，MUST 保留完成引用事件的规范顺序、状态和 identity，并且 MUST NOT 为该完成事件调用消息关联入口。完成投影 MUST NOT 包含 `contentUnavailable=true`，也 MUST NOT 清空、缩短或重新播放 consumer 已经看到的正文。后续安全拒绝事件仍 MUST 按其既有终态契约撤回对应 run 的已展示正文。

没有命中可复用 occurrence 时，共享过程投影 MUST 调用 server-only 消息关联入口。消息关联有效时，用户可见 payload MUST 不包含 `contentUnavailable`。消息关联无效、读取失败或结果在当前读取时不可见时，用户可见 payload MUST 包含布尔值 `contentUnavailable=true`，并且 MUST 不包含消息正文、Tool 参数或 Tool 结果正文。系统 MUST NOT 使用其他 occurrence、浏览器缓存、Event 正文副本或 Tool 本地状态补齐内容。

浏览器 MUST NOT 接收原始隐藏消息、消息可见性控制字段或未投影的 Tool 输入输出来完成关联。过程消息关联和订阅内完成收敛 MUST NOT 改变最终 Assistant Message、thinking、terminal event 或既有消息可见性语义。

`RuntimeSessionPort` MUST 提供 server-only `resolveProcessMessages(query)` 关联入口。`query` MUST 包含可信 `identityContext`、`sessionId`、`requestId`、`runId` 和去重后的 `messageIds`，并且 MAY 包含 `includeLegacyCandidates` 与 `signal`。引用模式 MUST 接受一至一千个 `messageIds`，结果 MUST 只包含同时匹配全部可信坐标和请求标识的 `SessionMessage` 领域对象。仅当 history route 需要关联无消息引用的旧事件时，`includeLegacyCandidates=true` MAY 与空 `messageIds` 组合，并返回当前可信运行内至多一千条完整候选；候选超过上限时 MUST 安全失败，不得返回截断集合。缺少 `signal` 时调用 MUST 正常执行，提供 `signal` 时取消 MUST 只终止本次关联读取。结果 MUST NOT 返回 gateway `*Record` 或数据库字段。该入口 MUST NOT 作为 Web route 暴露，也 MUST NOT 接受客户端直接提供的 `messageIds` 或 legacy candidate 开关。

**需求类别**：功能性需求

#### Scenario: 活跃执行说明使用已交付快照完成收敛

- **GIVEN** 同一 SSE 或 WebSocket 订阅已交付一个具有非空 `stepId` 和非空安全累计正文的 `LLM_CONTENT_DELTA`
- **WHEN** 同一订阅收到全部 occurrence 坐标一致的 completed `LLM_CONTENT_DELTA` 引用事件
- **THEN** 完成投影 MUST 保留最新已交付的安全累计正文并标记该 occurrence 已完成
- **AND** 系统 MUST NOT 为该完成事件调用消息关联入口
- **AND** 完成投影 MUST NOT 包含 `contentUnavailable=true`

#### Scenario: 活跃 Tool 结果使用已交付快照完成收敛

- **GIVEN** 同一 SSE 或 WebSocket 订阅已交付一个具有非空 `toolCallId` 和非空安全结果正文的 `CAPABILITY_RESULT_DELTA`
- **WHEN** 同一订阅收到全部 occurrence 坐标一致的 `CAPABILITY_COMPLETED` 引用事件
- **THEN** 完成投影 MUST 保留最新已交付的安全结果正文与结果展示级别并推进 Tool 完成状态
- **AND** 系统 MUST NOT 为该完成事件调用消息关联入口
- **AND** 完成投影 MUST NOT 包含 `contentUnavailable=true`

#### Scenario: 暂时不可读的消息不清空已展示正文

- **GIVEN** consumer 已显示当前 occurrence 的非空安全累计正文
- **WHEN** 对应完成引用事件到达时持久化消息尚未对关联读取可见
- **THEN** consumer MUST 继续看到已经交付的完整正文和完成状态
- **AND** 空的内容不可用完成态 MUST NOT 替换、清空或缩短该正文

#### Scenario: 未观察到 live 快照时从消息恢复

- **GIVEN** 当前订阅没有符合全部 occurrence 坐标的已交付非空安全累计快照
- **WHEN** SSE 或 WebSocket 投影一个携带 `messageId` 的 process Event
- **THEN** 共享过程投影 MUST 通过 server-only 消息关联入口恢复正文
- **AND** 两种 transport MUST 从同一个有效目标消息生成相同的安全正文、过程类型、顺序和状态
- **AND** 浏览器响应 MUST NOT 包含该目标消息的原始隐藏记录

#### Scenario: 不同 occurrence 不得复用正文

- **GIVEN** 当前订阅已交付至少一个非空安全累计过程快照
- **WHEN** 完成引用事件的 `stepId`、`toolCallId` 或任一可信 turn/run 坐标与全部已交付快照不一致
- **THEN** 系统 MUST NOT 使用任一已交付快照生成该完成事件的正文
- **AND** 系统 MUST 对该事件执行 Message 关联并按关联结果投影或安全降级

#### Scenario: 无快照且关联失败时显式降级

- **GIVEN** 当前订阅没有符合全部 occurrence 坐标的已交付非空安全累计快照
- **WHEN** `messageId` 不存在、目标消息作用域不匹配、消息类型不匹配、`toolCallId` 不一致或消息读取失败
- **THEN** Web stream MUST NOT 输出目标消息或 Event 中的正文副本
- **AND** 对应过程项 MUST 保留可安全公开的类型、顺序和状态
- **AND** 系统 MUST 输出 `contentUnavailable=true`，不得泄露目标消息是否属于其他 owner 或 Agent

#### Scenario: 服务端批量关联入口不成为公开消息读取 API

- **WHEN** 共享 Web 投影需要解析同一运行的一至一千个事件消息引用
- **THEN** server-only 关联入口 MUST 只返回与可信会话、请求、运行和请求标识同时匹配的 `SessionMessage`
- **AND** Web route MUST NOT 允许客户端直接调用该入口或提交任意 `messageIds`
- **AND** 关联结果 MUST NOT 包含 gateway `*Record` 或数据库字段

#### Scenario: 旧事件候选查询保持完整且有界

- **WHEN** history route 需要为同一运行中没有 `messageId` 的旧过程事件建立唯一关联
- **THEN** server-only 入口 MAY 在空 `messageIds` 下返回当前可信运行内至多一千条完整候选
- **AND** 候选超过一千条时 MUST 安全失败并使旧事件降级为仅状态结果
- **AND** 系统 MUST NOT 从截断候选集合推断唯一消息

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：用户打开会话时查看当前 session 的 Request Execution Stream；同一订阅已安全交付的过程正文可在对应完成边界原地收敛，缓存未命中、刷新和恢复场景仍从唯一 `SessionMessage` 安全投影。
- **依据 Requirements**：`Web stream 在服务端解析过程消息引用`

### 输出

- **变更类型**：修改
- **目标内容**：按序推送安全会话事件；完成投影保留同 occurrence 已交付的非空安全正文，无法复用且消息关联失败时只返回安全状态与 `contentUnavailable=true`。
- **依据 Requirements**：`Web stream 在服务端解析过程消息引用`

### 处理过程

- **变更类型**：修改
- **目标内容**：系统先判断当前订阅是否已经交付全部 occurrence 坐标一致的非空安全累计内容；命中时原地完成收敛，未命中时校验可信消息引用并从消息生成安全正文。
- **依据 Requirements**：`Web stream 在服务端解析过程消息引用`

### 结果

- **变更类型**：修改
- **目标内容**：合法 live occurrence 在完成边界保持连续；无法复用且引用无效或消息不可读时保留类型、顺序和状态并明确标记正文不可用。
- **依据 Requirements**：`Web stream 在服务端解析过程消息引用`

### 规格

- **规格项**：活跃流完成收敛
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：同一订阅已交付且全部 occurrence 坐标一致的非空安全累计正文原地收敛为完成态；未命中时从唯一 `SessionMessage` 恢复
- **依据 Requirements**：`Web stream 在服务端解析过程消息引用`
