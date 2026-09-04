## Function

- **所属 Function**：`FN-1.2 断线后从上次位置继续`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Live in-progress state converges to completed cold history

当 model invocation 产生累计 thinking delta 时，live path MUST 按到达顺序向 consumer 交付；未产生时 MUST NOT 构造 thinking delta。model invocation 结束时，consumer MUST 接收同 step 最后累计 delta 的 `completed=true` 投影。Cold history MUST 只返回该 persisted completed delta。两条路径在完成态的 reasoning、step、completed state 和 process ordering 上 MUST 等价。

对于已完成 Workflow，settled live 与只使用 visible conversation Message 和 persisted process Event 的 cold history MUST 在安全 lifecycle 状态、completed product、canonical terminal answer 和可见顺序上等价。等价范围 MUST 包括 canonical Tool event/message vocabulary 表示的 completed product，但 MUST NOT 要求恢复调用中的 fragment、瞬时 loading、token cadence 或事件到达时间。

同一 Workflow product identity 的 completed product MUST 替换此前 live fragment；request 到达 completed、failed、canceled、superseded 或 output-guard terminal 后 MUST 清除该 run 仍未被 completed product 替换的 fragment。active run 尚未出现 matching completion 或 terminal fact 时 MUST 继续显示已接收 fragment。

terminal Assistant Message/fact MUST 是完成态 canonical answer。cold history MUST 从同一 terminal fact 恢复该 text，提交前的 Assistant content candidate MUST NOT 形成第二个 completed answer。product TEXT 与 terminal text 完全相同时展示层 MUST 最多显示一次；PIU、DSL、其他 structured product 或不同 TEXT 与 terminal text 同时存在时，两条路径 MUST 保留相同的独立 segments。

**需求类别**：功能性需求

#### Scenario: 完成 delta 收敛 live thinking

- **WHEN** consumer 已显示当前连续 partial thinking entry，随后可能收到同一 model invocation 的 answer `LLM_CONTENT_DELTA`，并在下一个 ProcessPanel 过程 entry 边界前收到 `completed=true` envelope
- **THEN** consumer MUST 更新并 settle 同一 entry
- **AND** MUST NOT 创建重复 thinking entry
- **AND** answer `LLM_CONTENT_DELTA` MUST NOT 关闭该 entry 边界
- **AND** 后续 Capability 或其他 ProcessPanel 过程 event MUST 关闭该 entry 边界，不能仅按 `runId + stepId` 跨边界合并

#### Scenario: 冷历史重建最终过程

- **WHEN** client 关闭并重新打开已完成 conversation
- **THEN** Message 与 Event queries MUST 重建与 live 完成态等价的最终内容和过程
- **AND** MUST NOT 重建调用中的 live-only delta frames

#### Scenario: 突然丢失的进行中 thinking 不得被推断

- **WHEN** 进程在 model invocation 结束前消失且只有 live-only 调用中 delta
- **THEN** cold history MUST NOT 出现该调用中 reasoning
- **AND** system MUST NOT 从 final answer 或其他 event 猜测 thinking

#### Scenario: Workflow 完成态产品收敛 fragment

- **GIVEN** live 已显示 Workflow product fragment
- **WHEN** matching completed product 到达
- **THEN** settled live MUST 删除 matching fragment 并保留 completed product
- **AND** cold history MUST 恢复相同 completed product

#### Scenario: 请求终态清理不可恢复的 Workflow fragment

- **GIVEN** Workflow fragment 没有 matching completed product
- **WHEN** run 到达任一 canonical request terminal fact
- **THEN** settled live MUST 清除该 run 的残留 fragment
- **AND** cold history MUST NOT 恢复或猜测该 fragment

#### Scenario: Workflow 产品与最终回答收敛

- **WHEN** completed Workflow 同时具有 product Event 与 terminal Assistant Message
- **THEN** settled live 与 cold history MUST 保留相同产品结构与 terminal text
- **AND** 完全相同的 TEXT MUST 最多显示一次
- **AND** PIU、DSL、其他非 TEXT structure 或不同 TEXT MUST 与 terminal text 保留相同的独立 segments

#### Scenario: Workflow 隐藏标题时只呈现产品正文

- **GIVEN** completed Workflow product 的可信 output parser metadata 指定 `show_title=false` 且 `show_content=true`
- **WHEN** settled live 或 cold history 呈现该 product
- **THEN** 两条路径 MUST 保留相同的独立 product occurrence 与正文
- **AND** 展示层 MUST NOT 为该 product 生成空标题、独立状态图标、完成对勾或展开按钮
- **AND** 该正文的内容列 MUST 与同层普通节点的 detail 内容列对齐，不得占用状态图标或标题前导区域
- **AND** 该规则 MUST NOT 改变 product Event identity、排序、持久化 owner 或 Capability Result 三档策略

### Requirement: 过程历史从消息正文与事件时序联合恢复

当用户刷新、重连、重新打开会话或加载历史窗口时，系统 MUST 使用可见会话 Message 恢复已完成对话正文，并使用可恢复 process Event 恢复过程顺序与状态。ordinary process Event 携带 `messageId` 时，系统 MUST 在服务端按 Owner Scope、Agent Scope、`sessionId`、`requestId`、`runId`、Message type 和适用时 `toolCallId` 关联已持久化 Message，并 MUST 从该 Message 生成过程正文；系统 MUST NOT 从 Event 中的正文副本重建该内容。

对于由 `workflow-event-history` 定义的 message-free Workflow lifecycle，history MUST 直接恢复其安全 identity/status，MUST NOT 查询或猜测 inner Message，也 MUST NOT 因缺少 Message 增加 `contentUnavailable`。对于该规格定义的 completed Workflow product，history MUST 从 persisted product Event 恢复产品内容；terminal answer MUST 继续从 Assistant Message 恢复。ordinary Message-backed process MUST 继续遵循 Message association 规则。

历史响应 MUST 只返回与实时流相同的安全过程投影，MUST NOT 返回原始隐藏 Message、persistence-owned trace，或要求浏览器额外读取隐藏 Message 完成关联。不满足 message-free Workflow 资格的 Event MUST 沿用既有 association failure、content-unavailable 或 safe projection failure 行为，MUST NOT 借该例外恢复正文。

**需求类别**：功能性需求

#### Scenario: 重新打开会话恢复执行说明

- **WHEN** 一个已完成 Tool 轮次具有公开说明 Message 和引用该 Message 的可恢复 Event
- **AND** 用户重新打开包含该轮次的历史会话
- **THEN** 历史过程 MUST 在 Event 原有顺序位置显示该 Message 的安全公开说明
- **AND** 同一说明 MUST 最多显示一次
- **AND** 该说明 MUST 作为执行详情大面板内的正文直接呈现，不新增第二层 disclosure
- **AND** 该说明 MUST 位于关联 Tool 调用之前，并连接其前置 thinking 与后续 Tool 调用
- **AND** 该说明 MUST NOT 显示独立标题、独立状态图标、完成对勾、展开按钮或系统额外添加的固定引导文案
- **AND** 既有 thinking、Tool、PIU 和普通过程步骤的 disclosure 规则 MUST 保持不变
- **AND** 最终 Assistant Message MUST 继续显示在既有最终答案位置

#### Scenario: 历史 Tool 过程与实时投影一致

- **WHEN** 同一运行的 Tool 调用和 Tool 结果同时具有 Message 事实与可恢复 Event
- **THEN** 实时流与历史读取 MUST 对每个 `toolCallId` 生成相同的安全 Tool 过程内容、顺序和终态
- **AND** 历史读取 MUST NOT 因 Message 与 Event 各保存一份正文而生成重复过程项

#### Scenario: 浏览器不读取隐藏消息完成关联

- **WHEN** 浏览器请求一个运行的过程历史
- **THEN** 服务端响应 MUST 已经完成 Message 与 Event 的安全关联
- **AND** 响应 MUST NOT 包含用于关联的原始隐藏 Message 集合
- **AND** 浏览器 MUST NOT 额外请求原始隐藏 Message 来恢复过程正文

#### Scenario: Direct Workflow 从两类 durable fact 恢复

- **WHEN** Direct Workflow 已提交 terminal Assistant Message 和 persisted Workflow lifecycle/product Events
- **AND** 用户在没有 active/settled browser cache 时重新打开会话
- **THEN** conversation history MUST 从 Assistant Message 恢复 canonical terminal answer
- **AND** run history MUST 从 Workflow Events 恢复 safe lifecycle 与 completed product
- **AND** history MUST NOT 要求 Workflow inner Message

#### Scenario: Workflow-as-Tool 保留 outer protocol 与 inner process

- **WHEN** model loop 通过 Workflow Tool 完成一个轮次
- **THEN** history MUST 从 outer model protocol Message 恢复 Workflow Tool 调用与结果
- **AND** history MUST 从 inner Workflow Events 恢复节点过程
- **AND** inner process MUST NOT 被恢复为第二组 model protocol Message

#### Scenario: Workflow-as-Tool inner process 归入 outer Workflow 折叠区

- **GIVEN** Workflow-as-Tool inner Event 的可信 `parentToolCallId` 与 outer Workflow Tool 的 `toolCallId` 相同
- **WHEN** active live、settled live 或 cold history 呈现 Workflow Tool 调用
- **THEN** matching inner lifecycle/product MUST 位于 outer Workflow 条目的折叠内容内
- **AND** active live MUST 先呈现默认展开的 outer Workflow 执行中条目，再在其内部呈现 matching inner lifecycle/product
- **AND** outer completion MUST 更新同一条目为已完成，并沿用既有 completed 自动折叠行为
- **AND** outer 条目折叠时 MUST 隐藏 matching inner entries，展开时 MUST 按原有产品顺序与子条目 disclosure 语义呈现
- **AND** outer Capability Result 的 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 策略 MUST NOT 删除或裁剪 nested inner product
- **AND** Direct Workflow 或缺少可信 matching parent 的 entry MUST 保持既有顶层语义，展示层 MUST NOT 根据相邻顺序猜测父子关系

#### Scenario: 普通 Capability 缺少 Message 时保持 closed

- **WHEN** ordinary Capability lifecycle 缺少有效 Message 引用或唯一 matching Message
- **THEN** 系统 MUST NOT 把它作为 Event-owned Workflow process 恢复
- **AND** MUST 使用既有 Message association failure 或 content-unavailable 行为

#### Scenario: 过程失败不删除已提交回答

- **WHEN** Workflow process history 读取或安全投影失败但 terminal Assistant Message 已提交
- **THEN** conversation MUST 仍显示 canonical final answer
- **AND** process area MUST 沿用既有安全过程不可用投影
- **AND** 系统 MUST NOT 把缺失过程伪装为完整恢复

## ADDED Requirements

### Requirement: 结构化过程正文使用单一 Message 恢复

对于已经具有 canonical `CAPABILITY_RESULT` Message carrier 的 CLIP structured result 与 ordinary process body，系统 MUST 只持久化一份 Message 正文。对应 `TOOL_STRUCTURED_DELTA` Event MUST NOT 持久化第二份 Message 或 Event body。Conversation history MUST 从该 Message 识别 canonical structured event shape，并恢复安全 `TOOL_STRUCTURED_DELTA` envelope。

当 stored `CAPABILITY_RESULT` Message 不匹配 canonical structured event shape 时，history MUST 继续产生 ordinary `CAPABILITY_RESULT_DELTA` projection，MUST NOT 构造第二份 durable structured body。该 Message-first 规则 MUST NOT 被 ordinary Tool、Skill、Bash、LLM、ApiCall、CLIP 或 arbitrary self-reported structured output 绕过。qualified Workflow inner product 的 Event-owned 例外只由 `workflow-event-history` 定义。

**需求类别**：功能性需求

#### Scenario: 历史从 stored Message 恢复 CLIP structured delta

- **WHEN** conversation history 中的 stored `CAPABILITY_RESULT` Message 包含匹配 canonical structured event shape 的 payload
- **THEN** history MUST 产生安全 `TOOL_STRUCTURED_DELTA` envelope
- **AND** envelope MUST 保留 canonical `toolEventType`、`toolMessageType` 与 content
- **AND** history MUST NOT 读取该 CLIP result 的第二份 persisted Event body

#### Scenario: 非 structured CLIP payload 保持 ordinary result projection

- **WHEN** stored `CAPABILITY_RESULT` Message payload 不匹配 canonical structured event shape
- **THEN** history MUST 产生既有 `CAPABILITY_RESULT_DELTA` projection
- **AND** MUST NOT 构造第二份 durable structured body

#### Scenario: Workflow product 使用独立 Event-owned 例外

- **WHEN** qualified Workflow inner product 没有 canonical Message carrier
- **THEN** completed product body MUST 使用 `workflow-event-history` 定义的 durable Event owner
- **AND** 该例外 MUST NOT 改变 CLIP 或 ordinary Message-backed reconstruction

#### Scenario: string payload 的 structured history 恢复（DEFERRED）

- **WHEN** public Capability result contract 接受 CLIP string payload，且 stored `CAPABILITY_RESULT` Message 包含该 payload
- **THEN** history MUST 产生 `toolEventType: "ANSWER"`、`toolMessageType: "TEXT"` 的 `TOOL_STRUCTURED_DELTA` envelope
- **AND** 在 public Capability result contract 不接受 string payload 时，本 Scenario MUST NOT 改变当前输入值域或形成当前实施任务

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：completed live 与 cold history 联合 Message 和 qualified Workflow Event 重建相同产品过程与 terminal answer；ordinary structured process 继续只从 canonical Message carrier 恢复正文。
- **依据 Requirements**：`Live in-progress state converges to completed cold history`、`过程历史从消息正文与事件时序联合恢复`、`结构化过程正文使用单一 Message 恢复`

### 输出

- **变更类型**：修改
- **目标内容**：安全 lifecycle、ordinary Message-backed process、completed Workflow product 与 canonical terminal answer。
- **依据 Requirements**：`Live in-progress state converges to completed cold history`、`过程历史从消息正文与事件时序联合恢复`、`结构化过程正文使用单一 Message 恢复`

### 处理过程

- **变更类型**：修改
- **目标内容**：ordinary process 由服务端关联 Message；qualified Workflow lifecycle/product 直接从 Event 恢复；completion 替换 fragment，request terminal 清理残留。
- **依据 Requirements**：`Live in-progress state converges to completed cold history`、`过程历史从消息正文与事件时序联合恢复`、`结构化过程正文使用单一 Message 恢复`

### 结果

- **变更类型**：修改
- **目标内容**：已完成 Workflow 的 settled live 与 cold history 在产品过程、terminal answer 和顺序上收敛；ordinary result 不产生第二份 durable body；不合格 Event 不借 Workflow 例外恢复正文。
- **依据 Requirements**：`Live in-progress state converges to completed cold history`、`过程历史从消息正文与事件时序联合恢复`、`结构化过程正文使用单一 Message 恢复`

### 规格

- **规格项**：已完成 Workflow 的 history 事实组合
- **变更类型**：新增
- **原规格值**：不适用（新增）
- **目标规格值**：terminal answer 来自 visible Assistant Message；inner lifecycle/product 来自 qualified persisted Workflow Event；live-only fragment 不恢复
- **依据 Requirements**：`Live in-progress state converges to completed cold history`、`过程历史从消息正文与事件时序联合恢复`

### 主规格

- **变更类型**：修改
- **目标内容**：`ts-stream-history-consistency`
- **依据 Requirements**：`Live in-progress state converges to completed cold history`、`过程历史从消息正文与事件时序联合恢复`、`结构化过程正文使用单一 Message 恢复`

### 遗留规格

- **变更类型**：修改
- **目标内容**：`ts-stream-resume-replay` 继续保留本 change 未触及的 cursor/replay Requirements
- **依据 Requirements**：`过程历史从消息正文与事件时序联合恢复`
