## Function

- **所属 Function**：`conversation-share`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Frontend share interaction behavior

前端（agent-web）SHALL 在每轮问答的助手回复操作行中展示分享按钮（与复制、点赞、点踩、收藏、重新生成位于同一行）。点击分享按钮后进入分享勾选模式：当前会话下所有问答对左侧出现复选框，点击分享按钮对应的问答对默认勾选，用户可继续勾选或取消其他问答对。会话面板底部出现全宽分享按钮（占满绘画面板宽度）。

点击底部分享按钮后弹出分享设置弹窗，包含：有效期选项（24 小时、7 天、一个月、永久，始终展示）、权限选项（"保持同样权限"勾选框，仅 remote 模式展示）。点击弹窗内的生成按钮后，前端调用 `POST /api/v1/sessions/:sessionId/shares`，传入勾选的 `runIds`、`originUrl`（取自 `window.location.origin`）、`expiresIn`、`allowedOps`（remote 模式勾选时为 `HostSiteContext.user.ops`，否则为 null）。成功后展示完整 `shareUrl` 供用户复制。

勾选模式 MUST 支持退出（取消按钮或 ESC），退出后恢复正常对话视图。

分享勾选模式与报告勾选模式互斥：同一时间只能处于其中一种模式。进入报告勾选模式时，分享勾选模式 MUST 自动退出并清空分享已选集合；进入分享勾选模式时，报告勾选模式 MUST 自动退出并清空报告已选集合。

分享勾选选中数量 MUST NOT 超过 `100`。该上限与分享创建 Web API 的 `runIds` `maxItems`（`WEB_SHARE_RUN_IDS_MAX_ITEMS`）和 `RequestRunStoreGateway.listRuns` 单页 `limit` 上限同值。逐项勾选时，当前已选数量已达到 `100` 后，前端 MUST 拒绝继续新增选中并给出提示。全选时，可选项数量超过 `100` 的，前端 MUST 截断为前 `100` 个可选项并给出提示；可选项数量不超过 `100` 的，全选行为不变。取消勾选不受上限影响。前端 MUST 在勾选阶段即强制该上限，MUST NOT 依赖后端 schema 校验兜底，MUST NOT 允许用户勾选超过 `100` 项后再提交。前端限制常量 MUST 由 `agent-web` 边界独立持有，不跨包 import 后端常量。

#### Scenario: Enter selection mode

- **WHEN** 用户点击某问答对操作行的分享按钮
- **THEN** 当前会话所有问答对左侧出现复选框
- **AND** 该问答对默认勾选
- **AND** 会话面板底部出现全宽分享按钮

#### Scenario: Toggle selection in selection mode

- **WHEN** 用户在勾选模式下点击另一个问答对的复选框
- **THEN** 该问答对被勾选
- **AND** 再次点击取消勾选

#### Scenario: Selection rejects additions beyond max items

- **GIVEN** 分享勾选模式已选中 `100` 个问答对
- **WHEN** 用户点击第 `101` 个未勾选问答对的复选框
- **THEN** 前端 MUST 拒绝勾选该问答对
- **AND** 已选集合 MUST 保持 `100` 项不变
- **AND** 前端 MUST 给出已达上限的提示
- **AND** 取消勾选已选项仍有效

#### Scenario: Select all truncates to max items

- **GIVEN** 当前会话有 `120` 个可分享问答对
- **WHEN** 用户点击全选
- **THEN** 前端 MUST 选中前 `100` 个可选项
- **AND** 已选集合大小 MUST 为 `100`
- **AND** 前端 MUST 给出已截断至 `100` 的提示

#### Scenario: Select all within limit selects all

- **GIVEN** 当前会话有 `50` 个可分享问答对
- **WHEN** 用户点击全选
- **THEN** 前端 MUST 选中全部 `50` 个可选项
- **AND** MUST NOT 截断
- **AND** MUST NOT 显示截断提示

#### Scenario: Open share settings dialog

- **WHEN** 用户点击底部全宽分享按钮
- **THEN** 弹出分享设置弹窗
- **AND** 弹窗包含有效期选项（24h/7d/30d/永久）
- **AND** remote 模式下弹窗包含"保持同样权限"勾选框
- **AND** local 模式下弹窗不展示权限勾选框

#### Scenario: Generate share link

- **WHEN** 用户在弹窗中设置有效期和权限后点击生成
- **THEN** 前端调用 `POST /api/v1/sessions/:sessionId/shares`
- **AND** 请求体包含勾选的 `runIds`、`originUrl`、`expiresIn`、`allowedOps`
- **AND** 成功后展示完整 `shareUrl` 供复制

#### Scenario: Exit selection mode

- **WHEN** 用户在勾选模式下点击取消或按 ESC
- **THEN** 退出勾选模式，恢复正常对话视图
- **AND** 复选框消失

#### Scenario: Entering report selection mode exits share selection mode

- **GIVEN** 当前处于分享勾选模式且已勾选若干问答对
- **WHEN** 用户通过右键"生成报告"进入报告勾选模式
- **THEN** 分享勾选模式 MUST 自动退出
- **AND** 分享已选集合 MUST 被清空
- **AND** 报告勾选模式 MUST 激活

#### Scenario: Entering share selection mode exits report selection mode

- **GIVEN** 当前处于报告勾选模式且已勾选若干问答对
- **WHEN** 用户点击分享按钮进入分享勾选模式
- **THEN** 报告勾选模式 MUST 自动退出
- **AND** 报告已选集合 MUST 被清空
- **AND** 分享勾选模式 MUST 激活

## ADDED Requirements

### Requirement: 分享 run 解析使用批量查询

`ConversationShareService` 在创建分享和查看分享路径解析选中 `runIds` 时，MUST 通过一次 `RequestRunStoreGateway.listRuns` 批量查询获取当前可信 scope 下全部选中 run 的 `RequestRunRecord`，构建 `runId -> RequestRunRecord` 的映射，MUST NOT 对每个 `runId` 在解析循环内逐条调用 `loadRun`。单次 `listRuns` 的 `limit` MUST 等于选中 `runIds` 数量（受前端 `100` 上限约束，恒满足 `listRuns` 的 `1..100` 上限），MUST NOT 使用分页循环。

`resolveShareUnit` MUST 从批量查询构建的映射中按 `selectedRunId` 取 `RequestRunRecord`，取不到时 MUST 进入与原 `loadRun === undefined` 等价的 fork copied run anchor 回退分支。映射命中时 MUST 沿用原 scope 与 session 归属校验（`run.tenantId`、`run.subjectId`、`run.agentId`、`run.sessionId` 与当前 scope 一致）和 attempt 精度逻辑。批量解析 MUST 与原逐条解析行为等价：`SHARE_RUN_NOT_RESOLVABLE`、`SHARE_CONTENT_DELETED`、fork copied run anchor 回退、scope 隔离和 attempt 精度语义 MUST 保持不变。

`listRuns` 已按可信 `tenantId`、`subjectId`、`agentId` 过滤，跨 scope 的同值 `runId` 不会出现在结果页中，因此映射缺失即等价于原 `loadRun` 对跨 scope run 返回 `undefined` 的回退路径。

**需求类别**：系统质量属性

**质量属性**：性能/容量、可靠性/恢复

**适用范围**：该 Function

#### Scenario: 创建分享单次批量解析

- **GIVEN** 用户 `(T1, U1, A1)` 在 session `S1` 选中 runs `[R1, R2, R3]` 创建分享
- **WHEN** `createShare` 解析选中 `runIds`
- **THEN** `ConversationShareService` MUST 调用一次 `listRuns({ tenantId: T1, subjectId: U1, agentId: A1, runIds: [R1, R2, R3], offset: 0, limit: 3 })`
- **AND** MUST NOT 对 `R1`、`R2`、`R3` 分别调用 `loadRun`

#### Scenario: 查看分享单次批量解析

- **GIVEN** 分享 `SH1` 的冻结 `runIds` 为 `[R1, R2]`
- **WHEN** `loadSharedConversation` 解析选中 `runIds`
- **THEN** `ConversationShareService` MUST 调用一次 `listRuns` 获取 `R1` 和 `R2` 的记录
- **AND** MUST NOT 对 `R1`、`R2` 分别调用 `loadRun`

#### Scenario: 批量解析与逐条解析行为等价

- **GIVEN** scope `(T1, U1, A1)`、session `S1` 下存在可分享的 runs `[R1, R2]`
- **WHEN** 使用批量 `listRuns` 解析 `runIds`
- **THEN** 分享创建结果 MUST 与逐条 `loadRun` 解析时一致
- **AND** 分享查看结果 MUST 与逐条 `loadRun` 解析时一致

#### Scenario: fork copied run anchor 回退保持不变

- **GIVEN** 选中 `runId` `F1` 是 fork 生成的 copied run anchor，没有 `RequestRunRecord`
- **AND** `F1` 对应的 readable messages 恰好有一个唯一 canonical USER 和 assistant answer
- **WHEN** 使用批量 `listRuns` 解析 `runIds`
- **THEN** `listRuns` 结果 MUST 不包含 `F1`
- **AND** `resolveShareUnit` MUST 进入 fork copied run anchor 回退分支
- **AND** 分享解析 MUST 成功返回 canonical USER 和 `F1` 的 selected messages

#### Scenario: 跨 scope runId 不可见

- **GIVEN** `(T1, U1, A1)` 与 `(T2, U2, A2)` 下存在相同字符串值的 `runId`
- **WHEN** `(T1, U1, A1)` 的分享解析使用 `listRuns` 查询该 `runId`
- **THEN** 结果 MUST 只包含 `(T1, U1, A1)` 的记录
- **AND** 映射缺失该 runId 时 MUST 进入 fork 回退分支或返回不可解析
- **AND** 其他 scope 的记录 MUST 不可见

#### Scenario: 跨 session run 被拒绝

- **GIVEN** scope `(T1, U1, A1)` 下 `runId` `R1` 属于 session `S2` 而非当前分享 session `S1`
- **WHEN** `listRuns` 返回 `R1` 的记录
- **THEN** `resolveShareUnit` MUST 校验 `run.sessionId !== S1` 并返回 null
- **AND** 分享创建 MUST 抛出 `SHARE_RUN_NOT_RESOLVABLE`，分享查看 MUST 返回 `SHARE_CONTENT_DELETED`

## Function 变更汇总

### 描述

- **变更类型**：修改
- **目标内容**：对话分享 run 解析从 N 次逐条 `loadRun` 收敛为一次 `listRuns` 批量查询；前端勾选选中数量上限为 `100`，与批量查询单页容量和分享 API schema 对齐。
- **依据 Requirements**：`Frontend share interaction behavior`、`分享 run 解析使用批量查询`

### 输入

- **变更类型**：修改
- **目标内容**：分享解析输入选中 `runIds` 集合，受前端 `100` 上限约束；批量查询以该集合为 `runIds` 过滤条件。
- **依据 Requirements**：`Frontend share interaction behavior`、`分享 run 解析使用批量查询`

### 输出

- **变更类型**：修改
- **目标内容**：分享创建和查看结果与逐条解析时等价；前端勾选集合大小不超过 `100`。
- **依据 Requirements**：`分享 run 解析使用批量查询`

### 结果

- **变更类型**：修改
- **目标内容**：批量解析在保持 scope 隔离、attempt 精度、fork 回退和 safe error 语义的前提下，将 gateway 调用次数从 N 降为 1。
- **依据 Requirements**：`分享 run 解析使用批量查询`
