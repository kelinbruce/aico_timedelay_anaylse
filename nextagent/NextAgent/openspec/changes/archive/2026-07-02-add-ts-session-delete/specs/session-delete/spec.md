## ADDED Requirements

### Requirement: 会话删除命令受 runtime 和 session 边界控制

系统 SHALL 提供受控会话删除能力。Web channel SHALL 通过 `DELETE /api/v1/sessions/:sessionId` 接受删除请求，并 MUST 只从可信 auth/channel boundary 获取 `IdentityContext`，只由 runtime 内部解析 trusted Agent Scope。客户端请求体、查询字符串、metadata、模型输出或 Capability 参数 MUST NOT 提供或覆盖 `tenantId`、`subjectId` 或 `agentId`。

Runtime session facade SHALL 将删除命令委托给 `agent-session` 的会话领域边界；`agent-channel-web` MUST NOT 直接访问 gateway、SQLite row、session store 或 message store。删除成功响应 SHALL 使用无内容成功结果或等价空 body 成功结果，MUST NOT 返回被删除会话的 messages、timeline、run、checkpoint、attachment content、annotation detail、share detail 或 persistence record。

#### Scenario: 删除当前 scope 下的会话成功
- **GIVEN** 当前 trusted owner scope 和 Agent scope 下存在 session `S1`
- **WHEN** 客户端请求 `DELETE /api/v1/sessions/S1`
- **THEN** Web channel MUST 构造 runtime-facing 删除命令
- **AND** Runtime MUST 使用 trusted Agent Scope 委托 `agent-session`
- **AND** 删除成功后响应 MUST 表示成功且不包含会话内容

#### Scenario: 客户端不能提供 owner 或 agent scope
- **WHEN** 客户端删除会话时在请求体、查询字符串或 metadata 中携带 `tenantId`、`subjectId` 或 `agentId`
- **THEN** 系统 MUST 忽略或拒绝这些客户端字段
- **AND** 删除命令 MUST 只使用 trusted identity 和 trusted Agent Scope

#### Scenario: Web channel 不直接操作持久化
- **WHEN** `agent-channel-web` 处理会话删除 route
- **THEN** 它 MUST 通过 runtime-facing session port 调用删除能力
- **AND** MUST NOT 直接导入或调用 gateway-local store、SQLite row mapper 或 `agent-session` 私有实现

### Requirement: 会话删除保持 owner scope 和 Agent scope 隔离

系统 SHALL 对删除操作执行 owner scope 和 Agent scope 隔离。删除目标必须是当前 trusted `(tenantId, subjectId, agentId, sessionId)` 下的会话。跨 owner、跨 Agent 或不存在的 session 删除 MUST 返回 safe not-found outcome，且 MUST NOT 泄露目标 session 是否存在于其他 owner 或 Agent scope。

#### Scenario: 删除不能跨 owner scope
- **GIVEN** session `S1` 属于 owner scope `(T1, U1)` 和 Agent `A1`
- **WHEN** owner scope `(T1, U2)` 或 `(T2, U1)` 请求删除 `S1`
- **THEN** 系统 MUST 返回 safe not-found outcome
- **AND** `S1` 在原 owner scope 下 MUST 保持存在

#### Scenario: 删除不能跨 Agent scope
- **GIVEN** session `S1` 属于 owner scope `(T1, U1)` 和 Agent `A1`
- **WHEN** 同一 owner scope 下 Agent `A2` 的请求删除 `S1`
- **THEN** 系统 MUST 返回 safe not-found outcome
- **AND** `S1` 在 Agent `A1` scope 下 MUST 保持存在

#### Scenario: 不存在会话删除失败关闭
- **WHEN** 客户端请求删除当前 scope 下不存在的 session
- **THEN** 系统 MUST 返回 safe not-found outcome
- **AND** MUST NOT 执行宽松删除或跨 scope 查找

### Requirement: 运行中会话删除失败关闭

系统 SHALL 在删除会话前检查该会话是否存在非 terminal active 或 in-flight request run。若存在非 terminal run，删除 MUST 失败关闭并返回 safe conflict outcome。系统 MUST NOT 在本删除命令中隐式 cancel、retry、terminal commit、隐藏消息、修改 active context 或推进 request lifecycle。

已经 terminal committed 且无 in-flight run 的会话可以删除。删除成功后，该会话的 stream subscription、history read、conversation preview、session list 和 current active session 查询 MUST 不再返回该会话内容；已经建立的 stream connection MUST 以 safe not-found、safe closed 或等价安全终止方式结束，MUST NOT 继续投影被删除会话的新事件。

#### Scenario: 非 terminal run 阻止删除
- **GIVEN** session `S1` 下存在 status 为 `QUEUED`、`RUNNING`、`CANCEL_REQUESTED` 或其他非 terminal 状态的 request run
- **WHEN** 用户请求删除 `S1`
- **THEN** 系统 MUST 返回 safe conflict outcome
- **AND** MUST NOT 删除 `S1` 的 session、message、timeline、run、checkpoint 或 active context facts

#### Scenario: 删除不隐式取消运行中请求
- **GIVEN** session `S1` 有正在执行的 run `R1`
- **WHEN** 用户请求删除 `S1`
- **THEN** 系统 MUST NOT 调用 cancel command
- **AND** MUST NOT 将 `R1` terminal commit 为 canceled、failed 或 completed

#### Scenario: 删除后历史读取不可见
- **GIVEN** session `S1` 已成功删除
- **WHEN** 客户端请求 `GET /api/v1/sessions/S1/conversation`
- **THEN** 系统 MUST 返回 safe not-found outcome
- **AND** MUST NOT 返回删除前的 visible history

### Requirement: 会话删除使用单事务物理删除主路径事实

系统 SHALL 将会话删除建模为 owner+agent scoped composite delete。gateway-local MUST 在一个数据库事务内删除该 session 的主路径会话事实和从属索引事实。删除范围 MUST 至少覆盖 session、messages、active context state/items、request runs、timeline events、checkpoints、conversation annotations、conversation shares、favorite/session annotation list projection，以及会话搜索/预览所依赖的会话从属事实。

删除 MUST 是物理删除；本 change 不引入 `DELETED` session retained state、回收站、恢复 API 或软删除列表。gateway-local MUST 使用 dedicated business tables 和 scoped coordinates 删除，MUST NOT 通过 generic `records(store,key,json)` 承载删除状态，MUST NOT 在 JS 中拉取 owner 或 Agent scope 下全部会话后过滤。

如果事务中任何一部分删除失败，整个删除 MUST 回滚；删除失败后会话 MUST 保持可按原 scope 读取，系统 MUST 返回显式 safe error。

#### Scenario: 单事务删除会话主路径事实
- **GIVEN** session `S1` 下存在 messages、request runs、timeline events、active context items 和 checkpoints
- **WHEN** 删除 `S1` 成功
- **THEN** 后续按当前 scope 查询 session list、conversation、timeline replay、active context 或 checkpoint MUST 不再返回 `S1` 的事实
- **AND** 这些删除 MUST 在一个 gateway-local transaction 中完成

#### Scenario: 删除失败回滚
- **GIVEN** gateway-local 删除 session `S1` 的 messages 后删除 timeline events 失败
- **WHEN** 删除事务结束
- **THEN** 系统 MUST 回滚整个事务
- **AND** 后续查询 MUST 仍能按原 scope 读取 `S1` 的完整未删除状态
- **AND** Web API MUST 返回显式 safe error

#### Scenario: 删除不创建软删除会话列表项
- **WHEN** session `S1` 删除成功
- **THEN** 会话列表 MUST NOT 返回 `S1` 的 tombstone、deleted marker 或空标题列表项
- **AND** 系统 MUST NOT 提供恢复 `S1` 的 Web API

### Requirement: 前端会话列表提供删除交互

前端 SHALL 在普通会话列表、local/immersive search dialog 和 collaborative PIU History Popover 的会话行操作中提供删除入口。删除入口 MUST 复用现有列表项动作模式，并提供确认交互，避免单击误删。删除按钮、确认按钮、取消按钮、loading/error 提示和 accessible label MUST 使用现有 i18n 资源，不得硬编码可见文案。

删除成功后，前端 SHALL 使用删除前的当前列表条件刷新列表窗口：普通列表保持普通最近/展开偏好，搜索态保持当前关键词、创建时间范围和已加载窗口，收藏或 PIU History Popover 保持对应 host runtime 的当前列表状态。删除失败时，前端 MUST 保留原列表项并展示 safe error。

当被删除会话是当前打开会话时，local/immersive 前端 SHALL 进入安全的未选中或新会话状态；collaborative PIU SHALL 清除既有 `nextagent:AIAgentPIU:activeSessionId` 中的被删除 session id 或切换到安全未选中状态。前端 MUST NOT 继续展示已删除会话的历史内容作为当前有效会话。

#### Scenario: 普通会话列表删除并刷新
- **GIVEN** Sidebar 普通会话列表显示 session `S1`
- **WHEN** 用户通过行操作确认删除 `S1`
- **THEN** 前端 MUST 调用 `DELETE /api/v1/sessions/S1`
- **AND** 删除成功后 MUST 从当前列表窗口移除 `S1`
- **AND** MUST 按删除前的普通列表条件刷新或补齐列表

#### Scenario: 搜索态删除保留过滤条件
- **GIVEN** search dialog 当前以 `q=告警` 和完整创建时间范围展示搜索结果
- **WHEN** 用户删除其中的 session `S1`
- **THEN** 删除成功后前端 MUST 使用相同 `q`、创建时间范围和已加载窗口刷新搜索结果
- **AND** MUST NOT 恢复为普通会话列表

#### Scenario: 删除当前打开会话后不显示旧历史
- **GIVEN** 用户当前打开 session `S1`
- **WHEN** 用户从会话列表确认删除 `S1` 且后端返回成功
- **THEN** 前端 MUST 清除当前有效 session selection 或创建安全的新会话状态
- **AND** MUST NOT 继续把 `S1` 的历史内容显示为当前会话

#### Scenario: 删除失败保留列表项
- **WHEN** 用户删除 session `S1` 但后端返回 safe conflict 或 safe error
- **THEN** 前端 MUST 保留 `S1` 列表项
- **AND** MUST 展示可访问的失败提示
